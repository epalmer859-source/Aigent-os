// ============================================================
// Queue Insertion Optimizer — Tests
//
// Every test traces to a rule in unified-scheduling-spec.md.
// Uses mocked OSRM. No real network calls.
// ============================================================

import { describe, it, expect, vi } from "vitest";
import {
  getValidInsertionPoints,
  scoreDriveTimeForInsertion,
  findOptimalPosition,
  insertAtPosition,
  calculateMorningCutoffPosition,
  validateQueueVersion,
  bumpQueueVersion,
  clearExpiredManualPositions,
  type QueuedJob,
  type NewJobInput,
} from "../queue-insertion";
import type { OsrmServiceDeps } from "../osrm-service";
import type { TechProfile } from "../capacity-math";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQueuedJob(overrides: Partial<QueuedJob> = {}): QueuedJob {
  return {
    id: `job-${Math.random().toString(36).slice(2, 6)}`,
    queuePosition: 0,
    status: "NOT_STARTED",
    timePreference: "NO_PREFERENCE",
    addressLat: 33.749,
    addressLng: -84.388,
    manualPosition: false,
    estimatedDurationMinutes: 60,
    driveTimeMinutes: 15,
    ...overrides,
  };
}

function makeNewJob(overrides: Partial<NewJobInput> = {}): NewJobInput {
  return {
    id: "new-job",
    addressLat: 33.80,
    addressLng: -84.40,
    timePreference: "NO_PREFERENCE",
    totalCostMinutes: 100,
    ...overrides,
  };
}

const HOME_BASE = { lat: 33.70, lng: -84.35 };

/** Mock OSRM: returns a fixed drive time based on simple coordinate difference. */
function mockOsrmDeps(fixedMinutes: number): OsrmServiceDeps {
  return {
    baseUrl: "http://test:5000",
    fetchFn: vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: "Ok",
        routes: [{ duration: fixedMinutes * 60, distance: fixedMinutes * 1000 }],
      }),
    }),
    logger: { warn: vi.fn() },
  };
}

/**
 * Mock OSRM that returns different times based on call order.
 * Useful for testing optimal position selection.
 */
function sequentialOsrmDeps(minutesSequence: number[]): OsrmServiceDeps {
  let callIndex = 0;
  return {
    baseUrl: "http://test:5000",
    fetchFn: vi.fn().mockImplementation(async () => {
      const mins = minutesSequence[callIndex] ?? 10;
      callIndex++;
      return {
        ok: true,
        json: async () => ({
          code: "Ok",
          routes: [{ duration: mins * 60, distance: mins * 1000 }],
        }),
      };
    }),
    logger: { warn: vi.fn() },
  };
}

const STANDARD_TECH: TechProfile = {
  id: "tech-1",
  businessId: "biz-1",
  workingHoursStart: "08:00",
  workingHoursEnd: "17:00",
  lunchStart: "12:00",
  lunchEnd: "12:30",
  overtimeCapMinutes: 0,
};

// ── getValidInsertionPoints ───────────────────────────────────────────────────

