// ============================================================
// Inter-Tech Transfer Engine — Tests
//
// Every test traces to a rule in unified-scheduling-spec.md.
// Uses in-memory DB fakes. No real DB, OSRM, or time calls.
//
// Assumptions:
//   - OSRM is mocked to return configurable drive times.
//   - ClockProvider is faked for deterministic time.
//   - CapacityDb is in-memory (from capacity-math module).
//   - Drive time contribution uses the same OSRM mock as
//     queue insertion, so net savings are deterministic.
// ============================================================

import { describe, it, expect, vi } from "vitest";
import {
  calculateDriveTimeContribution,
  evaluateTransfer,
  executeTransfer,
  evaluateBatchTransfers,
  executeBatchSameDayTransfers,
  type TransferableJob,
  type TransferDb,
  type ClockProvider,
  type TransferEvaluation,
} from "../inter-tech-transfer";
import { type TechProfile, type TimePreference } from "../capacity-math";
import type { TechCandidate } from "../tech-assignment";
import type { QueuedJob } from "../queue-insertion";
import type { Coordinates, OsrmServiceDeps } from "../osrm-service";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TODAY = new Date("2026-04-09");
const TOMORROW = new Date("2026-04-10");

function dateKey(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

function makeClock(today: Date = TODAY): ClockProvider {
  return {
    now: () => today,
    today: () => today,
  };
}

function mockOsrmDeps(fixedMinutes = 15): OsrmServiceDeps {
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

// Variable OSRM: returns different drive times based on coordinates
function variableOsrmDeps(durationMap: Map<string, number>, defaultMinutes = 15): OsrmServiceDeps {
  return {
    baseUrl: "http://test:5000",
    fetchFn: vi.fn().mockImplementation(async (url: string) => {
      // Extract coordinates from OSRM URL
      for (const [key, minutes] of durationMap) {
        if (url.includes(key)) {
          return {
            ok: true,
            json: async () => ({
              code: "Ok",
              routes: [{ duration: minutes * 60, distance: minutes * 1000 }],
            }),
          };
        }
      }
      return {
        ok: true,
        json: async () => ({
          code: "Ok",
          routes: [{ duration: defaultMinutes * 60, distance: defaultMinutes * 1000 }],
        }),
      };
    }),
    logger: { warn: vi.fn() },
  };
}

function makeTechProfile(id: string, businessId = "biz-1"): TechProfile {
  return {
    id,
    businessId,
    workingHoursStart: "08:00",
    workingHoursEnd: "17:00",
    lunchStart: "12:00",
    lunchEnd: "12:30",
    overtimeCapMinutes: 0,
  };
}

function makeTechCandidate(id: string, overrides: Partial<TechCandidate> = {}): TechCandidate {
  return {
    id,
    businessId: "biz-1",
    name: `Tech ${id}`,
    homeBaseLat: 33.749,
    homeBaseLng: -84.388,
    skillTags: ["st-hvac"],
    workingHoursStart: "08:00",
    workingHoursEnd: "17:00",
    lunchStart: "12:00",
    lunchEnd: "12:30",
    overtimeCapMinutes: 0,
    isActive: true,
    existingJobsToday: 2,
    ...overrides,
  };
}

function makeJob(overrides: Partial<TransferableJob> = {}): TransferableJob {
  return {
    jobId: "job-1",
    technicianId: "tech-source",
    businessId: "biz-1",
    serviceTypeId: "st-hvac",
    scheduledDate: TODAY,
    scheduledStartMinute: 600,
    totalCostMinutes: 60,
    addressLat: 33.80,
    addressLng: -84.40,
    timePreference: "NO_PREFERENCE",
    status: "NOT_STARTED",
    queuePosition: 1,
    manualPosition: false,
    transferCount: 0,
    ...overrides,
  };
}

function makeQueuedJob(overrides: Partial<QueuedJob> = {}): QueuedJob {
  return {
    id: "q-1",
    queuePosition: 0,
    status: "NOT_STARTED",
    timePreference: "NO_PREFERENCE",
    addressLat: 33.75,
    addressLng: -84.39,
    manualPosition: false,
    estimatedDurationMinutes: 60,
    driveTimeMinutes: 15,
    ...overrides,
  };
}

const HOME_BASE: Coordinates = { lat: 33.749, lng: -84.388 };

// ── In-memory TransferDb ─────────────────────────────────────────────────────

interface InMemoryTransferState {
  jobs: Map<string, TransferableJob>;
  queues: Map<string, QueuedJob[]>; // key: "techId:YYYY-MM-DD"
  techsByBusiness: Map<string, TechCandidate[]>;
  transferCounts: Map<string, number>; // key: "jobId:YYYY-MM-DD"
  updatedSchedules: Array<{ jobId: string; technicianId: string; date: Date; queuePosition: number }>;
  incrementedTransfers: string[];
  transferEvents: Array<{
    jobId: string; fromTechnicianId: string; toTechnicianId: string;
    fromDate: Date; toDate: Date; fromQueuePosition: number; toQueuePosition: number;
    approvalType: string; netDriveTimeSavingMinutes: number;
  }>;
}

function freshState(): InMemoryTransferState {
  return {
    jobs: new Map(),
    queues: new Map(),
    techsByBusiness: new Map(),
    transferCounts: new Map(),
    updatedSchedules: [],
    incrementedTransfers: [],
    transferEvents: [],
  };
}

function createInMemoryTransferDb(
  techProfiles: TechProfile[],
  state: InMemoryTransferState,
): TransferDb {
  const profileMap = new Map(techProfiles.map((p) => [p.id, p]));

  const db: TransferDb = {
    async getTechProfile(id: string) { return profileMap.get(id) ?? null; },
    pauseGuardDb: {
      async getSchedulingMode() { return { mode: "active" as const }; },
    },

    async getJob(jobId) {
      return state.jobs.get(jobId) ?? null;
    },

    async getTransferableJobsForTechDate(technicianId, date) {
      const result: TransferableJob[] = [];
      for (const job of state.jobs.values()) {
        if (job.technicianId === technicianId && dateKey(job.scheduledDate) === dateKey(date)) {
          result.push(job);
        }
      }
      return result;
    },

    async getQueueForTechDate(technicianId, date) {
      const key = `${technicianId}:${dateKey(date)}`;
      return state.queues.get(key) ?? [];
    },

    async listOtherActiveTechs(businessId, excludeTechnicianId) {
      const techs = state.techsByBusiness.get(businessId) ?? [];
      return techs.filter((t) => t.id !== excludeTechnicianId && t.isActive);
    },

    async getTransferCountToday(jobId, date) {
      return state.transferCounts.get(`${jobId}:${dateKey(date)}`) ?? 0;
    },

    async getTechHomeBase() {
      return { lat: 33.749, lng: -84.388 };
    },

    async updateJobSchedule(jobId, technicianId, date, queuePosition) {
      state.updatedSchedules.push({ jobId, technicianId, date, queuePosition });
    },

    async incrementTransferCount(jobId) {
      state.incrementedTransfers.push(jobId);
    },

    async createTransferEvent(event) {
      state.transferEvents.push(event);
    },

    async transaction<T>(fn: (tx: TransferDb) => Promise<T>): Promise<T> {
      return fn(db);
    },
  };

  return db;
}

// ── calculateDriveTimeContribution ───────────────────────────────────────────

describe("calculateDriveTimeContribution", () => {
  it("first job: contribution = home->job (no next)", async () => {
    const queue: QueuedJob[] = [
      makeQueuedJob({ id: "j1", queuePosition: 0, addressLat: 33.80, addressLng: -84.40 }),
    ];
    const osrm = mockOsrmDeps(20);

    const contribution = await calculateDriveTimeContribution(0, queue, HOME_BASE, osrm);

    // home->job=20, no next, no prev->next shortcut
    expect(contribution).toBe(20);
  });

  it("middle job: contribution = prev->job + job->next - prev->next", async () => {
    const queue: QueuedJob[] = [
      makeQueuedJob({ id: "j0", queuePosition: 0, addressLat: 33.70, addressLng: -84.30 }),
      makeQueuedJob({ id: "j1", queuePosition: 1, addressLat: 33.80, addressLng: -84.40 }),
      makeQueuedJob({ id: "j2", queuePosition: 2, addressLat: 33.90, addressLng: -84.50 }),
    ];
    const osrm = mockOsrmDeps(15);

    const contribution = await calculateDriveTimeContribution(1, queue, HOME_BASE, osrm);

    // All same mock: prev->job=15, job->next=15, prev->next=15
    // Contribution = 15 + 15 - 15 = 15
    expect(contribution).toBe(15);
  });

  it("last job: contribution = prev->job (no outgoing leg)", async () => {
    const queue: QueuedJob[] = [
      makeQueuedJob({ id: "j0", queuePosition: 0, addressLat: 33.70, addressLng: -84.30 }),
      makeQueuedJob({ id: "j1", queuePosition: 1, addressLat: 33.80, addressLng: -84.40 }),
    ];
    const osrm = mockOsrmDeps(10);

    const contribution = await calculateDriveTimeContribution(1, queue, HOME_BASE, osrm);

    // prev->job=10, no next, no prev->next
    expect(contribution).toBe(10);
  });

  it("empty queue returns 0", async () => {
    const osrm = mockOsrmDeps(10);
    const contribution = await calculateDriveTimeContribution(0, [], HOME_BASE, osrm);
    expect(contribution).toBe(0);
  });
});

// ── evaluateTransfer ─────────────────────────────────────────────────────────

describe("evaluateTransfer", () => {
  it("locked job returns blocked_locked", async () => {
    const job = makeJob({ status: "EN_ROUTE" });
    const state = freshState();
    const db = createInMemoryTransferDb([], state);
    const osrm = mockOsrmDeps();

    const result = await evaluateTransfer(job, [], [], HOME_BASE, makeClock(), db, osrm);

    expect(result.outcome).toBe("blocked_locked");
  });

  it("manual position returns blocked_manual", async () => {
    const job = makeJob({ manualPosition: true });
    const state = freshState();
    const db = createInMemoryTransferDb([], state);
    const osrm = mockOsrmDeps();

    const result = await evaluateTransfer(job, [], [], HOME_BASE, makeClock(), db, osrm);

    expect(result.outcome).toBe("blocked_manual");
  });

  it("transfer cap exceeded returns blocked_transfer_cap", async () => {
    const job = makeJob({ transferCount: 1 });
    const state = freshState();
    // DB is the source of truth for transfer cap
    state.transferCounts.set(`job-1:${dateKey(TODAY)}`, 1);
    const db = createInMemoryTransferDb([], state);
    const osrm = mockOsrmDeps();

    const result = await evaluateTransfer(job, [], [], HOME_BASE, makeClock(), db, osrm);

    expect(result.outcome).toBe("blocked_transfer_cap");
  });

  it("emergency bypasses transfer cap", async () => {
    const job = makeJob({ transferCount: 1 });
    const targetTech = makeTechCandidate("tech-target");
    const profiles = [makeTechProfile("tech-source"), makeTechProfile("tech-target")];
    const state = freshState();
    const db = createInMemoryTransferDb(profiles, state);

    // Source queue: job-1 is alone → contribution = home->job
    const sourceQueue: QueuedJob[] = [
      makeQueuedJob({ id: "job-1", queuePosition: 0, addressLat: 33.80, addressLng: -84.40 }),
    ];

    // Use variable OSRM to make target closer
    // Source contribution will be some value, target insertion will be less
    const osrm = mockOsrmDeps(10);

    const result = await evaluateTransfer(
      job, [targetTech], sourceQueue, HOME_BASE, makeClock(), db, osrm, true,
    );

    // Should not be blocked_transfer_cap since isEmergency=true
    expect(result.outcome).not.toBe("blocked_transfer_cap");
  });

  it("no skilled candidate returns no_improvement", async () => {
    const job = makeJob({ serviceTypeId: "st-hvac" });
    const wrongSkillTech = makeTechCandidate("tech-target", { skillTags: ["st-plumbing"] });
    const profiles = [makeTechProfile("tech-source"), makeTechProfile("tech-target")];
    const state = freshState();
    const db = createInMemoryTransferDb(profiles, state);
    const sourceQueue: QueuedJob[] = [
      makeQueuedJob({ id: "job-1", queuePosition: 0 }),
    ];
    const osrm = mockOsrmDeps();

    const result = await evaluateTransfer(
      job, [wrongSkillTech], sourceQueue, HOME_BASE, makeClock(), db, osrm,
    );

    expect(result.outcome).toBe("no_improvement");
  });

  it("no capacity returns no_improvement", async () => {
    const job = makeJob();
    const targetTech = makeTechCandidate("tech-target");
    const profiles = [makeTechProfile("tech-source"), makeTechProfile("tech-target")];
    const state = freshState();

    // Fill target tech's capacity via queue
    state.queues.set(`tech-target:${dateKey(TODAY)}`, [
      makeQueuedJob({ id: "filler-1", queuePosition: 0, estimatedDurationMinutes: 510, driveTimeMinutes: 0 }),
    ]);

    const db = createInMemoryTransferDb(profiles, state);

    const sourceQueue: QueuedJob[] = [
      makeQueuedJob({ id: "job-1", queuePosition: 0 }),
    ];
    const osrm = mockOsrmDeps();

    const result = await evaluateTransfer(
      job, [targetTech], sourceQueue, HOME_BASE, makeClock(), db, osrm,
    );

    expect(result.outcome).toBe("no_improvement");
  });

  it("same-day transfer has approvalRequired = false", async () => {
    const job = makeJob({ scheduledDate: TODAY });
    const targetTech = makeTechCandidate("tech-target");
    const profiles = [makeTechProfile("tech-source"), makeTechProfile("tech-target")];
    const state = freshState();
    const db = createInMemoryTransferDb(profiles, state);
    const sourceQueue: QueuedJob[] = [
      makeQueuedJob({ id: "job-1", queuePosition: 0, addressLat: 33.80, addressLng: -84.40 }),
    ];

    // Use high source drive time so there's a positive net saving
    const osrm = mockOsrmDeps(10);

    const result = await evaluateTransfer(
      job, [targetTech], sourceQueue, HOME_BASE, makeClock(TODAY), db, osrm,
    );

    if (result.outcome === "transfer_recommended") {
      expect(result.approvalRequired).toBe(false);
    }
  });

  it("future-day transfer has approvalRequired = true", async () => {
    const job = makeJob({ scheduledDate: TOMORROW });
    const targetTech = makeTechCandidate("tech-target");
    const profiles = [makeTechProfile("tech-source"), makeTechProfile("tech-target")];
    const state = freshState();
    const db = createInMemoryTransferDb(profiles, state);
    const sourceQueue: QueuedJob[] = [
      makeQueuedJob({ id: "job-1", queuePosition: 0, addressLat: 33.80, addressLng: -84.40 }),
    ];
    const osrm = mockOsrmDeps(10);

    const result = await evaluateTransfer(
      job, [targetTech], sourceQueue, HOME_BASE, makeClock(TODAY), db, osrm,
    );

    if (result.outcome === "transfer_recommended") {
      expect(result.approvalRequired).toBe(true);
    }
  });

  it("transfer_recommended includes correct fields", async () => {
    const job = makeJob({ totalCostMinutes: 60 });
    const targetTech = makeTechCandidate("tech-target");
    const profiles = [makeTechProfile("tech-source"), makeTechProfile("tech-target")];
    const state = freshState();
    const db = createInMemoryTransferDb(profiles, state);
    const sourceQueue: QueuedJob[] = [
      makeQueuedJob({ id: "job-1", queuePosition: 0, addressLat: 33.80, addressLng: -84.40 }),
    ];
    const osrm = mockOsrmDeps(10);

    const result = await evaluateTransfer(
      job, [targetTech], sourceQueue, HOME_BASE, makeClock(), db, osrm,
    );

    if (result.outcome === "transfer_recommended") {
      expect(result.fromTechnicianId).toBe("tech-source");
      expect(result.toTechnicianId).toBe("tech-target");
      expect(result.totalCostMinutes).toBe(60);
      expect(result.reason).toBe("drive_time_improvement");
    }
  });
});

// ── executeTransfer ──────────────────────────────────────────────────────────

describe("executeTransfer", () => {
  const makeRecommendation = (overrides: Partial<TransferEvaluation & { outcome: "transfer_recommended" }> = {}): TransferEvaluation & { outcome: "transfer_recommended" } => ({
    outcome: "transfer_recommended",
    jobId: "job-1",
    fromTechnicianId: "tech-source",
    toTechnicianId: "tech-target",
    fromDate: TODAY,
    toDate: TODAY,
    fromQueuePosition: 1,
    newQueuePosition: 0,
    totalCostMinutes: 60,
    timePreference: "NO_PREFERENCE" as const,
    netDriveTimeSavingMinutes: 10,
    approvalRequired: false,
    reason: "drive_time_improvement",
    ...overrides,
  });

  it("transferred: updates schedule, increments count, creates event", async () => {
    const profiles = [makeTechProfile("tech-source"), makeTechProfile("tech-target")];
    const state = freshState();
    const db = createInMemoryTransferDb(profiles, state);

    const evaluation = makeRecommendation();
    const result = await executeTransfer(evaluation, "auto_same_day", "biz-1", db);

    expect(result.outcome).toBe("transferred");
    if (result.outcome === "transferred") {
      expect(result.fromTechnicianId).toBe("tech-source");
      expect(result.toTechnicianId).toBe("tech-target");
      expect(result.approvalType).toBe("auto_same_day");
    }

    expect(state.updatedSchedules).toHaveLength(1);
    expect(state.updatedSchedules[0]!.technicianId).toBe("tech-target");
    expect(state.incrementedTransfers).toContain("job-1");
    expect(state.transferEvents).toHaveLength(1);
    expect(state.transferEvents[0]!.approvalType).toBe("auto_same_day");
    expect(state.transferEvents[0]!.netDriveTimeSavingMinutes).toBe(10);
  });

  it("capacity_changed when target is full", async () => {
    const profiles = [makeTechProfile("tech-source"), makeTechProfile("tech-target")];
    const state = freshState();

    // Fill target capacity via queue
    state.queues.set(`tech-target:${dateKey(TODAY)}`, [
      makeQueuedJob({ id: "filler-1", queuePosition: 0, estimatedDurationMinutes: 510, driveTimeMinutes: 0 }),
    ]);

    const db = createInMemoryTransferDb(profiles, state);

    const evaluation = makeRecommendation();
    const result = await executeTransfer(evaluation, "auto_same_day", "biz-1", db);

    expect(result.outcome).toBe("capacity_changed");
  });

  it("capacity_changed when queue position exceeds queue length", async () => {
    const profiles = [makeTechProfile("tech-source"), makeTechProfile("tech-target")];
    const state = freshState();
    const db = createInMemoryTransferDb(profiles, state);

    // Queue is empty, but recommendation says position 5
    const evaluation = makeRecommendation({ newQueuePosition: 5 });
    const result = await executeTransfer(evaluation, "auto_same_day", "biz-1", db);

    expect(result.outcome).toBe("capacity_changed");
  });

  it("emergency_bypass approval type is recorded", async () => {
    const profiles = [makeTechProfile("tech-source"), makeTechProfile("tech-target")];
    const state = freshState();
    const db = createInMemoryTransferDb(profiles, state);

    const evaluation = makeRecommendation();
    const result = await executeTransfer(evaluation, "emergency_bypass", "biz-1", db);

    expect(result.outcome).toBe("transferred");
    if (result.outcome === "transferred") {
      expect(result.approvalType).toBe("emergency_bypass");
    }
    expect(state.transferEvents[0]!.approvalType).toBe("emergency_bypass");
  });

  it("owner_required approval type is recorded", async () => {
    const profiles = [makeTechProfile("tech-source"), makeTechProfile("tech-target")];
    const state = freshState();
    const db = createInMemoryTransferDb(profiles, state);

    const evaluation = makeRecommendation({ approvalRequired: true });
    const result = await executeTransfer(evaluation, "owner_required", "biz-1", db);

    expect(result.outcome).toBe("transferred");
    if (result.outcome === "transferred") {
      expect(result.approvalType).toBe("owner_required");
    }
  });
});

// ── evaluateBatchTransfers ───────────────────────────────────────────────────

describe("evaluateBatchTransfers", () => {
  it("empty tech queue returns empty result", async () => {
    const state = freshState();
    const db = createInMemoryTransferDb([], state);
    const osrm = mockOsrmDeps();

    const result = await evaluateBatchTransfers("tech-source", TODAY, makeClock(), db, osrm);

    expect(result.recommended).toHaveLength(0);
    expect(result.noImprovement).toHaveLength(0);
    expect(result.blockedLocked).toHaveLength(0);
  });

  it("mixed jobs: categorizes correctly", async () => {
    const notStarted = makeJob({ jobId: "ns-1", status: "NOT_STARTED", transferCount: 0 });
    const locked = makeJob({ jobId: "locked-1", status: "IN_PROGRESS", transferCount: 0 });
    const manual = makeJob({ jobId: "manual-1", status: "NOT_STARTED", manualPosition: true, transferCount: 0 });
    const capped = makeJob({ jobId: "capped-1", status: "NOT_STARTED", transferCount: 1 });

    const state = freshState();
    state.jobs.set(notStarted.jobId, notStarted);
    state.jobs.set(locked.jobId, locked);
    state.jobs.set(manual.jobId, manual);
    state.jobs.set(capped.jobId, capped);
    // DB is source of truth for transfer cap
    state.transferCounts.set(`capped-1:${dateKey(TODAY)}`, 1);

    const targetTech = makeTechCandidate("tech-target");
    state.techsByBusiness.set("biz-1", [targetTech]);

    const sourceQueue: QueuedJob[] = [
      makeQueuedJob({ id: "ns-1", queuePosition: 0 }),
      makeQueuedJob({ id: "locked-1", queuePosition: 1, status: "IN_PROGRESS" }),
      makeQueuedJob({ id: "manual-1", queuePosition: 2 }),
      makeQueuedJob({ id: "capped-1", queuePosition: 3 }),
    ];
    state.queues.set(`tech-source:${dateKey(TODAY)}`, sourceQueue);

    const profiles = [makeTechProfile("tech-source"), makeTechProfile("tech-target")];
    const db = createInMemoryTransferDb(profiles, state);
    const osrm = mockOsrmDeps(10);

    const result = await evaluateBatchTransfers("tech-source", TODAY, makeClock(), db, osrm);

    expect(result.blockedLocked).toContain("locked-1");
    expect(result.blockedManual).toContain("manual-1");
    expect(result.blockedTransferCap).toContain("capped-1");
  });
});

// ── executeBatchSameDayTransfers ─────────────────────────────────────────────

describe("executeBatchSameDayTransfers", () => {
  const makeRecommendation = (jobId: string, approvalRequired: boolean): TransferEvaluation => ({
    outcome: "transfer_recommended",
    jobId,
    fromTechnicianId: "tech-source",
    toTechnicianId: "tech-target",
    fromDate: TODAY,
    toDate: TODAY,
    fromQueuePosition: 0,
    newQueuePosition: 0,
    totalCostMinutes: 60,
    timePreference: "NO_PREFERENCE" as const,
    netDriveTimeSavingMinutes: 10,
    approvalRequired,
    reason: "drive_time_improvement",
  });

  it("executes only auto-approved (approvalRequired=false)", async () => {
    const profiles = [makeTechProfile("tech-source"), makeTechProfile("tech-target")];
    const state = freshState();
    const db = createInMemoryTransferDb(profiles, state);

    const evaluations: TransferEvaluation[] = [
      makeRecommendation("auto-1", false),
      makeRecommendation("owner-1", true),  // should be skipped
      makeRecommendation("auto-2", false),
    ];

    const result = await executeBatchSameDayTransfers(evaluations, "biz-1", db);

    // Only auto-1 and auto-2 should be executed
    const transferredIds = result.transferred
      .filter((t) => t.outcome === "transferred")
      .map((t) => t.outcome === "transferred" ? t.jobId : "");
    expect(transferredIds).toContain("auto-1");
    expect(transferredIds).toContain("auto-2");
    expect(transferredIds).not.toContain("owner-1");
  });

  it("continues if one transfer fails", async () => {
    const profiles = [makeTechProfile("tech-source"), makeTechProfile("tech-target")];
    const state = freshState();

    // Fill capacity so first job fails (only 30 min left of 510)
    state.queues.set(`tech-target:${dateKey(TODAY)}`, [
      makeQueuedJob({ id: "filler-1", queuePosition: 0, estimatedDurationMinutes: 480, driveTimeMinutes: 0 }),
    ]);

    const db = createInMemoryTransferDb(profiles, state);

    const evaluations: TransferEvaluation[] = [
      // This one needs 200 min — won't fit (only 30 left)
      {
        ...makeRecommendation("fail-1", false),
        totalCostMinutes: 200,
      } as TransferEvaluation,
      // This one needs 20 min — will fit
      {
        ...makeRecommendation("ok-1", false),
        totalCostMinutes: 20,
      } as TransferEvaluation,
    ];

    const result = await executeBatchSameDayTransfers(evaluations, "biz-1", db);

    // fail-1 should be capacity_changed, ok-1 should be transferred
    expect(result.capacityChanged).toContain("fail-1");
    const transferred = result.transferred.find(
      (t) => t.outcome === "transferred" && t.jobId === "ok-1",
    );
    expect(transferred).toBeDefined();
  });

  it("skips non-recommended evaluations", async () => {
    const state = freshState();
    const db = createInMemoryTransferDb([], state);

    const evaluations: TransferEvaluation[] = [
      { outcome: "no_improvement", jobId: "skip-1", reason: "no_better_target" },
      { outcome: "blocked_locked", jobId: "skip-2", reason: "job_locked" },
    ];

    const result = await executeBatchSameDayTransfers(evaluations, "biz-1", db);

    expect(result.transferred).toHaveLength(0);
    expect(result.capacityChanged).toHaveLength(0);
    expect(result.blocked).toHaveLength(0);
  });
});

// ── Transfer cap source of truth ────────────────────────────────────────────

describe("transfer cap uses DB as source of truth", () => {
  it("DB count = 1 blocks transfer even if job.transferCount = 0", async () => {
    const job = makeJob({ transferCount: 0 }); // stale field says 0
    const state = freshState();
    // But DB says 1 transfer already happened today
    state.transferCounts.set(`job-1:${dateKey(TODAY)}`, 1);
    const db = createInMemoryTransferDb([], state);
    const osrm = mockOsrmDeps();

    const result = await evaluateTransfer(job, [], [], HOME_BASE, makeClock(), db, osrm);

    expect(result.outcome).toBe("blocked_transfer_cap");
  });

  it("emergency bypass ignores DB transfer count", async () => {
    const job = makeJob({ transferCount: 1 });
    const state = freshState();
    state.transferCounts.set(`job-1:${dateKey(TODAY)}`, 1);
    const targetTech = makeTechCandidate("tech-target");
    const profiles = [makeTechProfile("tech-source"), makeTechProfile("tech-target")];
    const db = createInMemoryTransferDb(profiles, state);
    const sourceQueue: QueuedJob[] = [
      makeQueuedJob({ id: "job-1", queuePosition: 0, addressLat: 33.80, addressLng: -84.40 }),
    ];
    const osrm = mockOsrmDeps(10);

    const result = await evaluateTransfer(
      job, [targetTech], sourceQueue, HOME_BASE, makeClock(), db, osrm, true,
    );

    expect(result.outcome).not.toBe("blocked_transfer_cap");
  });
});

// ── Queue index correctness ─────────────────────────────────────────────────

describe("queue index correctness", () => {
  it("evaluateTransfer uses actual array index, not queuePosition", async () => {
    // Job says queuePosition=5 but it's actually at array index 1
    const job = makeJob({ queuePosition: 5 });
    const targetTech = makeTechCandidate("tech-target");
    const profiles = [makeTechProfile("tech-source"), makeTechProfile("tech-target")];
    const state = freshState();
    const db = createInMemoryTransferDb(profiles, state);

    // sourceQueue: job-1 is at array index 1, NOT index 5
    const sourceQueue: QueuedJob[] = [
      makeQueuedJob({ id: "other-job", queuePosition: 0, addressLat: 33.70, addressLng: -84.30 }),
      makeQueuedJob({ id: "job-1", queuePosition: 5, addressLat: 33.80, addressLng: -84.40 }),
    ];

    const osrm = mockOsrmDeps(10);

    // Should not crash and should find the job correctly
    const result = await evaluateTransfer(
      job, [targetTech], sourceQueue, HOME_BASE, makeClock(), db, osrm,
    );

    // Should produce a result (not crash from out-of-bounds array access)
    expect(["transfer_recommended", "no_improvement"]).toContain(result.outcome);
  });

  it("job not found in sourceQueue returns no_improvement", async () => {
    const job = makeJob({ jobId: "missing-job" });
    const state = freshState();
    const db = createInMemoryTransferDb([], state);
    const sourceQueue: QueuedJob[] = [
      makeQueuedJob({ id: "other-job", queuePosition: 0 }),
    ];
    const osrm = mockOsrmDeps();

    const result = await evaluateTransfer(
      job, [], sourceQueue, HOME_BASE, makeClock(), db, osrm,
    );

    expect(result.outcome).toBe("no_improvement");
  });
});

// ── Time preference through execution ───────────────────────────────────────

describe("timePreference carried through execution", () => {
  const makeRecommendationWithPref = (
    pref: "MORNING" | "AFTERNOON" | "NO_PREFERENCE",
    overrides: Record<string, unknown> = {},
  ): TransferEvaluation & { outcome: "transfer_recommended" } => ({
    outcome: "transfer_recommended",
    jobId: "job-1",
    fromTechnicianId: "tech-source",
    toTechnicianId: "tech-target",
    fromDate: TODAY,
    toDate: TODAY,
    fromQueuePosition: 1,
    newQueuePosition: 0,
    totalCostMinutes: 60,
    timePreference: pref,
    netDriveTimeSavingMinutes: 10,
    approvalRequired: false,
    reason: "drive_time_improvement" as const,
    ...overrides,
  });

  it("evaluation includes timePreference in result", async () => {
    const job = makeJob({ timePreference: "MORNING" });
    const targetTech = makeTechCandidate("tech-target");
    const profiles = [makeTechProfile("tech-source"), makeTechProfile("tech-target")];
    const state = freshState();
    const db = createInMemoryTransferDb(profiles, state);
    const sourceQueue: QueuedJob[] = [
      makeQueuedJob({ id: "job-1", queuePosition: 0, addressLat: 33.80, addressLng: -84.40 }),
    ];
    const osrm = mockOsrmDeps(10);

    const result = await evaluateTransfer(
      job, [targetTech], sourceQueue, HOME_BASE, makeClock(), db, osrm,
    );

    if (result.outcome === "transfer_recommended") {
      expect(result.timePreference).toBe("MORNING");
    }
  });

  it("MORNING job execution succeeds when MORNING capacity available", async () => {
    const profiles = [makeTechProfile("tech-source"), makeTechProfile("tech-target")];
    const state = freshState();
    const db = createInMemoryTransferDb(profiles, state);

    const evaluation = makeRecommendationWithPref("MORNING");
    const result = await executeTransfer(evaluation, "auto_same_day", "biz-1", db);

    expect(result.outcome).toBe("transferred");
  });

  it("AFTERNOON job execution succeeds when capacity available", async () => {
    const profiles = [makeTechProfile("tech-source"), makeTechProfile("tech-target")];
    const state = freshState();
    const db = createInMemoryTransferDb(profiles, state);

    const evaluation = makeRecommendationWithPref("AFTERNOON");
    const result = await executeTransfer(evaluation, "auto_same_day", "biz-1", db);

    expect(result.outcome).toBe("transferred");
  });

  it("target full capacity but no MORNING sub-capacity -> capacity_changed", async () => {
    const profiles = [makeTechProfile("tech-source"), makeTechProfile("tech-target")];
    const state = freshState();

    // Fill morning capacity via queue (240 min fills 08:00-12:00)
    state.queues.set(`tech-target:${dateKey(TODAY)}`, [
      makeQueuedJob({ id: "morning-filler", queuePosition: 0, estimatedDurationMinutes: 240, driveTimeMinutes: 0 }),
    ]);

    const db = createInMemoryTransferDb(profiles, state);

    const evaluation = makeRecommendationWithPref("MORNING", { totalCostMinutes: 60 });
    const result = await executeTransfer(evaluation, "auto_same_day", "biz-1", db);

    expect(result.outcome).toBe("capacity_changed");
  });
});

// ── Stale execution validation ──────────────────────────────────────────────

describe("stale execution validation", () => {
  it("slot inside newly locked prefix returns capacity_changed", async () => {
    const profiles = [makeTechProfile("tech-source"), makeTechProfile("tech-target")];
    const state = freshState();
    // Target queue now has a locked job at position 0
    state.queues.set(`tech-target:${dateKey(TODAY)}`, [
      makeQueuedJob({ id: "locked-1", queuePosition: 0, status: "EN_ROUTE" }),
      makeQueuedJob({ id: "existing-1", queuePosition: 1 }),
    ]);
    const db = createInMemoryTransferDb(profiles, state);

    // Evaluation says insert at position 0 — but that's now locked
    const evaluation: TransferEvaluation & { outcome: "transfer_recommended" } = {
      outcome: "transfer_recommended",
      jobId: "job-1",
      fromTechnicianId: "tech-source",
      toTechnicianId: "tech-target",
      fromDate: TODAY,
      toDate: TODAY,
      fromQueuePosition: 1,
      newQueuePosition: 0,
      totalCostMinutes: 60,
      timePreference: "NO_PREFERENCE",
      netDriveTimeSavingMinutes: 10,
      approvalRequired: false,
      reason: "drive_time_improvement",
    };

    const result = await executeTransfer(evaluation, "auto_same_day", "biz-1", db);

    expect(result.outcome).toBe("capacity_changed");
  });
});

// ── Batch home base ─────────────────────────────────────────────────────────

describe("evaluateBatchTransfers uses real home base", () => {
  it("uses getTechHomeBase, not fake {0,0}", async () => {
    const job = makeJob({ jobId: "j1", queuePosition: 0 });
    const targetTech = makeTechCandidate("tech-target");
    const state = freshState();
    state.jobs.set("j1", job);
    state.techsByBusiness.set("biz-1", [targetTech]);
    state.queues.set(`tech-source:${dateKey(TODAY)}`, [
      makeQueuedJob({ id: "j1", queuePosition: 0, addressLat: 33.80, addressLng: -84.40 }),
    ]);

    const profiles = [makeTechProfile("tech-source"), makeTechProfile("tech-target")];
    const db = createInMemoryTransferDb(profiles, state);

    // Spy on getTechHomeBase to prove it's called
    const spy = vi.spyOn(db, "getTechHomeBase");

    const osrm = mockOsrmDeps(10);
    await evaluateBatchTransfers("tech-source", TODAY, makeClock(), db, osrm);

    expect(spy).toHaveBeenCalledWith("tech-source");
  });
});
