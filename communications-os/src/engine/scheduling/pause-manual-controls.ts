// ============================================================
// src/engine/scheduling/pause-manual-controls.ts
//
// PAUSE/RESYNC + MANUAL CONTROLS + STARTING MY DAY
//
// Deterministic logic only. No AI. No notifications.
//
// Rules enforced:
//   - Capacity is still enforced while paused
//   - Resync audit is read-only
//   - Locked jobs form an immovable prefix
//   - Manual arrangement sets manualPosition = true
//   - Owner manual arrangement is the override path;
//     existing manual flags do not block direct owner reordering
//   - Reset to AI clears manual flags and rebuilds unlocked queue
//   - Starting My Day: one use per tech/date, GPS-based drive
//     time recalculation with capacity delta enforcement
//
// Injectable: db, clock, OSRM deps.
// ============================================================

import { isLockedState, type SchedulingJobStatus } from "./scheduling-state-machine";
import {
  checkCapacityFromQueue,
  calculateAvailableMinutes,
  type TechProfile,
  type CapacityViolation,
} from "./capacity-math";
import { findOptimalPosition, type QueuedJob, type NewJobInput } from "./queue-insertion";
import { getStartingMyDayDriveTime, type Coordinates, type OsrmServiceDeps } from "./osrm-service";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SchedulingMode = "active" | "paused" | "resync_pending";

export interface SchedulingModeState {
  businessId: string;
  mode: SchedulingMode;
  pausedAt?: Date;
  pausedBy?: string;
}

export interface SchedulingModeEvent {
  businessId: string;
  fromMode: SchedulingMode;
  toMode: SchedulingMode;
  userId: string;
  timestamp: Date;
}

export interface TechQueueSummary {
  technicianId: string;
  techName: string;
  totalJobs: number;
  lockedJobs: number;
  unlockedJobs: number;
  manualJobs: number;
  usedMinutes: number;
  availableMinutes: number;
  utilizationPercent: number;
}

export interface ResyncAudit {
  businessId: string;
  date: Date;
  techSummaries: TechQueueSummary[];
  violations: CapacityViolation[];
  orphanedJobIds: string[];
  recommendedActions: string[];
}

export type PauseResult =
  | { outcome: "paused"; businessId: string }
  | { outcome: "already_paused"; businessId: string }
  | { outcome: "invalid_state"; currentMode: SchedulingMode };

export type ResyncResult =
  | { outcome: "resync_started"; audit: ResyncAudit }
  | { outcome: "invalid_state"; currentMode: SchedulingMode };

export type ResumeResult =
  | { outcome: "resumed"; businessId: string }
  | { outcome: "blocked_violations"; violations: CapacityViolation[] }
  | { outcome: "invalid_state"; currentMode: SchedulingMode };

export type ArrangeResult =
  | { outcome: "arranged"; jobId: string; newPosition: number; queue: QueuedJob[] }
  | { outcome: "blocked_locked"; jobId: string; reason: string }
  | { outcome: "blocked_target_locked"; jobId: string; reason: string }
  | { outcome: "job_not_found"; jobId: string };

export type ResetToAIResult = {
  outcome: "reset";
  technicianId: string;
  date: Date;
  queue: QueuedJob[];
  manualFlagsCleared: number;
};

export interface StartMyDayInput {
  technicianId: string;
  date: Date;
  gpsLat: number;
  gpsLng: number;
}

export type StartMyDayResult =
  | {
      outcome: "updated";
      technicianId: string;
      previousDriveTimeMinutes: number;
      newDriveTimeMinutes: number;
      deltaMinutes: number;
    }
  | { outcome: "already_used"; technicianId: string }
  | { outcome: "no_jobs"; technicianId: string }
  | { outcome: "capacity_exceeded"; technicianId: string; deltaMinutes: number };

export interface ClockProvider {
  now(): Date;
  today(): Date;
}

export interface TechInfo {
  id: string;
  name: string;
  businessId: string;
  isActive: boolean;
  profile: TechProfile;
}

export interface PauseManualDb {
  getSchedulingMode(businessId: string): Promise<SchedulingModeState>;
  setSchedulingMode(businessId: string, mode: SchedulingMode, userId: string, timestamp: Date): Promise<void>;
  createModeEvent(event: SchedulingModeEvent): Promise<void>;

  getActiveTechsForBusiness(businessId: string): Promise<TechInfo[]>;
  getQueueForTechDate(technicianId: string, date: Date): Promise<QueuedJob[]>;
  getOrphanedJobs(businessId: string, date: Date): Promise<string[]>;

  updateQueueOrder(technicianId: string, date: Date, queue: QueuedJob[]): Promise<void>;
  setManualPosition(jobId: string, manual: boolean): Promise<void>;
  clearAllManualFlags(technicianId: string, date: Date): Promise<number>;

