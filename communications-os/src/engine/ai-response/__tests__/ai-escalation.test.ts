// ============================================================
// src/engine/ai-response/__tests__/ai-escalation.test.ts
//
// AI ESCALATION — knowledge-gap detection tests
//
// Finding 1: when Claude signals it doesn't know something
// the engine must force handoff + fire an escalation notification.
//
// Test categories:
//   AE01  detected_intent = "unknown" → escalation fires
//   AE02  handoff_reason contains "not sure" → escalation fires
//   AE03  confident response, no signals → no escalation
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";

import {
  generateAIResponse,
  _resetAIResponseStoreForTest,
  _setClaudeCallForTest,
  _getEscalationEventsForTest,
} from "../index";

import {
  _resetPromptAssemblyStoreForTest,
  _seedBusinessConfigForTest,
  _seedConversationDataForTest,
  _seedCustomerDataForTest,
  _seedMessageForTest,
} from "../../prompt-assembly/index";

import type { AIDecision, GenerateResponseParams } from "../contract";

// ── Constants ─────────────────────────────────────────────────

const BIZ_ID = "biz_ae_test";
const CONV_ID = "conv_ae_test";
const CUST_ID = "cust_ae_test";
const INBOUND_MSG_ID = "msg_ae_inbound_001";

// ── Helpers ───────────────────────────────────────────────────

function makeDecision(overrides: Partial<AIDecision> = {}): AIDecision {
  return {
    response_text: "I can help you with that.",
    proposed_state_change: null,
    handoff_required: false,
    handoff_reason: null,
    message_purpose: "admin_response_relay",
    requested_data_fields: [],
    detected_intent: "general_inquiry",
    confidence: 0.9,
    rule_flags: [],
    is_first_message: false,
    ...overrides,
  };
}

function makeParams(): GenerateResponseParams {
  return {
    businessId: BIZ_ID,
    conversationId: CONV_ID,
    inboundMessageId: INBOUND_MSG_ID,
  };
}

function seedContext(): void {
  _seedBusinessConfigForTest({
    id: BIZ_ID,
    name: "Test Biz",
    industry: "plumbing",
    phone: "+15550000001",
    signoffName: "Admin",
    hours: "Mon-Fri 9am-5pm",
    servicesOffered: ["plumbing"],
    servicesNotOffered: [],
    serviceArea: "City",
    cancellationPolicy: null,
    warrantyPolicy: null,
    paymentMethods: ["cash"],
    customerPhilosophy: null,
    customInstructions: null,
  });
  _seedConversationDataForTest({
    id: CONV_ID,
    businessId: BIZ_ID,
    customerId: CUST_ID,
    primaryState: "new_lead",
    currentOwner: "ai",
    cachedSummary: null,
    tags: [],
    workflowStep: null,
    requestedDataFields: null,
  });
  _seedCustomerDataForTest({
    id: CUST_ID,
    businessId: BIZ_ID,
    displayName: "Jane Customer",
    aiDisclosureSentAt: new Date("2024-01-01"),
  });
  _seedMessageForTest({
    id: INBOUND_MSG_ID,
    conversationId: CONV_ID,
    businessId: BIZ_ID,
    direction: "inbound",
    senderType: "customer",
    content: "Do you install tankless water heaters?",
    createdAt: new Date("2024-06-15T10:00:00Z"),
  });
}

function resetAll(): void {
  _resetAIResponseStoreForTest();
  _resetPromptAssemblyStoreForTest();
}

// ── AE: Escalation tests ──────────────────────────────────────

describe("AE: AI escalation (knowledge-gap detection)", () => {
  beforeEach(() => {
    resetAll();
    seedContext();
  });

  it("AE01: detected_intent = 'unknown' → handoffCreated=true, escalation notification fired", async () => {
    _setClaudeCallForTest(async () =>
      JSON.stringify(
        makeDecision({
          detected_intent: "unknown",
          handoff_required: false,
          handoff_reason: null,
        }),
      ),
    );

    const result = await generateAIResponse(makeParams());

    expect(result.success).toBe(true);
    expect(result.handoffCreated).toBe(true);

    const events = _getEscalationEventsForTest();
    expect(events).toHaveLength(1);
    expect(events[0]!.notificationType).toBe("new_approval_request");
    expect(events[0]!.title).toBe("AI needs help");
    // Body should be the customer's message
    expect(events[0]!.body).toBe("Do you install tankless water heaters?");
  });

  it("AE02: handoff_reason contains 'not sure' → escalation forced even if originally non-handoff", async () => {
    _setClaudeCallForTest(async () =>
      JSON.stringify(
        makeDecision({
          detected_intent: "service_inquiry",
          handoff_required: true,
          handoff_reason: "I'm not sure about this, let me check with the team",
        }),
      ),
    );

    const result = await generateAIResponse(makeParams());

    expect(result.success).toBe(true);
    expect(result.handoffCreated).toBe(true);

    const events = _getEscalationEventsForTest();
    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe("AI needs help");
  });

  it("AE03: confident response about an unknown topic (no escalation signals) → no forced handoff", async () => {
    _setClaudeCallForTest(async () =>
      JSON.stringify(
        makeDecision({
          detected_intent: "service_inquiry",
          confidence: 0.95,
          handoff_required: false,
          handoff_reason: null,
        }),
      ),
    );

    const result = await generateAIResponse(makeParams());

    expect(result.success).toBe(true);
    expect(result.handoffCreated).toBe(false);

    const events = _getEscalationEventsForTest();
    expect(events).toHaveLength(0);
  });
});
