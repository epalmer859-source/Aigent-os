// ============================================================
// src/engine/scheduling/reschedule-pipeline.ts
//
// RESCHEDULE PIPELINE — IN-PLACE JOB UPDATE
//
// Updates the original scheduling_job row in place rather than
// creating a new row. Preserves job UUID, increments rebook_count,
// and maintains full audit trail via scheduling_events.
//
// All writes run inside a single transaction. Slot re-verification
// happens as the first step inside the transaction to prevent
// booking a slot that was taken between display and selection.
//
// Injectable: db interface for testing without a real database.
// ============================================================

import type { QueuedJob } from "./queue-insertion";
import type { TechCandidate } from "./tech-assignment";
import { parseHHMM } from "./capacity-math";
import type { AvailableSlot, JobContext } from "./ai-booking-pipeline";
import { computeWindowVariants } from "./ai-booking-pipeline";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RescheduleInput {
  originalJobId: string;
  originalAppointmentId: string;
  slot: AvailableSlot;
  techName: string;
}

export interface RescheduleDb {
  getQueueForTechDate(technicianId: string, date: Date): Promise<QueuedJob[]>;
  getTechCandidate(technicianId: string): Promise<TechCandidate | null>;

  updateSchedulingJob(jobId: string, data: {
    technicianId: string;
    scheduledDate: Date;
    queuePosition: number;
    windowStart: Date;
    windowEnd: Date;
    rebookCount: number;
  }): Promise<void>;

  updateAppointment(appointmentId: string, data: {
    appointmentDate: Date;
    appointmentTime: Date;
    technicianName: string;
  }): Promise<void>;

  createSchedulingEvent(event: {
    schedulingJobId: string;
    eventType: string;
    oldValue: string | null;
    newValue: string;
    triggeredBy: string;
    timestamp: Date;
  }): Promise<void>;

  getCurrentRebookCount(jobId: string): Promise<number>;

  transaction<T>(fn: (tx: RescheduleDb) => Promise<T>): Promise<T>;
}

export type RescheduleResult =
  | { success: true; jobId: string; techName: string; scheduledDate: Date; queuePosition: number; rebookCount: number }
  | { success: false; reason: string };

// ── computeAvailableWindows (inline for now) ──────────────────────────────────
// Re-exported from ai-booking-pipeline via its internal helper.
// Since computeAvailableWindows is not exported from ai-booking-pipeline,
// we duplicate the slot-verification logic here using computeWindowVariants
// which IS exported.

function verifySlotAvailable(
  queue: QueuedJob[],
  tech: TechCandidate,
  slot: AvailableSlot,
): boolean {
  const workStart = parseHHMM(tech.workingHoursStart);
  const lunchStart = parseHHMM(tech.lunchStart);
  const lunchEnd = parseHHMM(tech.lunchEnd);
  const workEnd = parseHHMM(tech.workingHoursEnd);
  const overtime = tech.overtimeCapMinutes ?? 0;
  const dayEnd = workEnd + overtime;

  // Walk the queue to find available windows, same algorithm as
  // computeAvailableWindows in ai-booking-pipeline.ts
  const occupied: { start: number; end: number }[] = [];
  let cursor = workStart;
  for (const job of queue) {
    if (cursor >= lunchStart && cursor < lunchEnd) cursor = lunchEnd;
    const serviceDuration = job.estimatedDurationMinutes - (job.driveTimeMinutes || 0);
    const driveToNext = job.driveTimeMinutes || 15;
    occupied.push({ start: cursor, end: cursor + serviceDuration });
    cursor += serviceDuration + driveToNext;
    if (cursor > lunchStart && cursor < lunchEnd) cursor = lunchEnd;
  }

  const windows: { startMinutes: number; queuePosition: number }[] = [];
  let searchStart = workStart;

  for (let i = 0; i <= occupied.length; i++) {
    const gapEnd = i < occupied.length ? occupied[i]!.start : dayEnd;
    let gapStart = searchStart;
    if (gapStart >= lunchStart && gapStart < lunchEnd) gapStart = lunchEnd;

    let windowStart = gapStart;
    while (windowStart + slot.totalCostMinutes <= gapEnd) {
      if (windowStart < lunchStart && windowStart + slot.totalCostMinutes > lunchStart) {
        windowStart = lunchEnd;
        continue;
      }
      if (windowStart >= lunchStart && windowStart < lunchEnd) {
        windowStart = lunchEnd;
        continue;
      }
      if (windowStart + slot.totalCostMinutes > dayEnd) break;
      windows.push({ startMinutes: windowStart, queuePosition: i });
      windowStart += slot.totalCostMinutes + 15;
    }

    if (i < occupied.length) searchStart = occupied[i]!.end;
  }

  // Check if the slot's arrival time + variant still exists
  if (slot.arrivalMinutes != null && slot.variantType != null) {
    const matchingWindow = windows.find(
      (w) => w.startMinutes === slot.arrivalMinutes && w.queuePosition === slot.queuePosition,
    );
    if (!matchingWindow) return false;

    const jobContext: JobContext = { kind: "diagnostic" };
    const variants = computeWindowVariants(
      matchingWindow.startMinutes, matchingWindow.queuePosition, workStart, jobContext,
    );
    return variants.some(
      (v) => v.variantType === slot.variantType
        && formatTime24(v.wStart) === slot.windowStart
        && formatTime24(v.wEnd) === slot.windowEnd,
    );
  }

  // Fallback: check if any window produces matching windowStart
  const jobContext: JobContext = { kind: "diagnostic" };
  return windows.some((w) => {
    const variants = computeWindowVariants(w.startMinutes, w.queuePosition, workStart, jobContext);
    return variants.some((v) => formatTime24(v.wStart) === slot.windowStart);
  });
}