  getTechHomeBase(technicianId: string): Promise<Coordinates>;

  isStartingMyDayUsed(technicianId: string, date: Date): Promise<boolean>;
  markStartingMyDayUsed(technicianId: string, date: Date): Promise<void>;
  updateFirstJobDriveTime(technicianId: string, date: Date, driveTimeMinutes: number): Promise<void>;
  getTechProfile(technicianId: string): Promise<TechProfile | null>;

  transaction<T>(fn: (tx: PauseManualDb) => Promise<T>): Promise<T>;
}

// ── 1. pauseScheduling ───────────────────────────────────────────────────────

export async function pauseScheduling(
  businessId: string,
  userId: string,
  clock: ClockProvider,
  db: PauseManualDb,
): Promise<PauseResult> {
  const current = await db.getSchedulingMode(businessId);

  if (current.mode === "paused") {
    return { outcome: "already_paused", businessId };
  }
  if (current.mode !== "active") {
    return { outcome: "invalid_state", currentMode: current.mode };
  }

  const now = clock.now();
  await db.setSchedulingMode(businessId, "paused", userId, now);
  await db.createModeEvent({
    businessId,
    fromMode: "active",
    toMode: "paused",
    userId,
    timestamp: now,
  });

  return { outcome: "paused", businessId };
}

// ── 2. buildResyncAudit ──────────────────────────────────────────────────────

export async function buildResyncAudit(
  businessId: string,
  date: Date,
  db: PauseManualDb,
): Promise<ResyncAudit> {
  const techs = await db.getActiveTechsForBusiness(businessId);
  const techSummaries: TechQueueSummary[] = [];
  const allViolations: CapacityViolation[] = [];

  for (const tech of techs) {
    const queue = await db.getQueueForTechDate(tech.id, date);

    const lockedJobs = queue.filter((j) => isLockedState(j.status)).length;
    const unlockedJobs = queue.length - lockedJobs;
    const manualJobs = queue.filter((j) => j.manualPosition).length;
    const usedMinutes = queue.reduce(
      (sum, j) => sum + j.estimatedDurationMinutes + j.driveTimeMinutes, 0,
    );

    // Revalidate capacity from queue (ground truth)
    const avail = calculateAvailableMinutes(tech.profile);
    const queueCap = checkCapacityFromQueue(queue, tech.profile, 0, "NO_PREFERENCE");
    const violations: CapacityViolation[] = [];
    if (queueCap.remainingTotal < 0) {
      violations.push({ technicianId: tech.id, date, violation: "total_overcapacity", reserved: avail.totalMinutes - queueCap.remainingTotal, available: avail.totalMinutes });
    }
    if (queueCap.remainingMorning < 0) {
      violations.push({ technicianId: tech.id, date, violation: "morning_overcapacity", reserved: avail.morningMinutes - queueCap.remainingMorning, available: avail.morningMinutes });
    }
    if (queueCap.remainingAfternoon < 0) {
      violations.push({ technicianId: tech.id, date, violation: "afternoon_overcapacity", reserved: avail.afternoonMinutes - queueCap.remainingAfternoon, available: avail.afternoonMinutes });
    }
    allViolations.push(...violations);

    techSummaries.push({
      technicianId: tech.id,
      techName: tech.name,
      totalJobs: queue.length,
      lockedJobs,
      unlockedJobs,
      manualJobs,
      usedMinutes,
      availableMinutes: avail.totalMinutes,
      utilizationPercent: avail.totalMinutes > 0
        ? Math.round((usedMinutes / avail.totalMinutes) * 100)
        : 0,
    });
  }

  const orphanedJobIds = await db.getOrphanedJobs(businessId, date);

  // Build recommended actions
  const recommendedActions: string[] = [];
  if (allViolations.length > 0) {
    recommendedActions.push(`Resolve ${allViolations.length} capacity violation(s) before resuming`);
  }
  if (orphanedJobIds.length > 0) {
    recommendedActions.push(`Reassign ${orphanedJobIds.length} orphaned job(s)`);
  }
  const overUtilized = techSummaries.filter((t) => t.utilizationPercent > 100);
  if (overUtilized.length > 0) {
    recommendedActions.push(`${overUtilized.length} tech(s) over 100% utilization`);
  }

  return {
    businessId,
    date,
    techSummaries,
    violations: allViolations,
    orphanedJobIds,
    recommendedActions,
  };
}

// ── 3. requestResync ─────────────────────────────────────────────────────────

