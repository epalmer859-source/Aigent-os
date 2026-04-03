// ============================================================
// src/engine/prompt-assembly/contract.ts
//
// PROMPT ASSEMBLY ENGINE — CONTRACT
//
// Exports ONLY types and constants. Zero logic.
//
// Prompt structure (4 layers, assembled in order):
//   Layer 1 — Business identity: name, industry, phone, hours,
//             services, service area, policies, philosophy,
//             signoff name, custom instructions.
//   Layer 2 — Conversation context: state, owner, customer name,
//             cached summary, active tags, workflow step,
//             requested data fields.
//   Layer 3 — Rules and capabilities: universal AI behavior rules
//             (Doc 03), industry capabilities (Doc 07), industry
//             prohibitions (Doc 08), state-specific instructions.
//   Layer 4 — Response format: AIDecision JSON schema and the
//             instruction to respond ONLY with a valid JSON object.
//
// Conversation history:
//   Last MAX_HISTORY_MESSAGES messages from message_log, oldest-first.
//   inbound → role 'user', outbound → role 'assistant'.
//
// AI disclosure:
//   If customers.ai_disclosure_sent_at is null, Layer 2 includes a
//   mandatory first-message disclosure instruction with the template
//   AI_DISCLOSURE_TEMPLATE.
// ============================================================

// ── Input shape ───────────────────────────────────────────────

export interface PromptContext {
  businessId: string;
  conversationId: string;
  customerId: string;
  /** ID of the inbound message that triggered this AI response cycle. */
  inboundMessageId: string;
}

// ── Output shapes ─────────────────────────────────────────────

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export interface PromptMetadata {
  businessName: string;
  industry: string;
  conversationState: string;
  customerName: string | null;
  /** Number of messages included in conversationHistory. */
  messageCount: number;
  /** Rough token count of the system prompt (characters / 4). */
  promptTokenEstimate: number;
  /** Number of industry capability rules included in Layer 3. */
  capabilitiesIncluded: number;
  /** Number of industry prohibition rules included in Layer 3. */
  prohibitionsIncluded: number;
}

export interface AssembledPrompt {
  /** Full system prompt for Claude — the concatenation of all 4 layers. */
  systemPrompt: string;
  /** Ordered conversation history for the Claude messages array. */
  conversationHistory: ConversationMessage[];
  metadata: PromptMetadata;
}

// ── Constants ─────────────────────────────────────────────────

/** Maximum number of messages loaded from message_log for conversation history. */
export const MAX_HISTORY_MESSAGES = 20;

/**
 * First-message AI disclosure template.
 * {signoff_name} and {business_name} are placeholders replaced at assembly time.
 * Included in Layer 2 when customers.ai_disclosure_sent_at IS NULL.
 */
export const AI_DISCLOSURE_TEMPLATE =
  "Hey! I'm {signoff_name} with {business_name} — I handle just about everything here. Questions, scheduling, quotes, updates — just text me and I'll take care of it. If something needs the team's direct attention, I'll pull them in. Reply STOP anytime to opt out.";

/**
 * Layer 4 response format instruction appended to every system prompt.
 * Claude must return a JSON object matching the AIDecision schema.
 */
export const RESPONSE_FORMAT_INSTRUCTION =
  "Respond ONLY with a JSON object matching this schema. No markdown, no backticks, no preamble.";

// ── Function signature ────────────────────────────────────────

/**
 * Assemble the full prompt package for one AI response cycle.
 *
 * Reads business config, conversation state, customer record, and
 * recent message history from the store (Prisma in production).
 * Applies industry rules, state-specific instructions, and the
 * AI disclosure check.
 *
 * Throws if the businessId, conversationId, or customerId is not found.
 */
export type AssemblePromptFn = (context: PromptContext) => Promise<AssembledPrompt>;
