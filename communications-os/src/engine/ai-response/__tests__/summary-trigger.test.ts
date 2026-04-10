// ============================================================
// src/engine/ai-response/__tests__/summary-trigger.test.ts
//
// SUMMARY TRIGGER — tests for auto-triggering regenerateSummary
// after a state change (Finding 3).
//
// Test categories:
//   ST01  state change → regenerateSummary called
//   ST02  no state change → regenerateSummary NOT called
//   ST03  regenerateSummary failure → generateAIResponse still succeeds
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";

import {
  generateAIResponse,
  _resetAIResponseStoreForTest,
  _setClaudeCallForTest,
  _getSummaryCallsForTest,
} from "../index";

import {
  _resetPromptAssemblyStoreForTest,
  _seedBusinessConfigForTest,
  _seedConversationDataForTest,
  _seedCustomerDataForTest,
} from "../../prompt-assembly/index";

import type { AIDecision, GenerateResponseParams } from "../contract";

// ── Constants ─────────────────────────────────────────────────

const BIZ_ID = "biz_st_test";
const CONV_ID = "conv_st_test";
const CUST_ID = "cust_st_test";
const INBOUND_MSG_ID = "msg_st_inbound_001";

// ── Helpers ───────────────────────────────────────────────────

function makeDecision(overrides: Partial<AIDecision> = {}): AIDecision {
  return {
    response_text: "All set, I've noted your request.",
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

function seedContext(state = "new_lead"): void {
  _seedBusinessConfigForTest({
    id: BIZ_ID,
    name: "Summary Biz",
    industry: "plumbing",
    phone: "+15550000002",
    signoffName: "Bob",
    hours: "Mon-Fri 8am-6pm",
    servicesOffered: ["drain cleaning"],
    servicesNotOffered: [],
    serviceArea: "Metro",
    cancellationPolicy: null,
    warrantyPolicy: null,
    paymentMethods: ["cash", "card"],
    customerPhilosophy: null,
    customInstructions: null,
  });
  _seedConversationDataForTest({
    id: CONV_ID,
    businessId: BIZ_ID,
    customerId: CUST_ID,
    primaryState: state,
    currentOwner: "ai",
    cachedSummary: null,
    tags: [],
    workflowStep: null,
    requestedDataFields: null,
  });
  _seedCustomerDataForTest({
    id: CUST_ID,
    businessId: BIZ_ID,
    displayName: "Alice Customer",
    aiDisclosureSentAt: new Date("2024-01-01"),
  });
}

function resetAll(): void {
  _resetAIResponseStoreForTest();
  _resetPromptAssemblyStoreForTest();
}

// ── ST: Summary trigger tests ─────────────────────────────────

describe("ST: Summary trigger on state change", () => {
  beforeEach(() => {
    resetAll();
    seedContext("new_lead");
  });

  it("ST01: AI response with valid state change → regenerateSummary called for that conversation", async () => {
    // new_lead → lead_qualified is a valid transition
    let summaryCallCount = 0;
    _setClaudeCallForTest(async (_sys, _hist) => {
      summaryCallCount++;
      // First call = main response; second call = summary regeneration
      if (summaryCallCount === 1) {
        return JSON.stringify(makeDecision({ proposed_state_change: "lead_qualified" }));
      }
      return "Customer asked about drain cleaning.";
    });

    const result = await generateAIResponse(makeParams());

    expect(result.success).toBe(true);
    expect(result.stateChanged).toBe(true);

    const summaryCalls = _getSummaryCallsForTest();
    expect(summaryCalls).toHaveLength(1);
    expect(summaryCalls[0]!.conversationId).toBe(CONV_ID);
  });

  it("ST02: AI response without state change → regenerateSummary NOT called", async () => {
    _setClaudeCallForTest(async () =>
      JSON.stringify(makeDecision({ proposed_state_change: null })),
    );

    const result = await generateAIResponse(makeParams());

    expect(result.success).toBe(true);
    expect(result.stateChanged).toBe(false);

    const summaryCalls = _getSummaryCallsForTest();
    expect(summaryCalls).toHaveLength(0);
  });

  it("ST03: regenerateSummary failure does not cause generateAIResponse to fail", async () => {
    let callCount = 0;
    _setClaudeCallForTest(async () => {
      callCount++;
      if (callCount === 1) {
        // Main response — triggers state change
        return JSON.stringify(makeDecision({ proposed_state_change: "lead_qualified" }));
      }
      // Summary call — throw to simulate Claude failure
      throw new Error("Claude summary call failed");
    });

    const result = await generateAIResponse(makeParams());

    // Main response should still succeed despite summary failure
    expect(result.success).toBe(true);
    expect(result.stateChanged).toBe(true);

    // The summary call was still attempted (recorded synchronously)
    const summaryCalls = _getSummaryCallsForTest();
    expect(summaryCalls).toHaveLength(1);
  });
});