export async function requestResync(
  businessId: string,
  userId: string,
  clock: ClockProvider,
  db: PauseManualDb,
): Promise<ResyncResult> {
  const current = await db.getSchedulingMode(businessId);

  if (current.mode !== "paused") {
    return { outcome: "invalid_state", currentMode: current.mode };
  }

  const now = clock.now();
  const today = clock.today();

  await db.setSchedulingMode(businessId, "resync_pending", userId, now);
  await db.createModeEvent({
    businessId,
    fromMode: "paused",
    toMode: "resync_pending",
    userId,
    timestamp: now,
  });

  const audit = await buildResyncAudit(businessId, today, db);

  return { outcome: "resync_started", audit };
}

// ── 4. resumeScheduling ──────────────────────────────────────────────────────

export async function resumeScheduling(
  businessId: string,
  userId: string,
  clock: ClockProvider,
  db: PauseManualDb,
): Promise<ResumeResult> {
  const current = await db.getSchedulingMode(businessId);

  if (current.mode !== "resync_pending") {
    return { outcome: "invalid_state", currentMode: current.mode };
  }

  // Re-run violation check — only capacity violations block resume.
  // Orphaned jobs (surfaced by buildResyncAudit) are advisory in V1;
  // they do not block resume. The spec requires owner to approve resync
  // after reviewing the audit, but the blocking gate is capacity only.
  const techs = await db.getActiveTechsForBusiness(businessId);
  const today = clock.today();
  const violations: CapacityViolation[] = [];

  for (const tech of techs) {
    const queue = await db.getQueueForTechDate(tech.id, today);
    const queueCap = checkCapacityFromQueue(queue, tech.profile, 0, "NO_PREFERENCE");
    if (queueCap.remainingTotal < 0) {
      violations.push({ technicianId: tech.id, date: today, violation: "total_overcapacity", reserved: -queueCap.remainingTotal, available: calculateAvailableMinutes(tech.profile).totalMinutes });
    }
  }

  if (violations.length > 0) {
    return { outcome: "blocked_violations", violations };
  }

  const now = clock.now();
  await db.setSchedulingMode(businessId, "active", userId, now);
  await db.createModeEvent({
    businessId,
    fromMode: "resync_pending",
    toMode: "active",
    userId,
    timestamp: now,
  });

  return { outcome: "resumed", businessId };
}

// ── 5. arrangeJobManually ────────────────────────────────────────────────────

export async function arrangeJobManually(
  jobId: string,
  newPosition: number,
  technicianId: string,
  date: Date,
  db: PauseManualDb,
): Promise<ArrangeResult> {
  const queue = await db.getQueueForTechDate(technicianId, date);

  // Find the job
  const jobIndex = queue.findIndex((j) => j.id === jobId);
  if (jobIndex === -1) {
    return { outcome: "job_not_found", jobId };
  }

  const job = queue[jobIndex]!;

  // Cannot move locked jobs
  if (isLockedState(job.status)) {
    return { outcome: "blocked_locked", jobId, reason: "cannot_move_locked_job" };
  }

  // Find locked prefix boundary
  let lockedPrefixEnd = 0;
  while (lockedPrefixEnd < queue.length && isLockedState(queue[lockedPrefixEnd]!.status)) {
    lockedPrefixEnd++;
  }

  // Target position must not be in locked prefix
  if (newPosition < lockedPrefixEnd) {
    return {
      outcome: "blocked_target_locked",
      jobId,
      reason: "cannot_place_in_locked_prefix",
    };
  }

  // Clamp target position
  const clampedPosition = Math.min(newPosition, queue.length - 1);

  // Build new queue: remove job from current position, insert at new position
  const working = queue.map((j) => ({ ...j }));
  const [removed] = working.splice(jobIndex, 1);
  removed!.manualPosition = true;
  removed!.manualPositionSetDate = new Date(); // H3: track when manual position was set
  working.splice(clampedPosition, 0, removed!);

  // Recompute sequential positions
  for (let i = 0; i < working.length; i++) {
    working[i]!.queuePosition = i;
  }

  // Persist
  await db.transaction(async (tx) => {
    await tx.updateQueueOrder(technicianId, date, working);
    await tx.setManualPosition(jobId, true);
  });

  return {
    outcome: "arranged",
    jobId,
    newPosition: clampedPosition,
    queue: working,
  };
}

// ── 6. resetToAI ─────────────────────────────────────────────────────────────
//
// "Reset to AI Optimization" per spec: clears all manual flags for this
// tech/date, then rebuilds the unlocked portion of the queue using the
// same greedy drive-time optimizer as new-job insertion.
//
// Locked prefix: jobs whose status is a locked state (EN_ROUTE, IN_PROGRESS,
// etc.) form an immovable prefix at the front of the queue. They are
// detected by scanning from position 0 until the first non-locked job.
//
// Rebuild strategy: process unlocked jobs in their current queue order.
// For each job, use findOptimalPosition to find the drive-time-optimal
// slot in the rebuilt queue (after the locked prefix). On ties,
// findOptimalPosition picks the earliest position, which combined with
// processing in current order means ties preserve relative input order.
//
// Tech home base: needed by findOptimalPosition for drive-time scoring
// of the first queue slot. Retrieved via db.getTechHomeBase().

