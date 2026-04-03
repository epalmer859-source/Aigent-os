// ============================================================
// src/engine/inbound/contract.ts
//
// INBOUND MESSAGE HANDLER — CONTRACT
//
// Exports ONLY types and constants. Zero logic.
//
// Pipeline (not implemented here):
//   1.  Validate params (Zod).
//   2.  Normalize contact value via normalizeContact().
//   3.  STOP / START keyword detection on SMS content.
//       STOP → set opted_out, enqueue STOP_CONFIRMATION_MESSAGE, return early.
//       START → set resubscribed, enqueue START_CONFIRMATION_MESSAGE, return early.
//   4.  resolveCustomer() — get/create customer + conversation.
//   5.  If conversation is null (doNotContact) → return early, no message stored.
//   6.  Persist inbound message record.
//   7.  Attach media records if mediaUrls present.
//   8.  If isNewConversation → apply new_lead state, set currentOwner = "ai".
//   9.  If isReopened → transition state back to new_lead via state machine.
//   10. Update conversation.updatedAt, silence timer reset.
//   11. Cancel pending SILENCE_TIMER_PURPOSES rows for this conversation.
//   12. If currentOwner === "ai" → enqueue AI response (aiResponseQueued = true).
//   13. Return InboundResult.
// ============================================================

// ── Input / output shapes ─────────────────────────────────────

export interface InboundParams {
  businessId: string;
  /** Raw contact value — normalized internally (E.164 for phone). */
  fromContact: string;
  /** "phone" | "email" | "web_chat" */
  contactType: "phone" | "email" | "web_chat";
  /** "sms" | "voice" | "email" | "web_chat" */
  channel: "sms" | "voice" | "email" | "web_chat";
  /** Message text body (may be empty string for media-only messages). */
  content: string;
  /** Optional list of media attachment URLs. */
  mediaUrls?: string[];
  /** Twilio MessageSid for idempotency / duplicate detection. */
  twilioMessageSid?: string;
}

export interface InboundResult {
  customerId: string;
  conversationId: string;
  /** Stable ID for the persisted inbound message record. */
  messageId: string;
  /** True when the customer was created during this call. */
  isNewCustomer: boolean;
  /** True when the conversation was created during this call. */
  isNewConversation: boolean;
  /**
   * True when a NEW conversation was created because the prior conversation
   * was closed within auto_close_days (returning customer).
   */
  isReopened: boolean;
  /** True when an AI response was enqueued for this message. */
  aiResponseQueued: boolean;
  /** True when the conversation state was changed by this inbound message. */
  stateChanged: boolean;
  /** The new state after any transition, or undefined if no change occurred. */
  newState?: string;
  /**
   * The AI-generated reply text, present only for web_chat channel when
   * aiResponseQueued is true. Web chat delivers the response synchronously
   * rather than via the queue worker.
   */
  aiReplyText?: string;
}

// ── STOP / START keyword sets ─────────────────────────────────

/**
 * SMS opt-out keywords (case-insensitive match against trimmed content).
 * Receiving any of these → set consent_status = "opted_out".
 * Twilio-standard STOP keyword list.
 */
export const STOP_KEYWORDS: readonly string[] = [
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
] as const;

/**
 * SMS opt-in keywords (case-insensitive match against trimmed content).
 * Receiving any of these from an opted_out customer → set consent_status = "resubscribed".
 */
export const START_KEYWORDS: readonly string[] = ["START", "YES"] as const;

// ── Confirmation message templates ───────────────────────────

/**
 * Confirmation sent immediately after a STOP keyword is received.
 * {business_name} and {phone} are template placeholders filled at send time.
 */
export const STOP_CONFIRMATION_MESSAGE =
  "You've been unsubscribed from {business_name}. I handle most of the communication here — scheduling, quotes, updates, all of it — so you won't be hearing from us on any of that. Reply START anytime to reconnect, or call or text {phone} if you need anything.";

/**
 * Confirmation sent immediately after a START keyword is received.
 * {business_name} is a template placeholder filled at send time.
 */
export const START_CONFIRMATION_MESSAGE =
  "You're reconnected with {business_name}. I'm here — whatever you need, just let me know!";

// ── Silence-timer purposes ────────────────────────────────────

/**
 * Pending outbound queue rows with these message purposes are canceled
 * when a customer reply arrives, resetting the silence timer.
 */
export const SILENCE_TIMER_PURPOSES: readonly string[] = [
  "routine_followup_1",
  "routine_followup_final",
] as const;

// ── Function signature ────────────────────────────────────────

/**
 * Handle one inbound message from a customer (or internal contact).
 *
 * Orchestrates:
 *   - Contact normalization
 *   - STOP / START keyword handling (SMS only)
 *   - Customer + conversation resolution
 *   - Message persistence
 *   - Silence-timer queue cancellation
 *   - State machine transitions (new_lead on reopen)
 *   - AI response queueing
 *
 * Throws on invalid params (Zod validation failure).
 * Returns early (without persisting a message) when the customer has
 * do_not_contact = true.
 */
export type HandleInboundMessageFn = (params: InboundParams) => Promise<InboundResult>;
