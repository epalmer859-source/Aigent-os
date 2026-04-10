// ============================================================
// Tests for src/engine/scheduling/scheduling-workers.ts (C4)
// ============================================================

import { describe, it, expect, vi } from "vitest";
import {
  morningReminderWorker,
  endOfDaySweepWorker,
  pullForwardExpiryWorker,
  skillTagValidationWorker,
  manualPositionExpiryWorker,
  estimateTimeoutWorker,
  morningBriefingWorker,
  timerCheckInWorker,
  projectScopePromptWorker,
  workerHeartbeatWorker,
  type MorningReminderWorkerDb,
  type EndOfDaySweepWorkerDb,
  type PullForwardExpiryWorkerDb,
  type SkillTagValidationWorkerDb,
  type ManualPositionExpiryWorkerDb,
  type EstimateTimeoutWorkerDb,
  type MorningBriefingWorkerDb,
  type TimerCheckInWorkerDb,
  type ProjectScopePromptWorkerDb,
  type HeartbeatDb,
  type BusinessConfig,
  type WorkerClockProvider,
} from "../scheduling-workers";
import {
  createInMemorySchedulingDb,
  type SchedulingJobRecord,
} from "../scheduling-state-machine";
import type { TechProfile } from "../capacity-math";

// ── Fixtures ────────────────────────────────────────────────────────────────

const BIZ_ID = "biz-1";
const TIMEZONE = "America/New_York";
const CONFIG: BusinessConfig = { businessId: BIZ_ID, timezone: TIMEZONE };

// 2026-04-09T14:00:00Z = 10:00 AM EDT
const NOW = new Date("2026-04-09T14:00:00Z");
const clock: WorkerClockProvider = { now: () => NOW };

// ── Morning reminder worker ─────────────────────────────────────────────────

describe("morningReminderWorker", () => {
  function makeMorningDb(
    jobs: { jobId: string }[],
    alreadyQueued: Set<string> = new Set(),
  ): MorningReminderWorkerDb {
    return {
      async listNotStartedJobsForDate() { return jobs; },
      async hasPendingMorningReminder(jobId) { return alreadyQueued.has(jobId); },
      pauseGuardDb: {
        async getSchedulingMode() { return { mode: "active" as const }; },
      },
    };
  }

  it("queues reminders for all jobs without existing reminders", async () => {
    const queued: string[] = [];
    const db = makeMorningDb([{ jobId: "j1" }, { jobId: "j2" }]);

    const result = await morningReminderWorker(
      CONFIG, clock, db,
      async (jobId) => { queued.push(jobId); },
    );

    expect(result.jobsProcessed).toBe(2);
    expect(result.remindersQueued).toBe(2);
    expect(result.alreadyQueued).toBe(0);
    expect(queued).toEqual(["j1", "j2"]);
  });

  it("skips jobs that already have a pending reminder (idempotent)", async () => {
    const queued: string[] = [];
    const db = makeMorningDb(
      [{ jobId: "j1" }, { jobId: "j2" }],
      new Set(["j1"]), // j1 already queued
    );

    const result = await morningReminderWorker(
      CONFIG, clock, db,
      async (jobId) => { queued.push(jobId); },
    );

    expect(result.remindersQueued).toBe(1);
    expect(result.alreadyQueued).toBe(1);
    expect(queued).toEqual(["j2"]);
  });

  it("returns zero counts for businesses with no jobs", async () => {
    const db = makeMorningDb([]);
    const result = await morningReminderWorker(
      CONFIG, clock, db,
      async () => {},
    );

    expect(result.jobsProcessed).toBe(0);
    expect(result.remindersQueued).toBe(0);
    expect(result.alreadyQueued).toBe(0);
  });

  it("is fully idempotent on second run (all already queued)", async () => {
    const db = makeMorningDb(
      [{ jobId: "j1" }, { jobId: "j2" }],
      new Set(["j1", "j2"]),
    );

    const result = await morningReminderWorker(
      CONFIG, clock, db,
      async () => { throw new Error("should not be called"); },
    );

    expect(result.remindersQueued).toBe(0);
    expect(result.alreadyQueued).toBe(2);
  });
});

// ── End-of-day sweep worker ─────────────────────────────────────────────────

