// ============================================================
// src/engine/scheduling/inter-tech-transfer.ts
//
// INTER-TECH TRANSFER ENGINE — DETERMINISTIC OPTIMIZATION
//
// Evaluates whether unlocked jobs improve total drive time
// by moving to another tech. No AI. No notifications.
//
// Rules enforced:
//   - Only NOT_STARTED / NEEDS_REBOOK may transfer
//   - Manual-position jobs blocked
//   - 1 optimization transfer per job per day (emergency bypasses)
//   - Same-day = auto-approve, future-day = owner required
//   - Transfer must yield positive net drive time savings
//   - Best target: highest savings → fewer jobs → lower drive → input order
//   - Execution is fully transactional
//
// Injectable: db, clock, OSRM deps.
// ============================================================

import { isLockedState, type SchedulingJobStatus } from "./scheduling-state-machine";
import { checkCapacity, reserveCapacity, releaseCapacity, type CapacityDb, type TimePreference } from "./capacity-math";
import { findOptimalPosition, type QueuedJob, type NewJobInput } from "./queue-insertion";
import { getDriveTime, type Coordinates, type OsrmServiceDeps } from "./osrm-service";
import type { TechCandidate } from "./tech-assignment";
import { checkPauseGuard, type PauseGuardDb } from "./pause-guard";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TransferableJob {
  jobId: string;
  technicianId: string;
  businessId: string;
  serviceTypeId: string;
  scheduledDate: Date;
  scheduledStartMinute: number;
  totalCostMinutes: number;
  addressLat: number;
  addressLng: number;
  timePreference: TimePreference;
  status: SchedulingJobStatus;
  queuePosition: number;
  manualPosition: boolean;
  transferCount: number;
}

export interface TransferTarget {
  technicianId: string;
  date: Date;
  queuePosition: number;
  addedDriveTimeMinutes: number;
  netDriveTimeSavingMinutes: number;
  existingJobsToday: number;
  absoluteDriveTimeMinutes: number;
}

export type TransferEvaluation =
  | {
      outcome: "transfer_recommended";
      jobId: string;
      fromTechnicianId: string;
      toTechnicianId: string;
      fromDate: Date;
      toDate: Date;
      fromQueuePosition: number;
      newQueuePosition: number;
      totalCostMinutes: number;
      timePreference: TimePreference;
      netDriveTimeSavingMinutes: number;
      approvalRequired: boolean;
      reason: "drive_time_improvement";
    }
  | { outcome: "no_improvement"; jobId: string; reason: "no_better_target" }
  | { outcome: "blocked_locked"; jobId: string; reason: "job_locked" }
  | { outcome: "blocked_transfer_cap"; jobId: string; reason: "max_transfers_reached" }
  | { outcome: "blocked_manual"; jobId: string; reason: "manual_position_set" };

export type TransferApproval = "auto_same_day" | "owner_required" | "emergency_bypass";

export type TransferResult =
  | {
      outcome: "transferred";
      jobId: string;
      fromTechnicianId: string;
      toTechnicianId: string;
      date: Date;
      newQueuePosition: number;
      approvalType: TransferApproval;
    }
  | { outcome: "capacity_changed"; jobId: string; reason: "slot_no_longer_available" }
  | { outcome: "blocked"; jobId: string; reason: string };

export interface BatchTransferEvaluationResult {
  recommended: TransferEvaluation[];
  noImprovement: string[];
  blockedLocked: string[];
  blockedTransferCap: string[];
  blockedManual: string[];
}

export interface BatchTransferExecutionResult {
  transferred: TransferResult[];
  capacityChanged: string[];
  blocked: string[];
}

export interface ClockProvider {
  now(): Date;
  today(): Date;
}

export interface TransferDb {
  getJob(jobId: string): Promise<TransferableJob | null>;
  getTransferableJobsForTechDate(technicianId: string, date: Date): Promise<TransferableJob[]>;
  getQueueForTechDate(technicianId: string, date: Date): Promise<QueuedJob[]>;
  listOtherActiveTechs(businessId: string, excludeTechnicianId: string): Promise<TechCandidate[]>;
  /** Source of truth for per-day transfer cap. Used instead of job.transferCount. */
  getTransferCountToday(jobId: string, date: Date): Promise<number>;
  getTechHomeBase(technicianId: string): Promise<Coordinates>;

  updateJobSchedule(jobId: string, technicianId: string, date: Date, queuePosition: number): Promise<void>;
  incrementTransferCount(jobId: string): Promise<void>;
  createTransferEvent(event: {
    jobId: string;
    fromTechnicianId: string;
    toTechnicianId: string;
    fromDate: Date;
    toDate: Date;
    fromQueuePosition: number;
    toQueuePosition: number;
    approvalType: TransferApproval;
    netDriveTimeSavingMinutes: number;
  }): Promise<void>;

