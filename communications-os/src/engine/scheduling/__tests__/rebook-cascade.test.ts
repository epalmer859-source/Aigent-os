// ============================================================
// Rebook Cascade & Sick Tech Redistribution — Tests
//
// Every test traces to a rule in unified-scheduling-spec.md.
// Uses in-memory DB fakes. No real DB, OSRM, or time calls.
//
// Assumptions:
//   - BusinessDayProvider is faked to return deterministic dates.
//   - Capacity is derived from the queue (no separate counter).
//   - OSRM is mocked to return fixed drive times.
//   - Queue insertion uses the real findOptimalPosition with
//     mocked OSRM so geographic scoring is deterministic.
// ============================================================

import { describe, it, expect, vi } from "vitest";
import {
  findRebookSlot,
  rebookSingleJob,
  redistributeSickTechJobs,
  markNeedsRebook,
  type RebookableJob,
  type RebookCascadeDb,
  type BusinessDayProvider,
} from "../rebook-cascade";
import { type TechProfile, type TimePreference } from "../capacity-math";
import type { TechCandidate } from "../tech-assignment";
import type { QueuedJob } from "../queue-insertion";
import type { OsrmServiceDeps } from "../osrm-service";
import type { SchedulingJobStatus } from "../scheduling-state-machine";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TODAY = new Date("2026-04-09");
const DAY1 = new Date("2026-04-10");
const DAY2 = new Date("2026-04-11");
const DAY3 = new Date("2026-04-14"); // skip weekend

function dateKey(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

const BUSINESS_DAYS: BusinessDayProvider = {
  getNextBusinessDays(_startDate: Date, count: number): Date[] {
    return [DAY1, DAY2, DAY3].slice(0, count);
  },
};

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

function makeTechCandidate(
  id: string,
  overrides: Partial<TechCandidate> = {},
): TechCandidate {
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
    ...overrides,
  };
}

function makeJob(overrides: Partial<RebookableJob> = {}): RebookableJob {
  return {
    jobId: "job-1",
    technicianId: "sick-tech",
    businessId: "biz-1",
    serviceTypeId: "st-hvac",
    scheduledDate: TODAY,
    timePreference: "NO_PREFERENCE",
    totalCostMinutes: 100,
    addressLat: 33.80,
    addressLng: -84.40,
    status: "NOT_STARTED",
    queuePosition: 0,
    manualPosition: false,
    ...overrides,
  };
}

/** Create a queue job that consumes the given duration minutes. */
function makeQueuedJob(
  id: string,
  durationMinutes: number,
  overrides: Partial<QueuedJob> = {},
): QueuedJob {
  return {
    id,
    queuePosition: 0,
    status: "NOT_STARTED" as SchedulingJobStatus,
    timePreference: "NO_PREFERENCE" as TimePreference,
    addressLat: 33.80,
    addressLng: -84.40,
    manualPosition: false,
    estimatedDurationMinutes: durationMinutes,
    driveTimeMinutes: 15,
    ...overrides,
  };
}

/**
 * Fill a tech's queue for a given date so that capacity is consumed.
 * Tech has 510 available minutes (08:00-17:00 minus 30min lunch).
 */