describe("endOfDaySweepWorker", () => {
  const techProfile: TechProfile = {
    id: "tech-1",
    businessId: BIZ_ID,
    workingHoursStart: "08:00",
    workingHoursEnd: "17:00",
    lunchStart: "12:00",
    lunchEnd: "13:00",
    overtimeCapMinutes: 0,
  };

  function makeSweepDb(
    jobs: SchedulingJobRecord[],
    techProfiles: Array<{ id: string; profile: TechProfile }>,
  ): EndOfDaySweepWorkerDb {
    const baseDb = createInMemorySchedulingDb(jobs);
    return {
      ...baseDb,
      async getActiveTechProfiles() { return techProfiles; },
      pauseGuardDb: {
        async getSchedulingMode() { return { mode: "active" as const }; },
      },
    };
  }

  it("passes business timezone to endOfDaySweep", async () => {
    // Tech ends at 17:00 EDT. At 23:30 UTC (19:30 EDT), that's 2.5h past → stuck.
    // Use a reference time that is clearly April 9 in EDT.
    const lateNow = new Date("2026-04-09T23:30:00Z");
    const lateClock: WorkerClockProvider = { now: () => lateNow };

    const jobs: SchedulingJobRecord[] = [{
      id: "job-stuck",
      businessId: BIZ_ID,
      technicianId: "tech-1",
      customerId: "cust-1",
      status: "IN_PROGRESS",
      scheduledDate: new Date("2026-04-09T12:00:00Z"), // clearly April 9 EDT
      arrivedAt: new Date("2026-04-09T14:00:00Z"),
      completedAt: null,
      customerName: "Stuck Customer",
    }];

    const db = makeSweepDb(jobs, [{ id: "tech-1", profile: techProfile }]);
    const result = await endOfDaySweepWorker(CONFIG, lateClock, db);

    expect(result.timezone).toBe(TIMEZONE);
    expect(result.stuckJobs).toHaveLength(1);
    expect(result.stuckJobs[0]!.jobId).toBe("job-stuck");
  });

  it("returns empty when no stuck jobs", async () => {
    // 18:00 UTC = 14:00 EDT, well before 17:00 end time
    const earlyNow = new Date("2026-04-09T18:00:00Z");
    const earlyClock: WorkerClockProvider = { now: () => earlyNow };

    const jobs: SchedulingJobRecord[] = [{
      id: "job-ok",
      businessId: BIZ_ID,
      technicianId: "tech-1",
      customerId: "cust-1",
      status: "IN_PROGRESS",
      scheduledDate: new Date("2026-04-09T12:00:00Z"),
      arrivedAt: new Date("2026-04-09T14:00:00Z"),
      completedAt: null,
    }];

    const db = makeSweepDb(jobs, [{ id: "tech-1", profile: techProfile }]);
    const result = await endOfDaySweepWorker(CONFIG, earlyClock, db);

    expect(result.stuckJobs).toHaveLength(0);
  });

  it("is idempotent (pure read, no mutations)", async () => {
    const lateNow = new Date("2026-04-09T23:30:00Z");
    const lateClock: WorkerClockProvider = { now: () => lateNow };

    const jobs: SchedulingJobRecord[] = [{
      id: "job-stuck",
      businessId: BIZ_ID,
      technicianId: "tech-1",
      customerId: "cust-1",
      status: "IN_PROGRESS",
      scheduledDate: new Date("2026-04-09T12:00:00Z"),
      arrivedAt: null,
      completedAt: null,
    }];

    const db = makeSweepDb(jobs, [{ id: "tech-1", profile: techProfile }]);

    // Run twice — same result both times
    const result1 = await endOfDaySweepWorker(CONFIG, lateClock, db);
    const result2 = await endOfDaySweepWorker(CONFIG, lateClock, db);

    expect(result1.stuckJobs).toEqual(result2.stuckJobs);
  });
});

// ── H8: Pause guard blocks workers ────────────────────────────────────────

