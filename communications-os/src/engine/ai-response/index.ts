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
  channel: z.string().optional(),
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
  // First attempt: parse as-is
  try {
    return JSON.parse(text) as AIDecision;
  } catch {
    // Second attempt: extract the outermost JSON object by finding first { and last }
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as AIDecision;
      } catch {
        // JSON structure found but malformed — fall through to plain text recovery
      }
    }

    // Third attempt: plain text recovery.
    // Claude returned a natural language response instead of JSON.
    // Synthesize a valid decision object so the customer still gets
    // the AI's actual message instead of a generic fallback.
    if (text.length > 5 && !text.startsWith("{")) {
      console.warn("[ai-response] PLAIN TEXT RECOVERY — Claude returned text instead of JSON, synthesizing decision from:", text.slice(0, 150));
      return {
        response_text: text,
        proposed_state_change: null,
        handoff_required: false,
        handoff_reason: null,
        message_purpose: "general_reply",
        requested_data_fields: [],
        detected_intent: "general_inquiry",
        confidence: 0.7,
        rule_flags: [],
        is_first_message: false,
      };
    }

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

  const { businessId, conversationId, inboundMessageId, channel } = params;

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
      channel,
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
      replyText: FALLBACK_RESPONSE,
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
    replyText: responseText,
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
  const { businessId, conversationId, inboundMessageId, channel } = params;

  // Resolve customerId from DB.
  console.log("[ai-response] starting for conversation:", conversationId);
  const convRow = await db.conversations.findUnique({
    where: { id: conversationId },
    select: { customer_id: true, primary_state: true },
  });
  if (!convRow) {
    console.error("[ai-response] conversation not found:", conversationId);
    return { success: false, stateChanged: false, handoffCreated: false, error: `Customer not found for conversation ${conversationId}` };
  }
  const customerId = convRow.customer_id;
  const conversationState = convRow.primary_state as string;
  console.log("[ai-response] conversation found, state:", conversationState, "customerId:", customerId);

  // Assemble prompt (will use Prisma in production since NODE_ENV !== "test").
  let systemPrompt: string;
  let conversationHistory: { role: "user" | "assistant"; content: string }[];
  try {
    const assembled = await assemblePrompt({ businessId, conversationId, customerId, inboundMessageId, channel });
    systemPrompt = assembled.systemPrompt;
    conversationHistory = assembled.conversationHistory.map((m) => ({ role: m.role, content: m.content }));
    console.log("[ai-response] prompt assembled, system length:", systemPrompt.length, "history messages:", conversationHistory.length);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[ai-response] assemblePrompt failed:", msg);
    return { success: false, stateChanged: false, handoffCreated: false, error: msg };
  }

  // Call Claude with retry.
  const { productionClaudeCall } = await import("~/engine/claude-client");
  const startTime = Date.now();
  let decision: AIDecision | null = null;
  let lastError: string | undefined;
  const maxAttempts = MAX_RETRIES + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    console.log("[ai-response] claude call attempt", attempt + 1, "of", maxAttempts);
    try {
      const raw = await productionClaudeCall(systemPrompt, conversationHistory);
      console.log("[ai-response] claude raw response (first 300 chars):", raw.slice(0, 300));
      decision = _parseDecision(raw);
      if (decision !== null) {
        console.log("[ai-response] decision parsed successfully, confidence:", decision.confidence, "intent:", decision.detected_intent, "bookingConfirmed:", decision.bookingConfirmed, "selectedSlot:", decision.selectedSlot);
        break;
      }
      lastError = "Failed to parse AI response as JSON";
      console.warn("[ai-response] parse failed, raw was:", raw.slice(0, 500));
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error("[ai-response] claude call threw:", lastError);
      decision = null;
    }
  }

  const latencyMs = Date.now() - startTime;
  console.log("[ai-response] claude total latency:", latencyMs, "ms, decision:", decision !== null ? "ok" : "null");

  // FALLBACK PATH — check for fallback loop before sending another generic message
  if (decision === null) {
    console.error("[ai-response] entering fallback path, lastError:", lastError);

    // Detect fallback loop: check if ANY recent assistant message was a fallback/recovery.
    // This catches alternating patterns (fallback → recovery → fallback → ...).
    const recentMessages = conversationHistory.slice(-6);
    const recentAssistantMsgs = recentMessages.filter((m) => m.role === "assistant");
    const fallbackCount = recentAssistantMsgs.filter((m) =>
      m.content === FALLBACK_RESPONSE ||
      m.content.includes("let me connect you with our team") ||
      m.content.includes("Our team has been notified")
    ).length;
    const isInFallbackLoop = fallbackCount >= 1;

    let fallbackText: string;
    if (isInFallbackLoop) {
      console.error("[ai-response] FALLBACK LOOP DETECTED — fallbackCount:", fallbackCount, "in last", recentAssistantMsgs.length, "assistant messages");
      fallbackText = "I'm sorry for the trouble — let me connect you with our team directly. Someone will reach out to you shortly!";
    } else {
      fallbackText = FALLBACK_RESPONSE;
    }

    const { msgId, queueId } = await db.$transaction(async (tx) => {
      const msg = await tx.message_log.create({ data: { business_id: businessId, conversation_id: conversationId, direction: "outbound", channel: "sms", sender_type: "ai", content: fallbackText } });
      const q = await tx.outbound_queue.create({ data: { business_id: businessId, conversation_id: conversationId, message_purpose: "admin_response_relay", audience_type: "customer", channel: "sms", dedupe_key: `fallback:${Date.now()}`, scheduled_send_at: new Date() } });
      await tx.prompt_log.create({ data: { business_id: businessId, conversation_id: conversationId, prompt_purpose: "ai_response", prompt_text: (systemPrompt ?? "").slice(0, 2000), response_text: lastError ?? "", model: AI_MODEL, latency_ms: latencyMs, success: false, error_message: lastError } });
      return { msgId: msg.id, queueId: q.id };
    });

    // On fallback loop, escalate so a human can step in
    if (isInFallbackLoop) {
      try {
        await db.escalations.create({ data: { business_id: businessId, conversation_id: conversationId, category: "complaint" as any, status: "open" } });
      } catch { /* escalation creation is non-critical */ }
    }

    return { success: false, stateChanged: false, handoffCreated: false, replyText: fallbackText, messageLogId: msgId, queueRowId: queueId, error: lastError };
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

  console.log('[ai-response] parsed decision:', JSON.stringify(effectiveDecision, null, 2));

  // ── AI Booking Pipeline — Two-Step Slot Flow ────────────────────────────
  // Step 1: bookingConfirmed + no selectedSlot → generate slots, present to customer
  // Step 2: bookingConfirmed + selectedSlot → book that exact slot
  console.log('[ai-response] booking check:', {
    bookingConfirmed: effectiveDecision.bookingConfirmed,
    selectedSlot: effectiveDecision.selectedSlot,
    ruleFlags: effectiveDecision.rule_flags,
    proposedState: effectiveDecision.proposed_state_change,
  });
  const bookingTriggered = effectiveDecision.bookingConfirmed === true || flags.includes("booking_confirmed");
  const selectedSlotIndex = effectiveDecision.selectedSlot ?? null;
  let bookingResponseOverride: string | null = null;

  if (bookingTriggered) {
    const bookingStartTime = Date.now();
    try {
      const { generateAvailableSlots, bookSelectedSlot } = await import("~/engine/scheduling/ai-booking-pipeline");
      const { createBookingOrchestratorDb, createCapacityDb } = await import("~/engine/scheduling/prisma-scheduling-adapter");
      const { randomUUID } = await import("crypto");

      // Gather customer data from the decision and conversation
      const collectedName = effectiveDecision.collected_name
        ?? (effectiveDecision as unknown as Record<string, unknown>)["collectedName"] as string | null | undefined;
      const collectedAddress = effectiveDecision.collected_service_address
        ?? (effectiveDecision as unknown as Record<string, unknown>)["collected_service_address"] as string | null | undefined;
      const availabilityPref = effectiveDecision.availability_preference ?? null;
      const availabilityCutoff = effectiveDecision.availability_cutoff_time ?? null;

      // Persist address and/or cutoff time if collected this turn
      const persistData: Record<string, unknown> = {};
      if (collectedAddress) persistData.collected_service_address = collectedAddress;
      if (availabilityCutoff) persistData.availability_cutoff_time = availabilityCutoff;
      if (Object.keys(persistData).length > 0) {
        await db.conversations.update({
          where: { id: conversationId },
          data: persistData,
        });
      }

      // Look up customer name
      let customerName = collectedName ?? "";
      if (!customerName) {
        const convTitle = await db.conversations.findUnique({
          where: { id: conversationId },
          select: { contact_display_name: true },
        });
        customerName = convTitle?.contact_display_name ?? "Customer";
      }

      // ── STEP 2: Customer selected a slot → book it ─────────────────
      if (selectedSlotIndex !== null && selectedSlotIndex > 0) {
        console.log("[ai-response] STEP 2 — booking selected slot:", selectedSlotIndex);

        // Load stored slots from conversation
        const convSlots = await db.conversations.findUnique({
          where: { id: conversationId },
        }) as unknown as { pending_booking_slots?: unknown } | null;
        const storedSlots = (Array.isArray(convSlots?.pending_booking_slots) ? convSlots.pending_booking_slots : []) as Array<Record<string, unknown>>;

        if (storedSlots.length === 0) {
          console.warn("[ai-response] no stored slots found for selection");
          bookingResponseOverride = "I don't have any available slots on file. Let me check availability again — one moment.";
          // Force back to step 1 by clearing selectedSlot
          effectiveDecision.proposed_state_change = null;
        } else {
          const pickedSlot = storedSlots.find((s) => s.index === selectedSlotIndex) as unknown as import("~/engine/scheduling/ai-booking-pipeline").AvailableSlot | undefined;
          if (!pickedSlot) {
            bookingResponseOverride = `That option isn't available. Please pick a number between 1 and ${storedSlots.length} from the list above.`;
            effectiveDecision.proposed_state_change = null;
          } else {
            // Look up address
            let addressText = collectedAddress ?? "";
            if (!addressText) {
              const convAddr = await db.conversations.findUnique({
                where: { id: conversationId },
                select: { collected_service_address: true },
              });
              addressText = convAddr?.collected_service_address ?? "";
            }

            const bookingDb = createBookingOrchestratorDb(db);
            const result = await bookSelectedSlot({
              businessId,
              customerId,
              customerName,
              addressText,
              slot: pickedSlot,
            }, {
              bookingDb,
              generateId: () => randomUUID(),
            });

            if (result.booked) {
              // Format date relative to today
              const now = new Date();
              const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate());
              const schedMid = new Date(result.scheduledDate.getFullYear(), result.scheduledDate.getMonth(), result.scheduledDate.getDate());
              const dayDiff = Math.round((schedMid.getTime() - todayMid.getTime()) / 86400000);
              let dateStr: string;
              if (dayDiff === 0) dateStr = "today";
              else if (dayDiff === 1) dateStr = "tomorrow";
              else dateStr = result.scheduledDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

              const queueNote = result.queuePosition === 0 ? " You're first on the schedule." : result.queuePosition === 1 ? " You're second on the schedule." : "";

              let bizPhone = "";
              try {
                const biz = await db.businesses.findUnique({ where: { id: businessId }, select: { preferred_phone_number: true } });
                if (biz?.preferred_phone_number) bizPhone = ` If anything changes, reach us at ${biz.preferred_phone_number}.`;
              } catch { /* non-critical */ }

              bookingResponseOverride = `Great news, ${customerName}! Your appointment is booked — ${result.techName} will be heading your way ${dateStr}.${queueNote} We'll send you a heads-up when they're on the way.${bizPhone}`;
              console.log("[ai-response] STEP 2 SUCCESS — jobId:", result.jobId, "tech:", result.techName, "date:", dateStr);

              // Clear stored slots
              await db.conversations.update({
                where: { id: conversationId },
                data: { pending_booking_slots: null } as never,
              });
            } else {
              bookingResponseOverride = `That slot is no longer available — someone else may have grabbed it. Let me check for updated availability.`;
              effectiveDecision.proposed_state_change = null;
              console.warn("[ai-response] STEP 2 booking failed:", result.reason);
            }
          }
        }

      // ── STEP 1: Generate slots and present to customer ─────────────
      } else {
        console.log("[ai-response] STEP 1 — generating available slots");
        console.log("[ai-response] STEP 1 inputs:", {
          businessId,
          serviceDescription: effectiveDecision.detected_intent ?? "(none)",
          availabilityPref,
          conversationState,
        });

        const serviceDescription = effectiveDecision.detected_intent ?? "";
        const capacityDb = createCapacityDb(db);

        const slotDeps = {
          capacityDb,
          async getTechCandidates(bizId: string) {
            console.log("[ai-response] STEP 1 — querying technicians for business:", bizId);
            const techs = await db.technicians.findMany({
              where: { business_id: bizId, is_active: true },
              include: { skill_tags: true, scheduling_jobs: { where: { status: { in: ["NOT_STARTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"] }, scheduled_date: new Date() }, select: { id: true } } },
            });
            console.log("[ai-response] STEP 1 — found", techs.length, "active techs:", techs.map((t) => ({ id: t.id, name: t.name, skills: t.skill_tags.map((s: { service_type_id: string }) => s.service_type_id) })));
            return techs.map((t) => ({
              id: t.id,
              businessId: t.business_id,
              name: t.name,
              homeBaseLat: t.home_base_lat,
              homeBaseLng: t.home_base_lng,
              skillTags: t.skill_tags.map((s: { service_type_id: string }) => s.service_type_id),
              workingHoursStart: t.working_hours_start,
              workingHoursEnd: t.working_hours_end,
              lunchStart: t.lunch_start,
              lunchEnd: t.lunch_end,
              overtimeCapMinutes: t.overtime_cap_minutes,
              isActive: t.is_active,
              existingJobsToday: t.scheduling_jobs.length,
            }));
          },
          async getServiceTypes(bizId: string) {
            console.log("[ai-response] STEP 1 — querying service types for business:", bizId);
            const rows = await db.service_types.findMany({ where: { business_id: bizId } });
            console.log("[ai-response] STEP 1 — found", rows.length, "service types:", rows.map((r) => ({ id: r.id, name: r.name })));
            return rows.map((r) => ({
              id: r.id,
              name: r.name,
              industry: r.industry,
              baseDurationMinutes: r.base_duration_minutes,
              volatilityTier: r.volatility_tier as "LOW" | "MEDIUM" | "HIGH",
              symptomPhrases: Array.isArray(r.symptom_phrases) ? r.symptom_phrases as string[] : [],
              propertyTypeVariants: r.property_type_variants as Record<string, number> | undefined,
            }));
          },
          async getBusinessIndustry(bizId: string) {
            console.log("[ai-response] STEP 1 — querying business industry for:", bizId);
            const biz = await db.businesses.findUnique({ where: { id: bizId }, select: { industry: true } });
            if (!biz) {
              console.error("[ai-response] STEP 1 — business not found:", bizId);
              return "general";
            }
            console.log("[ai-response] STEP 1 — business industry:", biz.industry);
            return biz.industry;
          },
          async getQueueForTechDate(technicianId: string, date: Date) {
            const { createBookingOrchestratorDb: createBODb } = await import("~/engine/scheduling/prisma-scheduling-adapter");
            const boDb = createBODb(db);
            return boDb.getQueueForTechDate(technicianId, date);
          },
        };

        // Send a holding message so the customer sees something while we compute slots.
        // This is stored in message_log so it shows in conversation history.
        console.log("[ai-response] STEP 1 — sending holding message before slot computation");
        try {
          await db.message_log.create({
            data: {
              business_id: businessId,
              conversation_id: conversationId,
              direction: "outbound",
              channel: "sms",
              sender_type: "ai",
              content: "Let me check what's available for you...",
            },
          });
        } catch (holdingErr) {
          console.warn("[ai-response] STEP 1 — holding message failed (non-critical):", holdingErr);
        }

        // Load cutoff time — may have been set in a prior turn
        let cutoffTime = availabilityCutoff;
        if (!cutoffTime) {
          const convCutoff = await db.conversations.findUnique({
            where: { id: conversationId },
            select: { availability_cutoff_time: true },
          }) as unknown as { availability_cutoff_time?: string | null } | null;
          cutoffTime = convCutoff?.availability_cutoff_time ?? null;
        }

        // Run slot generation with a 15-second timeout
        console.log("[ai-response] STEP 1 — calling generateAvailableSlots (15s timeout)...");
        const SLOT_TIMEOUT_MS = 15000;
        const slotPromise = generateAvailableSlots({
          businessId,
          serviceDescription,
          availabilityPreference: availabilityPref,
          availabilityCutoffTime: cutoffTime,
        }, slotDeps);
        const slotTimeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Slot generation timed out after ${SLOT_TIMEOUT_MS}ms`)), SLOT_TIMEOUT_MS)
        );

        let slotResult: Awaited<ReturnType<typeof generateAvailableSlots>>;
        try {
          slotResult = await Promise.race([slotPromise, slotTimeout]);
        } catch (timeoutErr) {
          const tMsg = timeoutErr instanceof Error ? timeoutErr.message : String(timeoutErr);
          console.error("[ai-response] STEP 1 — SLOT GENERATION TIMED OUT:", tMsg);
          bookingResponseOverride = "I'm having trouble checking our schedule right now — let me have someone from the team reach out to you directly to get your appointment set up.";
          effectiveDecision.proposed_state_change = null;
          effectiveDecision.handoff_required = true;
          effectiveDecision.handoff_reason = `Slot generation timeout: ${tMsg}`;
          // Skip the rest of Step 1
          slotResult = { success: false, reason: tMsg };
        }
        console.log("[ai-response] STEP 1 — generateAvailableSlots returned:", slotResult.success ? `${(slotResult as { slots: unknown[] }).slots.length} slots` : `failed: ${(slotResult as { reason: string }).reason}`);

        if (slotResult.success && !bookingResponseOverride) {
          // Store slots on conversation for step 2
          await db.conversations.update({
            where: { id: conversationId },
            data: { pending_booking_slots: slotResult.slots as unknown } as never,
          });

          // Format as numbered list
          const slotLines = slotResult.slots.map((s) => `${s.index}. ${s.label}`);
          bookingResponseOverride = `Here are the available time slots:\n\n${slotLines.join("\n")}\n\nWhich option works best for you? Just reply with the number.`;

          // Force state to stay in booking_in_progress — do NOT transition to booked yet
          effectiveDecision.proposed_state_change = null;
          console.log("[ai-response] STEP 1 — presented", slotResult.slots.length, "slots");
        } else if (!bookingResponseOverride) {
          bookingResponseOverride = `I wasn't able to find available time slots right now. Our team will follow up with you shortly to get your appointment scheduled.`;
          effectiveDecision.proposed_state_change = null;
          console.warn("[ai-response] STEP 1 — no slots:", (slotResult as { reason: string }).reason);
        }
      }
      console.log("[ai-response] booking pipeline completed in", Date.now() - bookingStartTime, "ms");
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errStack = err instanceof Error ? err.stack : "";
      console.error("[ai-response] BOOKING PIPELINE ERROR after", Date.now() - bookingStartTime, "ms:", errMsg);
      console.error("[ai-response] BOOKING PIPELINE STACK:", errStack);
      bookingResponseOverride = `I'm having trouble checking availability right now — let me connect you with our team. Someone will reach out shortly to get your appointment scheduled!`;
      effectiveDecision.proposed_state_change = null;
      // Don't let booking failure silently corrupt state — ensure handoff
      effectiveDecision.handoff_required = true;
      effectiveDecision.handoff_reason = `Booking pipeline error: ${errMsg}`;
    }
  }

  // Validate.
  const validation = validateAIDecision(effectiveDecision, conversationState);
  console.log("[ai-response] validation result:", { confidencePassed: validation.confidencePassed, stateChangeAllowed: validation.stateChangeAllowed, handoffValid: validation.handoffValid, errors: validation.errors, actualConfidence: effectiveDecision.confidence, threshold: CONFIDENCE_THRESHOLD });

  let responseText = bookingResponseOverride ?? effectiveDecision.response_text;
  if (!validation.confidencePassed && !bookingResponseOverride) {
    // Check if using the generic fallback would create a loop.
    // If the AI produced a substantive response, prefer it over the generic fallback
    // to avoid poisoning conversation history with dead-end messages.
    const aiText = effectiveDecision.response_text ?? "";
    const recentMessages = conversationHistory.slice(-4);
    const lastAssistantMsg = [...recentMessages].reverse().find((m) => m.role === "assistant");
    const alreadyInFallback = lastAssistantMsg?.content === FALLBACK_RESPONSE;

    if (alreadyInFallback && aiText.length > 20) {
      // Break the loop: use Claude's actual response even though confidence is low
      console.warn("[ai-response] low confidence BUT in fallback loop — using AI response to break cycle:", aiText.slice(0, 100));
      responseText = aiText;
    } else if (alreadyInFallback) {
      // In a loop and AI has nothing useful — send recovery message
      console.error("[ai-response] FALLBACK LOOP — low confidence, no useful AI text — sending recovery");
      responseText = "I'm having some trouble right now — let me connect you with our team. Someone will follow up shortly!";
    } else {
      console.warn("[ai-response] low confidence (", effectiveDecision.confidence, ") — using fallback response");
      responseText = FALLBACK_RESPONSE;
    }
  }

  // Sync the decision object so any consumer reading decision.response_text gets the override.
  effectiveDecision.response_text = responseText;
  if (effectiveDecision.responseText !== undefined) effectiveDecision.responseText = responseText;

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

  // Handoff — check both the original forceHandoff and any booking-pipeline-triggered handoff.
  let handoffCreated = false;
  if (forceHandoff || effectiveDecision.handoff_required) {
    await db.escalations.create({ data: { business_id: businessId, conversation_id: conversationId, category: "complaint" as any, status: "open" } });
    handoffCreated = true;
  }

  // Store outbound message + queue row + prompt log in a transaction.
  // Also stamp ai_disclosure_sent_at on first message so the disclosure never repeats.
  // Update conversation title (contact_display_name / contact_handle) when name/phone are collected.
  const { msgId, queueId } = await db.$transaction(async (tx) => {
    const msg = await tx.message_log.create({ data: { business_id: businessId, conversation_id: conversationId, direction: "outbound", channel: "sms", sender_type: "ai", content: responseText } });
    const q = await tx.outbound_queue.create({ data: { business_id: businessId, conversation_id: conversationId, message_purpose: messagePurpose, audience_type: "customer", channel: "sms", dedupe_key: `ai:${conversationId}:${Date.now()}`, scheduled_send_at: new Date() } });
    await tx.prompt_log.create({ data: { business_id: businessId, conversation_id: conversationId, prompt_purpose: "ai_response", prompt_text: (systemPrompt ?? "").slice(0, 2000), response_text: (responseText ?? "").slice(0, 2000), model: AI_MODEL, latency_ms: latencyMs, success: true } });
    await tx.customers.updateMany({
      where: { id: customerId, ai_disclosure_sent_at: null },
      data: { ai_disclosure_sent_at: new Date() },
    });

    // If Claude collected a name, phone, or address this turn, write them to the conversation.
    const collectedName = effectiveDecision.collected_name ?? (effectiveDecision as unknown as Record<string, unknown>)["collectedName"] as string | null | undefined;
    const collectedPhone = effectiveDecision.collected_phone ?? (effectiveDecision as unknown as Record<string, unknown>)["collectedPhone"] as string | null | undefined;
    const collectedAddr = effectiveDecision.collected_service_address ?? (effectiveDecision as unknown as Record<string, unknown>)["collected_service_address"] as string | null | undefined;
    if (collectedName ?? collectedPhone ?? collectedAddr) {
      const convUpdate: Record<string, string> = {};
      if (collectedName) convUpdate["contact_display_name"] = collectedName;
      if (collectedPhone) convUpdate["contact_handle"] = collectedPhone;
      if (collectedAddr) convUpdate["collected_service_address"] = collectedAddr;
      await tx.conversations.update({
        where: { id: conversationId },
        data: convUpdate as never,
      });
    }

    return { msgId: msg.id, queueId: q.id };
  });

  // Update stores for test-like consistency in production (no-op in prod since they're empty).
  _outboundMessages.set(msgId, { id: msgId, conversationId, businessId, direction: "outbound", senderType: "ai", content: responseText, messagePurpose, createdAt: new Date() });
  _queueRows.set(queueId, { id: queueId, conversationId, messagePurpose, createdAt: new Date() });

  return { success: true, decision: effectiveDecision, replyText: responseText, messageLogId: msgId, queueRowId: queueId, stateChanged, newState, handoffCreated };
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