describe("getValidInsertionPoints", () => {
  it("empty queue -> [0]", () => {
    const result = getValidInsertionPoints([], makeNewJob());
    expect(result).toEqual([0]);
  });

  it("all NOT_STARTED -> [0..length]", () => {
    const queue = [
      makeQueuedJob({ queuePosition: 0 }),
      makeQueuedJob({ queuePosition: 1 }),
      makeQueuedJob({ queuePosition: 2 }),
    ];
    const result = getValidInsertionPoints(queue, makeNewJob());
    expect(result).toEqual([0, 1, 2, 3]);
  });

  it("locked jobs at front -> only positions after locked prefix", () => {
    const queue = [
      makeQueuedJob({ queuePosition: 0, status: "EN_ROUTE" }),
      makeQueuedJob({ queuePosition: 1, status: "ARRIVED" }),
      makeQueuedJob({ queuePosition: 2, status: "NOT_STARTED" }),
      makeQueuedJob({ queuePosition: 3, status: "NOT_STARTED" }),
    ];
    const result = getValidInsertionPoints(queue, makeNewJob());
    // First unlocked is position 2
    expect(result).toEqual([2, 3, 4]);
  });

  it("MORNING -> only positions before cutoff", () => {
    const queue = [
      makeQueuedJob({ queuePosition: 0 }),
      makeQueuedJob({ queuePosition: 1 }),
      makeQueuedJob({ queuePosition: 2 }),
      makeQueuedJob({ queuePosition: 3 }),
    ];
    const newJob = makeNewJob({ timePreference: "MORNING" });
    // cutoff at position 2 → valid: 0, 1
    const result = getValidInsertionPoints(queue, newJob, 2);
    expect(result).toEqual([0, 1]);
  });

  it("AFTERNOON -> only positions at/after cutoff", () => {
    const queue = [
      makeQueuedJob({ queuePosition: 0 }),
      makeQueuedJob({ queuePosition: 1 }),
      makeQueuedJob({ queuePosition: 2 }),
      makeQueuedJob({ queuePosition: 3 }),
    ];
    const newJob = makeNewJob({ timePreference: "AFTERNOON" });
    // cutoff at position 2 → valid: 2, 3, 4
    const result = getValidInsertionPoints(queue, newJob, 2);
    expect(result).toEqual([2, 3, 4]);
  });

  it("SOONEST -> all unlocked positions", () => {
    const queue = [
      makeQueuedJob({ queuePosition: 0, status: "EN_ROUTE" }),
      makeQueuedJob({ queuePosition: 1 }),
      makeQueuedJob({ queuePosition: 2 }),
    ];
    const newJob = makeNewJob({ timePreference: "SOONEST" });
    const result = getValidInsertionPoints(queue, newJob);
    expect(result).toEqual([1, 2, 3]);
  });

  it("NO_PREFERENCE -> all unlocked positions", () => {
    const queue = [
      makeQueuedJob({ queuePosition: 0 }),
      makeQueuedJob({ queuePosition: 1 }),
    ];
    const newJob = makeNewJob({ timePreference: "NO_PREFERENCE" });
    const result = getValidInsertionPoints(queue, newJob);
    expect(result).toEqual([0, 1, 2]);
  });

  it("manual jobs act as order-locked anchors (insertion preserves their order)", () => {
    const queue = [
      makeQueuedJob({ queuePosition: 0, manualPosition: true, id: "manual-1" }),
      makeQueuedJob({ queuePosition: 1, id: "normal" }),
      makeQueuedJob({ queuePosition: 2, manualPosition: true, id: "manual-2" }),
    ];
    // All positions are valid — inserting preserves relative order
    const result = getValidInsertionPoints(queue, makeNewJob());
    expect(result).toEqual([0, 1, 2, 3]);

    // Verify that inserting doesn't break manual order
    const inserted = insertAtPosition(queue, makeNewJob(), 1);
    const manualIds = inserted
      .filter((j) => j.manualPosition)
      .map((j) => j.id);
    expect(manualIds).toEqual(["manual-1", "manual-2"]); // order preserved
  });

  it("all positions locked -> []", () => {
    const queue = [
      makeQueuedJob({ queuePosition: 0, status: "EN_ROUTE" }),
      makeQueuedJob({ queuePosition: 1, status: "IN_PROGRESS" }),
    ];
    const result = getValidInsertionPoints(queue, makeNewJob());
    expect(result).toEqual([]);
  });
});

// ── scoreDriveTimeForInsertion ────────────────────────────────────────────────