  capacityDb: CapacityDb;

  /** Pause guard operations. */
  pauseGuardDb: PauseGuardDb;

  transaction<T>(fn: (tx: TransferDb) => Promise<T>): Promise<T>;
}

// ── 1. calculateDriveTimeContribution ────────────────────────────────────────

export async function calculateDriveTimeContribution(
  jobIndex: number,
  queue: QueuedJob[],
  techHomeBase: Coordinates,
  osrmDeps?: OsrmServiceDeps,
): Promise<number> {
  if (queue.length === 0 || jobIndex < 0 || jobIndex >= queue.length) return 0;

  const job = queue[jobIndex]!;
  const jobCoords: Coordinates = { lat: job.addressLat, lng: job.addressLng };

  // Previous location
  const prevCoords: Coordinates = jobIndex === 0
    ? techHomeBase
    : { lat: queue[jobIndex - 1]!.addressLat, lng: queue[jobIndex - 1]!.addressLng };

  // Next location
  const hasNext = jobIndex < queue.length - 1;
  const nextCoords: Coordinates | null = hasNext
    ? { lat: queue[jobIndex + 1]!.addressLat, lng: queue[jobIndex + 1]!.addressLng }
    : null;

  // Legs with job present: prev->job + job->next
  const prevToJob = await getDriveTime(prevCoords, jobCoords, osrmDeps);
  let jobToNextMinutes = 0;
  if (nextCoords) {
    const jobToNext = await getDriveTime(jobCoords, nextCoords, osrmDeps);
    jobToNextMinutes = jobToNext.durationMinutes;
  }

  // Leg without job: prev->next (what would exist if job removed)
  let prevToNextMinutes = 0;
  if (nextCoords) {
    const prevToNext = await getDriveTime(prevCoords, nextCoords, osrmDeps);
    prevToNextMinutes = prevToNext.durationMinutes;
  }

  // Contribution = cost of having the job in the queue
  // = (prev->job + job->next) - (prev->next)
  return prevToJob.durationMinutes + jobToNextMinutes - prevToNextMinutes;
}

// ── 2. evaluateTransfer ──────────────────────────────────────────────────────

