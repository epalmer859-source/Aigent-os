// ============================================================
// src/engine/scheduling/booking-orchestrator.ts
//
// BOOKING ORCHESTRATOR — ATOMIC JOB CREATION
//
// Single entry point for creating a new scheduling job.
// Checks capacity from the actual queue (ground truth), then
// creates the job + audit event in one atomic transaction.
//
// Rules enforced:
//   - Capacity computed from actual queue, not a counter table
//   - All steps in a single transaction (C1 fix)
//   - Queue position + job + event created atomically
//   - Scheduling event created atomically with the job (C5 fix)
//   - Communication firing happens AFTER commit, not inside txn
//
// Injectable: db, clock.
// ============================================================

import { checkCapacityFromQueue, type TimePreference, type TechProfile } from "./capacity-math";
import { findOptimalPosition, insertAtPosition, type QueuedJob, type NewJobInput } from "./queue-insertion";
import type { Coordinates, OsrmServiceDeps } from "./osrm-service";
import type { SchedulingJobStatus, SchedulingTriggeredBy } from "./scheduling-state-machine";
import { checkPauseGuard, type PauseGuardDb } from "./pause-guard";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BookingRequest {
  jobId: string;
  businessId: string;
  technicianId: string;
  customerId: string;
  customerName: string;
  scheduledDate: Date;
  timePreference: TimePreference;
  totalCostMinutes: number;
  driveTimeMinutes: number;
  addressLat: number;
  addressLng: number;
  addressText: string;
  serviceType: string;
  jobNotes?: string | null;
  windowStart?: Date | null;
  windowEnd?: Date | null;
}

export type BookingOutcome =
  | { success: true; jobId: string; queuePosition: number }
  | { success: false; reason: "no_capacity" | "no_morning_capacity" | "no_afternoon_capacity" | "invalid_queue_position" | "scheduling_paused" | "resync_pending" };

export interface BookingOrchestratorDb {
  /** Get the current queue for a tech on a date (for insertion calculation). */
  getQueueForTechDate(technicianId: string, date: Date): Promise<QueuedJob[]>;

  /** Get the tech's profile for capacity calculation. */
  getTechProfile(technicianId: string): Promise<TechProfile | null>;

  /** Create the scheduling_job row. */
  createSchedulingJob(job: {
    id: string;
    businessId: string;
    technicianId: string;
    customerId: string;
    customerName: string;
    status: SchedulingJobStatus;
    scheduledDate: Date;
    queuePosition: number;
    timePreference: TimePreference;
    totalCostMinutes: number;
    driveTimeMinutes: number;
    addressLat: number;
    addressLng: number;
    addressText: string;
    serviceType: string;
    jobNotes?: string | null;
    windowStart?: Date | null;
    windowEnd?: Date | null;
  }): Promise<void>;

  /** Create a scheduling_events audit row. */
  createSchedulingEvent(event: {
    schedulingJobId: string;
    eventType: string;
    oldValue: string | null;
    newValue: string;
    triggeredBy: SchedulingTriggeredBy;
    timestamp: Date;
  }): Promise<void>;

  /** Pause guard operations. */
  pauseGuardDb: PauseGuardDb;

  /** Transaction wrapper — all operations inside run atomically. */
  transaction<T>(fn: (tx: BookingOrchestratorDb) => Promise<T>): Promise<T>;
}

export interface ClockProvider {
  now(): Date;
}

// ── bookJob ─────────────────────────────────────────────────────────────────

/**
 * Atomic job booking: check capacity from queue, create job, set queue
 * position, and create audit event — all inside a single transaction.
 *
 * Returns a BookingOutcome. On success, the caller is responsible for
 * firing communication events (confirmation message, etc.) AFTER this
 * function returns — never inside the transaction.
 */
export async function bookJob(
  request: BookingRequest,
  techHomeBase: Coordinates,
  db: BookingOrchestratorDb,
  clock: ClockProvider,
  osrmDeps?: OsrmServiceDeps,
): Promise<BookingOutcome> {
  // 0. Pause guard — block automated booking when business is paused
  const pauseCheck = await checkPauseGuard(request.businessId, db.pauseGuardDb);
  if (pauseCheck.allowed === false) {
    return { success: false as const, reason: pauseCheck.reason };
  }

  return db.transaction(async (tx) => {
    // 1. Get queue + tech profile, compute capacity from actual jobs
    const queue = await tx.getQueueForTechDate(request.technicianId, request.scheduledDate);
    const tech = await tx.getTechProfile(request.technicianId);
    if (!tech) {
      return { success: false as const, reason: "no_capacity" as const };
    }

    const cap = checkCapacityFromQueue(
      queue,
      tech,
      request.totalCostMinutes,
      request.timePreference,
    );

    if (!cap.fits) {
      const reason = request.timePreference === "MORNING" && cap.remainingMorning < request.totalCostMinutes
        ? "no_morning_capacity" as const
        : request.timePreference === "AFTERNOON" && cap.remainingAfternoon < request.totalCostMinutes
          ? "no_afternoon_capacity" as const
          : "no_capacity" as const;
      return { success: false as const, reason };
    }

    // 2. Compute optimal queue position
    const newJobInput: NewJobInput = {
      id: request.jobId,
      addressLat: request.addressLat,
      addressLng: request.addressLng,
      timePreference: request.timePreference,
      totalCostMinutes: request.totalCostMinutes,
    };

    const insertion = await findOptimalPosition(queue, newJobInput, techHomeBase, osrmDeps);

    if (!insertion.valid) {
      return { success: false as const, reason: "invalid_queue_position" as const };
    }

    // 3. Create the scheduling_job row
    await tx.createSchedulingJob({
      id: request.jobId,
      businessId: request.businessId,
      technicianId: request.technicianId,
      customerId: request.customerId,
      customerName: request.customerName,
      status: "NOT_STARTED",
      scheduledDate: request.scheduledDate,
      queuePosition: insertion.position,
      timePreference: request.timePreference,
      totalCostMinutes: request.totalCostMinutes,
      driveTimeMinutes: request.driveTimeMinutes,
      addressLat: request.addressLat,
      addressLng: request.addressLng,
      addressText: request.addressText,
      serviceType: request.serviceType,
      jobNotes: request.jobNotes ?? null,
      windowStart: request.windowStart ?? null,
      windowEnd: request.windowEnd ?? null,
    });

    // 4. Create audit event
    await tx.createSchedulingEvent({
      schedulingJobId: request.jobId,
      eventType: "status_change",
      oldValue: null,
      newValue: "NOT_STARTED",
      triggeredBy: "SYSTEM",
      timestamp: clock.now(),
    });

    return {
      success: true as const,
      jobId: request.jobId,
      queuePosition: insertion.position,
    };
  });
}