describe("scoreDriveTimeForInsertion", () => {
  it("middle insertion computes correct delta", async () => {
    const queue = [
      makeQueuedJob({ queuePosition: 0, addressLat: 33.75, addressLng: -84.39 }),
      makeQueuedJob({ queuePosition: 1, addressLat: 33.85, addressLng: -84.45 }),
    ];
    const newJob = makeNewJob({ addressLat: 33.80, addressLng: -84.42 });

    // All OSRM calls return 10 min
    // Current leg (pos0 -> pos1): 10 min
    // New legs: prev->new (10) + new->next (10) = 20
    // Delta: 20 - 10 = 10
    const osrm = mockOsrmDeps(10);
    const score = await scoreDriveTimeForInsertion(queue, newJob, 1, HOME_BASE, osrm);
    expect(score.addedDriveTimeMinutes).toBe(10);
  });

  it("position 0 uses home base as previous", async () => {
    const queue = [
      makeQueuedJob({ queuePosition: 0, addressLat: 33.80, addressLng: -84.40 }),
    ];
    const newJob = makeNewJob();

    // Current: home -> queue[0] = 10
    // New: home -> new (10) + new -> queue[0] (10) = 20
    // Delta: 20 - 10 = 10
    const osrm = mockOsrmDeps(10);
    const score = await scoreDriveTimeForInsertion(queue, newJob, 0, HOME_BASE, osrm);
    expect(score.addedDriveTimeMinutes).toBe(10);
  });

  it("end insertion has no next job", async () => {
    const queue = [
      makeQueuedJob({ queuePosition: 0, addressLat: 33.75, addressLng: -84.39 }),
    ];
    const newJob = makeNewJob();

    // No current leg (end of queue)
    // New: prev -> new = 10, no new->next
    // Delta: 10 - 0 = 10
    const osrm = mockOsrmDeps(10);
    const score = await scoreDriveTimeForInsertion(queue, newJob, 1, HOME_BASE, osrm);
    expect(score.addedDriveTimeMinutes).toBe(10);
  });

  it("uses mocked OSRM service", async () => {
    const queue = [makeQueuedJob()];
    const newJob = makeNewJob();
    const osrm = mockOsrmDeps(5);

    await scoreDriveTimeForInsertion(queue, newJob, 0, HOME_BASE, osrm);

    // fetchFn should have been called (3 times: current leg, prev->new, new->next)
    expect(osrm.fetchFn).toHaveBeenCalled();
  });
});

// ── findOptimalPosition ───────────────────────────────────────────────────────

describe("findOptimalPosition", () => {
  it("picks lowest addedDriveTimeMinutes", async () => {
    const queue = [
      makeQueuedJob({ queuePosition: 0, addressLat: 33.75, addressLng: -84.39 }),
      makeQueuedJob({ queuePosition: 1, addressLat: 33.85, addressLng: -84.45 }),
    ];
    // New job very close to job at position 1
    const newJob = makeNewJob({ addressLat: 33.851, addressLng: -84.451 });

    // Use sequential mock:
    // Position 0: current(10), prev->new(20), new->next(15) = delta 25
    // Position 1: current(10), prev->new(5), new->next(3)   = delta -2
    // Position 2: prev->new(8)                               = delta 8
    const osrm = sequentialOsrmDeps([
      10, 20, 15,  // pos 0: current, prev->new, new->next
      10, 5, 3,    // pos 1: current, prev->new, new->next
      8,           // pos 2: prev->new (end, no next)
    ]);

    const result = await findOptimalPosition(queue, newJob, HOME_BASE, osrm);
    expect(result.valid).toBe(true);
    expect(result.position).toBe(1);
    expect(result.addedDriveTimeMinutes).toBe(-2);
  });

  it("ties break to earliest position", async () => {
    const queue = [
      makeQueuedJob({ queuePosition: 0 }),
      makeQueuedJob({ queuePosition: 1 }),
    ];
    const newJob = makeNewJob();

    // All positions score the same: 10
    const osrm = mockOsrmDeps(10);
    const result = await findOptimalPosition(queue, newJob, HOME_BASE, osrm);

    expect(result.valid).toBe(true);
    expect(result.position).toBe(0); // earliest with same score
  });

  it("returns invalid when no positions available", async () => {
    const queue = [
      makeQueuedJob({ queuePosition: 0, status: "EN_ROUTE" }),
      makeQueuedJob({ queuePosition: 1, status: "IN_PROGRESS" }),
    ];
    const newJob = makeNewJob();
    const osrm = mockOsrmDeps(10);

    const result = await findOptimalPosition(queue, newJob, HOME_BASE, osrm);
    expect(result.valid).toBe(false);
    expect(result.position).toBe(-1);
    expect(result.reason).toBe("no_valid_position");
  });

  it("MORNING restriction respected", async () => {
    const queue = [
      makeQueuedJob({ queuePosition: 0 }),
      makeQueuedJob({ queuePosition: 1 }),
      makeQueuedJob({ queuePosition: 2 }),
    ];
    const newJob = makeNewJob({ timePreference: "MORNING" });

    // Morning cutoff at position 1 → only position 0 is valid
    const osrm = mockOsrmDeps(10);
    const result = await findOptimalPosition(queue, newJob, HOME_BASE, osrm, 1);

    expect(result.valid).toBe(true);
    expect(result.position).toBe(0);
  });

  it("AFTERNOON restriction respected", async () => {
    const queue = [
      makeQueuedJob({ queuePosition: 0 }),
      makeQueuedJob({ queuePosition: 1 }),
      makeQueuedJob({ queuePosition: 2 }),
    ];
    const newJob = makeNewJob({ timePreference: "AFTERNOON" });

    // Morning cutoff at 1 → afternoon positions are 1, 2, 3
    const osrm = mockOsrmDeps(10);
    const result = await findOptimalPosition(queue, newJob, HOME_BASE, osrm, 1);

    expect(result.valid).toBe(true);
    // All score the same (10), earliest afternoon position wins
    expect(result.position).toBe(1);
  });
});