describe("H8: pause guard on workers", () => {
  it("morningReminderWorker returns zeros when paused", async () => {
    const db: MorningReminderWorkerDb = {
      async listNotStartedJobsForDate() { return [{ jobId: "j1" }]; },
      async hasPendingMorningReminder() { return false; },
      pauseGuardDb: {
        async getSchedulingMode() { return { mode: "paused" as const }; },
      },
    };

    const result = await morningReminderWorker(
      CONFIG, clock, db,
      async () => { throw new Error("should not be called"); },
    );

    expect(result.jobsProcessed).toBe(0);
    expect(result.remindersQueued).toBe(0);
  });

  it("endOfDaySweepWorker returns empty stuckJobs when paused", async () => {
    const lateNow = new Date("2026-04-09T23:30:00Z");
    const lateClock: WorkerClockProvider = { now: () => lateNow };

    const jobs: SchedulingJobRecord[] = [{
      id: "job-stuck",
      businessId: BIZ_ID,
      technicianId: "tech-1",
      customerId: "cust-1",
      status: "IN_PROGRESS",
      scheduledDate: new Date("2026-04-09T12:00:00Z"),
      arrivedAt: new Date("2026-04-09T14:00:00Z"),
      completedAt: null,
    }];

    const baseDb = createInMemorySchedulingDb(jobs);
    const db: EndOfDaySweepWorkerDb = {
      ...baseDb,
      async getActiveTechProfiles() {
        return [{ id: "tech-1", profile: {
          id: "tech-1",
          businessId: BIZ_ID,
          workingHoursStart: "08:00",
          workingHoursEnd: "17:00",
          lunchStart: "12:00",
          lunchEnd: "13:00",
          overtimeCapMinutes: 0,
        } }];
      },
      pauseGuardDb: {
        async getSchedulingMode() { return { mode: "paused" as const }; },
      },
    };

    const result = await endOfDaySweepWorker(CONFIG, lateClock, db);

    expect(result.stuckJobs).toHaveLength(0);
  });
});

// ── Pull-forward expiry worker ──────────────────────────────────────────────

describe("pullForwardExpiryWorker", () => {
  it("returns expired count from db", async () => {
    const db: PullForwardExpiryWorkerDb = {
      async expireOffers() { return 3; },
    };
    const result = await pullForwardExpiryWorker(clock, db);
    expect(result.expiredCount).toBe(3);
  });

  it("returns 0 when no offers expired", async () => {
    const db: PullForwardExpiryWorkerDb = {
      async expireOffers() { return 0; },
    };
    const result = await pullForwardExpiryWorker(clock, db);
    expect(result.expiredCount).toBe(0);
  });

  it("passes current time to expireOffers", async () => {
    let receivedDate: Date | null = null;
    const db: PullForwardExpiryWorkerDb = {
      async expireOffers(now) { receivedDate = now; return 0; },
    };
    await pullForwardExpiryWorker(clock, db);
    expect(receivedDate).toEqual(NOW);
  });
});

// ── Skill tag validation worker ─────────────────────────────────────────────

describe("skillTagValidationWorker", () => {
  function makeSkillDb(
    mismatches: Array<{ jobId: string; technicianId: string; serviceTypeId: string }> = [],
    mode: "active" | "paused" = "active",
  ): SkillTagValidationWorkerDb {
    return {
      async findMismatchedJobs() { return mismatches; },
      pauseGuardDb: {
        async getSchedulingMode() { return { mode }; },
      },
    };
  }

  it("returns mismatched jobs", async () => {
    const mismatches = [
      { jobId: "j1", technicianId: "t1", serviceTypeId: "st1" },
      { jobId: "j2", technicianId: "t2", serviceTypeId: "st2" },
    ];
    const db = makeSkillDb(mismatches);
    const result = await skillTagValidationWorker(CONFIG, clock, db);
    expect(result.mismatches).toHaveLength(2);
    expect(result.businessId).toBe(BIZ_ID);
  });

  it("returns empty when no mismatches", async () => {
    const db = makeSkillDb([]);
    const result = await skillTagValidationWorker(CONFIG, clock, db);
    expect(result.mismatches).toHaveLength(0);
  });

  it("skips when paused", async () => {
    const db = makeSkillDb([{ jobId: "j1", technicianId: "t1", serviceTypeId: "st1" }], "paused");
    const result = await skillTagValidationWorker(CONFIG, clock, db);
    expect(result.mismatches).toHaveLength(0);
  });
});

// ── Manual position expiry worker ───────────────────────────────────────────

describe("manualPositionExpiryWorker", () => {
  function makeManualDb(
    expiredCount = 0,
    mode: "active" | "paused" = "active",
  ): ManualPositionExpiryWorkerDb {
    return {
      async clearExpiredManualPositions() { return expiredCount; },
      pauseGuardDb: {
        async getSchedulingMode() { return { mode }; },
      },
    };
  }

  it("clears expired manual positions", async () => {
    const db = makeManualDb(5);
    const result = await manualPositionExpiryWorker(CONFIG, clock, db);
    expect(result.expiredCount).toBe(5);
    expect(result.businessId).toBe(BIZ_ID);
  });

  it("returns 0 when none expired", async () => {
    const db = makeManualDb(0);
    const result = await manualPositionExpiryWorker(CONFIG, clock, db);
    expect(result.expiredCount).toBe(0);
  });

  it("skips when paused", async () => {
    const db = makeManualDb(10, "paused");
    const result = await manualPositionExpiryWorker(CONFIG, clock, db);
    expect(result.expiredCount).toBe(0);
  });

  it("passes cutoff date 24 hours in the past", async () => {
    let receivedCutoff: Date | null = null;
    const db: ManualPositionExpiryWorkerDb = {
      async clearExpiredManualPositions(cutoff) { receivedCutoff = cutoff; return 0; },
      pauseGuardDb: {
        async getSchedulingMode() { return { mode: "active" as const }; },
      },
    };
    await manualPositionExpiryWorker(CONFIG, clock, db);
    const expected = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
    expect(receivedCutoff).toEqual(expected);
  });
});

