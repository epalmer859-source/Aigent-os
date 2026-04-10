// ============================================================
// Drift Tracker — Tests
//
// Every test traces to a rule in unified-scheduling-spec.md.
// Pure functions. No DB. No side effects.
// ============================================================

import { describe, it, expect } from "vitest";
import {
  recordJobDrift,
  getCumulativeDrift,
  evaluatePerJobDrift,
  evaluateCumulativeDrift,
  checkWindowBoundaryCrossing,
  evaluateFullDrift,
  type DriftRecord,
  type OriginalWindow,
} from "../drift-tracker";

// ── recordJobDrift ───────────────────────────────────────────────────────────

describe("recordJobDrift", () => {
  it("positive drift: actual > estimated", () => {
    const result = recordJobDrift("job-1", 60, 75);
    expect(result.jobId).toBe("job-1");
    expect(result.estimatedDurationMinutes).toBe(60);
    expect(result.actualDurationMinutes).toBe(75);
    expect(result.driftMinutes).toBe(15);
  });

  it("negative drift: actual < estimated", () => {
    const result = recordJobDrift("job-2", 60, 50);
    expect(result.driftMinutes).toBe(-10);
  });

  it("zero drift: actual equals estimated", () => {
    const result = recordJobDrift("job-3", 45, 45);
    expect(result.driftMinutes).toBe(0);
  });
});

// ── getCumulativeDrift ───────────────────────────────────────────────────────

describe("getCumulativeDrift", () => {
  it("three equal positive drifts sum correctly", () => {
    const records: DriftRecord[] = [
      recordJobDrift("j-1", 60, 70),  // +10
      recordJobDrift("j-2", 60, 70),  // +10
      recordJobDrift("j-3", 60, 70),  // +10
    ];
    const result = getCumulativeDrift(records);
    expect(result.totalDriftMinutes).toBe(30);
    expect(result.jobDrifts).toHaveLength(3);
  });

  it("mixed positive and negative drifts sum correctly", () => {
    const records: DriftRecord[] = [
      recordJobDrift("j-1", 60, 80),  // +20
      recordJobDrift("j-2", 60, 55),  // -5
      recordJobDrift("j-3", 60, 75),  // +15
    ];
    const result = getCumulativeDrift(records);
    expect(result.totalDriftMinutes).toBe(30);
  });

  it("three equal negative drifts sum correctly", () => {
    const records: DriftRecord[] = [
      recordJobDrift("j-1", 60, 50),  // -10
      recordJobDrift("j-2", 60, 50),  // -10
      recordJobDrift("j-3", 60, 50),  // -10
    ];
    const result = getCumulativeDrift(records);
    expect(result.totalDriftMinutes).toBe(-30);
  });
});

// ── evaluatePerJobDrift ──────────────────────────────────────────────────────

describe("evaluatePerJobDrift", () => {
  it("10 min drift -> silent", () => {
    expect(evaluatePerJobDrift(10).action).toBe("silent");
  });

  it("14 min drift -> silent", () => {
    expect(evaluatePerJobDrift(14).action).toBe("silent");
  });

  it("15 min drift -> internal_update", () => {
    expect(evaluatePerJobDrift(15).action).toBe("internal_update");
  });

  it("30 min drift -> internal_update", () => {
    expect(evaluatePerJobDrift(30).action).toBe("internal_update");
  });

  it("45 min drift -> internal_update", () => {
    expect(evaluatePerJobDrift(45).action).toBe("internal_update");
  });

  it("46 min drift -> communicate_customer", () => {
    const result = evaluatePerJobDrift(46);
    expect(result.action).toBe("communicate_customer");
    if (result.action === "communicate_customer") {
      expect(result.reason).toBe("variance_exceeded_45min");
    }
  });

  it("-20 min drift -> internal_update (uses absolute value)", () => {
    expect(evaluatePerJobDrift(-20).action).toBe("internal_update");
  });
});

// ── evaluateCumulativeDrift ──────────────────────────────────────────────────

describe("evaluateCumulativeDrift", () => {
  it("25 min -> not triggered", () => {
    const result = evaluateCumulativeDrift(25);
    expect(result.triggered).toBe(false);
    expect(result.cumulativeDriftMinutes).toBe(25);
    expect(result.reason).toBeUndefined();
  });

  it("29 min -> not triggered", () => {
    const result = evaluateCumulativeDrift(29);
    expect(result.triggered).toBe(false);
  });

  it("30 min -> triggered", () => {
    const result = evaluateCumulativeDrift(30);
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("cumulative_drift_exceeded");
    expect(result.cumulativeDriftMinutes).toBe(30);
  });

  it("45 min -> triggered", () => {
    const result = evaluateCumulativeDrift(45);
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("cumulative_drift_exceeded");
  });

  it("-35 min -> triggered (uses absolute value)", () => {
    const result = evaluateCumulativeDrift(-35);
    expect(result.triggered).toBe(true);
    expect(result.reason).toBe("cumulative_drift_exceeded");
    expect(result.cumulativeDriftMinutes).toBe(-35);
  });
});

// ── checkWindowBoundaryCrossing ──────────────────────────────────────────────