// ── insertAtPosition ──────────────────────────────────────────────────────────

describe("insertAtPosition", () => {
  it("insert at 0 shifts all existing jobs", () => {
    const queue = [
      makeQueuedJob({ id: "a", queuePosition: 0 }),
      makeQueuedJob({ id: "b", queuePosition: 1 }),
    ];
    const newJob = makeNewJob({ id: "new" });

    const result = insertAtPosition(queue, newJob, 0);
    expect(result).toHaveLength(3);
    expect(result[0]!.id).toBe("new");
    expect(result[0]!.queuePosition).toBe(0);
    expect(result[1]!.id).toBe("a");
    expect(result[1]!.queuePosition).toBe(1);
    expect(result[2]!.id).toBe("b");
    expect(result[2]!.queuePosition).toBe(2);
  });

  it("insert at end appends", () => {
    const queue = [
      makeQueuedJob({ id: "a", queuePosition: 0 }),
      makeQueuedJob({ id: "b", queuePosition: 1 }),
    ];
    const newJob = makeNewJob({ id: "new" });

    const result = insertAtPosition(queue, newJob, 2);
    expect(result).toHaveLength(3);
    expect(result[2]!.id).toBe("new");
    expect(result[2]!.queuePosition).toBe(2);
  });

  it("insert in middle shifts later jobs", () => {
    const queue = [
      makeQueuedJob({ id: "a", queuePosition: 0 }),
      makeQueuedJob({ id: "b", queuePosition: 1 }),
      makeQueuedJob({ id: "c", queuePosition: 2 }),
    ];
    const newJob = makeNewJob({ id: "new" });

    const result = insertAtPosition(queue, newJob, 1);
    expect(result).toHaveLength(4);
    expect(result.map((j) => j.id)).toEqual(["a", "new", "b", "c"]);
    expect(result.map((j) => j.queuePosition)).toEqual([0, 1, 2, 3]);
  });

  it("does not mutate original array", () => {
    const queue = [
      makeQueuedJob({ id: "a", queuePosition: 0 }),
      makeQueuedJob({ id: "b", queuePosition: 1 }),
    ];
    const originalLength = queue.length;
    const originalFirst = queue[0]!.queuePosition;

    insertAtPosition(queue, makeNewJob(), 1);

    expect(queue).toHaveLength(originalLength);
    expect(queue[0]!.queuePosition).toBe(originalFirst);
  });

  it("throws on invalid position (negative)", () => {
    expect(() => insertAtPosition([], makeNewJob(), -1)).toThrow("Invalid insertion position");
  });

  it("throws on invalid position (> length)", () => {
    const queue = [makeQueuedJob()];
    expect(() => insertAtPosition(queue, makeNewJob(), 5)).toThrow("Invalid insertion position");
  });
});

