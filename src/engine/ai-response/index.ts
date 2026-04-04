// ============================================================
// src/engine/ai-response/index.ts
//
// AI RESPONSE GENERATOR — IMPLEMENTATION
//
// Pipeline:
//   1. Validate params via Zod.
//   2. Resolve customerId from conversation store.
//   3. Assemble prompt (Component 6).
//   4. Call Claude (injectable, with MAX_RETRIES=1 retry).
//   5. Parse JSON response; on failure retry then fallback.
//   6. Apply rule_flag overrides.
//   7. validateAIDecision() — pure validation.
//   8. Execute: state change, handoff, message record, queue row.
//   9. Log to prompt_log.
//  10. Return GenerateResponseResult.
// ============================================================

import { z } from "zod";
import {
  CONFIDENCE_THRESHOLD,
  FALLBACK_RESPONSE,
  MAX_RETRIES,
  AI_MODEL,
  type AIDecision,
  type ClaudeCallFn,
  type GenerateResponseParams,
  type GenerateResponseResult,
  type ValidationResult,
} from "./contract";
import {
  assemblePrompt,
  getConversationCustomerId,
  getConversationState,
  updateConversationState,
  updateConversationSummary,
  getConversationSummary,
  getConversationMessages,
} from "../prompt-assembly/index";
import { isValidTransition } from "../state-machine/index";
import {
  CUSTOMER_FACING_PURPOSES,
  INTERNAL_PURPOSES,
} from "../suppression/contract";
import type { ConversationState } from "../state-machine/contract";

// ── Zod validation ────────────────────────────────────────────

const GenerateResponseParamsSchema = z.object({
  businessId: z.string().min(1),
  conversationId: z.string().min(1),
  inboundMessageId: z.string().min(1),
});

// ── In-memory stores ──────────────────────────────────────────

interface OutboundMessageRecord {
  id: string;
  conversationId: string;
  businessId: string;
  direction: "outbound";
  senderType: "ai";
  content: string;
  messagePurpose: string;
  createdAt: Date;
}

interface QueueRowRecord {
  id: string;
  conversationId: string;
  messagePurpose: string;
  createdAt: Date;
}

interface HandoffRecord {
  id: string;
  conversationId: string;
  reason: string;
  createdAt: Date;
}

interface PromptLogRecord {
  id: string;
  conversationId: string;
  model: string;
  latencyMs: number;
  success: boolean;
  error?: string;
  createdAt: Date;
}

const _outboundMessages = new Map<string, OutboundMessageRecord>();
const _queueRows = new Map<string, QueueRowRecord>();
const _handoffs = new Map<string, HandoffRecord>();
const _promptLogs = new Map<string, PromptLogRecord>();

// ── Injectable Claude call ────────────────────────────────────

const _defaultClaudeCall: ClaudeCallFn = async (_systemPrompt, _history) => {
  throw new Error("No Claude call configured — use _setClaudeCallForTest in tests");
};

let _claudeCall: ClaudeCallFn = _defaultClaudeCall;

// ── Escalation notification (Finding 1) ──────────────────────

interface EscalationEvent {
  conversationId: string;
  businessId: string;
  notificationType: string;
  title: string;
  body: string;
}

type EscalationNotifyFn = (event: EscalationEvent) => Promise<void>;

// Default: no-op. Wire to deliverNotification in production-init.ts.
const _defaultEscalationNotify: EscalationNotifyFn = async (_event) => {};

let _escalationNotify: EscalationNotifyFn = _defaultEscalationNotify;

/** In-memory log of every escalation triggered — inspectable in tests. */
const _escalationEvents: EscalationEvent[] = [];

function _triggerEscalation(event: EscalationEvent): void {
  _escalationEvents.push({ ...event });
  void _escalationNotify(event).catch(() => {});
}

// ── Summary-regeneration call log (Finding 3) ────────────────

/** Tracks which conversationIds had regenerateSummary fired this session. */
const _summaryCalls: Array<{ conversationId: string }> = [];

// ── Canonical purpose set ─────────────────────────────────────

