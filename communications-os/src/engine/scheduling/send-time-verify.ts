// ============================================================
// src/engine/scheduling/send-time-verify.ts
//
// H1: SEND-TIME STATE VERIFICATION
//
// Before the queue worker delivers a scheduling message, verify
// the job is still in a state where the message is relevant.
// If not, cancel the message instead of sending stale content.
//
// Deterministic. No AI. Pure lookup + comparison.
// ============================================================

import type { SchedulingMessagePurpose } from "./communication-wiring";
import type { SchedulingJobStatus } from "./scheduling-state-machine";

// ── Valid job states per message purpose ─────────────────────────────────────
// A message should only be delivered when the job is in one of these states.

const VALID_STATES_FOR_PURPOSE: Record<SchedulingMessagePurpose, ReadonlySet<SchedulingJobStatus>> = {
  scheduling_confirmation: new Set(["NOT_STARTED"]),
  scheduling_morning_reminder: new Set(["NOT_STARTED"]),
  scheduling_en_route: new Set(["EN_ROUTE"]),
  scheduling_arrival: new Set(["ARRIVED", "IN_PROGRESS"]),
  scheduling_completion: new Set(["COMPLETED"]),
  scheduling_delay_notice: new Set(["NOT_STARTED", "EN_ROUTE"]),
  scheduling_window_change: new Set(["NOT_STARTED", "EN_ROUTE"]),
  scheduling_rebook_notice: new Set(["NOT_STARTED", "NEEDS_REBOOK"]),
  scheduling_pull_forward_offer: new Set(["NOT_STARTED"]),
  scheduling_pull_forward_accepted: new Set(["NOT_STARTED"]),
  scheduling_tech_estimate_prompt: new Set(["EN_ROUTE", "ARRIVED", "IN_PROGRESS"]),
  scheduling_tech_estimate_reminder: new Set(["ARRIVED", "IN_PROGRESS"]),
  scheduling_completion_note_prompt: new Set(["COMPLETED", "INCOMPLETE"]),
  scheduling_review_request: new Set(["COMPLETED"]),
  scheduling_followup_outreach: new Set(["COMPLETED"]),
  scheduling_sick_tech_notice: new Set(["NOT_STARTED", "NEEDS_REBOOK"]),
};

export { VALID_STATES_FOR_PURPOSE };

// ── Send-time verification ──────────────────────────────────────────────────

export interface SendTimeVerifyDb {
  getJobStatus(jobId: string): Promise<SchedulingJobStatus | null>;
}

export interface SendTimeVerifyResult {
  shouldSend: boolean;
  reason?: "job_not_found" | "state_mismatch";
  currentStatus?: SchedulingJobStatus;
}

/**
 * Verify at send time that a scheduling message is still relevant.
 *
 * Call this in the queue worker BEFORE delivering any scheduling-purpose
 * message. If it returns shouldSend=false, cancel the message.
 *
 * Idempotent: safe to call multiple times for the same message.
 */
export async function verifySendTimeState(
  jobId: string,
  purpose: SchedulingMessagePurpose,
  db: SendTimeVerifyDb,
): Promise<SendTimeVerifyResult> {
  const currentStatus = await db.getJobStatus(jobId);

  if (!currentStatus) {
    return { shouldSend: false, reason: "job_not_found" };
  }

  const validStates = VALID_STATES_FOR_PURPOSE[purpose];
  if (!validStates) {
    // Unknown purpose — allow send (defensive: don't block unknown purposes)
    return { shouldSend: true };
  }

  if (validStates.has(currentStatus)) {
    return { shouldSend: true, currentStatus };
  }

  return {
    shouldSend: false,
    reason: "state_mismatch",
    currentStatus,
  };
}
