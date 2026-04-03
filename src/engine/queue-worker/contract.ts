// ============================================================
// src/engine/queue-worker/contract.ts
//
// OUTBOUND QUEUE WORKER — CONTRACT
//
// Exports ONLY types and constants. Zero logic.
//
// Rules encoded here (not implemented):
//   - Rows are claimed with FOR UPDATE SKIP LOCKED to prevent double-processing.
//   - Claim lease expires after CLAIM_TIMEOUT_SECONDS; expired leases can be
//     re-claimed by another worker cycle.
//   - Suppression engine is consulted for every claimed row before sending.
//     suppress → "canceled", defer → "deferred", send → sendMessage().
//   - Retry: up to MAX_RETRY_COUNT send attempts per row.
//     RETRY_INTERVALS_SECONDS[n] is the wait after the (n+1)th failure.
//     After MAX_RETRY_COUNT failures → "failed_terminal".
//   - processDeferredMessages() re-processes rows where
//     quiet_hours_deferred_until <= now(), re-running full suppression.
// ============================================================

// ── Result shapes ─────────────────────────────────────────────

export interface QueueWorkerResult {
  /** Total rows claimed (and acted on) this cycle. */
  processed: number;
  /** Rows whose send attempt succeeded. */
  sent: number;
  /** Rows canceled by the suppression engine. */
  suppressed: number;
  /** Rows deferred to the next quiet-hours window. */
  deferred: number;
  /** Rows whose send attempt failed (retryable or terminal). */
  failed: number;
}

export interface SendResult {
  success: boolean;
  /** Provider-assigned message ID, e.g. Twilio MessageSid "SMxxxxxx". */
  providerMessageId?: string;
  /** Provider error code, e.g. Twilio error code "21211". */
  errorCode?: string;
  errorMessage?: string;
}

// ── Queue row ─────────────────────────────────────────────────

export type AudienceType = "customer" | "internal";

export type QueueRowStatus =
  | "pending"
  | "deferred"
  | "claimed"
  | "sent"
  | "failed_retryable"
  | "failed_terminal"
  | "canceled";

/**
 * Represents one row from the outbound_queue table.
 * Matches Schema v6 §1.12.
 */
export interface QueueRow {
  id: string;
  businessId: string;
  conversationId: string;
  customerId: string;
  messagePurpose: string;
  audienceType: AudienceType;
  /** "sms" | "voice" | "email" | "web_chat" */
  channel: string;
  messageBody: string;
  status: QueueRowStatus;
  /** Row is not eligible to be claimed until this time has passed. */
  scheduledSendAt: Date;
  /** Random UUID written atomically during the claim step. */
  claimToken: string | null;
  claimedAt: Date | null;
  /** Claim lease expiry; expired leases can be re-claimed. */
  claimExpiresAt: Date | null;
  /** Number of send attempts made so far (not counting the current attempt). */
  sendAttemptCount: number;
  /** Row becomes failed_terminal once sendAttemptCount reaches this value. */
  maxRetryCount: number;
  /** Earliest time the row is eligible for a retry claim. */
  nextRetryAt: Date | null;
  lastAttemptAt: Date | null;
  /** Set when status = "deferred"; row is re-eligible at this time. */
  quietHoursDeferredUntil: Date | null;
  /** Human-readable reason the row was suppressed/canceled. */
  invalidatedBy: string | null;
  terminalFailureReason: string | null;
  /** Optional dedupe key forwarded to the suppression engine. */
  dedupeKey: string | null;
  /** Optional recurring service ID forwarded to the suppression engine. */
  recurringServiceId: string | null;
  /** Provider message ID written on successful send. */
  providerMessageId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── Worker constants ──────────────────────────────────────────

/** Default number of rows claimed per processQueue() call. */
export const DEFAULT_BATCH_SIZE = 10;

/**
 * Claim lease duration in seconds.
 * A row with claim_expires_at < now() is considered stale and can be re-claimed.
 */
export const CLAIM_TIMEOUT_SECONDS = 30;

/**
 * Maximum send attempts before a row becomes failed_terminal.
 * Attempt n (1-indexed) uses RETRY_INTERVALS_SECONDS[n-1] for next_retry_at.
 */
export const MAX_RETRY_COUNT = 3;

/**
 * Wait durations (seconds) between consecutive send failures.
 * Index 0 → after 1st failure (30 s), index 1 → after 2nd (2 min),
 * index 2 → after 3rd (10 min).
 */
export const RETRY_INTERVALS_SECONDS: readonly number[] = [30, 120, 600] as const;

// ── Function signatures ───────────────────────────────────────

/**
 * Claim up to `batchSize` eligible queue rows (pending + overdue retries),
 * run each through the suppression engine, and attempt delivery.
 *
 * Production: uses a Prisma.$transaction with FOR UPDATE SKIP LOCKED to
 * prevent concurrent workers from processing the same row.
 */
export type ProcessQueueFn = (batchSize?: number) => Promise<QueueWorkerResult>;

/**
 * Attempt to deliver one outbound_queue row via the appropriate channel.
 *
 * Routes by audienceType:
 *   "customer" → Twilio (SMS; email deferred)
 *   "internal" → notification system (dashboard + optional staff contact)
 *
 * Production: calls twilio.messages.create({ to, from, body }) for SMS.
 */
export type SendMessageFn = (queueRow: QueueRow) => Promise<SendResult>;

/**
 * Re-process all deferred rows whose quiet_hours_deferred_until <= now().
 * Applies full suppression logic — a row may be suppressed or re-deferred
 * if conditions have changed since it was first deferred.
 *
 * Production: SELECT … WHERE status = 'deferred' AND
 *   quiet_hours_deferred_until <= NOW() FOR UPDATE SKIP LOCKED.
 */
export type ProcessDeferredMessagesFn = () => Promise<QueueWorkerResult>;