// ── Estimate timeout worker ───────────────────────────────────────────────

describe("estimateTimeoutWorker", () => {
  function makeEstimateDb(
    jobs: Array<{ jobId: string; technicianId: string; arrivedAt: Date }> = [],
    hasReminder: Set<string> = new Set(),
    mode: "active" | "paused" = "active",
  ): EstimateTimeoutWorkerDb {
    return {
      async findArrivedJobsWithoutEstimate() { return jobs; },
      async hasEstimateReminder(jobId) { return hasReminder.has(jobId); },
      pauseGuardDb: {
        async getSchedulingMode() { return { mode }; },
      },
    };
  }

  it("queues reminders for timed-out jobs without existing reminders", async () => {
    const queued: string[] = [];
    const jobs = [
      { jobId: "j1", technicianId: "t1", arrivedAt: new Date("2026-04-09T13:30:00Z") },
      { jobId: "j2", technicianId: "t2", arrivedAt: new Date("2026-04-09T13:35:00Z") },
    ];
    const db = makeEstimateDb(jobs);
    const result = await estimateTimeoutWorker(
      CONFIG, clock, db,
      async (jobId) => { queued.push(jobId); },
    );

    expect(result.timedOutJobs).toHaveLength(2);
    expect(result.remindersQueued).toBe(2);
    expect(queued).toEqual(["j1", "j2"]);
  });

  it("skips jobs that already have a reminder (idempotent)", async () => {
    const queued: string[] = [];
    const jobs = [
      { jobId: "j1", technicianId: "t1", arrivedAt: new Date("2026-04-09T13:30:00Z") },
      { jobId: "j2", technicianId: "t2", arrivedAt: new Date("2026-04-09T13:35:00Z") },
    ];
    const db = makeEstimateDb(jobs, new Set(["j1"]));
    const result = await estimateTimeoutWorker(
      CONFIG, clock, db,
      async (jobId) => { queued.push(jobId); },
    );

    expect(result.remindersQueued).toBe(1);
    expect(queued).toEqual(["j2"]);
  });

  it("returns empty when no timed-out jobs", async () => {
    const db = makeEstimateDb([]);
    const result = await estimateTimeoutWorker(
      CONFIG, clock, db,
      async () => { throw new Error("should not be called"); },
    );

    expect(result.timedOutJobs).toHaveLength(0);
    expect(result.remindersQueued).toBe(0);
  });

  it("skips when paused", async () => {
    const jobs = [
      { jobId: "j1", technicianId: "t1", arrivedAt: new Date("2026-04-09T13:30:00Z") },
    ];
    const db = makeEstimateDb(jobs, new Set(), "paused");
    const result = await estimateTimeoutWorker(
      CONFIG, clock, db,
      async () => { throw new Error("should not be called"); },
    );

    expect(result.timedOutJobs).toHaveLength(0);
    expect(result.remindersQueued).toBe(0);
  });

  it("passes cutoff 15 minutes in the past to db", async () => {
    let receivedCutoff: Date | null = null;
    const db: EstimateTimeoutWorkerDb = {
      async findArrivedJobsWithoutEstimate(_bizId, cutoff) { receivedCutoff = cutoff; return []; },
      async hasEstimateReminder() { return false; },
      pauseGuardDb: {
        async getSchedulingMode() { return { mode: "active" as const }; },
      },
    };
    await estimateTimeoutWorker(CONFIG, clock, db, async () => {});
    const expected = new Date(NOW.getTime() - 20 * 60 * 1000);
    expect(receivedCutoff).toEqual(expected);
  });
});

// ── Morning briefing worker ───────────────────────────────────────────────