const ALL_PURPOSES = new Set<string>([
  ...CUSTOMER_FACING_PURPOSES,
  ...INTERNAL_PURPOSES,
]);

// ── ID generator ──────────────────────────────────────────────

function _genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── JSON parser (strips markdown code fences if present) ──────

function _parseDecision(raw: string): AIDecision | null {
  let text = raw.trim();
  // Strip markdown fences e.g. ```json ... ```
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(text) as AIDecision;
  } catch {
    return null;
  }
}

// ── validateAIDecision — pure function ────────────────────────

export function validateAIDecision(
  decision: AIDecision,
  conversationState: string,
): ValidationResult {
  const errors: string[] = [];

  // Confidence check
  const confidencePassed = decision.confidence >= CONFIDENCE_THRESHOLD;
  if (!confidencePassed) {
    errors.push(
      `Confidence ${decision.confidence} is below threshold ${CONFIDENCE_THRESHOLD}`,
    );
  }

  // State transition check
  let stateChangeAllowed = false;
  if (decision.proposed_state_change === null) {
    stateChangeAllowed = true; // no change proposed — trivially allowed
  } else {
    stateChangeAllowed = isValidTransition(
      conversationState as ConversationState,
      decision.proposed_state_change as ConversationState,
    );
    if (!stateChangeAllowed) {
      errors.push(
        `Invalid transition: ${conversationState} → ${decision.proposed_state_change}`,
      );
    }
  }

  // Handoff validity check
  let handoffValid = true;
  if (decision.handoff_required) {
    if (!decision.handoff_reason || decision.handoff_reason.trim() === "") {
      handoffValid = false;
      errors.push("handoff_required is true but handoff_reason is null or empty");
    }
  }

  const isValid = confidencePassed && stateChangeAllowed && handoffValid;

  return {
    isValid,
    stateChangeAllowed,
    handoffValid,
    prohibitionViolation: false,
    confidencePassed,
    errors,
  };
}

// ── generateAIResponse ────────────────────────────────────────