// ── calculateMorningCutoffPosition ────────────────────────────────────────────

describe("calculateMorningCutoffPosition", () => {
  it("standard queue -> correct cutoff", () => {
    // Morning: 08:00 to 12:00 = 240 min
    // Job 0: 60 + 15 = 75 (cumulative: 75)
    // Job 1: 60 + 15 = 75 (cumulative: 150)
    // Job 2: 60 + 15 = 75 (cumulative: 225)
    // Job 3: 60 + 15 = 75 (cumulative: 300 > 240) → cutoff at position 3
    const queue = [
      makeQueuedJob({ queuePosition: 0, estimatedDurationMinutes: 60, driveTimeMinutes: 15 }),
      makeQueuedJob({ queuePosition: 1, estimatedDurationMinutes: 60, driveTimeMinutes: 15 }),
      makeQueuedJob({ queuePosition: 2, estimatedDurationMinutes: 60, driveTimeMinutes: 15 }),
      makeQueuedJob({ queuePosition: 3, estimatedDurationMinutes: 60, driveTimeMinutes: 15 }),
    ];

    const cutoff = calculateMorningCutoffPosition(queue, STANDARD_TECH);
    expect(cutoff).toBe(3);
  });

  it("short morning -> earlier cutoff", () => {
    // Tech works 10:00 - 17:00, lunch at 12:00. Morning = 120 min.
    const lateTech: TechProfile = {
      ...STANDARD_TECH,
      workingHoursStart: "10:00",
    };

    // Job 0: 60 + 15 = 75 (cumulative: 75)
    // Job 1: 60 + 15 = 75 (cumulative: 150 > 120) → cutoff at position 1
    const queue = [
      makeQueuedJob({ queuePosition: 0, estimatedDurationMinutes: 60, driveTimeMinutes: 15 }),
      makeQueuedJob({ queuePosition: 1, estimatedDurationMinutes: 60, driveTimeMinutes: 15 }),
      makeQueuedJob({ queuePosition: 2, estimatedDurationMinutes: 60, driveTimeMinutes: 15 }),
    ];

    const cutoff = calculateMorningCutoffPosition(queue, lateTech);
    expect(cutoff).toBe(1);
  });

  it("empty queue -> 0", () => {
    const cutoff = calculateMorningCutoffPosition([], STANDARD_TECH);
    expect(cutoff).toBe(0);
  });

  it("all jobs fit in morning -> cutoff at queue length", () => {
    // Morning = 240 min. Two small jobs = 40 total.
    const queue = [
      makeQueuedJob({ queuePosition: 0, estimatedDurationMinutes: 10, driveTimeMinutes: 5 }),
      makeQueuedJob({ queuePosition: 1, estimatedDurationMinutes: 10, driveTimeMinutes: 5 }),
    ];

    const cutoff = calculateMorningCutoffPosition(queue, STANDARD_TECH);
    expect(cutoff).toBe(2); // all fit
  });
});

// ── H2: Queue version validation ──────────────────────────────────────────

describe("H2: validateQueueVersion", () => {
  it("returns true when expected version matches current version", () => {
    const queue = [
      makeQueuedJob({ queueVersion: 5 }),
      makeQueuedJob({ queueVersion: 5 }),
    ];
    expect(validateQueueVersion(queue, 5)).toBe(true);
  });

  it("returns false when expected version does not match", () => {
    const queue = [
      makeQueuedJob({ queueVersion: 5 }),
      makeQueuedJob({ queueVersion: 5 }),
    ];
    expect(validateQueueVersion(queue, 4)).toBe(false);
  });

  it("returns true for empty queue regardless of expected version", () => {
    expect(validateQueueVersion([], 99)).toBe(true);
  });

  it("treats undefined queueVersion as 0", () => {
    const queue = [makeQueuedJob()]; // no queueVersion set
    expect(validateQueueVersion(queue, 0)).toBe(true);
    expect(validateQueueVersion(queue, 1)).toBe(false);
  });
});

