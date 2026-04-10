// ============================================================
// src/engine/scheduling/rebook-cascade.ts
//
// REBOOK CASCADE & SICK TECH REDISTRIBUTION
//
// Deterministic logic only. No AI. No notifications.
//
// Rules enforced:
//   - Locked jobs (per isLockedState()) are immovable
//   - 3-business-day lookahead, strict chronological order
//   - Earlier valid day always beats later valid day
//   - Same-day redistribution attempted before future-day rebook
//   - Capacity + queue insertion must BOTH pass for a valid slot
//   - All state changes are transactional
//
// Injectable: db, businessDayProvider, OSRM deps.
// ============================================================

import { isLockedState, type SchedulingJobStatus } from "./scheduling-state-machine";
import { checkCapacity, reserveCapacity, releaseCapacity, type CapacityDb, type TimePreference } from "./capacity-math";
import { findOptimalPosition, type QueuedJob, type NewJobInput } from "./queue-insertion";
import type { TechCandidate } from "./tech-assignment";
import type { Coordinates, OsrmServiceDeps } from "./osrm-service";
import { checkPauseGuard, type PauseGuardDb } from "./pause-guard";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RebookableJob {
  jobId: string;
  technicianId: string;
  businessId: string;
  serviceTypeId: string;
  scheduledDate: Date;
  timePreference: TimePreference;
  totalCostMinutes: number;
  addressLat: number;
  addressLng: number;
  status: SchedulingJobStatus;
  queuePosition: number;
  manualPosition: boolean;
  /** H5: Number of times this job has been rebooked. Circuit breaker at MAX_REBOOK_COUNT. */
  rebookCount?: number;
}

// ── H5: Rebook circuit breaker ──────────────────────────────────────────────
const MAX_REBOOK_COUNT = 3;

export interface RebookSlot {
  technicianId: string;
  date: Date;
  queuePosition: number;
}

export type RebookResult =
  | {
      outcome: "rebooked";
      jobId: string;
      technicianId: string;
      date: Date;
      queuePosition: number;
      reason: "capacity_found";
    }
  | {
      outcome: "needs_rebook";
      jobId: string;
      reason: "no_capacity_next_3_business_days";
    }
  | {
      outcome: "blocked_locked";
      jobId: string;
      reason: "job_locked";
    }
  | {
      outcome: "blocked_rebook_limit";
      jobId: string;
      reason: "max_rebook_count_reached";
      rebookCount: number;
    };

export interface RedistributionResult {
  redistributed: RebookResult[];
  blockedLockedJobs: string[];
  needsRebook: string[];
}

export interface BusinessDayProvider {
  getNextBusinessDays(startDate: Date, count: number): Date[];
}

export interface RebookCascadeDb {
  getJob(jobId: string): Promise<RebookableJob | null>;
  getQueueForTechDate(technicianId: string, date: Date): Promise<QueuedJob[]>;
  listJobsForTechDate(technicianId: string, date: Date): Promise<RebookableJob[]>;
  listOtherActiveTechs(businessId: string, excludeTechnicianId: string): Promise<TechCandidate[]>;

  updateJobSchedule(jobId: string, technicianId: string, date: Date, queuePosition: number): Promise<void>;
  /** H5: Increment the rebook_count on a job after a successful rebook. */
  incrementRebookCount(jobId: string): Promise<void>;
  markJobNeedsRebook(jobId: string): Promise<void>;
  createRebookQueueEntry(jobId: string, originalDate: Date, originalTechnicianId: string, reason: string): Promise<void>;

  // Capacity operations (delegated to CapacityDb interface)
  capacityDb: CapacityDb;

  /** Pause guard operations. */
  pauseGuardDb: PauseGuardDb;

  transaction<T>(fn: (tx: RebookCascadeDb) => Promise<T>): Promise<T>;
}

// ── 1. findRebookSlot ────────────────────────────────────────────────────────