describe("checkWindowBoundaryCrossing", () => {
  const LUNCH = 720; // 12:00 = 720 minutes

  it("morning job pushed past lunch -> crossed", () => {
    // Original window: 480–720 (8:00–12:00), projected start at 730
    const result = checkWindowBoundaryCrossing(480, 720, 730, LUNCH);
    expect(result.crossed).toBe(true);
    expect(result.fromWindow).toBe("morning");
    expect(result.toWindow).toBe("afternoon");
  });

  it("morning job stays before lunch -> not crossed", () => {
    const result = checkWindowBoundaryCrossing(480, 720, 600, LUNCH);
    expect(result.crossed).toBe(false);
  });

  it("afternoon job stays afternoon -> not crossed", () => {
    // Original window: 720–1020 (12:00–17:00), projected at 780
    const result = checkWindowBoundaryCrossing(720, 1020, 780, LUNCH);
    expect(result.crossed).toBe(false);
  });

  it("small variance crossing noon still triggers", () => {
    // Original window ends exactly at lunch, projected 1 minute past
    const result = checkWindowBoundaryCrossing(480, 720, 720, LUNCH);
    expect(result.crossed).toBe(true);
    expect(result.fromWindow).toBe("morning");
    expect(result.toWindow).toBe("afternoon");
  });

  it("afternoon job pulled into morning -> crossed", () => {
    const result = checkWindowBoundaryCrossing(720, 1020, 700, LUNCH);
    expect(result.crossed).toBe(true);
    expect(result.fromWindow).toBe("afternoon");
    expect(result.toWindow).toBe("morning");
  });
});

// ── evaluateFullDrift ────────────────────────────────────────────────────────

describe("evaluateFullDrift", () => {
  const LUNCH = 720;

  it("no drift -> all silent", () => {
    const records: DriftRecord[] = [
      recordJobDrift("j-1", 60, 60),
      recordJobDrift("j-2", 45, 45),
      recordJobDrift("j-3", 30, 30),
    ];
    const projectedStarts = [480, 540, 600]; // all morning, no crossing
    const windows: OriginalWindow[] = [
      { windowStart: 480, windowEnd: 540 },
      { windowStart: 540, windowEnd: 585 },
      { windowStart: 585, windowEnd: 615 },
    ];

    const evals = evaluateFullDrift(records, projectedStarts, windows, LUNCH);
    expect(evals).toHaveLength(3);
    expect(evals.every((e) => e.action === "silent")).toBe(true);
  });

  it("cumulative drift >= 30 -> full_recalculation for all jobs", () => {
    const records: DriftRecord[] = [
      recordJobDrift("j-1", 60, 75),  // +15
      recordJobDrift("j-2", 60, 80),  // +20
      recordJobDrift("j-3", 60, 55),  // -5
    ];
    // cumulative = +30 → triggered
    const projectedStarts = [480, 555, 635];
    const windows: OriginalWindow[] = [
      { windowStart: 480, windowEnd: 540 },
      { windowStart: 540, windowEnd: 600 },
      { windowStart: 600, windowEnd: 660 },
    ];

    const evals = evaluateFullDrift(records, projectedStarts, windows, LUNCH);
    expect(evals).toHaveLength(3);
    expect(evals.every((e) => e.action === "full_recalculation")).toBe(true);
    expect(evals.every((e) => e.reason === "cumulative_drift_exceeded")).toBe(true);
  });

  it("window boundary crossed -> communicate_customer", () => {
    const records: DriftRecord[] = [
      recordJobDrift("j-1", 60, 65),  // +5 (silent per-job)
    ];
    // cumulative = +5 (not triggered)
    // But projected start crosses into afternoon
    const projectedStarts = [725]; // past lunch
    const windows: OriginalWindow[] = [
      { windowStart: 480, windowEnd: 720 }, // morning job
    ];

    const evals = evaluateFullDrift(records, projectedStarts, windows, LUNCH);
    expect(evals).toHaveLength(1);
    expect(evals[0]!.action).toBe("communicate_customer");
    expect(evals[0]!.reason).toBe("window_crossed_morning_to_afternoon");
  });

  it("mixed actions across multiple jobs", () => {
    const records: DriftRecord[] = [
      recordJobDrift("j-1", 60, 62),   // +2 → silent
      recordJobDrift("j-2", 60, 80),   // +20 → internal_update
      recordJobDrift("j-3", 60, 63),   // +3 → silent per-job, but crosses window
    ];
    // cumulative = +25 (not triggered)
    const projectedStarts = [480, 542, 725]; // j-3 crosses into afternoon
    const windows: OriginalWindow[] = [
      { windowStart: 480, windowEnd: 540 },
      { windowStart: 540, windowEnd: 600 },
      { windowStart: 600, windowEnd: 720 }, // morning job pushed past lunch
    ];

    const evals = evaluateFullDrift(records, projectedStarts, windows, LUNCH);
    expect(evals).toHaveLength(3);
    expect(evals[0]!.action).toBe("silent");
    expect(evals[1]!.action).toBe("internal_update");
    expect(evals[2]!.action).toBe("communicate_customer");
    expect(evals[2]!.reason).toBe("window_crossed_morning_to_afternoon");
  });
});
