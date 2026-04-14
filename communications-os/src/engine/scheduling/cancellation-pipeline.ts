// ============================================================
// src/engine/scheduling/cancellation-pipeline.ts
//
// CANCELLATION PIPELINE — CUSTOMER-INITIATED APPOINTMENT CANCELLATION
//
// Two functions:
//   1. findCustomerAppointments(businessId, phone) — look up active
//      appointments by phone number (fuzzy match: strip non-digits).
//   2. cancelAppointment(appointmentId, reason, canceledBy) — cancel
//      the appointment, transition the scheduling job to CANCELED,
//      and trigger queue recalculation for the affected tech.
//
// Injectable: db interface for testing without a real database.
// ============================================================

import type { SchedulingJobStatus } from "./scheduling-state-machine";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CustomerAppointment {
  appointmentId: string;
  schedulingJobId: string | null;
  techName: string;
  date: string;          // ISO date string (YYYY-MM-DD)
  windowStart: string;   // HH:MM or "TBD"
  windowEnd: string;     // HH:MM or "TBD"
  serviceDescription: string;
  status: string;
}

export type CanceledBy = "customer" | "owner" | "system";

export interface CancelResult {
  success: boolean;
  reason?: string;
  appointmentId?: string;
}

// ── DB interface ──────────────────────────────────────────────────────────────

export interface CancellationDb {
  /** Find customer IDs by phone number (fuzzy: digits-only match). */
  findCustomerIdsByPhone(businessId: string, phone: string): Promise<string[]>;

  /** Find active appointments for a customer (status = booked or rescheduled). */
  findActiveAppointments(businessId: string, customerIds: string[]): Promise<CustomerAppointment[]>;

  /** Get the scheduling job for an appointment. */
  getSchedulingJobForAppointment(appointmentId: string): Promise<{
    jobId: string;
    technicianId: string;
    scheduledDate: Date;
    status: SchedulingJobStatus;
  } | null>;

  /** Update the appointment to canceled status with reason. */
  updateAppointmentCanceled(appointmentId: string, reason: string, canceledBy: CanceledBy): Promise<void>;

  /** Transition the scheduling job to CANCELED status. */
  transitionJobToCanceled(jobId: string): Promise<void>;

  /** Cancel all pending scheduling messages for this job. */
  cancelPendingMessages(jobId: string): Promise<number>;
}

// ── 1. findCustomerAppointments ───────────────────────────────────────────────

/**
 * Look up a customer's active (booked/rescheduled) appointments by phone number.
 *
 * Phone matching is fuzzy: all non-digit characters are stripped before
 * comparing, so "(404) 555-1234", "4045551234", and "+14045551234" all match.
 *
 * Returns an empty array if no customer found or no active appointments.
 */
export async function findCustomerAppointments(
  businessId: string,
  phone: string,
  db: CancellationDb,
): Promise<CustomerAppointment[]> {
  const stripped = phone.replace(/\D/g, "");
  if (stripped.length < 7) return []; // too short to be a valid phone

  const customerIds = await db.findCustomerIdsByPhone(businessId, stripped);
  if (customerIds.length === 0) return [];

  return db.findActiveAppointments(businessId, customerIds);
}

// ── 2. cancelAppointment ──────────────────────────────────────────────────────

/**
 * Cancel an appointment:
 *   1. Mark the appointment as canceled with reason and timestamp.
 *   2. Transition the linked scheduling job to CANCELED.
 *   3. Cancel all pending scheduling messages for the job.
 *
 * Returns { success: true } on success, or { success: false, reason } on failure.
 */
export async function cancelAppointment(
  appointmentId: string,
  reason: string,
  canceledBy: CanceledBy,
  db: CancellationDb,
): Promise<CancelResult> {
  // Look up the scheduling job linked to this appointment
  const job = await db.getSchedulingJobForAppointment(appointmentId);

  if (!job) {
    // Appointment exists but no scheduling job — just cancel the appointment
    await db.updateAppointmentCanceled(appointmentId, reason, canceledBy);
    return { success: true, appointmentId };
  }

  // Only NOT_STARTED and NEEDS_REBOOK can transition to CANCELED
  if (job.status !== "NOT_STARTED" && job.status !== "NEEDS_REBOOK") {
    return {
      success: false,
      reason: `cannot_cancel_${job.status.toLowerCase()}`,
    };
  }

  // Cancel the appointment record
  await db.updateAppointmentCanceled(appointmentId, reason, canceledBy);

  // Transition the scheduling job to CANCELED
  await db.transitionJobToCanceled(job.jobId);

  // Cancel all pending scheduling messages
  await db.cancelPendingMessages(job.jobId);

  return { success: true, appointmentId };
}
