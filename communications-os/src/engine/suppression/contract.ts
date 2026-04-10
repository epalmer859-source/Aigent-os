// ============================================================
// src/engine/suppression/contract.ts
//
// SUPPRESSION ENGINE — CONTRACT
//
// Exports ONLY types and constants. Zero logic.
//
// Rules encoded here (not implemented):
//   - Global rules G1–G6 checked first, in order, first match wins.
//   - Per-purpose rules checked after globals pass.
//   - Dedupe check: no two non-terminal rows share the same dedupe_key.
//   - Urgent/operational purposes (dispatch_notice, delay_notice,
//     schedule_change_notice) are exempt from quiet hours AND the
//     rolling 24h cap.
//   - missed_call_fallback and handoff_response are exempt from quiet
//     hours only (still count toward the 24h cap).
//   - Internal purposes are exempt from the do_not_contact suppression.
// ============================================================

// ── Decision types ────────────────────────────────────────────

export type SuppressionDecision = "send" | "defer" | "suppress";

export interface SuppressionResult {
  decision: SuppressionDecision;
  /** Human-readable reason code, e.g. "business_paused", "quiet_hours", "24h_cap". */
  reason: string;
  /** Set only when decision = "defer". ISO 8601 Date of next send window open. */
  deferUntil?: Date;
}

// ── Message context ───────────────────────────────────────────

export interface MessageContext {
  businessId: string;
  conversationId: string;
  customerId: string;
  /** From the canonical purpose list. */
  messagePurpose: string;
  /** "sms" | "voice" | "email" | "web_chat" */
  channel: string;
  /**
   * Optional dedupe key. When provided, the suppression engine checks
   * outbound_queue for an existing non-terminal row with this key and
   * suppresses if found (reason: "duplicate_dedupe_key").
   */
  dedupeKey?: string;
  /**
   * Optional recurring service ID. Required when messagePurpose =
   * "recurring_reminder" so the engine can check recurring_services.status.
   */
  recurringServiceId?: string;
}

// ── Canonical purpose lists ───────────────────────────────────

/** All customer-facing message purposes. Doc 11 §1.1. */
export const CUSTOMER_FACING_PURPOSES = [
  "missed_call_fallback",
  "routine_followup_1",
  "routine_followup_final",
  "quote_followup_1",
  "quote_followup_final",
  "closeout",
  "reschedule_confirmation",
  "cancellation_confirmation",
  "dispatch_notice",
  "delay_notice",
  "schedule_change_notice",
  "stale_waiting_customer_update",
  "stale_waiting_customer_update_parts",
  "handoff_response",
  "quote_delivery",
  "admin_response_relay",
  "recurring_reminder",
] as const;

export type CustomerFacingPurpose = (typeof CUSTOMER_FACING_PURPOSES)[number];

/** All internal message purposes. Doc 11 §1.2. */
export const INTERNAL_PURPOSES = [
  "stale_waiting_internal_ping",
  "escalation_alert",
  "new_quote_request",
  "new_approval_request",
  "parts_request",
  "payment_management_ready",
  "human_takeover_summary",
  "schedule_change_admin_notice",
  "urgent_service_request",
] as const;

export type InternalPurpose = (typeof INTERNAL_PURPOSES)[number];

export type MessagePurpose = CustomerFacingPurpose | InternalPurpose;

/**
 * Urgent/operational purposes: exempt from quiet hours AND the rolling 24h cap.
 * Doc 11 §1.3.
 */
export const URGENT_PURPOSES: readonly string[] = [
  "dispatch_notice",
  "delay_notice",
  "schedule_change_notice",
] as const;

/**
 * Purposes exempt from quiet hours only. They still count toward the 24h cap.
 * Doc 11 §1.3.
 */
export const QUIET_HOURS_EXEMPT_PURPOSES: readonly string[] = [
  "missed_call_fallback",
  "handoff_response",
] as const;

/**
 * Special purpose for the business-paused auto-reply.
 * This is the only outbound allowed when businesses.is_paused = true.
 */
export const PAUSE_MESSAGE_PURPOSE = "pause_message";

/**
 * Outbound queue statuses that are still active (non-terminal).
 * A duplicate dedupe_key in any of these statuses triggers suppression.
 */
export const NON_TERMINAL_QUEUE_STATUSES: readonly string[] = [
  "pending",
  "deferred",
  "claimed",
] as const;

/** Terminal queue statuses — a duplicate dedupe_key here does NOT suppress. */
export const TERMINAL_QUEUE_STATUSES: readonly string[] = [
  "sent",
  "failed_retryable",
  "failed_terminal",
  "canceled",
] as const;

/**
 * Per-purpose allowed conversation states.
 * A message is suppressed if the conversation's primary_state is not in
 * the allowed set for that purpose (where a set is defined).
 */
export const ALLOWED_STATES_BY_PURPOSE: Record<string, readonly string[]> = {
  closeout: ["job_completed"],
};

// ── Function signatures ───────────────────────────────────────

/**
 * Decide whether a proposed outbound message should be sent, deferred, or
 * suppressed. Runs all global checks (G1–G6) then per-purpose checks.
 *
 * Production: queries Prisma for businesses, customers, conversations,
 * conversation_tags, message_log (24h cap), and outbound_queue (dedupe).
 */
export type ShouldSendMessageFn = (context: MessageContext) => Promise<SuppressionResult>;

/**
 * Cancel all pending quote_followup_1 and quote_followup_final queue rows
 * for a given conversation. Called when a new quote supersedes the old one.
 *
 * Returns the number of rows canceled.
 */
export type CancelQuoteFollowupsFn = (conversationId: string) => Promise<number>;

/**
 * Cancel all outbound_queue rows whose dedupe_key starts with
 * `${dependencyType}:${dependencyId}` in non-terminal status.
 * Used to clean up stale-waiting pings when the blocking dependency resolves.
 *
 * Returns the number of rows canceled.
 */
export type CancelByDependencyFn = (
  dependencyType: string,
  dependencyId: string,
) => Promise<number>;