describe("morningBriefingWorker", () => {
  function makeBriefingDb(
    techs: Array<{ technicianId: string; technicianName: string; jobCount: number; totalMinutes: number }> = [],
    alreadyQueued: Set<string> = new Set(),
    mode: "active" | "paused" = "active",
  ): MorningBriefingWorkerDb {
    return {
      async getActiveTechsWithJobs() { return techs; },
      async hasPendingMorningBriefing(techId) { return alreadyQueued.has(techId); },
      pauseGuardDb: { async getSchedulingMode() { return { mode }; } },
    };
  }

  it("queues briefings for techs with jobs", async () => {
    const queued: string[] = [];
    const techs = [
      { technicianId: "t1", technicianName: "Alice", jobCount: 3, totalMinutes: 180 },
      { technicianId: "t2", technicianName: "Bob", jobCount: 2, totalMinutes: 120 },
    ];
    const result = await morningBriefingWorker(CONFIG, clock, makeBriefingDb(techs), async (techId) => { queued.push(techId); });
    expect(result.briefingsQueued).toBe(2);
    expect(queued).toEqual(["t1", "t2"]);
  });

  it("skips techs with zero jobs", async () => {
    const queued: string[] = [];
    const techs = [
      { technicianId: "t1", technicianName: "Alice", jobCount: 0, totalMinutes: 0 },
      { technicianId: "t2", technicianName: "Bob", jobCount: 1, totalMinutes: 60 },
    ];
    const result = await morningBriefingWorker(CONFIG, clock, makeBriefingDb(techs), async (techId) => { queued.push(techId); });
    expect(result.briefingsQueued).toBe(1);
    expect(queued).toEqual(["t2"]);
  });

  it("is idempotent (skips already queued)", async () => {
    const techs = [{ technicianId: "t1", technicianName: "Alice", jobCount: 3, totalMinutes: 180 }];
    const result = await morningBriefingWorker(
      CONFIG, clock, makeBriefingDb(techs, new Set(["t1"])),
      async () => { throw new Error("should not be called"); },
    );
    expect(result.briefingsQueued).toBe(0);
    expect(result.alreadyQueued).toBe(1);
  });

  it("skips when paused", async () => {
    const techs = [{ technicianId: "t1", technicianName: "Alice", jobCount: 3, totalMinutes: 180 }];
    const result = await morningBriefingWorker(
      CONFIG, clock, makeBriefingDb(techs, new Set(), "paused"),
      async () => { throw new Error("should not be called"); },
    );
    expect(result.briefingsQueued).toBe(0);
  });
});

// ── Timer check-in worker ─────────────────────────────────────────────────

describe("timerCheckInWorker", () => {
  function makeCheckInDb(
    jobs: Array<{ jobId: string; technicianId: string; arrivedAt: Date; estimatedDurationMinutes: number }> = [],
    hasCheckIn: Set<string> = new Set(),
    mode: "active" | "paused" = "active",
  ): TimerCheckInWorkerDb {
    return {
      async findOverrunningJobs() { return jobs; },
      async hasTimerCheckIn(jobId) { return hasCheckIn.has(jobId); },
      pauseGuardDb: { async getSchedulingMode() { return { mode }; } },
    };
  }

  it("queues check-ins for overrunning jobs", async () => {
    const queued: string[] = [];
    const jobs = [
      { jobId: "j1", technicianId: "t1", arrivedAt: new Date("2026-04-09T12:00:00Z"), estimatedDurationMinutes: 60 },
    ];
    const result = await timerCheckInWorker(CONFIG, clock, makeCheckInDb(jobs), async (jobId) => { queued.push(jobId); });
    expect(result.checkInsQueued).toBe(1);
    expect(queued).toEqual(["j1"]);
  });

  it("is idempotent (skips already sent)", async () => {
    const jobs = [
      { jobId: "j1", technicianId: "t1", arrivedAt: new Date("2026-04-09T12:00:00Z"), estimatedDurationMinutes: 60 },
    ];
    const result = await timerCheckInWorker(CONFIG, clock, makeCheckInDb(jobs, new Set(["j1"])), async () => { throw new Error("should not be called"); });
    expect(result.checkInsQueued).toBe(0);
  });

  it("skips when paused", async () => {
    const jobs = [
      { jobId: "j1", technicianId: "t1", arrivedAt: new Date("2026-04-09T12:00:00Z"), estimatedDurationMinutes: 60 },
    ];
    const result = await timerCheckInWorker(CONFIG, clock, makeCheckInDb(jobs, new Set(), "paused"), async () => { throw new Error("should not be called"); });
    expect(result.checkInsQueued).toBe(0);
  });
});