describe("H2: bumpQueueVersion", () => {
  it("increments version on all jobs", () => {
    const queue = [
      makeQueuedJob({ queueVersion: 3 }),
      makeQueuedJob({ queueVersion: 3 }),
    ];
    const bumped = bumpQueueVersion(queue);
    expect(bumped[0]!.queueVersion).toBe(4);
    expect(bumped[1]!.queueVersion).toBe(4);
  });

  it("does not mutate original queue", () => {
    const queue = [makeQueuedJob({ queueVersion: 1 })];
    const bumped = bumpQueueVersion(queue);
    expect(queue[0]!.queueVersion).toBe(1);
    expect(bumped[0]!.queueVersion).toBe(2);
  });

  it("returns empty array for empty queue", () => {
    expect(bumpQueueVersion([])).toEqual([]);
  });

  it("treats undefined version as 0, bumps to 1", () => {
    const queue = [makeQueuedJob()];
    const bumped = bumpQueueVersion(queue);
    expect(bumped[0]!.queueVersion).toBe(1);
  });
});

// ── H3: Manual position expiry ─────────────────────────────────────────────

describe("H3: clearExpiredManualPositions", () => {
  const NOW = new Date("2026-04-09T12:00:00Z");

  it("clears manual flag when manualPositionSetDate is older than maxAgeDays", () => {
    const eightDaysAgo = new Date("2026-04-01T12:00:00Z");
    const queue = [
      makeQueuedJob({ manualPosition: true, manualPositionSetDate: eightDaysAgo }),
    ];

    const result = clearExpiredManualPositions(queue, NOW, 7);

    expect(result.clearedCount).toBe(1);
    expect(result.queue[0]!.manualPosition).toBe(false);
    expect(result.queue[0]!.manualPositionSetDate).toBeNull();
  });

  it("preserves manual flag when within maxAgeDays", () => {
    const threeDaysAgo = new Date("2026-04-06T12:00:00Z");
    const queue = [
      makeQueuedJob({ manualPosition: true, manualPositionSetDate: threeDaysAgo }),
    ];

    const result = clearExpiredManualPositions(queue, NOW, 7);

    expect(result.clearedCount).toBe(0);
    expect(result.queue[0]!.manualPosition).toBe(true);
  });

  it("ignores non-manual jobs", () => {
    const queue = [
      makeQueuedJob({ manualPosition: false }),
    ];

    const result = clearExpiredManualPositions(queue, NOW, 7);

    expect(result.clearedCount).toBe(0);
  });

  it("ignores manual jobs with no set date", () => {
    const queue = [
      makeQueuedJob({ manualPosition: true, manualPositionSetDate: null }),
    ];

    const result = clearExpiredManualPositions(queue, NOW, 7);

    expect(result.clearedCount).toBe(0);
    expect(result.queue[0]!.manualPosition).toBe(true);
  });

  it("does not mutate original queue", () => {
    const eightDaysAgo = new Date("2026-04-01T12:00:00Z");
    const queue = [
      makeQueuedJob({ manualPosition: true, manualPositionSetDate: eightDaysAgo }),
    ];

    clearExpiredManualPositions(queue, NOW, 7);

    expect(queue[0]!.manualPosition).toBe(true); // original unchanged
  });

  it("mixed queue: only clears expired manual positions", () => {
    const eightDaysAgo = new Date("2026-04-01T12:00:00Z");
    const threeDaysAgo = new Date("2026-04-06T12:00:00Z");

    const queue = [
      makeQueuedJob({ id: "expired", manualPosition: true, manualPositionSetDate: eightDaysAgo }),
      makeQueuedJob({ id: "fresh", manualPosition: true, manualPositionSetDate: threeDaysAgo }),
      makeQueuedJob({ id: "auto", manualPosition: false }),
    ];

    const result = clearExpiredManualPositions(queue, NOW, 7);

    expect(result.clearedCount).toBe(1);
    expect(result.queue.find((j) => j.id === "expired")!.manualPosition).toBe(false);
    expect(result.queue.find((j) => j.id === "fresh")!.manualPosition).toBe(true);
    expect(result.queue.find((j) => j.id === "auto")!.manualPosition).toBe(false);
  });
});