export async function findRebookSlot(
  job: RebookableJob,
  candidateTechs: TechCandidate[],
  businessDayProvider: BusinessDayProvider,
  db: RebookCascadeDb,
  osrmDeps?: OsrmServiceDeps,
): Promise<RebookSlot | null> {
  const futureDays = businessDayProvider.getNextBusinessDays(job.scheduledDate, 3);

  for (const day of futureDays) {
    for (const tech of candidateTechs) {
      // Check capacity for this tech on this day
      const cap = await checkCapacity(
        tech.id,
        day,
        job.totalCostMinutes,
        job.timePreference,
        db.capacityDb,
      );
      if (!cap.fits) continue;

      // Load target queue and check insertion
      const queue = await db.getQueueForTechDate(tech.id, day);
      const techHomeBase: Coordinates = { lat: tech.homeBaseLat, lng: tech.homeBaseLng };

      const newJobInput: NewJobInput = {
        id: job.jobId,
        addressLat: job.addressLat,
        addressLng: job.addressLng,
        timePreference: job.timePreference,
        totalCostMinutes: job.totalCostMinutes,
      };

      const insertion = await findOptimalPosition(
        queue, newJobInput, techHomeBase, osrmDeps,
      );

      if (insertion.valid) {
        return {
          technicianId: tech.id,
          date: day,
          queuePosition: insertion.position,
        };
      }
    }
  }

  return null;
}

// ── 2. rebookSingleJob ───────────────────────────────────────────────────────

export async function rebookSingleJob(
  job: RebookableJob,
  candidateTechs: TechCandidate[],
  businessDayProvider: BusinessDayProvider,
  db: RebookCascadeDb,
  osrmDeps?: OsrmServiceDeps,
): Promise<RebookResult> {
  // Locked jobs are immovable
  if (isLockedState(job.status)) {
    return { outcome: "blocked_locked", jobId: job.jobId, reason: "job_locked" };
  }

  // H5: Circuit breaker — prevent infinite rebook loops
  const currentRebookCount = job.rebookCount ?? 0;
  if (currentRebookCount >= MAX_REBOOK_COUNT) {
    return {
      outcome: "blocked_rebook_limit",
      jobId: job.jobId,
      reason: "max_rebook_count_reached",
      rebookCount: currentRebookCount,
    };
  }

  const slot = await findRebookSlot(job, candidateTechs, businessDayProvider, db, osrmDeps);

  if (slot) {
    // Move semantics: reserve destination capacity, release source capacity.
    // Skip release when same tech + same date (no net change).
    const sameTechSameDate =
      slot.technicianId === job.technicianId &&
      slot.date.toISOString() === job.scheduledDate.toISOString();

    await db.transaction(async (tx) => {
      await reserveCapacity(
        slot.technicianId,
        slot.date,
        job.totalCostMinutes,
        job.timePreference,
        tx.capacityDb,
      );
      if (!sameTechSameDate) {
        await releaseCapacity(
          job.technicianId,
          job.scheduledDate,
          job.totalCostMinutes,
          job.timePreference,
          tx.capacityDb,
        );
      }
      await tx.updateJobSchedule(job.jobId, slot.technicianId, slot.date, slot.queuePosition);
      await tx.incrementRebookCount(job.jobId);
    });

    return {
      outcome: "rebooked",
      jobId: job.jobId,
      technicianId: slot.technicianId,
      date: slot.date,
      queuePosition: slot.queuePosition,
      reason: "capacity_found",
    };
  }

  // No slot found — mark NEEDS_REBOOK
  await markNeedsRebook(job, db);

  return {
    outcome: "needs_rebook",
    jobId: job.jobId,
    reason: "no_capacity_next_3_business_days",
  };
}

// ── 3. redistributeSickTechJobs ──────────────────────────────────────────────