// ── Project scope prompt worker ───────────────────────────────────────────

describe("projectScopePromptWorker", () => {
  function makeScopeDb(
    jobs: Array<{ jobId: string; technicianId: string; arrivedAt: Date }> = [],
    hasPrompt: Set<string> = new Set(),
    mode: "active" | "paused" = "active",
  ): ProjectScopePromptWorkerDb {
    return {
      async findLongRunningJobs() { return jobs; },
      async hasProjectScopePrompt(jobId) { return hasPrompt.has(jobId); },
      pauseGuardDb: { async getSchedulingMode() { return { mode }; } },
    };
  }

  it("queues scope prompts for long-running jobs", async () => {
    const queued: string[] = [];
    const jobs = [
      { jobId: "j1", technicianId: "t1", arrivedAt: new Date("2026-04-09T12:00:00Z") },
    ];
    const result = await projectScopePromptWorker(CONFIG, clock, makeScopeDb(jobs), async (jobId) => { queued.push(jobId); });
    expect(result.promptsQueued).toBe(1);
    expect(queued).toEqual(["j1"]);
  });

  it("is idempotent (skips already sent)", async () => {
    const jobs = [{ jobId: "j1", technicianId: "t1", arrivedAt: new Date("2026-04-09T12:00:00Z") }];
    const result = await projectScopePromptWorker(CONFIG, clock, makeScopeDb(jobs, new Set(["j1"])), async () => { throw new Error("should not be called"); });
    expect(result.promptsQueued).toBe(0);
  });

  it("passes 60-minute cutoff to db", async () => {
    let receivedCutoff: Date | null = null;
    const db: ProjectScopePromptWorkerDb = {
      async findLongRunningJobs(_bizId, cutoff) { receivedCutoff = cutoff; return []; },
      async hasProjectScopePrompt() { return false; },
      pauseGuardDb: { async getSchedulingMode() { return { mode: "active" as const }; } },
    };
    await projectScopePromptWorker(CONFIG, clock, db, async () => {});
    const expected = new Date(NOW.getTime() - 60 * 60 * 1000);
    expect(receivedCutoff).toEqual(expected);
  });

  it("skips when paused", async () => {
    const jobs = [{ jobId: "j1", technicianId: "t1", arrivedAt: new Date("2026-04-09T12:00:00Z") }];
    const result = await projectScopePromptWorker(CONFIG, clock, makeScopeDb(jobs, new Set(), "paused"), async () => { throw new Error("should not be called"); });
    expect(result.promptsQueued).toBe(0);
  });
});

// ── Worker heartbeat ──────────────────────────────────────────────────────

describe("workerHeartbeatWorker", () => {
  it("records heartbeat and returns non-stale on first run", async () => {
    const store = new Map<string, Date>();
    const db: HeartbeatDb = {
      async recordHeartbeat(name, ts) { store.set(name, ts); },
      async getLastHeartbeat(name) { return store.get(name) ?? null; },
    };
    const result = await workerHeartbeatWorker("test-worker", clock, db);
    expect(result.stale).toBe(false);
    expect(result.gapMs).toBeNull();
    expect(result.workerName).toBe("test-worker");
  });

  it("detects stale heartbeat (> 5 min gap)", async () => {
    const staleTime = new Date(NOW.getTime() - 6 * 60 * 1000); // 6 min ago
    const store = new Map<string, Date>([["test-worker", staleTime]]);
    const db: HeartbeatDb = {
      async recordHeartbeat(name, ts) { store.set(name, ts); },
      async getLastHeartbeat(name) { return store.get(name) ?? null; },
    };
    const result = await workerHeartbeatWorker("test-worker", clock, db);
    expect(result.stale).toBe(true);
    expect(result.gapMs).toBeGreaterThan(5 * 60 * 1000);
  });

  it("returns non-stale for recent heartbeat (< 5 min)", async () => {
    const recentTime = new Date(NOW.getTime() - 2 * 60 * 1000); // 2 min ago
    const store = new Map<string, Date>([["test-worker", recentTime]]);
    const db: HeartbeatDb = {
      async recordHeartbeat(name, ts) { store.set(name, ts); },
      async getLastHeartbeat(name) { return store.get(name) ?? null; },
    };
    const result = await workerHeartbeatWorker("test-worker", clock, db);
    expect(result.stale).toBe(false);
    expect(result.gapMs).toBeLessThanOrEqual(5 * 60 * 1000);
  });
});
