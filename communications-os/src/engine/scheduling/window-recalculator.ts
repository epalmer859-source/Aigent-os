// ============================================================
// src/engine/scheduling/window-recalculator.ts
//
// WINDOW RECALCULATOR — DYNAMIC DOWNSTREAM WINDOW UPDATES
//
// When a tech arrives at or completes a job, all downstream
// customer windows must be recalculated with real timing data.
//
// Also handles two notification triggers:
//   1. Window shifted 30+ minutes → customer gets window-change SMS
//   2. Customer is 2 jobs away → proactive "couple stops away" SMS
//
// If both triggers fire for the same customer, only the "couple
// stops away" message sends (more specific, no double-notify).
//
// Injectable: db interface for testing.
// ============================================================

import {
  calculateDiagnosticWindow,
  calculateKnownJobWindow,
  type WindowResult,
} from "./window-calculator";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RecalcJob {
  id: string;
  customerId: string;
  customerName: string | null;
  queuePosition: number;
  estimatedDurationMinutes: number;
  driveTimeMinutes: number;
  windowStart: Date | null;
  windowEnd: Date | null;
  status: string;
}

export interface FollowUpEstimates {
  estimatedLowMinutes: number;
  estimatedHighMinutes: number;
}

export interface WindowNotification {
  jobId: string;
  customerId: string;
  customerName: string | null;
  oldWindowStart: Date | null;
  oldWindowEnd: Date | null;
  newWindowStart: Date;
  newWindowEnd: Date;
  reason: "window_shifted" | "two_jobs_away";
}

export interface WindowRecalculationResult {
  updatedJobs: number;
  notifications: WindowNotification[];
}

export interface WindowRecalculatorDb {
  /** Get all non-canceled jobs for this tech on this date, ordered by queue_position ASC. */
  getJobsForTechOnDate(technicianId: string, date: Date): Promise<RecalcJob[]>;
  /** Get follow-up estimates if this job is a return visit (linked follow_up_requests). */
  getFollowUpEstimates(jobId: string): Promise<FollowUpEstimates | null>;
  /** Update window_start and window_end on a scheduling_job. */
  updateJobWindow(jobId: string, windowStart: Date, windowEnd: Date): Promise<void>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const WINDOW_SHIFT_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes
const V1_DRIVE_TIME_MINUTES = 15; // hardcoded V1

// ── recalculateDownstreamWindows ────────────────────────────────────────────

/**
 * Recalculate windows for all downstream jobs after a given job.
 *
 * @param technicianId  The tech whose queue to recalculate
 * @param fromJobId     The job that triggered recalculation (tech just arrived/completed)
 * @param baselineArrivalTime  The tech's actual arrival time (for arrival trigger)
 *                              or current time + drive (for completion trigger)
 * @param scheduledDate The date of the jobs to recalculate
 * @param db            Injectable DB interface
 * @returns Updated job count and notifications needed
 */
export async function recalculateDownstreamWindows(
  technicianId: string,
  fromJobId: string,
  baselineArrivalTime: Date,
  scheduledDate: Date,
  db: WindowRecalculatorDb,
): Promise<WindowRecalculationResult> {
  const allJobs = await db.getJobsForTechOnDate(technicianId, scheduledDate);

  // Find the trigger job's position
  const triggerIndex = allJobs.findIndex((j) => j.id === fromJobId);
  if (triggerIndex < 0) {
    return { updatedJobs: 0, notifications: [] };
  }

  // Get jobs downstream of the trigger (everything after it in queue order)
  const downstreamJobs = allJobs.slice(triggerIndex + 1);
  if (downstreamJobs.length === 0) {
    return { updatedJobs: 0, notifications: [] };
  }

  let updatedJobs = 0;
  const notifications: WindowNotification[] = [];
  // Track which customers already got a "two_jobs_away" notification
  const twoJobsAwayCustomers = new Set<string>();

  // The estimated arrival at the next job starts from the baseline
  let nextArrivalTime = baselineArrivalTime;

  for (let i = 0; i < downstreamJobs.length; i++) {
    const job = downstreamJobs[i]!;

    // Skip terminal-state jobs
    if (job.status === "COMPLETED" || job.status === "CANCELED" || job.status === "INCOMPLETE") {
      continue;
    }

    // Determine if this is a diagnostic or known job
    const followUp = await db.getFollowUpEstimates(job.id);
    let newWindow: WindowResult;

    if (followUp) {
      // Known job — use follow-up estimates
      newWindow = calculateKnownJobWindow(
        nextArrivalTime,
        followUp.estimatedLowMinutes,
        followUp.estimatedHighMinutes,
        job.driveTimeMinutes,
      );
    } else {
      // Diagnostic job — Rule 1
      newWindow = calculateDiagnosticWindow(nextArrivalTime);
    }

    // Check if window shifted significantly (30+ minutes)
    const oldStart = job.windowStart;
    const shifted = oldStart != null &&
      Math.abs(newWindow.windowStart.getTime() - oldStart.getTime()) >= WINDOW_SHIFT_THRESHOLD_MS;

    // Check "2 jobs away" condition: this job is at downstream index 1
    // (i.e., the trigger job is at N, this job is at N+2)
    const isTwoJobsAway = i === 1;

    // Persist the new window
    await db.updateJobWindow(job.id, newWindow.windowStart, newWindow.windowEnd);
    updatedJobs++;

    // Determine notification
    if (isTwoJobsAway) {
      // "Couple stops away" takes priority — always fires for N+2
      notifications.push({
        jobId: job.id,
        customerId: job.customerId,
        customerName: job.customerName,
        oldWindowStart: job.windowStart,
        oldWindowEnd: job.windowEnd,
        newWindowStart: newWindow.windowStart,
        newWindowEnd: newWindow.windowEnd,
        reason: "two_jobs_away",
      });
      twoJobsAwayCustomers.add(job.customerId);
    } else if (shifted && !twoJobsAwayCustomers.has(job.customerId)) {
      // Window shifted 30+ min, and this customer didn't already get a "two_jobs_away" message
      notifications.push({
        jobId: job.id,
        customerId: job.customerId,
        customerName: job.customerName,
        oldWindowStart: job.windowStart,
        oldWindowEnd: job.windowEnd,
        newWindowStart: newWindow.windowStart,
        newWindowEnd: newWindow.windowEnd,
        reason: "window_shifted",
      });
    }

    // Estimate when the tech will arrive at the NEXT downstream job:
    // current arrival + this job's estimated duration + drive to next
    const jobDuration = job.estimatedDurationMinutes;
    const driveToNext = (i + 1 < downstreamJobs.length)
      ? downstreamJobs[i + 1]!.driveTimeMinutes
      : V1_DRIVE_TIME_MINUTES;
    nextArrivalTime = new Date(
      nextArrivalTime.getTime() + (jobDuration + driveToNext) * 60 * 1000,
    );
  }

  return { updatedJobs, notifications };
}