export async function redistributeSickTechJobs(
  sickTechnicianId: string,
  date: Date,
  businessId: string,
  businessDayProvider: BusinessDayProvider,
  db: RebookCascadeDb,
  osrmDeps?: OsrmServiceDeps,
): Promise<RedistributionResult> {
  // H8: Pause guard — block automated redistribution when paused
  const pauseCheck = await checkPauseGuard(businessId, db.pauseGuardDb);
  if (!pauseCheck.allowed) {
    return { redistributed: [], blockedLockedJobs: [], needsRebook: [] };
  }

  const allJobs = await db.listJobsForTechDate(sickTechnicianId, date);

  const lockedJobs = allJobs.filter((j) => isLockedState(j.status));
  const unlockedJobs = allJobs.filter((j) => !isLockedState(j.status));

  const redistributed: RebookResult[] = [];
  const blockedLockedJobs: string[] = lockedJobs.map((j) => j.jobId);
  const needsRebook: string[] = [];

  // Add blocked_locked results for locked jobs
  for (const job of lockedJobs) {
    redistributed.push({
      outcome: "blocked_locked",
      jobId: job.jobId,
      reason: "job_locked",
    });
  }

  for (const job of unlockedJobs) {
    const otherTechs = await db.listOtherActiveTechs(job.businessId, sickTechnicianId);

    // Attempt same-day redistribution first via assignTech
    const sameDayResult = await attemptSameDayRedistribution(
      job, otherTechs, date, db, osrmDeps,
    );

    if (sameDayResult) {
      redistributed.push(sameDayResult);
      continue;
    }

    // Fall back to 3-day rebook cascade
    const rebookResult = await rebookSingleJob(
      job, otherTechs, businessDayProvider, db, osrmDeps,
    );

    redistributed.push(rebookResult);

    if (rebookResult.outcome === "needs_rebook") {
      needsRebook.push(job.jobId);
    }
  }

  return { redistributed, blockedLockedJobs, needsRebook };
}

// ── Same-day redistribution helper ───────────────────────────────────────────

async function attemptSameDayRedistribution(
  job: RebookableJob,
  candidateTechs: TechCandidate[],
  date: Date,
  db: RebookCascadeDb,
  osrmDeps?: OsrmServiceDeps,
): Promise<RebookResult | null> {
  if (candidateTechs.length === 0) return null;

  // Try each candidate in deterministic order until one passes
  // both capacity check AND queue insertion.
  const newJobInput: NewJobInput = {
    id: job.jobId,
    addressLat: job.addressLat,
    addressLng: job.addressLng,
    timePreference: job.timePreference,
    totalCostMinutes: job.totalCostMinutes,
  };

  // Try each candidate in order — capacity check + queue insertion
  for (const tech of candidateTechs) {
    const cap = await checkCapacity(
      tech.id, date, job.totalCostMinutes, job.timePreference, db.capacityDb,
    );
    if (!cap.fits) continue;

    const queue = await db.getQueueForTechDate(tech.id, date);
    const techHomeBase: Coordinates = { lat: tech.homeBaseLat, lng: tech.homeBaseLng };

    const insertion = await findOptimalPosition(
      queue, newJobInput, techHomeBase, osrmDeps,
    );
    if (!insertion.valid) continue;

    // Move semantics: reserve destination, release source (different tech on same day).
    const sameTech = tech.id === job.technicianId;
    await db.transaction(async (tx) => {
      await reserveCapacity(
        tech.id, date, job.totalCostMinutes, job.timePreference, tx.capacityDb,
      );
      if (!sameTech) {
        await releaseCapacity(
          job.technicianId, job.scheduledDate, job.totalCostMinutes, job.timePreference, tx.capacityDb,
        );
      }
      await tx.updateJobSchedule(job.jobId, tech.id, date, insertion.position);
    });

    return {
      outcome: "rebooked",
      jobId: job.jobId,
      technicianId: tech.id,
      date,
      queuePosition: insertion.position,
      reason: "capacity_found",
    };
  }

  return null;
}

// ── 4. markNeedsRebook ───────────────────────────────────────────────────────

export async function markNeedsRebook(
  job: RebookableJob,
  db: RebookCascadeDb,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.markJobNeedsRebook(job.jobId);
    await tx.createRebookQueueEntry(
      job.jobId,
      job.scheduledDate,
      job.technicianId,
      "no_capacity_next_3_business_days",
    );
  });
}
