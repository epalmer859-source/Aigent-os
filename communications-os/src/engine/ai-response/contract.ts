// ============================================================
// src/engine/ai-response/contract.ts
//
// AI RESPONSE GENERATOR — CONTRACT
//
// Exports ONLY types and constants. Zero logic.
//
// Pipeline (not implemented here):
//   1. assemblePrompt() — build system prompt + history (Component 6).
//   2. Call Claude API with assembled prompt (injectable for tests).
//   3. Parse and validate AIDecision JSON from Claude response.
//   4. If parse/timeout fails → retry once, then use FALLBACK_RESPONSE.
//   5. validateAIDecision() — check transition, confidence, handoff.
//   6. Apply rule_flags overrides (human_requested, aggressive_message, etc.).
//   7. Execute decision: state change, message queue row, handoff record.
//   8. Log to prompt_log (model, tokens, latency, success).
//   9. Return GenerateResponseResult.
// ============================================================

// ── AIDecision — the structured JSON Claude must return ───────

export interface AIDecision {
  /** Customer-facing message text to send. */
  response_text: string;
  /** Alias used by some Claude model versions (camelCase). Prefer response_text when present. */
  responseText?: string;
  /** Target state for a transition, or null if no change proposed. */
  proposed_state_change: string | null;
  /**
   * Step 1: Set true when all five fields are collected and customer confirms.
   * Triggers slot generation (not immediate booking).
   */
  bookingConfirmed?: boolean;
  /**
   * Step 2: Set true by the system after slots have been presented to the customer.
   * When this is true in conversation context, the AI waits for slot selection.
   */
  slotsPresented?: boolean;
  /**
   * Step 2: The slot the customer selected, parsed by the AI from their reply.
   * Contains the index (1-based) from the presented slot list.
   */
  selectedSlot?: number | null;
  /** Customer's full name if just collected in this turn — used to title the conversation. */
  collected_name?: string | null;
  /** Customer's callback phone number if just collected in this turn — used to title the conversation. */
  collected_phone?: string | null;
  /** Customer's scheduling availability preference if collected in this turn. */
  availability_preference?: string | null;
  /** Customer's availability cutoff time if collected in this turn (e.g. "12:00", "13:00", "14:00"). */
  availability_cutoff_time?: string | null;
  /** Customer's service address if collected in this turn (e.g. "123 Main St, City, ST 12345"). */
  collected_service_address?: string | null;
  /** True if a human should take over this conversation. */
  handoff_required: boolean;
  /** Required when handoff_required = true. */
  handoff_reason: string | null;
  /** Message purpose for the outbound queue row. */
  message_purpose: string;
  /** Fields Claude is waiting for from the customer. */
  requested_data_fields: string[];
  /** Claude's classification of what the customer is asking for. */
  detected_intent: string;
  /** 0.0–1.0. Below CONFIDENCE_THRESHOLD → fallback response used. */
  confidence: number;
  /**
   * Triggered rule identifiers. Processed after validation.
   * Known values: "human_requested", "aggressive_message", "out_of_area",
   * "legal_threat_detected", "safety_concern_detected", "booking_confirmed".
   */
  rule_flags: string[];
  /**
   * True when this is the first outbound message to the customer.
   * Signals that the AI disclosure text must be included in response_text.
   */
  is_first_message: boolean;
  /**
   * True when the AI is asking for the customer's address and the web chat
   * should render an inline address form (Street / City / State / Zip).
   */
  show_address_form?: boolean;
}

// ── Input / output shapes ─────────────────────────────────────

export interface GenerateResponseParams {
  businessId: string;
  conversationId: string;
  /** ID of the inbound message that triggered this cycle. */
  inboundMessageId: string;
  /** Channel the message arrived on ('sms', 'web_chat', etc.). Passed to prompt assembly for disclosure gating. */
  channel?: string;
}