export async function generateAIResponse(
  params: GenerateResponseParams,
): Promise<GenerateResponseResult> {
  // 1. Validate params
  GenerateResponseParamsSchema.parse(params);

  if (process.env.NODE_ENV !== "test") {
    return _generateAIResponseFromDb(params);
  }

  const { businessId, conversationId, inboundMessageId } = params;

  // 2. Resolve customerId
  const customerId = getConversationCustomerId(conversationId);
  if (!customerId) {
    return {
      success: false,
      stateChanged: false,
      handoffCreated: false,
      error: `Customer not found for conversation ${conversationId}`,
    };
  }

  // 3. Assemble prompt
  let systemPrompt: string;
  let conversationHistory: { role: "user" | "assistant"; content: string }[];
  try {
    const assembled = await assemblePrompt({
      businessId,
      conversationId,
      customerId,
      inboundMessageId,
    });
    systemPrompt = assembled.systemPrompt;
    conversationHistory = assembled.conversationHistory.map((m) => ({
      role: m.role,
      content: m.content,
    }));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { success: false, stateChanged: false, handoffCreated: false, error: errMsg };
  }

  // 4 & 5. Call Claude with retry, parse JSON
  const startTime = Date.now();
  let decision: AIDecision | null = null;
  let lastError: string | undefined;
  let callCount = 0;
  const maxAttempts = MAX_RETRIES + 1; // 1 retry = 2 total attempts

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      callCount++;
      const raw = await _claudeCall(systemPrompt, conversationHistory);
      decision = _parseDecision(raw);
      if (decision !== null) break;
      lastError = "Failed to parse AI response as JSON";
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      decision = null;
    }
  }

  const latencyMs = Date.now() - startTime;

  // ── FALLBACK PATH ─────────────────────────────────────────────
  if (decision === null) {
    const msgId = _genId("msg");
    const queueId = _genId("queue");
    const logId = _genId("log");

    // Production: db.messages.create({ ... })
    _outboundMessages.set(msgId, {
      id: msgId,
      conversationId,
      businessId,
      direction: "outbound",
      senderType: "ai",
      content: FALLBACK_RESPONSE,
      messagePurpose: "admin_response_relay",
      createdAt: new Date(),
    });

    // Production: db.outbound_queue.create({ ... })
    _queueRows.set(queueId, {
      id: queueId,
      conversationId,
      messagePurpose: "admin_response_relay",
      createdAt: new Date(),
    });

    // Production: db.prompt_logs.create({ ... })
    _promptLogs.set(logId, {
      id: logId,
      conversationId,
      model: AI_MODEL,
      latencyMs,
      success: false,
      error: lastError,
      createdAt: new Date(),
    });

    return {
      success: false,
      stateChanged: false,
      handoffCreated: false,
      messageLogId: msgId,
      queueRowId: queueId,
      error: lastError,
    };
  }

  // ── 6. Apply rule_flag overrides ──────────────────────────────

  const flags = decision.rule_flags ?? [];
  let forceHandoff = decision.handoff_required;
  let forceHandoffReason = decision.handoff_reason;
  let forceStateChange: string | null = decision.proposed_state_change;

  if (flags.includes("human_requested") || flags.includes("aggressive_message")) {
    forceHandoff = true;
    forceHandoffReason = forceHandoffReason ?? "Rule flag triggered: " + flags.join(", ");
  }

  if (flags.includes("out_of_area")) {
    forceStateChange = "waiting_on_approval";
  }

  // ── Finding 1: knowledge-gap escalation ──────────────────────────────────
  // Detect when Claude signals it doesn't know something and ensure handoff +
  // admin notification always fires, regardless of what rule_flags said.
  {
    const tentativeIntent = decision.detected_intent ?? "";
    const tentativeReason = forceHandoffReason ?? "";
    const hasKnowledgeGap =
      /unknown|escalate|unsure/i.test(tentativeIntent) ||
      (forceHandoff &&
        /don['']t know|not sure|check with team/i.test(tentativeReason));

    if (hasKnowledgeGap) {
      forceHandoff = true;
      forceHandoffReason = forceHandoffReason ?? "ai_knowledge_gap";

      // Body = the customer's triggering message
      const msgs = getConversationMessages(conversationId);
      const inboundMsg = msgs.find((m) => m.id === inboundMessageId);
      const notifBody = inboundMsg?.content ?? "(no message content)";

      _triggerEscalation({
        conversationId,
        businessId,
        notificationType: "new_approval_request",
        title: "AI needs help",
        body: notifBody,
      });
    }
  }

  // Merge overrides back into decision
  const effectiveDecision: AIDecision = {
    ...decision,
    handoff_required: forceHandoff,
    handoff_reason: forceHandoffReason,
    proposed_state_change: forceStateChange,
  };

  // ── 7. Validate ────────────────────────────────────────────────

  const conversationState = getConversationState(conversationId) ?? "new_lead";
  const validation = validateAIDecision(effectiveDecision, conversationState);

  // ── 8a. Determine response text ───────────────────────────────

  let responseText = effectiveDecision.response_text;
  if (!validation.confidencePassed) {
    responseText = FALLBACK_RESPONSE;
  }

  // ── 8b. Normalize message_purpose ─────────────────────────────

  const rawPurpose = effectiveDecision.message_purpose;
  const messagePurpose = ALL_PURPOSES.has(rawPurpose) ? rawPurpose : "admin_response_relay";

  // ── 8c. State change ──────────────────────────────────────────

  let stateChanged = false;
  let newState: string | undefined;

  if (effectiveDecision.proposed_state_change !== null && validation.stateChangeAllowed) {
    updateConversationState(conversationId, effectiveDecision.proposed_state_change);
    stateChanged = true;
    newState = effectiveDecision.proposed_state_change;
  } else if (flags.includes("out_of_area")) {
    // out_of_area forces waiting_on_approval regardless of normal validation
    updateConversationState(conversationId, "waiting_on_approval");
    stateChanged = true;
    newState = "waiting_on_approval";
  }

  // ── Finding 3: fire summary regeneration after any state change ──────────
  // Fire-and-forget — failure here must never fail the main response.
  if (stateChanged) {
    _summaryCalls.push({ conversationId });
    void regenerateSummary(conversationId).catch(() => {});
  }

  // ── 8d. Handoff ───────────────────────────────────────────────

  let handoffCreated = false;

  if (forceHandoff) {
    const handoffId = _genId("handoff");
    // Production: db.handoffs.create({ ... })
    _handoffs.set(handoffId, {
      id: handoffId,
      conversationId,
      reason: forceHandoffReason ?? "unspecified",
      createdAt: new Date(),
    });
    handoffCreated = true;
  }

  // ── 8e. Store outbound message ────────────────────────────────

  const msgId = _genId("msg");
  // Production: db.messages.create({ ... })
  _outboundMessages.set(msgId, {
    id: msgId,
    conversationId,
    businessId,
    direction: "outbound",
    senderType: "ai",
    content: responseText,
    messagePurpose,
    createdAt: new Date(),
  });

  // ── 8f. Queue row ─────────────────────────────────────────────

  const queueId = _genId("queue");
  // Production: db.outbound_queue.create({ ... })
  _queueRows.set(queueId, {
    id: queueId,
    conversationId,
    messagePurpose,
    createdAt: new Date(),
  });

  // ── 9. Log to prompt_log ──────────────────────────────────────

  const logId = _genId("log");
  // Production: db.prompt_logs.create({ ... })
  _promptLogs.set(logId, {
    id: logId,
    conversationId,
    model: AI_MODEL,
    latencyMs,
    success: true,
    createdAt: new Date(),
  });

  return {
    success: true,
    decision: effectiveDecision,
    messageLogId: msgId,
    queueRowId: queueId,
    stateChanged,
    newState,
    handoffCreated,
  };
}

