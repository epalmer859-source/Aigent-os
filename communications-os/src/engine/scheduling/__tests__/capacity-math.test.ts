// ============================================================
// Capacity Math Engine — Tests
//
// Every test traces to a rule in unified-scheduling-spec.md.
// Capacity is now queue-based: checkCapacityFromQueue computes
// remaining minutes from the actual scheduling_jobs queue.
// ============================================================

import { describe, it, expect } from "vitest";
import {
  calculateAvailableMinutes,
  calculateJobCost,
  checkCapacityFromQueue,
  parseHHMM,
  type TechProfile,
} from "../capacity-math";
import type { QueuedJob } from "../queue-insertion";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Standard 8-5 tech, 30-min lunch at noon. */
const STANDARD_TECH: TechProfile = {
  id: "tech-1",
  businessId: "biz-1",
  workingHoursStart: "08:00",
  workingHoursEnd: "17:00",
  lunchStart: "12:00",
  lunchEnd: "12:30",
  overtimeCapMinutes: 0,
};

/** Tech with 30 minutes overtime cap. */
const OVERTIME_TECH: TechProfile = {
  ...STANDARD_TECH,
  id: "tech-2",
  overtimeCapMinutes: 30,
};

/** Custom hours tech: 9-4, 1-hour lunch. */
const CUSTOM_TECH: TechProfile = {
  id: "tech-3",
  businessId: "biz-1",
  workingHoursStart: "09:00",
  workingHoursEnd: "16:00",
  lunchStart: "12:00",
  lunchEnd: "13:00",
  overtimeCapMinutes: 0,
};

function makeQueuedJob(durationMinutes: number, overrides: Partial<QueuedJob> = {}): QueuedJob {
  return {
    id: `job-${Math.random().toString(36).slice(2, 8)}`,
    queuePosition: 0,
    status: "NOT_STARTED",
    timePreference: "NO_PREFERENCE",
    addressLat: 33.80,
    addressLng: -84.40,
    manualPosition: false,
    estimatedDurationMinutes: durationMinutes,
    driveTimeMinutes: 15,
    ...overrides,
  };
}

// ── parseHHMM ─────────────────────────────────────────────────────────────────

describe("parseHHMM", () => {
  it("parses standard times", () => {
    expect(parseHHMM("08:00")).toBe(480);
    expect(parseHHMM("12:00")).toBe(720);
    expect(parseHHMM("17:00")).toBe(1020);
    expect(parseHHMM("00:00")).toBe(0);
    expect(parseHHMM("23:59")).toBe(1439);
  });

  it("rejects invalid formats", () => {
    expect(() => parseHHMM("8")).toThrow("Invalid time format");
    expect(() => parseHHMM("25:00")).toThrow("Invalid time value");
    expect(() => parseHHMM("12:60")).toThrow("Invalid time value");
  });
});

// ── calculateAvailableMinutes ─────────────────────────────────────────────────

describe("calculateAvailableMinutes", () => {
  it("standard 8-5 tech with 30-min lunch = 510 total, 240 morning, 270 afternoon", () => {
    const result = calculateAvailableMinutes(STANDARD_TECH);

    expect(result.totalMinutes).toBe(510);
    expect(result.morningMinutes).toBe(240);
    expect(result.afternoonMinutes).toBe(270);
  });

  it("tech with 30-min overtime cap", () => {
    const result = calculateAvailableMinutes(OVERTIME_TECH);

    expect(result.totalMinutes).toBe(540);
    expect(result.morningMinutes).toBe(240);
    expect(result.afternoonMinutes).toBe(300);
  });

  it("custom hours 9-4 with 1-hour lunch", () => {
    const result = calculateAvailableMinutes(CUSTOM_TECH);

    expect(result.totalMinutes).toBe(360);
    expect(result.morningMinutes).toBe(180);
    expect(result.afternoonMinutes).toBe(180);
  });

  it("throws when workingHoursEnd <= workingHoursStart", () => {
    expect(() =>
      calculateAvailableMinutes({ ...STANDARD_TECH, workingHoursEnd: "08:00" }),
    ).toThrow("must be after workingHoursStart");

    expect(() =>
      calculateAvailableMinutes({ ...STANDARD_TECH, workingHoursEnd: "07:00" }),
    ).toThrow("must be after workingHoursStart");
  });

  it("throws when lunchStart < workingHoursStart", () => {
    expect(() =>
      calculateAvailableMinutes({ ...STANDARD_TECH, lunchStart: "07:00" }),
    ).toThrow("cannot be before workingHoursStart");
  });

  it("throws when lunchEnd <= lunchStart", () => {
    expect(() =>
      calculateAvailableMinutes({ ...STANDARD_TECH, lunchEnd: "12:00" }),
    ).toThrow("must be after lunchStart");

    expect(() =>
      calculateAvailableMinutes({ ...STANDARD_TECH, lunchEnd: "11:00" }),
    ).toThrow("must be after lunchStart");
  });

  it("throws when lunchEnd > workingHoursEnd", () => {
    expect(() =>
      calculateAvailableMinutes({ ...STANDARD_TECH, lunchEnd: "18:00" }),
    ).toThrow("cannot be after workingHoursEnd");
  });
});

// ── calculateJobCost — multiplier stack ───────────────────────────────────────

