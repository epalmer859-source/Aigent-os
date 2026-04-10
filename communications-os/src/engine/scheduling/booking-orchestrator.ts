// ============================================================
// src/engine/scheduling/booking-orchestrator.ts
//
// BOOKING ORCHESTRATOR — ATOMIC JOB CREATION
//
// Single entry point for creating a new scheduling job.
// Wraps reserveCapacity → create job → set queue position →
// create audit event in one atomic transaction.
//
// Rules enforced:
//   - All four steps in a single transaction (C1 fix)
//   - Reserve AND position must BOTH succeed; failure rolls back
//   - Scheduling event created atomically with the job (C5 fix)
//   - Communication firing happens AFTER commit, not inside txn
//
// Injectable: db, clock.
// ============================================================

import { reserveCapacity, type CapacityDb, type TimePreference, type ReservationResult } from "./capacity-math";
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
  addressLat: number;
  addressLng: number;
  serviceType: string;
}

export type BookingOutcome =
  | { success: true; jobId: string; queuePosition: number }
  | { success: false; reason: "no_capacity" | "no_morning_capacity" | "no_afternoon_capacity" | "invalid_queue_position" | "scheduling_paused" | "resync_pending" };

export interface BookingOrchestratorDb {
  /** Get the current queue for a tech on a date (for insertion calculation). */
  getQueueForTechDate(technicianId: string, date: Date): Promise<QueuedJob[]>;

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
    addressLat: number;
    addressLng: number;
    serviceType: string;
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

  /** Capacity operations. */
  capacityDb: CapacityDb;

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
 * Atomic job booking: reserve capacity, create job, set queue position,
 * and create audit event — all inside a single transaction.
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
    // 1. Reserve capacity (uses row-level lock internally)
    const reserveResult: ReservationResult = await reserveCapacity(
      request.technicianId,
      request.scheduledDate,
      request.totalCostMinutes,
      request.timePreference,
      tx.capacityDb,
    );

    if (!reserveResult.success) {
      return {
        success: false as const,
        reason: reserveResult.reason ?? "no_capacity",
      };
    }

    // 2. Compute optimal queue position
    const queue = await tx.getQueueForTechDate(request.technicianId, request.scheduledDate);
    const newJobInput: NewJobInput = {
      id: request.jobId,
      addressLat: request.addressLat,
      addressLng: request.addressLng,
      timePreference: request.timePreference,
      totalCostMinutes: request.totalCostMinutes,
    };

    const insertion = await findOptimalPosition(queue, newJobInput, techHomeBase, osrmDeps);

    if (!insertion.valid) {
      // Capacity was reserved but queue insertion failed — transaction
      // will roll back, releasing the reservation automatically.
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
      addressLat: request.addressLat,
      addressLng: request.addressLng,
      serviceType: request.serviceType,
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