export async function resetToAI(
  technicianId: string,
  date: Date,
  db: PauseManualDb,
  osrmDeps?: OsrmServiceDeps,
): Promise<ResetToAIResult> {
  const queue = await db.getQueueForTechDate(technicianId, date);

  // Clear all manual flags
  const manualFlagsCleared = await db.clearAllManualFlags(technicianId, date);

  // Partition: locked prefix stays, unlocked gets rebuilt
  const locked: QueuedJob[] = [];
  const unlocked: QueuedJob[] = [];

  for (const job of queue) {
    if (isLockedState(job.status)) {
      locked.push({ ...job, manualPosition: false });
    } else {
      unlocked.push({ ...job, manualPosition: false });
    }
  }

  // Start with locked prefix intact
  const rebuilt: QueuedJob[] = [...locked];

  if (unlocked.length > 0) {
    const techHomeBase = await db.getTechHomeBase(technicianId);

    // Greedily insert each unlocked job at its optimal position.
    // Process in current queue order so ties preserve relative ordering.
    for (const job of unlocked) {
      const newJobInput: NewJobInput = {
        id: job.id,
        addressLat: job.addressLat,
        addressLng: job.addressLng,
        timePreference: job.timePreference,
        totalCostMinutes: job.estimatedDurationMinutes + job.driveTimeMinutes,
      };

      const result = await findOptimalPosition(
        rebuilt,
        newJobInput,
        techHomeBase,
        osrmDeps,
        locked.length, // insertion must be at or after locked prefix
      );

      // Insert at optimal position, or append if no valid position found
      const insertAt = result.valid ? result.position : rebuilt.length;
      const insertedJob: QueuedJob = { ...job, manualPosition: false };
      rebuilt.splice(insertAt, 0, insertedJob);
    }
  }

  // Recompute sequential positions
  for (let i = 0; i < rebuilt.length; i++) {
    rebuilt[i]!.queuePosition = i;
  }

  // Persist
  await db.updateQueueOrder(technicianId, date, rebuilt);

  return {
    outcome: "reset",
    technicianId,
    date,
    queue: rebuilt,
    manualFlagsCleared,
  };
}

// ── 7. startMyDay ────────────────────────────────────────────────────────────

export async function startMyDay(
  input: StartMyDayInput,
  db: PauseManualDb,
  clock: ClockProvider,
  osrmDeps?: OsrmServiceDeps,
): Promise<StartMyDayResult> {
  const { technicianId, date, gpsLat, gpsLng } = input;

  // Check already used
  const used = await db.isStartingMyDayUsed(technicianId, date);
  if (used) {
    return { outcome: "already_used", technicianId };
  }

  // Load queue
  const queue = await db.getQueueForTechDate(technicianId, date);
  if (queue.length === 0) {
    return { outcome: "no_jobs", technicianId };
  }

  // First job
  const firstJob = queue[0]!;
  const previousDriveTime = firstJob.driveTimeMinutes;

  // Compute new drive time from GPS to first job
  const gpsCoords: Coordinates = { lat: gpsLat, lng: gpsLng };
  const jobCoords: Coordinates = { lat: firstJob.addressLat, lng: firstJob.addressLng };
  const driveResult = await getStartingMyDayDriveTime(gpsCoords, jobCoords, osrmDeps);
  const newDriveTime = driveResult.durationMinutes;

  const delta = newDriveTime - previousDriveTime;

  // If delta > 0, verify capacity can absorb
  if (delta > 0) {
    const techProfile = await db.getTechProfile(technicianId);
    if (techProfile) {
      const cap = checkCapacityFromQueue(queue, techProfile, delta, "NO_PREFERENCE");
      if (!cap.fits) {
        return { outcome: "capacity_exceeded", technicianId, deltaMinutes: delta };
      }
    }
  }

  // Transactionally update drive time — no separate capacity counter to adjust.
  await db.transaction(async (tx) => {
    await tx.updateFirstJobDriveTime(technicianId, date, newDriveTime);
    await tx.markStartingMyDayUsed(technicianId, date);
  });

  return {
    outcome: "updated",
    technicianId,
    previousDriveTimeMinutes: previousDriveTime,
    newDriveTimeMinutes: newDriveTime,
    deltaMinutes: delta,
  };
}