export interface GenerateResponseResult {
  success: boolean;
  /** The validated AIDecision, present on success. */
  decision?: AIDecision;
  /** The actual reply text sent to the customer, always present even on failure. */
  replyText?: string;
  /** ID of the outbound message_log record created. */
  messageLogId?: string;
  /** ID of the outbound_queue row created. */
  queueRowId?: string;
  /** True when a state transition was applied. */
  stateChanged: boolean;
  /** The new state after transition, if stateChanged = true. */
  newState?: string;
  /** True when a handoff record was created. */
  handoffCreated: boolean;
  /** Error description on failure. */
  error?: string;
}

// ── Validation result ─────────────────────────────────────────

export interface ValidationResult {
  isValid: boolean;
  /** The proposed state transition is allowed per VALID_TRANSITIONS. */
  stateChangeAllowed: boolean;
  /**
   * True when handoff_required = true AND handoff_reason is non-empty.
   * False when handoff_required = true but handoff_reason is null/empty.
   */
  handoffValid: boolean;
  /** True when response_text or rule_flags violate a known prohibition. */
  prohibitionViolation: boolean;
  /** True when confidence >= CONFIDENCE_THRESHOLD. */
  confidencePassed: boolean;
  /** Human-readable error descriptions for any failed checks. */
  errors: string[];
}

// ── Injectable Claude call type ───────────────────────────────

/**
 * Signature for the Claude API call, injectable for testing.
 * Production: calls Anthropic SDK with messages.create().
 * Returns the raw text content of Claude's response (JSON string).
 */
export type ClaudeCallFn = (
  systemPrompt: string,
  conversationHistory: { role: "user" | "assistant"; content: string }[],
) => Promise<string>;

// ── Constants ─────────────────────────────────────────────────

/** Claude model ID used for all AI response generation. */
export const AI_MODEL = "claude-sonnet-4-6";

/** Maximum tokens Claude may return per AI response. */
export const AI_MAX_TOKENS = 800;

/** Sampling temperature for Claude responses. */
export const AI_TEMPERATURE = 0.7;

/**
 * Minimum confidence score required to use the AI decision.
 * Below this threshold → FALLBACK_RESPONSE is sent instead.
 * Lowered from 0.6 to 0.4 — short/casual customer messages like
 * "not cooling at all" and "soonest available" were being incorrectly
 * flagged as low-confidence, triggering the fallback loop.
 */
export const CONFIDENCE_THRESHOLD = 0.4;

/** Maximum number of Claude call attempts before using fallback. */
export const MAX_RETRIES = 1;

/**
 * Milliseconds before a Claude API call is considered timed out.
 * Increased from 10s to 30s — the system prompt with scheduling rules,
 * state instructions, and booking schema is large. 10s was causing
 * timeouts on normal responses, which triggered the fallback path.
 */
export const AI_TIMEOUT_MS = 30000;

/**
 * Sent to the customer when all Claude call attempts fail.
 * Also queued as an outbound message with purpose = admin_response_relay.
 */
export const FALLBACK_RESPONSE =
  "Thanks for your message! Our team has been notified and will get back to you shortly.";

// ── Function signatures ───────────────────────────────────────

/**
 * Generate, validate, and execute one AI response cycle.
 *
 * Assembles the prompt, calls Claude, validates the decision, applies
 * rule-flag overrides, executes the decision (state change, queue row,
 * handoff), and logs the attempt to prompt_log.
 */
export type GenerateAIResponseFn = (
  params: GenerateResponseParams,
) => Promise<GenerateResponseResult>;

/**
 * Validate a parsed AIDecision against the current conversation state.
 *
 * Pure function — no DB access, no side effects.
 * Checks: transition validity, confidence threshold, handoff validity.
 */
export type ValidateAIDecisionFn = (
  decision: AIDecision,
  conversationState: string,
) => ValidationResult;

/**
 * Regenerate and cache the conversation summary using the last N messages.
 * Updates conversation.cached_summary via a Claude call.
 * Returns true on success, false if Claude call or DB update fails.
 *
 * Production: db.conversations.update({ where: { id }, data: { cached_summary } })
 */
export type RegenerateSummaryFn = (conversationId: string) => Promise<boolean>;