describe("calculateJobCost", () => {
  it("owner says 45 min, HIGH volatility → exact walkthrough", () => {
    const result = calculateJobCost(45, "HIGH", 15);

    expect(result.bookedDurationMinutes).toBe(95);
    expect(result.driveTimeMinutes).toBe(15);
    expect(result.totalCostMinutes).toBe(110);
  });

  it("owner says 20 min → short-duration floor kicks in", () => {
    const result = calculateJobCost(20, "LOW", 10);

    expect(result.bookedDurationMinutes).toBe(55);
    expect(result.driveTimeMinutes).toBe(10);
    expect(result.totalCostMinutes).toBe(65);
  });

  it("LOW vs HIGH volatility comparison on same base input", () => {
    const low = calculateJobCost(60, "LOW", 0);
    const high = calculateJobCost(60, "HIGH", 0);

    expect(low.bookedDurationMinutes).toBe(95);
    expect(high.bookedDurationMinutes).toBe(125);
    expect(high.bookedDurationMinutes).toBeGreaterThan(low.bookedDurationMinutes);
  });

  it("no extra buffer added after volatility multiplier", () => {
    const result = calculateJobCost(45, "MEDIUM", 0);

    expect(result.bookedDurationMinutes).toBe(85);
  });

  it("rounds up to nearest 5 minutes", () => {
    const result = calculateJobCost(50, "LOW", 0);
    expect(result.bookedDurationMinutes).toBe(80);
    expect(result.bookedDurationMinutes % 5).toBe(0);
  });

  it("drive time is added AFTER rounding, not before", () => {
    const result = calculateJobCost(45, "HIGH", 7);

    expect(result.bookedDurationMinutes).toBe(95);
    expect(result.totalCostMinutes).toBe(102);
  });
});

// ── checkCapacityFromQueue ──────────────────────────────────────────────────

describe("checkCapacityFromQueue", () => {
  it("passes when queue is empty", () => {
    const result = checkCapacityFromQueue([], STANDARD_TECH, 100, "NO_PREFERENCE");

    expect(result.fits).toBe(true);
    expect(result.remainingTotal).toBe(510);
  });

  it("fails when queue fills the day", () => {
    const queue = [makeQueuedJob(510)];
    const result = checkCapacityFromQueue(queue, STANDARD_TECH, 1, "NO_PREFERENCE");

    expect(result.fits).toBe(false);
    expect(result.remainingTotal).toBe(0);
  });

  it("partial queue: remaining capacity correct", () => {
    const queue = [makeQueuedJob(200)];
    const result = checkCapacityFromQueue(queue, STANDARD_TECH, 100, "NO_PREFERENCE");

    expect(result.fits).toBe(true);
    expect(result.remainingTotal).toBe(310);
  });

  it("MORNING preference checks morning sub-capacity", () => {
    // Fill most of morning (240 total morning minutes)
    const queue = [makeQueuedJob(200)];
    // 40 min remaining in morning — 50 min job won't fit morning
    const result = checkCapacityFromQueue(queue, STANDARD_TECH, 50, "MORNING");

    expect(result.fits).toBe(false);
    expect(result.remainingMorning).toBeLessThan(50);
  });

  it("AFTERNOON preference checks afternoon sub-capacity", () => {
    // Fill morning completely (240 min), then fill most of afternoon
    const queue = [
      makeQueuedJob(240, { driveTimeMinutes: 0 }),
      makeQueuedJob(250, { driveTimeMinutes: 0 }),
    ];
    const result = checkCapacityFromQueue(queue, STANDARD_TECH, 25, "AFTERNOON");

    expect(result.fits).toBe(false);
  });

  it("SOONEST only checks total capacity", () => {
    // Fill morning completely
    const queue = [makeQueuedJob(240, { driveTimeMinutes: 0 })];
    const result = checkCapacityFromQueue(queue, STANDARD_TECH, 100, "SOONEST");

    expect(result.fits).toBe(true);
  });

  it("NO_PREFERENCE only checks total capacity", () => {
    // Fill morning with 200 min
    const queue = [makeQueuedJob(200)];
    const result = checkCapacityFromQueue(queue, STANDARD_TECH, 100, "NO_PREFERENCE");

    expect(result.fits).toBe(true);
  });

  it("morning sub-capacity: 3 morning-only when only 2 fit = third rejected", () => {
    // Morning = 240 min. Two 100-min jobs fill 200, leaving 40.
    const queue = [
      makeQueuedJob(100, { driveTimeMinutes: 0 }),
      makeQueuedJob(100, { driveTimeMinutes: 0 }),
    ];
    const result = checkCapacityFromQueue(queue, STANDARD_TECH, 100, "MORNING");

    expect(result.fits).toBe(false);
  });

  it("overtime tech has more capacity", () => {
    // OVERTIME_TECH has 540 total minutes
    const queue = [makeQueuedJob(510)];
    const result = checkCapacityFromQueue(queue, OVERTIME_TECH, 25, "NO_PREFERENCE");

    expect(result.fits).toBe(true);
    expect(result.remainingTotal).toBe(30);
  });

  it("multiple jobs in queue are summed correctly", () => {
    const queue = [
      makeQueuedJob(100),
      makeQueuedJob(100),
      makeQueuedJob(100),
    ];
    const result = checkCapacityFromQueue(queue, STANDARD_TECH, 100, "NO_PREFERENCE");

    // 510 - 300 = 210 remaining
    expect(result.fits).toBe(true);
    expect(result.remainingTotal).toBe(210);
  });
});