export async function evaluateTransfer(
  job: TransferableJob,
  candidateTechs: TechCandidate[],
  sourceQueue: QueuedJob[],
  techHomeBase: Coordinates,
  clock: ClockProvider,
  db: TransferDb,
  osrmDeps?: OsrmServiceDeps,
  isEmergency = false,
): Promise<TransferEvaluation> {
  // Gate 0: H8 pause guard
  const pauseCheck = await checkPauseGuard(job.businessId, db.pauseGuardDb);
  if (!pauseCheck.allowed) {
    return { outcome: "no_improvement", jobId: job.jobId, reason: "no_better_target" };
  }

  // Gate 1: locked
  if (isLockedState(job.status)) {
    return { outcome: "blocked_locked", jobId: job.jobId, reason: "job_locked" };
  }

  // Gate 2: manual position
  if (job.manualPosition) {
    return { outcome: "blocked_manual", jobId: job.jobId, reason: "manual_position_set" };
  }

  // Gate 3: transfer cap (1 per day unless emergency)
  // Use DB as source of truth, not potentially stale job.transferCount
  if (!isEmergency) {
    const dbTransferCount = await db.getTransferCountToday(job.jobId, job.scheduledDate);
    if (dbTransferCount >= 1) {
      return { outcome: "blocked_transfer_cap", jobId: job.jobId, reason: "max_transfers_reached" };
    }
  }

  // Find the actual array index of the job in sourceQueue by id,
  // since queuePosition may not equal the array index if order has drifted
  const sourceIndex = sourceQueue.findIndex((q) => q.id === job.jobId);
  if (sourceIndex === -1) {
    return { outcome: "no_improvement", jobId: job.jobId, reason: "no_better_target" };
  }

  // Calculate current contribution in source queue
  const currentContribution = await calculateDriveTimeContribution(
    sourceIndex, sourceQueue, techHomeBase, osrmDeps,
  );

  // Evaluate each candidate tech
  const targets: (TransferTarget & { _inputIndex: number })[] = [];

  for (let i = 0; i < candidateTechs.length; i++) {
    const tech = candidateTechs[i]!;

    // Must have the skill
    if (!tech.skillTags.includes(job.serviceTypeId)) continue;

    // Check capacity
    const cap = await checkCapacity(
      tech.id,
      job.scheduledDate,
      job.totalCostMinutes,
      job.timePreference,
      db.capacityDb,
    );
    if (!cap.fits) continue;

    // Load target queue
    const targetQueue = await db.getQueueForTechDate(tech.id, job.scheduledDate);
    const targetHomeBase: Coordinates = { lat: tech.homeBaseLat, lng: tech.homeBaseLng };

    const newJobInput: NewJobInput = {
      id: job.jobId,
      addressLat: job.addressLat,
      addressLng: job.addressLng,
      timePreference: job.timePreference,
      totalCostMinutes: job.totalCostMinutes,
    };

    const insertion = await findOptimalPosition(
      targetQueue, newJobInput, targetHomeBase, osrmDeps,
    );
    if (!insertion.valid) continue;

    // Compute absolute drive time to the job from target tech's home
    const jobCoords: Coordinates = { lat: job.addressLat, lng: job.addressLng };
    const absDrive = await getDriveTime(targetHomeBase, jobCoords, osrmDeps);

    const netSaving = currentContribution - insertion.addedDriveTimeMinutes;

    targets.push({
      technicianId: tech.id,
      date: job.scheduledDate,
      queuePosition: insertion.position,
      addedDriveTimeMinutes: insertion.addedDriveTimeMinutes,
      netDriveTimeSavingMinutes: netSaving,
      existingJobsToday: tech.existingJobsToday ?? 0,
      absoluteDriveTimeMinutes: absDrive.durationMinutes,
      _inputIndex: i,
    });
  }

  // Filter to positive improvements only
  const positiveTargets = targets.filter((t) => t.netDriveTimeSavingMinutes > 0);

  if (positiveTargets.length === 0) {
    return { outcome: "no_improvement", jobId: job.jobId, reason: "no_better_target" };
  }

  // Sort: highest net saving → fewer jobs → lower absolute drive → input order
  positiveTargets.sort((a, b) => {
    if (a.netDriveTimeSavingMinutes !== b.netDriveTimeSavingMinutes) {
      return b.netDriveTimeSavingMinutes - a.netDriveTimeSavingMinutes;
    }
    if (a.existingJobsToday !== b.existingJobsToday) {
      return a.existingJobsToday - b.existingJobsToday;
    }
    if (a.absoluteDriveTimeMinutes !== b.absoluteDriveTimeMinutes) {
      return a.absoluteDriveTimeMinutes - b.absoluteDriveTimeMinutes;
    }
    return a._inputIndex - b._inputIndex;
  });

  const best = positiveTargets[0]!;
  const today = clock.today();
  const isSameDay = dateKey(job.scheduledDate) === dateKey(today);

  return {
    outcome: "transfer_recommended",
    jobId: job.jobId,
    fromTechnicianId: job.technicianId,
    toTechnicianId: best.technicianId,
    fromDate: job.scheduledDate,
    toDate: best.date,
    fromQueuePosition: job.queuePosition,
    newQueuePosition: best.queuePosition,
    totalCostMinutes: job.totalCostMinutes,
    timePreference: job.timePreference,
    netDriveTimeSavingMinutes: best.netDriveTimeSavingMinutes,
    approvalRequired: !isSameDay,
    reason: "drive_time_improvement",
  };
}

// ── 3. executeTransfer ───────────────────────────────────────────────────────

export async function executeTransfer(
  evaluation: TransferEvaluation & { outcome: "transfer_recommended" },
  approvalType: TransferApproval,
  businessId: string,
  db: TransferDb,
  osrmDeps?: OsrmServiceDeps,
): Promise<TransferResult> {
  // H8: Pause guard — block automated execution when paused
  const pauseCheck = await checkPauseGuard(businessId, db.pauseGuardDb);
  if (pauseCheck.allowed === false) {
    return { outcome: "blocked" as const, jobId: evaluation.jobId, reason: pauseCheck.reason };
  }

  // Re-check capacity using the job's actual time preference
  const cap = await checkCapacity(
    evaluation.toTechnicianId,
    evaluation.toDate,
    evaluation.totalCostMinutes,
    evaluation.timePreference,
    db.capacityDb,
  );

  if (!cap.fits) {
    return {
      outcome: "capacity_changed",
      jobId: evaluation.jobId,
      reason: "slot_no_longer_available",
    };
  }

  // Re-check queue insertion validity: bounds + locked prefix
  const targetQueue = await db.getQueueForTechDate(evaluation.toTechnicianId, evaluation.toDate);
  if (evaluation.newQueuePosition > targetQueue.length) {
    return {
      outcome: "capacity_changed",
      jobId: evaluation.jobId,
      reason: "slot_no_longer_available",
    };
  }

  // Verify insertion position is not inside the locked prefix
  let lockedPrefixEnd = 0;
  while (lockedPrefixEnd < targetQueue.length && isLockedState(targetQueue[lockedPrefixEnd]!.status)) {
    lockedPrefixEnd++;
  }
  if (evaluation.newQueuePosition < lockedPrefixEnd) {
    return {
      outcome: "capacity_changed",
      jobId: evaluation.jobId,
      reason: "slot_no_longer_available",
    };
  }

  // Execute transactionally
  await db.transaction(async (tx) => {
    // Reserve capacity on target tech using actual time preference
    await reserveCapacity(
      evaluation.toTechnicianId,
      evaluation.toDate,
      evaluation.totalCostMinutes,
      evaluation.timePreference,
      tx.capacityDb,
    );

    // Release capacity from source tech using actual time preference
    await releaseCapacity(
      evaluation.fromTechnicianId,
      evaluation.fromDate,
      evaluation.totalCostMinutes,
      evaluation.timePreference,
      tx.capacityDb,
    );

    // Update job schedule
    await tx.updateJobSchedule(
      evaluation.jobId,
      evaluation.toTechnicianId,
      evaluation.toDate,
      evaluation.newQueuePosition,
    );

    // Increment transfer count
    await tx.incrementTransferCount(evaluation.jobId);

    // Create transfer event
    await tx.createTransferEvent({
      jobId: evaluation.jobId,
      fromTechnicianId: evaluation.fromTechnicianId,
      toTechnicianId: evaluation.toTechnicianId,
      fromDate: evaluation.fromDate,
      toDate: evaluation.toDate,
      fromQueuePosition: evaluation.fromQueuePosition,
      toQueuePosition: evaluation.newQueuePosition,
      approvalType,
      netDriveTimeSavingMinutes: evaluation.netDriveTimeSavingMinutes,
    });
  });

  return {
    outcome: "transferred",
    jobId: evaluation.jobId,
    fromTechnicianId: evaluation.fromTechnicianId,
    toTechnicianId: evaluation.toTechnicianId,
    date: evaluation.toDate,
    newQueuePosition: evaluation.newQueuePosition,
    approvalType,
  };
}