// ── regenerateSummary ─────────────────────────────────────────

// ── Production Prisma implementation ─────────────────────────

async function _generateAIResponseFromDb(
  params: GenerateResponseParams,
): Promise<GenerateResponseResult> {
  const { db } = await import("~/server/db");
  const { businessId, conversationId, inboundMessageId } = params;

  // Resolve customerId from DB.
  const convRow = await db.conversations.findUnique({
    where: { id: conversationId },
    select: { customer_id: true, primary_state: true },
  });
  if (!convRow) {
    return { success: false, stateChanged: false, handoffCreated: false, error: `Customer not found for conversation ${conversationId}` };
  }
  const customerId = convRow.customer_id;
  const conversationState = convRow.primary_state as string;

  // Assemble prompt (will use Prisma in production since NODE_ENV !== "test").
  let systemPrompt: string;
  let conversationHistory: { role: "user" | "assistant"; content: string }[];
  try {
    const assembled = await assemblePrompt({ businessId, conversationId, customerId, inboundMessageId });
    systemPrompt = assembled.systemPrompt;
    conversationHistory = assembled.conversationHistory.map((m) => ({ role: m.role, content: m.content }));
  } catch (err) {
    return { success: false, stateChanged: false, handoffCreated: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Call Claude with retry.
  const { productionClaudeCall } = await import("~/engine/claude-client");
  const startTime = Date.now();
  let decision: AIDecision | null = null;
  let lastError: string | undefined;
  const maxAttempts = MAX_RETRIES + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const raw = await productionClaudeCall(systemPrompt, conversationHistory);
      decision = _parseDecision(raw);
      if (decision !== null) break;
      lastError = "Failed to parse AI response as JSON";
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      decision = null;
    }
  }

  const latencyMs = Date.now() - startTime;

  // FALLBACK PATH
  if (decision === null) {
    const { msgId, queueId } = await db.$transaction(async (tx) => {
      const msg = await tx.message_log.create({ data: { business_id: businessId, conversation_id: conversationId, direction: "outbound", channel: "sms", sender_type: "ai", content: FALLBACK_RESPONSE } });
      const q = await tx.outbound_queue.create({ data: { business_id: businessId, conversation_id: conversationId, message_purpose: "admin_response_relay", audience_type: "customer", channel: "sms", dedupe_key: `fallback:${Date.now()}`, scheduled_send_at: new Date() } });
      await tx.prompt_log.create({ data: { business_id: businessId, conversation_id: conversationId, prompt_purpose: "ai_response", prompt_text: (systemPrompt ?? "").slice(0, 2000), response_text: lastError ?? "", model: AI_MODEL, latency_ms: latencyMs, success: false, error_message: lastError } });
      return { msgId: msg.id, queueId: q.id };
    });
    return { success: false, stateChanged: false, handoffCreated: false, messageLogId: msgId, queueRowId: queueId, error: lastError };
  }

  // Apply rule_flag overrides.
  const flags = decision.rule_flags ?? [];
  let forceHandoff = decision.handoff_required;
  let forceHandoffReason = decision.handoff_reason;
  let forceStateChange: string | null = decision.proposed_state_change;

  if (flags.includes("human_requested") || flags.includes("aggressive_message")) {
    forceHandoff = true;
    forceHandoffReason = forceHandoffReason ?? "Rule flag triggered: " + flags.join(", ");
  }
  if (flags.includes("out_of_area")) {
    forceStateChange = "waiting_on_approval";
  }

  // Knowledge-gap escalation.
  const tentativeIntent = decision.detected_intent ?? "";
  const tentativeReason = forceHandoffReason ?? "";
  const hasKnowledgeGap = /unknown|escalate|unsure/i.test(tentativeIntent) || (forceHandoff && /don['']t know|not sure|check with team/i.test(tentativeReason));
  if (hasKnowledgeGap) {
    forceHandoff = true;
    forceHandoffReason = forceHandoffReason ?? "ai_knowledge_gap";
    const inboundMsg = await db.message_log.findUnique({ where: { id: inboundMessageId }, select: { content: true } });
    _triggerEscalation({ conversationId, businessId, notificationType: "new_approval_request", title: "AI needs help", body: inboundMsg?.content ?? "(no message content)" });
  }

  const effectiveDecision: AIDecision = { ...decision, handoff_required: forceHandoff, handoff_reason: forceHandoffReason, proposed_state_change: forceStateChange };

  // Validate.
  const validation = validateAIDecision(effectiveDecision, conversationState);

  let responseText = effectiveDecision.response_text;
  if (!validation.confidencePassed) responseText = FALLBACK_RESPONSE;

  const rawPurpose = effectiveDecision.message_purpose;
  const messagePurpose = ALL_PURPOSES.has(rawPurpose) ? rawPurpose : "admin_response_relay";

  // State change.
  let stateChanged = false;
  let newState: string | undefined;
  if (effectiveDecision.proposed_state_change !== null && validation.stateChangeAllowed) {
    await db.conversations.update({ where: { id: conversationId }, data: { primary_state: effectiveDecision.proposed_state_change as any } });
    stateChanged = true;
    newState = effectiveDecision.proposed_state_change;
    // Update in-memory for same-request consistency.
    updateConversationState(conversationId, effectiveDecision.proposed_state_change);
  } else if (flags.includes("out_of_area")) {
    await db.conversations.update({ where: { id: conversationId }, data: { primary_state: "waiting_on_approval" as any } });
    stateChanged = true;
    newState = "waiting_on_approval";
    updateConversationState(conversationId, "waiting_on_approval");
  }

  if (stateChanged) {
    _summaryCalls.push({ conversationId });
    void regenerateSummary(conversationId).catch(() => {});
  }

  // Handoff.
  let handoffCreated = false;
  if (forceHandoff) {
    await db.escalations.create({ data: { business_id: businessId, conversation_id: conversationId, category: "complaint" as any, status: "open" } });
    handoffCreated = true;
  }

  // Store outbound message + queue row + prompt log in a transaction.
  const { msgId, queueId } = await db.$transaction(async (tx) => {
    const msg = await tx.message_log.create({ data: { business_id: businessId, conversation_id: conversationId, direction: "outbound", channel: "sms", sender_type: "ai", content: responseText } });
    const q = await tx.outbound_queue.create({ data: { business_id: businessId, conversation_id: conversationId, message_purpose: messagePurpose, audience_type: "customer", channel: "sms", dedupe_key: `ai:${conversationId}:${Date.now()}`, scheduled_send_at: new Date() } });
    await tx.prompt_log.create({ data: { business_id: businessId, conversation_id: conversationId, prompt_purpose: "ai_response", prompt_text: systemPrompt.slice(0, 2000), response_text: responseText.slice(0, 2000), model: AI_MODEL, latency_ms: latencyMs, success: true } });
    return { msgId: msg.id, queueId: q.id };
  });

  // Update stores for test-like consistency in production (no-op in prod since they're empty).
  _outboundMessages.set(msgId, { id: msgId, conversationId, businessId, direction: "outbound", senderType: "ai", content: responseText, messagePurpose, createdAt: new Date() });
  _queueRows.set(queueId, { id: queueId, conversationId, messagePurpose, createdAt: new Date() });

  return { success: true, decision: effectiveDecision, messageLogId: msgId, queueRowId: queueId, stateChanged, newState, handoffCreated };
}

