// ============================================================
// Gap-Fill Candidate Ranker — Tests
//
// Every test traces to a rule in unified-scheduling-spec.md.
// Uses in-memory DB fakes. No real DB, OSRM, or time calls.
//
// Assumptions:
//   - OSRM is mocked to return fixed drive times.
//   - ClockProvider is faked for deterministic time.
//   - CapacityDb is in-memory (from capacity-math module).
// ============================================================

import { describe, it, expect, vi } from "vitest";
import {
  detectGap,
  rankCandidates,
  createPullForwardOffer,
  acceptPullForward,
  expireStaleOffers,
  type GapInfo,
  type GapFillCandidate,
  type GapFillDb,
  type PullForwardOffer,
  type ClockProvider,
  type DetectGapInput,
  type ScoredCandidate,
  type StaleOfferRecord,
} from "../gap-fill";
import { type TechProfile, type TimePreference } from "../capacity-math";
import type { QueuedJob } from "../queue-insertion";
import type { OsrmServiceDeps } from "../osrm-service";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TODAY = new Date("2026-04-09");

function dateKey(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

function mockOsrmDeps(fixedMinutes = 10): OsrmServiceDeps {
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

function makeClock(now: Date): ClockProvider {
  return { now: () => now };
}

function makeGapInfo(overrides: Partial<GapInfo> = {}): GapInfo {
  return {
    gapId: "gap-1",
    technicianId: "tech-a",
    businessId: "biz-1",
    date: TODAY,
    gapStartMinute: 600, // 10:00
    gapDurationMinutes: 60,
    previousJobId: "prev-job",
    previousJobEndedAt: new Date("2026-04-09T10:00:00Z"),
    previousJobAddressLat: 33.749,
    previousJobAddressLng: -84.388,
    ...overrides,
  };
}

function makeCandidate(overrides: Partial<GapFillCandidate> = {}): GapFillCandidate {
  return {
    jobId: "cand-1",
    customerId: "cust-1",
    customerPhone: "+15551234567",
    technicianId: "tech-a",
    businessId: "biz-1",
    currentQueuePosition: 3,
    scheduledDate: TODAY,
    scheduledStartMinute: 720, // 12:00 — later than gap at 10:00
    totalCostMinutes: 40,
    addressLat: 33.80,
    addressLng: -84.40,
    serviceTypeId: "st-hvac",
    timePreference: "NO_PREFERENCE",
    status: "NOT_STARTED",
    isBooked: true,
    ...overrides,
  };
}

function makeDetectGapInput(overrides: Partial<DetectGapInput> = {}): DetectGapInput {
  return {
    gapId: "gap-1",
    technicianId: "tech-a",
    businessId: "biz-1",
    date: TODAY,
    gapStartMinute: 600,
    bookedDurationMinutes: 90,
    actualDurationMinutes: 45,
    previousJobId: "prev-job",
    previousJobEndedAt: new Date("2026-04-09T10:00:00Z"),
    previousJobAddressLat: 33.749,
    previousJobAddressLng: -84.388,
    ...overrides,
  };
}

// ── In-memory GapFillDb ──────────────────────────────────────────────────────

interface InMemoryGapFillState {
  offers: Map<string, PullForwardOffer>; // keyed by jobId
  gapOffers: Map<string, PullForwardOffer>; // keyed by gapId
  queues: Map<string, QueuedJob[]>;
  updatedSchedules: Array<{ jobId: string; technicianId: string; date: Date; queuePosition: number }>;
  expiredOffers: string[];
}

function freshGapFillState(): InMemoryGapFillState {
  return {
    offers: new Map(),
    gapOffers: new Map(),
    queues: new Map(),
    updatedSchedules: [],
    expiredOffers: [],
  };
}

function createInMemoryGapFillDb(
  techProfiles: TechProfile[],
  state: InMemoryGapFillState,
  bookedCandidates: GapFillCandidate[] = [],
  waitlistedCandidates: GapFillCandidate[] = [],
): GapFillDb {
  const profileMap = new Map(techProfiles.map((p) => [p.id, p]));

  const db: GapFillDb = {
    async getTechProfile(id: string) { return profileMap.get(id) ?? null; },
    pauseGuardDb: {
      async getSchedulingMode() { return { mode: "active" as const }; },
    },

    async getBookedCandidates() {
      return bookedCandidates;
    },

    async getWaitlistedCandidates() {
      return waitlistedCandidates;
    },

    async getQueueForTechDate(technicianId, date) {
      const key = `${technicianId}:${dateKey(date)}`;
      return state.queues.get(key) ?? [];
    },

    async createPullForwardOffer(offer) {
      state.offers.set(offer.jobId, offer);
      state.gapOffers.set(offer.gapId, offer);
    },

    async getPullForwardOffer(jobId) {
      return state.offers.get(jobId) ?? null;
    },

    async getActiveOfferForGap(gapId) {
      const offer = state.gapOffers.get(gapId);
      if (!offer) return null;
      if (state.expiredOffers.includes(offer.jobId)) return null;
      return offer;
    },

    async expirePullForwardOffer(jobId) {
      state.expiredOffers.push(jobId);
    },

    async updateJobSchedule(jobId, technicianId, date, queuePosition) {
      state.updatedSchedules.push({ jobId, technicianId, date, queuePosition });
    },

    async transaction<T>(fn: (tx: GapFillDb) => Promise<T>): Promise<T> {
      return fn(db);
    },
  };

  return db;
}

// ── detectGap ────────────────────────────────────────────────────────────────

describe("detectGap", () => {
  it("returns GapInfo when gap >= 30 minutes", () => {
    const result = detectGap(makeDetectGapInput({
      bookedDurationMinutes: 90,
      actualDurationMinutes: 45,
    }));

    expect(result).not.toBeNull();
    expect(result!.gapDurationMinutes).toBe(45);
    expect(result!.gapId).toBe("gap-1");
    expect(result!.technicianId).toBe("tech-a");
  });

  it("returns GapInfo when gap is exactly 30", () => {
    const result = detectGap(makeDetectGapInput({
      bookedDurationMinutes: 90,
      actualDurationMinutes: 60,
    }));

    expect(result).not.toBeNull();
    expect(result!.gapDurationMinutes).toBe(30);
  });

  it("returns null when gap < 30 minutes", () => {
    const result = detectGap(makeDetectGapInput({
      bookedDurationMinutes: 90,
      actualDurationMinutes: 65,
    }));

    expect(result).toBeNull();
  });

  it("returns null when no gap (actual >= booked)", () => {
    const result = detectGap(makeDetectGapInput({
      bookedDurationMinutes: 60,
      actualDurationMinutes: 60,
    }));

    expect(result).toBeNull();
  });

  it("returns null when actual exceeds booked (negative gap)", () => {
    const result = detectGap(makeDetectGapInput({
      bookedDurationMinutes: 60,
      actualDurationMinutes: 75,
    }));

    expect(result).toBeNull();
  });
});

// ── rankCandidates ───────────────────────────────────────────────────────────

describe("rankCandidates", () => {
  it("Tier 1 ranks before Tier 2 regardless of score", async () => {
    const gap = makeGapInfo({ gapDurationMinutes: 60 });
    const tier1 = makeCandidate({ jobId: "t1", isBooked: true, totalCostMinutes: 20, scheduledStartMinute: 720 });
    const tier2 = makeCandidate({ jobId: "t2", isBooked: false, totalCostMinutes: 45, scheduledStartMinute: 720 });
    const osrm = mockOsrmDeps(10);

    const result = await rankCandidates(gap, [tier2, tier1], osrm);

    expect(result.rankedCandidates.length).toBe(2);
    expect(result.rankedCandidates[0]!.tier).toBe("tier_1");
    expect(result.rankedCandidates[1]!.tier).toBe("tier_2");
    expect(result.tier1Count).toBe(1);
    expect(result.tier2Count).toBe(1);
  });

  it("locked candidates are excluded", async () => {
    const gap = makeGapInfo({ gapDurationMinutes: 60 });
    const locked = makeCandidate({ jobId: "locked", status: "EN_ROUTE", scheduledStartMinute: 720 });
    const unlocked = makeCandidate({ jobId: "ok", status: "NOT_STARTED", scheduledStartMinute: 720 });
    const osrm = mockOsrmDeps(10);

    const result = await rankCandidates(gap, [locked, unlocked], osrm);

    expect(result.rankedCandidates.length).toBe(1);
    expect(result.rankedCandidates[0]!.candidate.jobId).toBe("ok");
  });

  it("candidates that don't fit in gap are excluded", async () => {
    const gap = makeGapInfo({ gapDurationMinutes: 40 });
    // totalCostMinutes=35 + driveTime=10 = 45 > 40
    const tooBig = makeCandidate({ jobId: "big", totalCostMinutes: 35, scheduledStartMinute: 720 });
    // totalCostMinutes=25 + driveTime=10 = 35 <= 40
    const fits = makeCandidate({ jobId: "small", totalCostMinutes: 25, scheduledStartMinute: 720 });
    const osrm = mockOsrmDeps(10);

    const result = await rankCandidates(gap, [tooBig, fits], osrm);

    expect(result.rankedCandidates.length).toBe(1);
    expect(result.rankedCandidates[0]!.candidate.jobId).toBe("small");
  });

  it("ratchet rule enforced: Tier 1 must be scheduled after gap start", async () => {
    const gap = makeGapInfo({ gapStartMinute: 600, gapDurationMinutes: 60 });
    // Scheduled at 540 (before gap) — violates ratchet
    const before = makeCandidate({ jobId: "before", isBooked: true, scheduledStartMinute: 540, totalCostMinutes: 30 });
    // Scheduled at 720 (after gap) — passes ratchet
    const after = makeCandidate({ jobId: "after", isBooked: true, scheduledStartMinute: 720, totalCostMinutes: 30 });
    const osrm = mockOsrmDeps(10);

    const result = await rankCandidates(gap, [before, after], osrm);

    expect(result.rankedCandidates.length).toBe(1);
    expect(result.rankedCandidates[0]!.candidate.jobId).toBe("after");
  });

  it("ratchet rule: scheduledStartMinute == gapStartMinute is excluded", async () => {
    const gap = makeGapInfo({ gapStartMinute: 600, gapDurationMinutes: 60 });
    const sameTime = makeCandidate({ jobId: "same", isBooked: true, scheduledStartMinute: 600, totalCostMinutes: 30 });
    const osrm = mockOsrmDeps(10);

    const result = await rankCandidates(gap, [sameTime], osrm);

    expect(result.rankedCandidates.length).toBe(0);
  });

  it("scoring and tie-breaks are correct", async () => {
    const gap = makeGapInfo({ gapDurationMinutes: 60 });
    // Two candidates with same score — drive time and queue position break tie
    const candA = makeCandidate({
      jobId: "a", totalCostMinutes: 30, scheduledStartMinute: 720,
      currentQueuePosition: 5,
    });
    const candB = makeCandidate({
      jobId: "b", totalCostMinutes: 30, scheduledStartMinute: 720,
      currentQueuePosition: 2,
    });
    const osrm = mockOsrmDeps(10); // same drive time for both

    const result = await rankCandidates(gap, [candA, candB], osrm);

    expect(result.rankedCandidates.length).toBe(2);
    // Same score, same drive time → earlier queue position wins
    expect(result.rankedCandidates[0]!.candidate.jobId).toBe("b");
    expect(result.rankedCandidates[1]!.candidate.jobId).toBe("a");
  });

  it("empty candidates returns empty result", async () => {
    const gap = makeGapInfo();
    const osrm = mockOsrmDeps(10);

    const result = await rankCandidates(gap, [], osrm);

    expect(result.rankedCandidates).toHaveLength(0);
    expect(result.tier1Count).toBe(0);
    expect(result.tier2Count).toBe(0);
  });

  it("Tier 2 candidates are not subject to ratchet rule", async () => {
    const gap = makeGapInfo({ gapStartMinute: 600, gapDurationMinutes: 60 });
    // Waitlisted candidate scheduled before gap — no ratchet for Tier 2
    const waitlisted = makeCandidate({
      jobId: "wait", isBooked: false, scheduledStartMinute: 540, totalCostMinutes: 30,
    });
    const osrm = mockOsrmDeps(10);

    const result = await rankCandidates(gap, [waitlisted], osrm);

    expect(result.rankedCandidates.length).toBe(1);
    expect(result.rankedCandidates[0]!.tier).toBe("tier_2");
  });

  it("pullForwardMinutes calculated correctly", async () => {
    const gap = makeGapInfo({ gapStartMinute: 600, gapDurationMinutes: 60 });
    const cand = makeCandidate({ scheduledStartMinute: 720, totalCostMinutes: 30 });
    const osrm = mockOsrmDeps(10);

    const result = await rankCandidates(gap, [cand], osrm);

    expect(result.rankedCandidates[0]!.pullForwardMinutes).toBe(120); // 720 - 600
  });
});

// ── createPullForwardOffer ───────────────────────────────────────────────────

describe("createPullForwardOffer", () => {
  it("happy path: creates offer with correct fields", async () => {
    const gap = makeGapInfo();
    const cand = makeCandidate();
    const osrm = mockOsrmDeps(10);
    const profiles = [{ id: "tech-a", businessId: "biz-1", workingHoursStart: "08:00", workingHoursEnd: "17:00", lunchStart: "12:00", lunchEnd: "12:30", overtimeCapMinutes: 0 }];
    const state = freshGapFillState();
    const db = createInMemoryGapFillDb(profiles, state);
    const clock = makeClock(new Date("2026-04-09T10:00:00Z"));

    const scored: ScoredCandidate = {
      candidate: cand,
      tier: "tier_1",
      driveTimeMinutes: 10,
      fitsInGap: true,
      pullForwardMinutes: 120,
      score: 0.85,
    };

    const result = await createPullForwardOffer(scored, gap, clock, db, osrm);

    expect(result.outcome).toBe("offered");
    if (result.outcome === "offered") {
      expect(result.offer.gapId).toBe("gap-1");
      expect(result.offer.jobId).toBe("cand-1");
      expect(result.offer.originalTechnicianId).toBe("tech-a");
      expect(result.offer.targetTechnicianId).toBe("tech-a");
      expect(result.offer.originalWindow).toBe("12:00");
      expect(result.offer.newWindow).toBe("10:00");
      // Expires in 20 minutes
      const expectedExpiry = new Date("2026-04-09T10:20:00Z");
      expect(result.offer.expiresAt.getTime()).toBe(expectedExpiry.getTime());
    }
  });

  it("existing active offer blocks new offer", async () => {
    const gap = makeGapInfo();
    const cand = makeCandidate();
    const osrm = mockOsrmDeps(10);
    const profiles = [{ id: "tech-a", businessId: "biz-1", workingHoursStart: "08:00", workingHoursEnd: "17:00", lunchStart: "12:00", lunchEnd: "12:30", overtimeCapMinutes: 0 }];
    const state = freshGapFillState();

    // Pre-populate an active offer for this gap
    const existingOffer: PullForwardOffer = {
      gapId: "gap-1",
      jobId: "other-job",
      customerId: "cust-x",
      customerPhone: "+15559999999",
      originalTechnicianId: "tech-a",
      originalDate: TODAY,
      originalQueuePosition: 2,
      targetTechnicianId: "tech-a",
      targetDate: TODAY,
      newQueuePosition: 1,
      totalCostMinutes: 40,
      timePreference: "NO_PREFERENCE" as const,
      originalWindow: "14:00",
      newWindow: "10:00",
      expiresAt: new Date("2026-04-09T10:30:00Z"),
    };
    state.offers.set(existingOffer.jobId, existingOffer);
    state.gapOffers.set(existingOffer.gapId, existingOffer);

    const db = createInMemoryGapFillDb(profiles, state);
    const clock = makeClock(new Date("2026-04-09T10:00:00Z"));

    const scored: ScoredCandidate = {
      candidate: cand,
      tier: "tier_1",
      driveTimeMinutes: 10,
      fitsInGap: true,
      pullForwardMinutes: 120,
      score: 0.85,
    };

    const result = await createPullForwardOffer(scored, gap, clock, db, osrm);

    expect(result.outcome).toBe("offer_blocked");
  });

  it("gap too small returns gap_too_small", async () => {
    const gap = makeGapInfo({ gapDurationMinutes: 20 }); // below threshold
    const cand = makeCandidate();
    const state = freshGapFillState();
    const db = createInMemoryGapFillDb([], state);
    const clock = makeClock(new Date("2026-04-09T10:00:00Z"));

    const scored: ScoredCandidate = {
      candidate: cand,
      tier: "tier_1",
      driveTimeMinutes: 10,
      fitsInGap: true,
      pullForwardMinutes: 120,
      score: 0.85,
    };

    const result = await createPullForwardOffer(scored, gap, clock, db);

    expect(result.outcome).toBe("gap_too_small");
    if (result.outcome === "gap_too_small") {
      expect(result.gapMinutes).toBe(20);
    }
  });

  it("window strings are formatted correctly", async () => {
    const gap = makeGapInfo({ gapStartMinute: 495 }); // 8:15
    const cand = makeCandidate({ scheduledStartMinute: 930 }); // 15:30
    const osrm = mockOsrmDeps(10);
    const profiles = [{ id: "tech-a", businessId: "biz-1", workingHoursStart: "08:00", workingHoursEnd: "17:00", lunchStart: "12:00", lunchEnd: "12:30", overtimeCapMinutes: 0 }];
    const state = freshGapFillState();
    const db = createInMemoryGapFillDb(profiles, state);
    const clock = makeClock(new Date("2026-04-09T10:00:00Z"));

    const scored: ScoredCandidate = {
      candidate: cand,
      tier: "tier_1",
      driveTimeMinutes: 10,
      fitsInGap: true,
      pullForwardMinutes: 435,
      score: 0.85,
    };

    const result = await createPullForwardOffer(scored, gap, clock, db, osrm);

    expect(result.outcome).toBe("offered");
    if (result.outcome === "offered") {
      expect(result.offer.originalWindow).toBe("15:30");
      expect(result.offer.newWindow).toBe("08:15");
    }
  });

  it("cross-tech offer populates target tech correctly", async () => {
    // Gap is on tech-a, candidate is from tech-b
    const gap = makeGapInfo({ technicianId: "tech-a" });
    const cand = makeCandidate({ technicianId: "tech-b" });
    const osrm = mockOsrmDeps(10);
    const profiles = [
      { id: "tech-a", businessId: "biz-1", workingHoursStart: "08:00", workingHoursEnd: "17:00", lunchStart: "12:00", lunchEnd: "12:30", overtimeCapMinutes: 0 },
      { id: "tech-b", businessId: "biz-1", workingHoursStart: "08:00", workingHoursEnd: "17:00", lunchStart: "12:00", lunchEnd: "12:30", overtimeCapMinutes: 0 },
    ];
    const state = freshGapFillState();
    const db = createInMemoryGapFillDb(profiles, state);
    const clock = makeClock(new Date("2026-04-09T10:00:00Z"));

    const scored: ScoredCandidate = {
      candidate: cand,
      tier: "tier_1",
      driveTimeMinutes: 10,
      fitsInGap: true,
      pullForwardMinutes: 120,
      score: 0.85,
    };

    const result = await createPullForwardOffer(scored, gap, clock, db, osrm);

    expect(result.outcome).toBe("offered");
    if (result.outcome === "offered") {
      expect(result.offer.originalTechnicianId).toBe("tech-b");
      expect(result.offer.targetTechnicianId).toBe("tech-a");
    }
  });
});

// ── acceptPullForward ────────────────────────────────────────────────────────

describe("acceptPullForward", () => {
  it("accepted: updates job schedule", async () => {
    const profiles = [{ id: "tech-a", businessId: "biz-1", workingHoursStart: "08:00", workingHoursEnd: "17:00", lunchStart: "12:00", lunchEnd: "12:30", overtimeCapMinutes: 0 }];
    const state = freshGapFillState();
    const db = createInMemoryGapFillDb(profiles, state);

    const offer: PullForwardOffer = {
      gapId: "gap-1",
      jobId: "job-1",
      customerId: "cust-1",
      customerPhone: "+15551234567",
      originalTechnicianId: "tech-a",
      originalDate: TODAY,
      originalQueuePosition: 3,
      targetTechnicianId: "tech-a",
      targetDate: TODAY,
      newQueuePosition: 0,
      totalCostMinutes: 40,
      timePreference: "NO_PREFERENCE" as const,
      originalWindow: "12:00",
      newWindow: "10:00",
      expiresAt: new Date("2026-04-09T10:20:00Z"),
    };
    state.offers.set(offer.jobId, offer);

    const clock = makeClock(new Date("2026-04-09T10:05:00Z")); // before expiry

    const result = await acceptPullForward("job-1", "biz-1", clock, db);

    expect(result.outcome).toBe("accepted");
    if (result.outcome === "accepted") {
      expect(result.jobId).toBe("job-1");
      expect(result.technicianId).toBe("tech-a");
      expect(result.newQueuePosition).toBe(0);
    }
    expect(state.updatedSchedules).toHaveLength(1);
    expect(state.expiredOffers).toContain("job-1");
  });

  it("missing offer returns expired", async () => {
    const state = freshGapFillState();
    const db = createInMemoryGapFillDb([], state);
    const clock = makeClock(new Date("2026-04-09T10:05:00Z"));

    const result = await acceptPullForward("nonexistent", "biz-1", clock, db);

    expect(result.outcome).toBe("expired");
    if (result.outcome === "expired") {
      expect(result.reason).toBe("offer_expired");
    }
  });

  it("expired offer returns expired and expires the record", async () => {
    const state = freshGapFillState();
    const db = createInMemoryGapFillDb([], state);

    const offer: PullForwardOffer = {
      gapId: "gap-1",
      jobId: "job-1",
      customerId: "cust-1",
      customerPhone: "+15551234567",
      originalTechnicianId: "tech-a",
      originalDate: TODAY,
      originalQueuePosition: 3,
      targetTechnicianId: "tech-a",
      targetDate: TODAY,
      newQueuePosition: 1,
      totalCostMinutes: 40,
      timePreference: "NO_PREFERENCE" as const,
      originalWindow: "12:00",
      newWindow: "10:00",
      expiresAt: new Date("2026-04-09T10:20:00Z"),
    };
    state.offers.set(offer.jobId, offer);

    // Clock is PAST expiry
    const clock = makeClock(new Date("2026-04-09T10:25:00Z"));

    const result = await acceptPullForward("job-1", "biz-1", clock, db);

    expect(result.outcome).toBe("expired");
    expect(state.expiredOffers).toContain("job-1");
  });

  it("capacity_changed when queue position is no longer valid", async () => {
    const state = freshGapFillState();
    const db = createInMemoryGapFillDb([], state);

    const offer: PullForwardOffer = {
      gapId: "gap-1",
      jobId: "job-1",
      customerId: "cust-1",
      customerPhone: "+15551234567",
      originalTechnicianId: "tech-a",
      originalDate: TODAY,
      originalQueuePosition: 3,
      targetTechnicianId: "tech-a",
      targetDate: TODAY,
      newQueuePosition: 5, // Queue is empty → position 5 is invalid
      totalCostMinutes: 40,
      timePreference: "NO_PREFERENCE" as const,
      originalWindow: "12:00",
      newWindow: "10:00",
      expiresAt: new Date("2026-04-09T10:20:00Z"),
    };
    state.offers.set(offer.jobId, offer);

    const clock = makeClock(new Date("2026-04-09T10:05:00Z"));

    const result = await acceptPullForward("job-1", "biz-1", clock, db);

    expect(result.outcome).toBe("capacity_changed");
    if (result.outcome === "capacity_changed") {
      expect(result.reason).toBe("slot_no_longer_available");
    }
    expect(state.expiredOffers).toContain("job-1");
  });

  it("same-tech accept updates schedule and expires offer", async () => {
    const profiles = [{ id: "tech-a", businessId: "biz-1", workingHoursStart: "08:00", workingHoursEnd: "17:00", lunchStart: "12:00", lunchEnd: "12:30", overtimeCapMinutes: 0 }];
    const state = freshGapFillState();
    const db = createInMemoryGapFillDb(profiles, state);

    const offer: PullForwardOffer = {
      gapId: "gap-1",
      jobId: "job-1",
      customerId: "cust-1",
      customerPhone: "+15551234567",
      originalTechnicianId: "tech-a",
      originalDate: TODAY,
      originalQueuePosition: 3,
      targetTechnicianId: "tech-a",
      targetDate: TODAY,
      newQueuePosition: 0,
      totalCostMinutes: 40,
      timePreference: "NO_PREFERENCE" as const,
      originalWindow: "12:00",
      newWindow: "10:00",
      expiresAt: new Date("2026-04-09T10:20:00Z"),
    };
    state.offers.set(offer.jobId, offer);
    const clock = makeClock(new Date("2026-04-09T10:05:00Z"));

    const result = await acceptPullForward("job-1", "biz-1", clock, db);

    expect(result.outcome).toBe("accepted");
    expect(state.updatedSchedules[0]!.technicianId).toBe("tech-a");
    expect(state.expiredOffers).toContain("job-1");
  });

  it("cross-tech accept updates schedule with target tech", async () => {
    const profiles = [
      { id: "tech-a", businessId: "biz-1", workingHoursStart: "08:00", workingHoursEnd: "17:00", lunchStart: "12:00", lunchEnd: "12:30", overtimeCapMinutes: 0 },
      { id: "tech-b", businessId: "biz-1", workingHoursStart: "08:00", workingHoursEnd: "17:00", lunchStart: "12:00", lunchEnd: "12:30", overtimeCapMinutes: 0 },
    ];
    const state = freshGapFillState();
    const db = createInMemoryGapFillDb(profiles, state);

    const offer: PullForwardOffer = {
      gapId: "gap-1",
      jobId: "job-1",
      customerId: "cust-1",
      customerPhone: "+15551234567",
      originalTechnicianId: "tech-b",
      originalDate: TODAY,
      originalQueuePosition: 3,
      targetTechnicianId: "tech-a",
      targetDate: TODAY,
      newQueuePosition: 0,
      totalCostMinutes: 40,
      timePreference: "NO_PREFERENCE" as const,
      originalWindow: "12:00",
      newWindow: "10:00",
      expiresAt: new Date("2026-04-09T10:20:00Z"),
    };
    state.offers.set(offer.jobId, offer);
    const clock = makeClock(new Date("2026-04-09T10:05:00Z"));

    const result = await acceptPullForward("job-1", "biz-1", clock, db);

    expect(result.outcome).toBe("accepted");
    if (result.outcome === "accepted") {
      expect(result.technicianId).toBe("tech-a"); // target tech, not original
    }
    expect(state.updatedSchedules[0]!.technicianId).toBe("tech-a");
    expect(state.expiredOffers).toContain("job-1");
  });
});

// ── expireStaleOffers ────────────────────────────────────────────────────────

describe("expireStaleOffers", () => {
  it("expires old offers", async () => {
    const state = freshGapFillState();
    const db = createInMemoryGapFillDb([], state);
    const clock = makeClock(new Date("2026-04-09T11:00:00Z"));

    const stale: StaleOfferRecord[] = [
      { jobId: "job-old", expiresAt: new Date("2026-04-09T10:30:00Z") },
    ];

    const count = await expireStaleOffers(stale, clock, db);

    expect(count).toBe(1);
    expect(state.expiredOffers).toContain("job-old");
  });

  it("preserves live offers", async () => {
    const state = freshGapFillState();
    const db = createInMemoryGapFillDb([], state);
    const clock = makeClock(new Date("2026-04-09T10:00:00Z"));

    const offers: StaleOfferRecord[] = [
      { jobId: "job-live", expiresAt: new Date("2026-04-09T10:20:00Z") },
    ];

    const count = await expireStaleOffers(offers, clock, db);

    expect(count).toBe(0);
    expect(state.expiredOffers).not.toContain("job-live");
  });

  it("returns correct count with mixed stale and live", async () => {
    const state = freshGapFillState();
    const db = createInMemoryGapFillDb([], state);
    const clock = makeClock(new Date("2026-04-09T11:00:00Z"));

    const offers: StaleOfferRecord[] = [
      { jobId: "stale-1", expiresAt: new Date("2026-04-09T10:00:00Z") },
      { jobId: "live-1", expiresAt: new Date("2026-04-09T11:30:00Z") },
      { jobId: "stale-2", expiresAt: new Date("2026-04-09T10:45:00Z") },
    ];

    const count = await expireStaleOffers(offers, clock, db);

    expect(count).toBe(2);
    expect(state.expiredOffers).toContain("stale-1");
    expect(state.expiredOffers).toContain("stale-2");
    expect(state.expiredOffers).not.toContain("live-1");
  });
});

// ── Offer shape tests ───────────────────────────────────────────────────────

describe("offer shape includes cost and preference", () => {
  it("createPullForwardOffer populates totalCostMinutes and timePreference", async () => {
    const gap = makeGapInfo();
    const cand = makeCandidate({ totalCostMinutes: 45, timePreference: "MORNING" });
    const osrm = mockOsrmDeps(10);
    const profiles = [{ id: "tech-a", businessId: "biz-1", workingHoursStart: "08:00", workingHoursEnd: "17:00", lunchStart: "12:00", lunchEnd: "12:30", overtimeCapMinutes: 0 }];
    const state = freshGapFillState();
    const db = createInMemoryGapFillDb(profiles, state);
    const clock = makeClock(new Date("2026-04-09T10:00:00Z"));

    const scored: ScoredCandidate = {
      candidate: cand,
      tier: "tier_1",
      driveTimeMinutes: 10,
      fitsInGap: true,
      pullForwardMinutes: 120,
      score: 0.85,
    };

    const result = await createPullForwardOffer(scored, gap, clock, db, osrm);

    expect(result.outcome).toBe("offered");
    if (result.outcome === "offered") {
      expect(result.offer.totalCostMinutes).toBe(45);
      expect(result.offer.timePreference).toBe("MORNING");
    }
  });
});

// ── Acceptance capacity tests ───────────────────────────────────────────────

describe("acceptPullForward capacity checks", () => {
  it("uses real totalCostMinutes + timePreference for capacity check", async () => {
    const profiles = [{ id: "tech-a", businessId: "biz-1", workingHoursStart: "08:00", workingHoursEnd: "17:00", lunchStart: "12:00", lunchEnd: "12:30", overtimeCapMinutes: 0 }];
    const state = freshGapFillState();

    // Fill queue so only 30 min remain (510 total - 480 used = 30)
    const fillerJob: QueuedJob = {
      id: "filler-1", queuePosition: 0, status: "NOT_STARTED",
      timePreference: "NO_PREFERENCE" as TimePreference,
      addressLat: 33.75, addressLng: -84.39, manualPosition: false,
      estimatedDurationMinutes: 480, driveTimeMinutes: 0,
    };
    state.queues.set(`tech-a:${dateKey(TODAY)}`, [fillerJob]);

    const db = createInMemoryGapFillDb(profiles, state);

    const offer: PullForwardOffer = {
      gapId: "gap-1",
      jobId: "job-1",
      customerId: "cust-1",
      customerPhone: "+15551234567",
      originalTechnicianId: "tech-a",
      originalDate: TODAY,
      originalQueuePosition: 3,
      targetTechnicianId: "tech-a",
      targetDate: TODAY,
      newQueuePosition: 0,
      totalCostMinutes: 40, // needs 40 but only 30 left
      timePreference: "NO_PREFERENCE" as const,
      originalWindow: "12:00",
      newWindow: "10:00",
      expiresAt: new Date("2026-04-09T10:20:00Z"),
    };
    state.offers.set(offer.jobId, offer);
    const clock = makeClock(new Date("2026-04-09T10:05:00Z"));

    const result = await acceptPullForward("job-1", "biz-1", clock, db);

    expect(result.outcome).toBe("capacity_changed");
    expect(state.expiredOffers).toContain("job-1");
  });

  it("target has total capacity but no MORNING sub-capacity -> capacity_changed", async () => {
    const profiles = [{ id: "tech-a", businessId: "biz-1", workingHoursStart: "08:00", workingHoursEnd: "17:00", lunchStart: "12:00", lunchEnd: "12:30", overtimeCapMinutes: 0 }];
    const state = freshGapFillState();

    // Fill morning capacity with queue jobs (240 min of morning work)
    const morningFiller: QueuedJob = {
      id: "morning-filler", queuePosition: 0, status: "NOT_STARTED",
      timePreference: "NO_PREFERENCE" as TimePreference,
      addressLat: 33.75, addressLng: -84.39, manualPosition: false,
      estimatedDurationMinutes: 240, driveTimeMinutes: 0,
    };
    state.queues.set(`tech-a:${dateKey(TODAY)}`, [morningFiller]);

    const db = createInMemoryGapFillDb(profiles, state);

    const offer: PullForwardOffer = {
      gapId: "gap-1",
      jobId: "job-1",
      customerId: "cust-1",
      customerPhone: "+15551234567",
      originalTechnicianId: "tech-a",
      originalDate: TODAY,
      originalQueuePosition: 3,
      targetTechnicianId: "tech-a",
      targetDate: TODAY,
      newQueuePosition: 0,
      totalCostMinutes: 40,
      timePreference: "MORNING" as const,
      originalWindow: "12:00",
      newWindow: "10:00",
      expiresAt: new Date("2026-04-09T10:20:00Z"),
    };
    state.offers.set(offer.jobId, offer);
    const clock = makeClock(new Date("2026-04-09T10:05:00Z"));

    const result = await acceptPullForward("job-1", "biz-1", clock, db);

    expect(result.outcome).toBe("capacity_changed");
  });

  it("target has capacity -> accept succeeds", async () => {
    const profiles = [{ id: "tech-a", businessId: "biz-1", workingHoursStart: "08:00", workingHoursEnd: "17:00", lunchStart: "12:00", lunchEnd: "12:30", overtimeCapMinutes: 0 }];
    const state = freshGapFillState();
    // Empty queue = full capacity available
    const db = createInMemoryGapFillDb(profiles, state);
    const clock = makeClock(new Date("2026-04-09T10:05:00Z"));

    const offer: PullForwardOffer = {
      gapId: "gap-1",
      jobId: "job-1",
      customerId: "cust-1",
      customerPhone: "+15551234567",
      originalTechnicianId: "tech-a",
      originalDate: TODAY,
      originalQueuePosition: 3,
      targetTechnicianId: "tech-a",
      targetDate: TODAY,
      newQueuePosition: 0,
      totalCostMinutes: 40,
      timePreference: "NO_PREFERENCE" as const,
      originalWindow: "12:00",
      newWindow: "10:00",
      expiresAt: new Date("2026-04-09T10:20:00Z"),
    };
    state.offers.set(offer.jobId, offer);

    const result = await acceptPullForward("job-1", "biz-1", clock, db);

    expect(result.outcome).toBe("accepted");
  });
});

// ── Capacity accounting tests ───────────────────────────────────────────────

describe("acceptPullForward capacity accounting", () => {
  it("same-tech same-date: job move IS the capacity change, no separate accounting", async () => {
    const profiles = [{ id: "tech-a", businessId: "biz-1", workingHoursStart: "08:00", workingHoursEnd: "17:00", lunchStart: "12:00", lunchEnd: "12:30", overtimeCapMinutes: 0 }];
    const state = freshGapFillState();
    const db = createInMemoryGapFillDb(profiles, state);

    const offer: PullForwardOffer = {
      gapId: "gap-1",
      jobId: "job-1",
      customerId: "cust-1",
      customerPhone: "+15551234567",
      originalTechnicianId: "tech-a",
      originalDate: TODAY,
      originalQueuePosition: 3,
      targetTechnicianId: "tech-a", // same tech
      targetDate: TODAY,             // same date
      newQueuePosition: 0,
      totalCostMinutes: 40,
      timePreference: "NO_PREFERENCE" as const,
      originalWindow: "12:00",
      newWindow: "10:00",
      expiresAt: new Date("2026-04-09T10:20:00Z"),
    };
    state.offers.set(offer.jobId, offer);
    const clock = makeClock(new Date("2026-04-09T10:05:00Z"));

    const result = await acceptPullForward("job-1", "biz-1", clock, db);

    expect(result.outcome).toBe("accepted");
    // The move (updateJobSchedule) IS the capacity change
    expect(state.updatedSchedules).toHaveLength(1);
  });

  it("cross-tech accept moves job to target tech", async () => {
    const profiles = [
      { id: "tech-a", businessId: "biz-1", workingHoursStart: "08:00", workingHoursEnd: "17:00", lunchStart: "12:00", lunchEnd: "12:30", overtimeCapMinutes: 0 },
      { id: "tech-b", businessId: "biz-1", workingHoursStart: "08:00", workingHoursEnd: "17:00", lunchStart: "12:00", lunchEnd: "12:30", overtimeCapMinutes: 0 },
    ];
    const state = freshGapFillState();
    const db = createInMemoryGapFillDb(profiles, state);

    const offer: PullForwardOffer = {
      gapId: "gap-1",
      jobId: "job-1",
      customerId: "cust-1",
      customerPhone: "+15551234567",
      originalTechnicianId: "tech-b",
      originalDate: TODAY,
      originalQueuePosition: 3,
      targetTechnicianId: "tech-a",
      targetDate: TODAY,
      newQueuePosition: 0,
      totalCostMinutes: 40,
      timePreference: "NO_PREFERENCE" as const,
      originalWindow: "12:00",
      newWindow: "10:00",
      expiresAt: new Date("2026-04-09T10:20:00Z"),
    };
    state.offers.set(offer.jobId, offer);
    const clock = makeClock(new Date("2026-04-09T10:05:00Z"));

    const result = await acceptPullForward("job-1", "biz-1", clock, db);

    expect(result.outcome).toBe("accepted");
    // Job moved to target tech-a
    expect(state.updatedSchedules).toHaveLength(1);
    expect(state.updatedSchedules[0]!.technicianId).toBe("tech-a");
  });

  it("cross-date accept moves job to target date", async () => {
    const profiles = [
      { id: "tech-a", businessId: "biz-1", workingHoursStart: "08:00", workingHoursEnd: "17:00", lunchStart: "12:00", lunchEnd: "12:30", overtimeCapMinutes: 0 },
    ];
    const state = freshGapFillState();
    const TOMORROW = new Date("2026-04-10");
    const db = createInMemoryGapFillDb(profiles, state);

    const offer: PullForwardOffer = {
      gapId: "gap-1",
      jobId: "job-1",
      customerId: "cust-1",
      customerPhone: "+15551234567",
      originalTechnicianId: "tech-a",
      originalDate: TOMORROW,
      originalQueuePosition: 3,
      targetTechnicianId: "tech-a",
      targetDate: TODAY,
      newQueuePosition: 0,
      totalCostMinutes: 40,
      timePreference: "NO_PREFERENCE" as const,
      originalWindow: "12:00",
      newWindow: "10:00",
      expiresAt: new Date("2026-04-09T10:20:00Z"),
    };
    state.offers.set(offer.jobId, offer);
    const clock = makeClock(new Date("2026-04-09T10:05:00Z"));

    const result = await acceptPullForward("job-1", "biz-1", clock, db);

    expect(result.outcome).toBe("accepted");
    // Job moved to today
    expect(state.updatedSchedules).toHaveLength(1);
    expect(dateKey(state.updatedSchedules[0]!.date)).toBe(dateKey(TODAY));
  });
});

// ── Stale-slot validation tests ─────────────────────────────────────────────

describe("stale-slot validation", () => {
  it("slot inside locked prefix returns capacity_changed", async () => {
    const profiles = [{ id: "tech-a", businessId: "biz-1", workingHoursStart: "08:00", workingHoursEnd: "17:00", lunchStart: "12:00", lunchEnd: "12:30", overtimeCapMinutes: 0 }];
    const state = freshGapFillState();
    // Target queue now has a locked job at position 0
    const queuedJob: QueuedJob = {
      id: "locked-1",
      queuePosition: 0,
      status: "EN_ROUTE",
      timePreference: "NO_PREFERENCE",
      addressLat: 33.75,
      addressLng: -84.39,
      manualPosition: false,
      estimatedDurationMinutes: 60,
      driveTimeMinutes: 15,
    };
    state.queues.set(`tech-a:${dateKey(TODAY)}`, [queuedJob]);
    const db = createInMemoryGapFillDb(profiles, state);

    const offer: PullForwardOffer = {
      gapId: "gap-1",
      jobId: "job-1",
      customerId: "cust-1",
      customerPhone: "+15551234567",
      originalTechnicianId: "tech-a",
      originalDate: TODAY,
      originalQueuePosition: 3,
      targetTechnicianId: "tech-a",
      targetDate: TODAY,
      newQueuePosition: 0, // position 0 is now locked
      totalCostMinutes: 40,
      timePreference: "NO_PREFERENCE" as const,
      originalWindow: "12:00",
      newWindow: "10:00",
      expiresAt: new Date("2026-04-09T10:20:00Z"),
    };
    state.offers.set(offer.jobId, offer);
    const clock = makeClock(new Date("2026-04-09T10:05:00Z"));

    const result = await acceptPullForward("job-1", "biz-1", clock, db);

    expect(result.outcome).toBe("capacity_changed");
    expect(state.expiredOffers).toContain("job-1");
  });
});