// ── 4. evaluateBatchTransfers ────────────────────────────────────────────────

export async function evaluateBatchTransfers(
  technicianId: string,
  date: Date,
  clock: ClockProvider,
  db: TransferDb,
  osrmDeps?: OsrmServiceDeps,
  isEmergency = false,
): Promise<BatchTransferEvaluationResult> {
  const jobs = await db.getTransferableJobsForTechDate(technicianId, date);
  const sourceQueue = await db.getQueueForTechDate(technicianId, date);

  // Get candidate techs once for the business
  // (We need a businessId — use first job's, or return empty if no jobs)
  if (jobs.length === 0) {
    return { recommended: [], noImprovement: [], blockedLocked: [], blockedTransferCap: [], blockedManual: [] };
  }

  const businessId = jobs[0]!.businessId;
  const candidateTechs = await db.listOtherActiveTechs(businessId, technicianId);
  const techHomeBase = await db.getTechHomeBase(technicianId);

  const result: BatchTransferEvaluationResult = {
    recommended: [],
    noImprovement: [],
    blockedLocked: [],
    blockedTransferCap: [],
    blockedManual: [],
  };

  for (const job of jobs) {
    const evaluation = await evaluateTransfer(
      job, candidateTechs, sourceQueue, techHomeBase, clock, db, osrmDeps, isEmergency,
    );

    switch (evaluation.outcome) {
      case "transfer_recommended":
        result.recommended.push(evaluation);
        break;
      case "no_improvement":
        result.noImprovement.push(job.jobId);
        break;
      case "blocked_locked":
        result.blockedLocked.push(job.jobId);
        break;
      case "blocked_transfer_cap":
        result.blockedTransferCap.push(job.jobId);
        break;
      case "blocked_manual":
        result.blockedManual.push(job.jobId);
        break;
    }
  }

  return result;
}

// ── 5. executeBatchSameDayTransfers ──────────────────────────────────────────

export async function executeBatchSameDayTransfers(
  evaluations: TransferEvaluation[],
  businessId: string,
  db: TransferDb,
  osrmDeps?: OsrmServiceDeps,
): Promise<BatchTransferExecutionResult> {
  const result: BatchTransferExecutionResult = {
    transferred: [],
    capacityChanged: [],
    blocked: [],
  };

  // Only execute transfer_recommended with approvalRequired = false
  const autoApproved = evaluations.filter(
    (e): e is TransferEvaluation & { outcome: "transfer_recommended" } =>
      e.outcome === "transfer_recommended" && !e.approvalRequired,
  );

  for (const evaluation of autoApproved) {
    try {
      const transferResult = await executeTransfer(
        evaluation, "auto_same_day", businessId, db, osrmDeps,
      );

      result.transferred.push(transferResult);

      if (transferResult.outcome === "capacity_changed") {
        result.capacityChanged.push(evaluation.jobId);
      }
    } catch {
      result.blocked.push(evaluation.jobId);
    }
  }

  return result;
}

// ── Helper ───────────────────────────────────────────────────────────────────

function dateKey(d: Date): string {
  return d.toISOString().split("T")[0]!;
}