export async function regenerateSummary(conversationId: string): Promise<boolean> {
  // Fetch recent messages for summary context
  const messages = getConversationMessages(conversationId);
  const historyText = messages
    .map((m) => `${m.direction === "inbound" ? "Customer" : "AI"}: ${m.content}`)
    .join("\n");

  const systemPrompt = "Summarize the following conversation in one sentence for internal CRM context.";
  const history: { role: "user" | "assistant"; content: string }[] = [
    { role: "user", content: historyText || "(no messages)" },
  ];

  // Preserve existing summary before attempt
  const existingSummary = getConversationSummary(conversationId);

  const claudeCallFn =
    process.env.NODE_ENV !== "test"
      ? (await import("~/engine/claude-client")).productionSummaryCall
      : _claudeCall;

  try {
    const summary = await claudeCallFn(systemPrompt, history);
    if (!summary || summary.trim() === "") return false;
    // Production: db.conversations.update({ where: { id: conversationId }, data: { cached_summary: summary } })
    updateConversationSummary(conversationId, summary.trim());
    return true;
  } catch {
    // Restore existing summary (it may already be intact, but be explicit)
    if (existingSummary !== null) {
      updateConversationSummary(conversationId, existingSummary);
    }
    return false;
  }
}

// ── Test helpers ──────────────────────────────────────────────

