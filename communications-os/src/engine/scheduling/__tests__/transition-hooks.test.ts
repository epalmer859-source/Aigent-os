// ============================================================
// Tests for src/engine/scheduling/transition-hooks.ts
// F18: GPS mismatch detection (threshold: 8 km ≈ 15 min drive)
// F19: Suspiciously fast completion flagging (threshold: 50%)
// ============================================================

import { describe, it, expect, vi } from "vitest";
import {
  detectGpsMismatch,
  detectFastCompletion,
  persistGpsMismatch,
  persistFastCompletion,
  type GpsMismatchInput,
  type FastCompletionInput,
  type AccountabilityDb,
  type GpsMismatchResult,
  type FastCompletionResult,
} from "../transition-hooks";

// ── F18: GPS mismatch detection ─────────────────────────────────────────────

describe("detectGpsMismatch", () => {
  const baseInput: GpsMismatchInput = {
    jobId: "job-1",
    technicianGpsLat: 40.7128,
    technicianGpsLng: -74.006,
    jobAddressLat: 40.7128,
    jobAddressLng: -74.006,
  };

  it("returns flagged=false when tech is at the job address (0 km)", () => {
    const result = detectGpsMismatch(baseInput);
    expect(result.flagged).toBe(false);
    expect(result.distanceKm).toBe(0);
    expect(result.thresholdKm).toBe(8.0);
    expect(result.jobId).toBe("job-1");
  });

  it("returns flagged=false when tech is within threshold (< 8km)", () => {
    // ~5.5 km north of base position (0.05 degrees lat ≈ 5.5 km)
    const result = detectGpsMismatch({
      ...baseInput,
      technicianGpsLat: 40.7628,
    });
    expect(result.flagged).toBe(false);
    expect(result.distanceKm).toBeLessThan(8.0);
  });

  it("returns flagged=true when tech is beyond threshold (> 8km)", () => {
    // ~11 km away (0.1 degrees lat ≈ 11 km)
    const result = detectGpsMismatch({
      ...baseInput,
      technicianGpsLat: 40.8128,
    });
    expect(result.flagged).toBe(true);
    expect(result.distanceKm).toBeGreaterThan(8.0);
  });

  it("returns flagged=true for completely different locations", () => {
    // Los Angeles vs New York
    const result = detectGpsMismatch({
      ...baseInput,
      technicianGpsLat: 34.0522,
      technicianGpsLng: -118.2437,
    });
    expect(result.flagged).toBe(true);
    expect(result.distanceKm).toBeGreaterThan(3000);
  });

  it("rounds distanceKm to 2 decimal places", () => {
    const result = detectGpsMismatch({
      ...baseInput,
      technicianGpsLat: 40.7628,
    });
    const decimals = result.distanceKm.toString().split(".")[1] ?? "";
    expect(decimals.length).toBeLessThanOrEqual(2);
  });

  it("preserves jobId in result", () => {
    const result = detectGpsMismatch({ ...baseInput, jobId: "xyz-123" });
    expect(result.jobId).toBe("xyz-123");
  });
});

// ── F19: Suspiciously fast completion (threshold: 50%) ─────────────────────

describe("detectFastCompletion", () => {
  const baseTime = new Date("2026-04-09T10:00:00Z");

  function makeInput(actualMinutes: number, estimatedMinutes: number): FastCompletionInput {
    return {
      jobId: "job-1",
      estimatedDurationMinutes: estimatedMinutes,
      arrivedAt: baseTime,
      completedAt: new Date(baseTime.getTime() + actualMinutes * 60_000),
    };
  }

  it("flags when actual < 50% of estimated (suspiciously fast)", () => {
    // 20 min actual vs 60 min estimated = 33%
    const result = detectFastCompletion(makeInput(20, 60));
    expect(result.flagged).toBe(true);
    expect(result.percentOfEstimate).toBeLessThan(50);
    expect(result.jobId).toBe("job-1");
  });

  it("does not flag when actual >= 50% of estimated", () => {
    // 35 min actual vs 60 min estimated = 58%
    const result = detectFastCompletion(makeInput(35, 60));
    expect(result.flagged).toBe(false);
    expect(result.percentOfEstimate).toBeGreaterThanOrEqual(50);
  });

  it("does not flag when actual equals estimated", () => {
    const result = detectFastCompletion(makeInput(60, 60));
    expect(result.flagged).toBe(false);
    expect(result.percentOfEstimate).toBe(100);
  });

  it("does not flag when actual exceeds estimated", () => {
    const result = detectFastCompletion(makeInput(120, 60));
    expect(result.flagged).toBe(false);
    expect(result.percentOfEstimate).toBe(200);
  });

  it("does not flag when estimated is 0 (division guard)", () => {
    const result = detectFastCompletion(makeInput(10, 0));
    expect(result.flagged).toBe(false);
    expect(result.percentOfEstimate).toBe(100);
  });

  it("flags at exactly the boundary (just under 50%)", () => {
    // 29.9 min / 60 min = 49.8%
    const result = detectFastCompletion(makeInput(29.9, 60));
    expect(result.flagged).toBe(true);
  });

  it("does not flag at exactly 50%", () => {
    // 30 min / 60 min = 50%
    const result = detectFastCompletion(makeInput(30, 60));
    expect(result.flagged).toBe(false);
  });

  it("rounds actualMinutes to 1 decimal place", () => {
    const result = detectFastCompletion(makeInput(10.123, 60));
    const decimals = result.actualMinutes.toString().split(".")[1] ?? "";
    expect(decimals.length).toBeLessThanOrEqual(1);
  });

  it("preserves estimatedMinutes in result", () => {
    const result = detectFastCompletion(makeInput(30, 90));
    expect(result.estimatedMinutes).toBe(90);
  });
});