function formatTime24(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function parseSlotTime(hhMm: string, scheduledDate: Date): Date {
  const [h, m] = hhMm.split(":").map(Number) as [number, number];
  const d = new Date(scheduledDate);
  d.setHours(h, m, 0, 0);
  return d;
}

// ── rescheduleInPlace ─────────────────────────────────────────────────────────

export async function rescheduleInPlace(
  input: RescheduleInput,
  db: RescheduleDb,
): Promise<RescheduleResult> {
  const { originalJobId, originalAppointmentId, slot } = input;

  return db.transaction(async (tx) => {
    // 1. Re-verify slot availability inside the transaction
    const scheduledDate = new Date(slot.date + "T00:00:00");
    const queue = await tx.getQueueForTechDate(slot.technicianId, scheduledDate);

    // Exclude the original job from the queue (customer competing with themselves)
    const filteredQueue = queue.filter((j) => j.id !== originalJobId);

    const tech = await tx.getTechCandidate(slot.technicianId);
    if (!tech) {
      return { success: false as const, reason: "technician_not_found" };
    }

    if (!verifySlotAvailable(filteredQueue, tech, slot)) {
      return { success: false as const, reason: "slot_no_longer_available" };
    }

    // 2. Get current rebook_count for increment
    const currentRebookCount = await tx.getCurrentRebookCount(originalJobId);

    // 3. Update scheduling_jobs row in place
    const windowStart = parseSlotTime(slot.windowStart, scheduledDate);
    const windowEnd = parseSlotTime(slot.windowEnd, scheduledDate);

    await tx.updateSchedulingJob(originalJobId, {
      technicianId: slot.technicianId,
      scheduledDate,
      queuePosition: slot.queuePosition,
      windowStart,
      windowEnd,
      rebookCount: currentRebookCount + 1,
    });

    // 4. Update appointments row
    await tx.updateAppointment(originalAppointmentId, {
      appointmentDate: scheduledDate,
      appointmentTime: windowStart,
      technicianName: slot.techName,
    });

    // 5. Create audit event
    await tx.createSchedulingEvent({
      schedulingJobId: originalJobId,
      eventType: "rescheduled",
      oldValue: null,
      newValue: `${slot.date} ${slot.windowStart}-${slot.windowEnd} with ${slot.techName}`,
      triggeredBy: "CUSTOMER",
      timestamp: new Date(),
    });

    return {
      success: true as const,
      jobId: originalJobId,
      techName: slot.techName,
      scheduledDate,
      queuePosition: slot.queuePosition,
      rebookCount: currentRebookCount + 1,
    };
  });
}