export function _resetAIResponseStoreForTest(): void {
  _outboundMessages.clear();
  _queueRows.clear();
  _handoffs.clear();
  _promptLogs.clear();
  _claudeCall = _defaultClaudeCall;
  _escalationEvents.length = 0;
  _escalationNotify = _defaultEscalationNotify;
  _summaryCalls.length = 0;
}

export function _setClaudeCallForTest(fn: ClaudeCallFn): void {
  _claudeCall = fn;
}

export function _getOutboundMessageForTest(
  messageLogId: string,
): OutboundMessageRecord | undefined {
  return _outboundMessages.get(messageLogId);
}

export function _getPromptLogForTest(
  conversationId: string,
): PromptLogRecord | undefined {
  // Return the most recent log for this conversation
  const logs = [..._promptLogs.values()]
    .filter((l) => l.conversationId === conversationId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return logs[0];
}

export function _getHandoffForTest(
  conversationId: string,
): HandoffRecord | undefined {
  const handoffs = [..._handoffs.values()].filter(
    (h) => h.conversationId === conversationId,
  );
  return handoffs[0];
}

export function _getConversationSummaryForTest(
  conversationId: string,
): string | null {
  return getConversationSummary(conversationId);
}

// ── Escalation + summary test helpers (Findings 1 & 3) ───────

export function _getEscalationEventsForTest(): readonly EscalationEvent[] {
  return _escalationEvents;
}

export function _setEscalationNotifyForTest(fn: EscalationNotifyFn): void {
  _escalationNotify = fn;
}

export function _getSummaryCallsForTest(): readonly { conversationId: string }[] {
  return _summaryCalls;
}