function fillQueue(
  state: InMemoryState,
  techId: string,
  date: Date,
  totalMinutes: number,
): void {
  const key = `${techId}:${dateKey(date)}`;
  const existing = state.queues.get(key) ?? [];
  existing.push(
    makeQueuedJob(`filler-${techId}-${dateKey(date)}-${existing.length}`, totalMinutes, {
      queuePosition: existing.length,
      driveTimeMinutes: 0,
    }),
  );
  state.queues.set(key, existing);
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

// ── In-memory RebookCascadeDb ────────────────────────────────────────────────

interface InMemoryState {
  jobs: Map<string, RebookableJob>;
  queues: Map<string, QueuedJob[]>; // key: "techId:YYYY-MM-DD"
  techsByBusiness: Map<string, TechCandidate[]>;
  rebookQueue: Array<{ jobId: string; originalDate: Date; originalTechnicianId: string; reason: string }>;
  updatedSchedules: Array<{ jobId: string; technicianId: string; date: Date; queuePosition: number }>;
  markedNeedsRebook: string[];
}

function createInMemoryRebookDb(
  techProfiles: TechProfile[],
  state: InMemoryState,
): RebookCascadeDb {
  const profileMap = new Map(techProfiles.map((p) => [p.id, p]));

  const db: RebookCascadeDb = {
    getTechProfile(technicianId: string) {
      return Promise.resolve(profileMap.get(technicianId) ?? null);
    },

    pauseGuardDb: {
      async getSchedulingMode() { return { mode: "active" as const }; },
    },

    async getJob(jobId: string) {
      return state.jobs.get(jobId) ?? null;
    },

    async getQueueForTechDate(technicianId: string, date: Date) {
      const key = `${technicianId}:${dateKey(date)}`;
      return state.queues.get(key) ?? [];
    },

    async listJobsForTechDate(technicianId: string, date: Date) {
      const jobs: RebookableJob[] = [];
      for (const job of state.jobs.values()) {
        if (
          job.technicianId === technicianId &&
          dateKey(job.scheduledDate) === dateKey(date)
        ) {
          jobs.push(job);
        }
      }
      return jobs;
    },

    async listOtherActiveTechs(businessId: string, excludeTechnicianId: string) {
      const techs = state.techsByBusiness.get(businessId) ?? [];
      return techs.filter((t) => t.id !== excludeTechnicianId && t.isActive);
    },

    async updateJobSchedule(jobId, technicianId, date, queuePosition) {
      state.updatedSchedules.push({ jobId, technicianId, date, queuePosition });
      const job = state.jobs.get(jobId);
      if (job) {
        // Also update the queue so subsequent capacity checks see the consumed minutes
        const key = `${technicianId}:${dateKey(date)}`;
        const queue = state.queues.get(key) ?? [];
        queue.push(
          makeQueuedJob(`rebooked-${jobId}`, job.totalCostMinutes, {
            queuePosition,
            driveTimeMinutes: 0,
          }),
        );
        state.queues.set(key, queue);

        job.technicianId = technicianId;
        job.scheduledDate = date;
        job.queuePosition = queuePosition;
      }
    },

    async markJobNeedsRebook(jobId) {
      state.markedNeedsRebook.push(jobId);
      const job = state.jobs.get(jobId);
      if (job) {
        job.status = "NEEDS_REBOOK";
      }
    },

    async incrementRebookCount(jobId: string) {
      const job = state.jobs.get(jobId);
      if (job) {
        job.rebookCount = (job.rebookCount ?? 0) + 1;
      }
    },

    async createRebookQueueEntry(jobId, originalDate, originalTechnicianId, reason) {
      state.rebookQueue.push({ jobId, originalDate, originalTechnicianId, reason });
    },

    async transaction<T>(fn: (tx: RebookCascadeDb) => Promise<T>): Promise<T> {
      return fn(db);
    },
  };

  return db;
}

function freshState(): InMemoryState {
  return {
    jobs: new Map(),
    queues: new Map(),
    techsByBusiness: new Map(),
    rebookQueue: [],
    updatedSchedules: [],
    markedNeedsRebook: [],
  };
}

// ── findRebookSlot ───────────────────────────────────────────────────────────

describe("findRebookSlot", () => {
  it("finds valid slot on day 1", async () => {
    const tech = makeTechCandidate("tech-a");
    const profiles = [makeTechProfile("tech-a")];
    const state = freshState();
    const db = createInMemoryRebookDb(profiles, state);
    const job = makeJob();
    const osrm = mockOsrmDeps();

    const slot = await findRebookSlot(job, [tech], BUSINESS_DAYS, db, osrm);

    expect(slot).not.toBeNull();
    expect(slot!.technicianId).toBe("tech-a");
    expect(dateKey(slot!.date)).toBe(dateKey(DAY1));
    expect(slot!.queuePosition).toBe(0);
  });

  it("skips full day 1, finds day 2", async () => {
    const tech = makeTechCandidate("tech-a");
    const profiles = [makeTechProfile("tech-a")];
    const state = freshState();

    fillQueue(state, "tech-a", DAY1, 510);

    const db = createInMemoryRebookDb(profiles, state);
    const job = makeJob();
    const osrm = mockOsrmDeps();

    const slot = await findRebookSlot(job, [tech], BUSINESS_DAYS, db, osrm);

    expect(slot).not.toBeNull();
    expect(dateKey(slot!.date)).toBe(dateKey(DAY2));
  });

  it("skips full day 1 and day 2, finds day 3", async () => {
    const tech = makeTechCandidate("tech-a");
    const profiles = [makeTechProfile("tech-a")];
    const state = freshState();

    fillQueue(state, "tech-a", DAY1, 510);
    fillQueue(state, "tech-a", DAY2, 510);

    const db = createInMemoryRebookDb(profiles, state);
    const job = makeJob();
    const osrm = mockOsrmDeps();

    const slot = await findRebookSlot(job, [tech], BUSINESS_DAYS, db, osrm);

    expect(slot).not.toBeNull();
    expect(dateKey(slot!.date)).toBe(dateKey(DAY3));
  });

  it("returns null when all 3 business days are full", async () => {
    const tech = makeTechCandidate("tech-a");
    const profiles = [makeTechProfile("tech-a")];
    const state = freshState();

    fillQueue(state, "tech-a", DAY1, 510);
    fillQueue(state, "tech-a", DAY2, 510);
    fillQueue(state, "tech-a", DAY3, 510);

    const db = createInMemoryRebookDb(profiles, state);
    const job = makeJob();
    const osrm = mockOsrmDeps();

    const slot = await findRebookSlot(job, [tech], BUSINESS_DAYS, db, osrm);

    expect(slot).toBeNull();
  });

  it("respects MORNING preference", async () => {
    const tech = makeTechCandidate("tech-a");
    const profiles = [makeTechProfile("tech-a")];
    const state = freshState();

    // Fill morning capacity on day 1 (morning = 240 min before lunch)
    fillQueue(state, "tech-a", DAY1, 200);

    const db = createInMemoryRebookDb(profiles, state);

    // Job needs 100 min MORNING — only 40 left in morning on day 1
    const job = makeJob({ timePreference: "MORNING", totalCostMinutes: 100 });
    const osrm = mockOsrmDeps();

    const slot = await findRebookSlot(job, [tech], BUSINESS_DAYS, db, osrm);

    expect(slot).not.toBeNull();
    // Should skip day 1 (insufficient morning) and find day 2
    expect(dateKey(slot!.date)).toBe(dateKey(DAY2));
  });

  it("respects AFTERNOON preference", async () => {
    const tech = makeTechCandidate("tech-a");
    const profiles = [makeTechProfile("tech-a")];
    const state = freshState();

    // Fill afternoon capacity on day 1
    // First fill morning so cursor advances past lunch, then fill afternoon
    fillQueue(state, "tech-a", DAY1, 240); // fills morning
    fillQueue(state, "tech-a", DAY1, 250); // fills most of afternoon

    const db = createInMemoryRebookDb(profiles, state);

    const job = makeJob({ timePreference: "AFTERNOON", totalCostMinutes: 100 });
    const osrm = mockOsrmDeps();

    const slot = await findRebookSlot(job, [tech], BUSINESS_DAYS, db, osrm);

    expect(slot).not.toBeNull();
    expect(dateKey(slot!.date)).toBe(dateKey(DAY2));
  });

  it("skips day when capacity is full", async () => {
    const tech = makeTechCandidate("tech-a");
    const profiles = [makeTechProfile("tech-a")];
    const state = freshState();

    fillQueue(state, "tech-a", DAY1, 510);

    const db = createInMemoryRebookDb(profiles, state);
    const job = makeJob();
    const osrm = mockOsrmDeps();

    const slot = await findRebookSlot(job, [tech], BUSINESS_DAYS, db, osrm);

    expect(slot).not.toBeNull();
    expect(dateKey(slot!.date)).toBe(dateKey(DAY2));
  });

  it("earlier valid day beats later 'better' option", async () => {
    const techA = makeTechCandidate("tech-a");
    const techB = makeTechCandidate("tech-b");
    const profiles = [makeTechProfile("tech-a"), makeTechProfile("tech-b")];
    const state = freshState();
    const db = createInMemoryRebookDb(profiles, state);
    const job = makeJob();
    const osrm = mockOsrmDeps();

    const slot = await findRebookSlot(job, [techA, techB], BUSINESS_DAYS, db, osrm);

    expect(slot).not.toBeNull();
    expect(dateKey(slot!.date)).toBe(dateKey(DAY1));
    expect(slot!.technicianId).toBe("tech-a");
  });
});

// ── rebookSingleJob ──────────────────────────────────────────────────────────

describe("rebookSingleJob", () => {
  it("locked job returns blocked_locked", async () => {
    const job = makeJob({ status: "EN_ROUTE" });
    const state = freshState();
    const db = createInMemoryRebookDb([], state);
    const osrm = mockOsrmDeps();

    const result = await rebookSingleJob(job, [], BUSINESS_DAYS, db, osrm);

    expect(result.outcome).toBe("blocked_locked");
    if (result.outcome === "blocked_locked") {
      expect(result.reason).toBe("job_locked");
    }
  });

  it("unlocked job rebooks successfully when slot exists", async () => {
    const tech = makeTechCandidate("tech-a");
    const profiles = [makeTechProfile("tech-a")];
    const state = freshState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryRebookDb(profiles, state);
    const job = makeJob();
    const osrm = mockOsrmDeps();

    const result = await rebookSingleJob(job, [tech], BUSINESS_DAYS, db, osrm);

    expect(result.outcome).toBe("rebooked");
    if (result.outcome === "rebooked") {
      expect(result.technicianId).toBe("tech-a");
      expect(dateKey(result.date)).toBe(dateKey(DAY1));
      expect(result.reason).toBe("capacity_found");
    }
  });

  it("unlocked job marks NEEDS_REBOOK when no slot exists", async () => {
    const tech = makeTechCandidate("tech-a");
    const profiles = [makeTechProfile("tech-a")];
    const state = freshState();

    fillQueue(state, "tech-a", DAY1, 510);
    fillQueue(state, "tech-a", DAY2, 510);
    fillQueue(state, "tech-a", DAY3, 510);

    const db = createInMemoryRebookDb(profiles, state);
    const job = makeJob();
    state.jobs.set(job.jobId, job);
    const osrm = mockOsrmDeps();

    const result = await rebookSingleJob(job, [tech], BUSINESS_DAYS, db, osrm);

    expect(result.outcome).toBe("needs_rebook");
    if (result.outcome === "needs_rebook") {
      expect(result.reason).toBe("no_capacity_next_3_business_days");
    }
  });

  it("NEEDS_REBOOK path creates rebook_queue entry", async () => {
    const tech = makeTechCandidate("tech-a");
    const profiles = [makeTechProfile("tech-a")];
    const state = freshState();

    fillQueue(state, "tech-a", DAY1, 510);
    fillQueue(state, "tech-a", DAY2, 510);
    fillQueue(state, "tech-a", DAY3, 510);

    const db = createInMemoryRebookDb(profiles, state);
    const job = makeJob();
    state.jobs.set(job.jobId, job);
    const osrm = mockOsrmDeps();

    await rebookSingleJob(job, [tech], BUSINESS_DAYS, db, osrm);

    expect(state.markedNeedsRebook).toContain("job-1");
    expect(state.rebookQueue).toHaveLength(1);
    expect(state.rebookQueue[0]!.jobId).toBe("job-1");
    expect(state.rebookQueue[0]!.originalTechnicianId).toBe("sick-tech");
    expect(state.rebookQueue[0]!.reason).toBe("no_capacity_next_3_business_days");
  });

  it("rebook path uses transaction (updateJobSchedule called)", async () => {
    const tech = makeTechCandidate("tech-a");
    const profiles = [makeTechProfile("tech-a")];
    const state = freshState();
    const db = createInMemoryRebookDb(profiles, state);
    const job = makeJob();
    state.jobs.set(job.jobId, job);
    const osrm = mockOsrmDeps();

    await rebookSingleJob(job, [tech], BUSINESS_DAYS, db, osrm);

    expect(state.updatedSchedules).toHaveLength(1);
    expect(state.updatedSchedules[0]!.jobId).toBe("job-1");
    expect(state.updatedSchedules[0]!.technicianId).toBe("tech-a");
  });

  it("needs_rebook path uses transaction (markJobNeedsRebook called)", async () => {
    const profiles = [makeTechProfile("tech-a")];
    const state = freshState();

    fillQueue(state, "tech-a", DAY1, 510);
    fillQueue(state, "tech-a", DAY2, 510);
    fillQueue(state, "tech-a", DAY3, 510);

    const db = createInMemoryRebookDb(profiles, state);
    const job = makeJob();
    state.jobs.set(job.jobId, job);
    const osrm = mockOsrmDeps();

    await rebookSingleJob(job, [makeTechCandidate("tech-a")], BUSINESS_DAYS, db, osrm);

    expect(state.markedNeedsRebook).toContain("job-1");
    expect(state.rebookQueue).toHaveLength(1);
  });
});

// ── redistributeSickTechJobs ─────────────────────────────────────────────────

describe("redistributeSickTechJobs", () => {
  it("locked jobs are not moved and appear in blockedLockedJobs", async () => {
    const lockedJob = makeJob({ jobId: "locked-1", status: "IN_PROGRESS" });
    const state = freshState();
    state.jobs.set(lockedJob.jobId, lockedJob);
    state.techsByBusiness.set("biz-1", []);

    const profiles = [makeTechProfile("sick-tech")];
    const db = createInMemoryRebookDb(profiles, state);
    const osrm = mockOsrmDeps();

    const result = await redistributeSickTechJobs("sick-tech", TODAY, "biz-1", BUSINESS_DAYS, db, osrm);

    expect(result.blockedLockedJobs).toContain("locked-1");
    expect(result.redistributed.some((r) => r.outcome === "blocked_locked" && r.jobId === "locked-1")).toBe(true);
    expect(result.needsRebook).toHaveLength(0);
  });

  it("unlocked job redistributes same-day when another tech has room", async () => {
    const job = makeJob({ jobId: "job-1", status: "NOT_STARTED" });
    const otherTech = makeTechCandidate("tech-b");

    const state = freshState();
    state.jobs.set(job.jobId, job);
    state.techsByBusiness.set("biz-1", [
      makeTechCandidate("sick-tech"),
      otherTech,
    ]);

    const profiles = [makeTechProfile("sick-tech"), makeTechProfile("tech-b")];
    const db = createInMemoryRebookDb(profiles, state);
    const osrm = mockOsrmDeps();

    const result = await redistributeSickTechJobs("sick-tech", TODAY, "biz-1", BUSINESS_DAYS, db, osrm);

    expect(result.redistributed).toHaveLength(1);
    expect(result.redistributed[0]!.outcome).toBe("rebooked");
    if (result.redistributed[0]!.outcome === "rebooked") {
      expect(result.redistributed[0]!.technicianId).toBe("tech-b");
      expect(dateKey(result.redistributed[0]!.date)).toBe(dateKey(TODAY));
    }
    expect(result.needsRebook).toHaveLength(0);
  });

  it("same-day candidate fails queue insertion, falls through to future-day rebook", async () => {
    const job = makeJob({ jobId: "job-1", status: "NOT_STARTED" });
    const otherTech = makeTechCandidate("tech-b");

    const state = freshState();
    state.jobs.set(job.jobId, job);
    state.techsByBusiness.set("biz-1", [otherTech]);

    fillQueue(state, "tech-b", TODAY, 510);

    const profiles = [makeTechProfile("sick-tech"), makeTechProfile("tech-b")];
    const db = createInMemoryRebookDb(profiles, state);
    const osrm = mockOsrmDeps();

    const result = await redistributeSickTechJobs("sick-tech", TODAY, "biz-1", BUSINESS_DAYS, db, osrm);

    expect(result.redistributed).toHaveLength(1);
    expect(result.redistributed[0]!.outcome).toBe("rebooked");
    if (result.redistributed[0]!.outcome === "rebooked") {
      expect(dateKey(result.redistributed[0]!.date)).toBe(dateKey(DAY1));
    }
  });

  it("same-day redistribution fails, future-day day-1 rebook succeeds", async () => {
    const job = makeJob({ jobId: "job-1", status: "NOT_STARTED" });
    const otherTech = makeTechCandidate("tech-b");

    const state = freshState();
    state.jobs.set(job.jobId, job);
    state.techsByBusiness.set("biz-1", [otherTech]);

    fillQueue(state, "tech-b", TODAY, 510);

    const profiles = [makeTechProfile("sick-tech"), makeTechProfile("tech-b")];
    const db = createInMemoryRebookDb(profiles, state);
    const osrm = mockOsrmDeps();

    const result = await redistributeSickTechJobs("sick-tech", TODAY, "biz-1", BUSINESS_DAYS, db, osrm);

    expect(result.redistributed[0]!.outcome).toBe("rebooked");
    if (result.redistributed[0]!.outcome === "rebooked") {
      expect(dateKey(result.redistributed[0]!.date)).toBe(dateKey(DAY1));
      expect(result.redistributed[0]!.technicianId).toBe("tech-b");
    }
  });

  it("same-day redistribution fails, day-2 rebook succeeds", async () => {
    const job = makeJob({ jobId: "job-1", status: "NOT_STARTED" });
    const otherTech = makeTechCandidate("tech-b");

    const state = freshState();
    state.jobs.set(job.jobId, job);
    state.techsByBusiness.set("biz-1", [otherTech]);

    fillQueue(state, "tech-b", TODAY, 510);
    fillQueue(state, "tech-b", DAY1, 510);

    const profiles = [makeTechProfile("sick-tech"), makeTechProfile("tech-b")];
    const db = createInMemoryRebookDb(profiles, state);
    const osrm = mockOsrmDeps();

    const result = await redistributeSickTechJobs("sick-tech", TODAY, "biz-1", BUSINESS_DAYS, db, osrm);

    expect(result.redistributed[0]!.outcome).toBe("rebooked");
    if (result.redistributed[0]!.outcome === "rebooked") {
      expect(dateKey(result.redistributed[0]!.date)).toBe(dateKey(DAY2));
    }
  });

  it("all attempts fail, job ends in needsRebook", async () => {
    const job = makeJob({ jobId: "job-1", status: "NOT_STARTED" });
    const otherTech = makeTechCandidate("tech-b");

    const state = freshState();
    state.jobs.set(job.jobId, job);
    state.techsByBusiness.set("biz-1", [otherTech]);

    fillQueue(state, "tech-b", TODAY, 510);
    fillQueue(state, "tech-b", DAY1, 510);
    fillQueue(state, "tech-b", DAY2, 510);
    fillQueue(state, "tech-b", DAY3, 510);

    const profiles = [makeTechProfile("sick-tech"), makeTechProfile("tech-b")];
    const db = createInMemoryRebookDb(profiles, state);
    const osrm = mockOsrmDeps();

    const result = await redistributeSickTechJobs("sick-tech", TODAY, "biz-1", BUSINESS_DAYS, db, osrm);

    expect(result.needsRebook).toContain("job-1");
    expect(result.redistributed[0]!.outcome).toBe("needs_rebook");
  });

  it("mixed case: blocked, same-day redistributed, future rebooked, and NEEDS_REBOOK", async () => {
    const lockedJob = makeJob({ jobId: "locked-1", status: "EN_ROUTE" });
    const sameDayJob = makeJob({ jobId: "sameday-1", status: "NOT_STARTED", totalCostMinutes: 60 });
    const futureDayJob = makeJob({ jobId: "future-1", status: "NOT_STARTED", totalCostMinutes: 60 });
    const noSlotJob = makeJob({ jobId: "noslot-1", status: "NOT_STARTED", totalCostMinutes: 60 });

    const techB = makeTechCandidate("tech-b");
    const techC = makeTechCandidate("tech-c");

    const state = freshState();
    state.jobs.set(lockedJob.jobId, lockedJob);
    state.jobs.set(sameDayJob.jobId, sameDayJob);
    state.jobs.set(futureDayJob.jobId, futureDayJob);
    state.jobs.set(noSlotJob.jobId, noSlotJob);
    state.techsByBusiness.set("biz-1", [techB, techC]);

    const profiles = [
      makeTechProfile("sick-tech"),
      makeTechProfile("tech-b"),
      makeTechProfile("tech-c"),
    ];

    // tech-b: has room for 1 job today (60 min left), then fully booked all future days
    fillQueue(state, "tech-b", TODAY, 450);
    fillQueue(state, "tech-b", DAY1, 510);
    fillQueue(state, "tech-b", DAY2, 510);
    fillQueue(state, "tech-b", DAY3, 510);

    // tech-c: full today, has room for 1 job on day 1 (60 min left), then fully booked
    fillQueue(state, "tech-c", TODAY, 510);
    fillQueue(state, "tech-c", DAY1, 450);
    fillQueue(state, "tech-c", DAY2, 510);
    fillQueue(state, "tech-c", DAY3, 510);

    const db = createInMemoryRebookDb(profiles, state);
    const osrm = mockOsrmDeps();

    const result = await redistributeSickTechJobs("sick-tech", TODAY, "biz-1", BUSINESS_DAYS, db, osrm);

    // locked-1: blocked
    expect(result.blockedLockedJobs).toContain("locked-1");

    // sameday-1: should get same-day on tech-b (only one with room today)
    const sameDayResult = result.redistributed.find((r) => r.jobId === "sameday-1");
    expect(sameDayResult).toBeDefined();
    expect(sameDayResult!.outcome).toBe("rebooked");

    // future-1: same-day should fail (tech-b now full after sameday-1, tech-c full today)
    //           future-day rebook on tech-c day 1
    const futureResult = result.redistributed.find((r) => r.jobId === "future-1");
    expect(futureResult).toBeDefined();
    expect(futureResult!.outcome).toBe("rebooked");

    // noslot-1: everything full
    const noSlotResult = result.redistributed.find((r) => r.jobId === "noslot-1");
    expect(noSlotResult).toBeDefined();
    expect(noSlotResult!.outcome).toBe("needs_rebook");
    expect(result.needsRebook).toContain("noslot-1");
  });
});

// ── markNeedsRebook ──────────────────────────────────────────────────────────

describe("markNeedsRebook", () => {
  it("sets status to NEEDS_REBOOK", async () => {
    const job = makeJob();
    const state = freshState();
    state.jobs.set(job.jobId, job);
    const db = createInMemoryRebookDb([], state);

    await markNeedsRebook(job, db);

    expect(state.markedNeedsRebook).toContain("job-1");
  });

  it("creates rebook_queue entry with original date/tech/reason", async () => {
    const job = makeJob();
    const state = freshState();
    state.jobs.set(job.jobId, job);
    const db = createInMemoryRebookDb([], state);

    await markNeedsRebook(job, db);

    expect(state.rebookQueue).toHaveLength(1);
    const entry = state.rebookQueue[0]!;
    expect(entry.jobId).toBe("job-1");
    expect(dateKey(entry.originalDate)).toBe(dateKey(TODAY));
    expect(entry.originalTechnicianId).toBe("sick-tech");
    expect(entry.reason).toBe("no_capacity_next_3_business_days");
  });
});

// ── Capacity via queue (move semantics) ────────────────────────────────────

describe("capacity via queue — move semantics", () => {
  it("rebooked job appears in updatedSchedules (the move IS the capacity change)", async () => {
    const profiles = [makeTechProfile("sick-tech"), makeTechProfile("tech-a")];
    const state = freshState();

    fillQueue(state, "tech-a", TODAY, 510);

    const db = createInMemoryRebookDb(profiles, state);
    const osrm = mockOsrmDeps();

    const job = makeJob({ technicianId: "sick-tech", totalCostMinutes: 100 });
    state.jobs.set(job.jobId, job);

    const result = await rebookSingleJob(
      job, [makeTechCandidate("tech-a")], BUSINESS_DAYS, db, osrm,
    );

    expect(result.outcome).toBe("rebooked");
    expect(state.updatedSchedules).toHaveLength(1);
    expect(state.updatedSchedules[0]!.technicianId).toBe("tech-a");
    expect(dateKey(state.updatedSchedules[0]!.date)).toBe(dateKey(DAY1));
  });

  it("same-day redistribution moves job to another tech", async () => {
    const profiles = [makeTechProfile("sick-tech"), makeTechProfile("tech-b")];
    const state = freshState();
    state.techsByBusiness.set("biz-1", [
      makeTechCandidate("sick-tech"),
      makeTechCandidate("tech-b"),
    ]);
    const db = createInMemoryRebookDb(profiles, state);
    const osrm = mockOsrmDeps();

    const job = makeJob({ technicianId: "sick-tech", totalCostMinutes: 100 });
    state.jobs.set(job.jobId, job);

    const result = await redistributeSickTechJobs("sick-tech", TODAY, "biz-1", BUSINESS_DAYS, db, osrm);

    expect(result.redistributed).toHaveLength(1);
    expect(result.redistributed[0]!.outcome).toBe("rebooked");
    if (result.redistributed[0]!.outcome === "rebooked") {
      expect(result.redistributed[0]!.technicianId).toBe("tech-b");
      expect(dateKey(result.redistributed[0]!.date)).toBe(dateKey(TODAY));
    }
    expect(state.updatedSchedules).toHaveLength(1);
    expect(state.updatedSchedules[0]!.technicianId).toBe("tech-b");
  });

  it("NEEDS_REBOOK path does NOT create an updateJobSchedule entry", async () => {
    const profiles = [makeTechProfile("sick-tech"), makeTechProfile("tech-a")];
    const state = freshState();

    fillQueue(state, "tech-a", DAY1, 510);
    fillQueue(state, "tech-a", DAY2, 510);
    fillQueue(state, "tech-a", DAY3, 510);

    const db = createInMemoryRebookDb(profiles, state);
    const osrm = mockOsrmDeps();

    const job = makeJob({ technicianId: "sick-tech", totalCostMinutes: 100 });
    state.jobs.set(job.jobId, job);

    const result = await rebookSingleJob(
      job, [makeTechCandidate("tech-a")], BUSINESS_DAYS, db, osrm,
    );

    expect(result.outcome).toBe("needs_rebook");
    expect(state.updatedSchedules).toHaveLength(0);
    expect(state.markedNeedsRebook).toContain("job-1");
  });

  it("blocked_locked path does NOT move the job", async () => {
    const profiles = [makeTechProfile("sick-tech"), makeTechProfile("tech-a")];
    const state = freshState();
    const db = createInMemoryRebookDb(profiles, state);
    const osrm = mockOsrmDeps();

    const job = makeJob({ status: "EN_ROUTE", totalCostMinutes: 100 });

    const result = await rebookSingleJob(
      job, [makeTechCandidate("tech-a")], BUSINESS_DAYS, db, osrm,
    );

    expect(result.outcome).toBe("blocked_locked");
    expect(state.updatedSchedules).toHaveLength(0);
    expect(state.markedNeedsRebook).toHaveLength(0);
  });
});

// ── Multi-candidate same-day fallback ───────────────────────────────────────

describe("multi-candidate same-day fallback", () => {
  it("second same-day candidate used when first has no capacity", async () => {
    const techB = makeTechCandidate("tech-b");
    const techC = makeTechCandidate("tech-c");

    const profiles = [makeTechProfile("sick-tech"), makeTechProfile("tech-b"), makeTechProfile("tech-c")];
    const state = freshState();
    state.techsByBusiness.set("biz-1", [techB, techC]);

    fillQueue(state, "tech-b", TODAY, 510);

    const db = createInMemoryRebookDb(profiles, state);
    const osrm = mockOsrmDeps();

    const job = makeJob({ jobId: "job-1", status: "NOT_STARTED", totalCostMinutes: 60 });
    state.jobs.set(job.jobId, job);

    const result = await redistributeSickTechJobs("sick-tech", TODAY, "biz-1", BUSINESS_DAYS, db, osrm);

    expect(result.redistributed).toHaveLength(1);
    expect(result.redistributed[0]!.outcome).toBe("rebooked");
    if (result.redistributed[0]!.outcome === "rebooked") {
      expect(result.redistributed[0]!.technicianId).toBe("tech-c");
      expect(dateKey(result.redistributed[0]!.date)).toBe(dateKey(TODAY));
    }
  });

  it("earlier valid future day still beats later options (regression)", async () => {
    const tech = makeTechCandidate("tech-a");
    const profiles = [makeTechProfile("tech-a")];
    const state = freshState();

    fillQueue(state, "tech-a", DAY1, 510);

    const db = createInMemoryRebookDb(profiles, state);
    const job = makeJob();
    const osrm = mockOsrmDeps();

    const slot = await findRebookSlot(job, [tech], BUSINESS_DAYS, db, osrm);

    expect(slot).not.toBeNull();
    expect(dateKey(slot!.date)).toBe(dateKey(DAY2));
    expect(slot!.technicianId).toBe("tech-a");
  });
});

// ── H5: Rebook circuit breaker ──────────────────────────────────────────────

describe("H5: rebook circuit breaker", () => {
  it("blocks rebook when rebookCount >= MAX_REBOOK_COUNT (3)", async () => {
    const tech = makeTechCandidate("tech-a");
    const profiles = [makeTechProfile("tech-a")];
    const state = freshState();
    const db = createInMemoryRebookDb(profiles, state);
    const osrm = mockOsrmDeps();

    const job = makeJob({ rebookCount: 3 });

    const result = await rebookSingleJob(job, [tech], BUSINESS_DAYS, db, osrm);

    expect(result.outcome).toBe("blocked_rebook_limit");
    if (result.outcome === "blocked_rebook_limit") {
      expect(result.reason).toBe("max_rebook_count_reached");
      expect(result.rebookCount).toBe(3);
    }
  });

  it("allows rebook when rebookCount < MAX_REBOOK_COUNT", async () => {
    const tech = makeTechCandidate("tech-a");
    const profiles = [makeTechProfile("tech-a")];
    const state = freshState();
    const job = makeJob({ rebookCount: 2 });
    state.jobs.set(job.jobId, job);
    const db = createInMemoryRebookDb(profiles, state);
    const osrm = mockOsrmDeps();

    const result = await rebookSingleJob(job, [tech], BUSINESS_DAYS, db, osrm);

    expect(result.outcome).toBe("rebooked");
  });

  it("increments rebookCount on successful rebook", async () => {
    const tech = makeTechCandidate("tech-a");
    const profiles = [makeTechProfile("tech-a")];
    const state = freshState();
    const job = makeJob({ rebookCount: 1 });
    state.jobs.set(job.jobId, job);
    const db = createInMemoryRebookDb(profiles, state);
    const osrm = mockOsrmDeps();

    await rebookSingleJob(job, [tech], BUSINESS_DAYS, db, osrm);

    expect(state.jobs.get("job-1")!.rebookCount).toBe(2);
  });

  it("treats undefined rebookCount as 0 (allows rebook)", async () => {
    const tech = makeTechCandidate("tech-a");
    const profiles = [makeTechProfile("tech-a")];
    const state = freshState();
    const job = makeJob(); // rebookCount undefined
    state.jobs.set(job.jobId, job);
    const db = createInMemoryRebookDb(profiles, state);
    const osrm = mockOsrmDeps();

    const result = await rebookSingleJob(job, [tech], BUSINESS_DAYS, db, osrm);

    expect(result.outcome).toBe("rebooked");
  });
});

// ── H8: Pause guard on redistributeSickTechJobs ───────────────────────────

describe("H8: pause guard on redistributeSickTechJobs", () => {
  it("returns empty result when business is paused", async () => {
    const job = makeJob({ jobId: "job-1", status: "NOT_STARTED" });
    const state = freshState();
    state.jobs.set(job.jobId, job);
    state.techsByBusiness.set("biz-1", [makeTechCandidate("tech-a")]);

    const profiles = [makeTechProfile("sick-tech"), makeTechProfile("tech-a")];
    const db = createInMemoryRebookDb(profiles, state);
    db.pauseGuardDb = {
      async getSchedulingMode() { return { mode: "paused" as const }; },
    };
    const osrm = mockOsrmDeps();

    const result = await redistributeSickTechJobs("sick-tech", TODAY, "biz-1", BUSINESS_DAYS, db, osrm);

    expect(result.redistributed).toHaveLength(0);
    expect(result.blockedLockedJobs).toHaveLength(0);
    expect(result.needsRebook).toHaveLength(0);
  });

  it("returns empty result when business is resync_pending", async () => {
    const job = makeJob({ jobId: "job-1", status: "NOT_STARTED" });
    const state = freshState();
    state.jobs.set(job.jobId, job);
    state.techsByBusiness.set("biz-1", [makeTechCandidate("tech-a")]);

    const profiles = [makeTechProfile("sick-tech"), makeTechProfile("tech-a")];
    const db = createInMemoryRebookDb(profiles, state);
    db.pauseGuardDb = {
      async getSchedulingMode() { return { mode: "resync_pending" as const }; },
    };
    const osrm = mockOsrmDeps();

    const result = await redistributeSickTechJobs("sick-tech", TODAY, "biz-1", BUSINESS_DAYS, db, osrm);

    expect(result.redistributed).toHaveLength(0);
  });
});
