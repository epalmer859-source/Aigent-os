// ============================================================
// src/engine/workers/contract.ts
//
// BACKGROUND WORKERS — CONTRACT
//
// Exports ONLY types and constants. Zero logic.
//
// Worker schedule overview:
//   triggerEvaluator          — every 60 seconds
//   autoCloseWorker           — every 60 seconds
//   takeoverExpiryWorker      — every 60 seconds
//   quoteExpiryWorker         — daily, midnight UTC
//   conversationArchivalWorker— daily, 4 AM UTC
//   promptLogCleanupWorker    — daily, 3 AM UTC
//   webChatCleanupWorker      — daily, 2 AM UTC
//   notificationCleanupWorker — daily, 5 AM UTC
// ============================================================

// ── Core result type ──────────────────────────────────────────

/**
 * Returned by every worker function.
 * processed = succeeded + failed + skipped
 */
export interface WorkerResult {
  /** Total rows examined. */
  processed: number;
  /** Rows successfully acted upon. */
  succeeded: number;
  /** Rows that threw an unrecoverable error (partial failures). */
  failed: number;
  /** Rows examined but intentionally not acted upon (e.g. already closed, future timer). */
  skipped: number;
}

// ── Worker function signatures ────────────────────────────────

/**
 * Scans conversations for unresolved silence timers and queues follow-up
 * and stale-waiting messages at the cadences defined in Doc 02.
 *
 * - routine_followup_1 at FOLLOWUP_DELAY_1_HOURS after last unanswered AI question
 * - routine_followup_final at FOLLOWUP_DELAY_FINAL_HOURS after routine_followup_1
 * - stale_waiting_internal_ping and stale_waiting_customer_update per cadence
 *   (immediate, 6h, 12h, then every 12h thereafter)
 * - Suppressed when a non-terminal outbound_queue row exists with the same dedupe_key
 *
 * Schedule: every WORKER_INTERVAL_SECONDS seconds.
 */
export type TriggerEvaluatorFn = () => Promise<WorkerResult>;

/**
 * Finds conversations where auto_close_at <= now() AND primary_state is
 * NOT a closed state, then transitions each to closed_lost and cancels
 * all pending outbound_queue rows.
 *
 * Schedule: every WORKER_INTERVAL_SECONDS seconds.
 */
export type AutoCloseWorkerFn = () => Promise<WorkerResult>;

/**
 * Finds conversations where primary_state = 'human_takeover_active' AND
 * human_takeover_expires_at <= now() AND human_takeover_expires_at IS NOT NULL,
 * then calls restoreFromOverride() and logs human_takeover_timer_expired.
 *
 * Schedule: every WORKER_INTERVAL_SECONDS seconds.
 */
export type TakeoverExpiryWorkerFn = () => Promise<WorkerResult>;

/**
 * Finds quotes where status = 'sent' AND created_at + quote_expiry_days <= now(),
 * sets status = 'expired', logs quote_expired event.
 *
 * Schedule: daily midnight UTC.
 */
export type QuoteExpiryWorkerFn = () => Promise<WorkerResult>;

/**
 * Finds conversations in closed states where closed_at + ARCHIVE_AFTER_DAYS <= now()
 * AND is_archived = false, then sets is_archived = true.
 *
 * Schedule: daily 4 AM UTC.
 */
export type ConversationArchivalWorkerFn = () => Promise<WorkerResult>;

/**
 * Deletes prompt_log rows older than PROMPT_LOG_RETENTION_DAYS days.
 *
 * Schedule: daily 3 AM UTC.
 */
export type PromptLogCleanupWorkerFn = () => Promise<WorkerResult>;

/**
 * Deletes web_chat_sessions where created_at + WEB_CHAT_SESSION_RETENTION_HOURS <= now().
 *
 * Schedule: daily 2 AM UTC.
 */
export type WebChatCleanupWorkerFn = () => Promise<WorkerResult>;

/**
 * Deletes read notifications older than NOTIFICATION_RETENTION_DAYS days.
 *
 * Schedule: daily 5 AM UTC.
 */
export type NotificationCleanupWorkerFn = () => Promise<WorkerResult>;

// ── Constants ─────────────────────────────────────────────────

/** How often the high-frequency workers run, in seconds. */
export const WORKER_INTERVAL_SECONDS = 60;

/** Hours after last unanswered AI question before queuing routine_followup_1. */
export const FOLLOWUP_DELAY_1_HOURS = 8;

/** Hours after routine_followup_1 before queuing routine_followup_final. */
export const FOLLOWUP_DELAY_FINAL_HOURS = 24;

/**
 * Days after a conversation enters a closed state before it is archived.
 * Applies to conversationArchivalWorker.
 */
export const ARCHIVE_AFTER_DAYS = 90;

/**
 * Days to retain prompt_log rows before deletion.
 * Applies to promptLogCleanupWorker.
 */
export const PROMPT_LOG_RETENTION_DAYS = 30;

/**
 * Hours to retain web_chat_session rows before deletion.
 * Applies to webChatCleanupWorker.
 */
export const WEB_CHAT_SESSION_RETENTION_HOURS = 24;

/**
 * Days to retain read notifications before deletion.
 * Applies to notificationCleanupWorker.
 */
export const NOTIFICATION_RETENTION_DAYS = 30;

// ── Queue row status ──────────────────────────────────────────

export type QueueRowStatus = "pending" | "sent" | "canceled" | "failed";

// ── Quote status ──────────────────────────────────────────────

export type QuoteStatus = "sent" | "accepted" | "rejected" | "expired";

// ── Event types logged by workers ─────────────────────────────

export const WORKER_EVENT_TYPES = [
  "conversation_auto_closed",
  "human_takeover_timer_expired",
  "quote_expired",
] as const;

export type WorkerEventType = (typeof WORKER_EVENT_TYPES)[number];

// ── AI failure reprocessor (Finding 2) ───────────────────────

/**
 * Scans message_log for outbound fallback messages within the last 24 hours.
 * For each conversation that has a fallback but no subsequent successful AI
 * response, re-calls generateAIResponse with the original inbound message ID.
 *
 * Schedule: every AI_REPROCESS_INTERVAL_SECONDS seconds.
 */
export type AIFailureReprocessorFn = () => Promise<WorkerResult>;

/** How often the AI failure reprocessor runs, in seconds. */
export const AI_REPROCESS_INTERVAL_SECONDS = 300;