// ── Accountability Persistence ───────────────────────────────────────────────

function createMockDb(): AccountabilityDb {
  return {
    recordGpsMismatch: vi.fn().mockResolvedValue(undefined),
    getGpsMismatchCount: vi.fn().mockResolvedValue(0),
    recordFastCompletion: vi.fn().mockResolvedValue(undefined),
    enqueueOwnerAlert: vi.fn().mockResolvedValue(undefined),
  };
}

const NOW = new Date("2026-04-09T14:00:00Z");

describe("persistGpsMismatch", () => {
  const flaggedResult: GpsMismatchResult = {
    flagged: true,
    distanceKm: 12.5,
    thresholdKm: 8.0,
    jobId: "job-gps-1",
  };

  const notFlaggedResult: GpsMismatchResult = {
    flagged: false,
    distanceKm: 3.0,
    thresholdKm: 8.0,
    jobId: "job-gps-2",
  };

  it("skips recording when mismatch is not flagged", async () => {
    const db = createMockDb();
    const result = await persistGpsMismatch(
      { technicianId: "tech-1", businessId: "biz-1", mismatchResult: notFlaggedResult },
      db,
      NOW,
    );
    expect(result.recorded).toBe(false);
    expect(result.ownerFlagged).toBe(false);
    expect(db.recordGpsMismatch).not.toHaveBeenCalled();
  });

  it("records mismatch and does not flag owner when below threshold", async () => {
    const db = createMockDb();
    (db.getGpsMismatchCount as ReturnType<typeof vi.fn>).mockResolvedValue(1);

    const result = await persistGpsMismatch(
      { technicianId: "tech-1", businessId: "biz-1", mismatchResult: flaggedResult },
      db,
      NOW,
    );
    expect(result.recorded).toBe(true);
    expect(result.totalMismatches).toBe(1);
    expect(result.ownerFlagged).toBe(false);
    expect(db.recordGpsMismatch).toHaveBeenCalledWith("tech-1", "job-gps-1", 12.5, NOW);
    expect(db.enqueueOwnerAlert).not.toHaveBeenCalled();
  });

  it("flags owner when tech hits 3+ mismatches in 30 days", async () => {
    const db = createMockDb();
    (db.getGpsMismatchCount as ReturnType<typeof vi.fn>).mockResolvedValue(3);

    const result = await persistGpsMismatch(
      { technicianId: "tech-1", businessId: "biz-1", mismatchResult: flaggedResult },
      db,
      NOW,
    );
    expect(result.recorded).toBe(true);
    expect(result.totalMismatches).toBe(3);
    expect(result.ownerFlagged).toBe(true);
    expect(db.enqueueOwnerAlert).toHaveBeenCalledWith(
      "biz-1",
      "gps_mismatch_threshold",
      "tech-1",
      expect.stringContaining("3 GPS mismatches"),
      expect.stringContaining("gps_mismatch_alert:tech-1:"),
    );
  });

  it("queries 30-day window for mismatch count", async () => {
    const db = createMockDb();
    (db.getGpsMismatchCount as ReturnType<typeof vi.fn>).mockResolvedValue(0);

    await persistGpsMismatch(
      { technicianId: "tech-1", businessId: "biz-1", mismatchResult: flaggedResult },
      db,
      NOW,
    );

    const sinceArg = (db.getGpsMismatchCount as ReturnType<typeof vi.fn>).mock.calls[0]![1] as Date;
    const daysDiff = (NOW.getTime() - sinceArg.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysDiff).toBeCloseTo(30, 0);
  });
});

describe("persistFastCompletion", () => {
  const flaggedResult: FastCompletionResult = {
    flagged: true,
    actualMinutes: 15,
    estimatedMinutes: 60,
    percentOfEstimate: 25,
    jobId: "job-fast-1",
  };

  const notFlaggedResult: FastCompletionResult = {
    flagged: false,
    actualMinutes: 45,
    estimatedMinutes: 60,
    percentOfEstimate: 75,
    jobId: "job-fast-2",
  };

  it("skips recording when completion is not flagged", async () => {
    const db = createMockDb();
    const result = await persistFastCompletion(
      { technicianId: "tech-1", businessId: "biz-1", completionResult: notFlaggedResult },
      db,
      NOW,
    );
    expect(result.recorded).toBe(false);
    expect(result.ownerFlagged).toBe(false);
    expect(db.recordFastCompletion).not.toHaveBeenCalled();
  });

  it("records fast completion and immediately flags owner", async () => {
    const db = createMockDb();
    const result = await persistFastCompletion(
      { technicianId: "tech-1", businessId: "biz-1", completionResult: flaggedResult },
      db,
      NOW,
    );
    expect(result.recorded).toBe(true);
    expect(result.ownerFlagged).toBe(true);
    expect(db.recordFastCompletion).toHaveBeenCalledWith("tech-1", "job-fast-1", 25, NOW);
    expect(db.enqueueOwnerAlert).toHaveBeenCalledWith(
      "biz-1",
      "fast_completion",
      "tech-1",
      expect.stringContaining("15 min"),
      "fast_completion_alert:job-fast-1",
    );
  });

  it("includes percent and estimate in owner alert details", async () => {
    const db = createMockDb();
    await persistFastCompletion(
      { technicianId: "tech-1", businessId: "biz-1", completionResult: flaggedResult },
      db,
      NOW,
    );
    const alertDetails = (db.enqueueOwnerAlert as ReturnType<typeof vi.fn>).mock.calls[0]![3] as string;
    expect(alertDetails).toContain("25%");
    expect(alertDetails).toContain("60 min estimate");
  });
});
