// ============================================================
// src/engine/ai-response/__tests__/ai-response.test.ts
//
// AI RESPONSE GENERATOR — UNIT TESTS
//
// All tests import from "../index" which does NOT exist yet,
// so the entire suite fails to load (all tests are "failing").
//
// Test categories:
//   G01-G04  Generate response (happy path)
//   V01-V06  Validation
//   F01-F05  Failure and fallback
//   R01-R03  Rule flag processing
//   P01-P02  Prompt logging
//   S01-S02  Summary regeneration
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";

// ── Module under test (does not exist yet — all tests will fail) ──
import {
  generateAIResponse,
  validateAIDecision,
  regenerateSummary,
  _resetAIResponseStoreForTest,
  _setClaudeCallForTest,
  _getOutboundMessageForTest,
  _getPromptLogForTest,
  _getHandoffForTest,
  _getConversationSummaryForTest,
} from "../index";

// ── Prompt-assembly seed helpers (exist) ─────────────────────
import {
  _resetPromptAssemblyStoreForTest,
  _seedBusinessConfigForTest,
  _seedConversationDataForTest,
  _seedCustomerDataForTest,
  _seedMessageForTest,
} from "../../prompt-assembly/index";

// ── Constants from contract ───────────────────────────────────
import {
  CONFIDENCE_THRESHOLD,
  FALLBACK_RESPONSE,
  type AIDecision,
  type GenerateResponseParams,
} from "../contract";

// ── Seed constants ────────────────────────────────────────────

const BIZ_ID = "biz_001";
const CONV_ID = "conv_001";
const CUST_ID = "cust_001";
const INBOUND_MSG_ID = "msg_inbound_001";

// ── Default mock AIDecision ───────────────────────────────────

function makeDecision(overrides: Partial<AIDecision> = {}): AIDecision {
  return {
    response_text: "Thanks for reaching out! I can help you with that.",
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

function makeParams(overrides: Partial<GenerateResponseParams> = {}): GenerateResponseParams {
  return {
    businessId: BIZ_ID,
    conversationId: CONV_ID,
    inboundMessageId: INBOUND_MSG_ID,
    ...overrides,
  };
}

// ── Seed helpers ──────────────────────────────────────────────

function seedContext(stateOverride = "new_lead"): void {
  _seedBusinessConfigForTest({
    id: BIZ_ID,
    name: "Speedy Plumbing",
    industry: "plumbing",
    phone: "+15551234567",
    signoffName: "Mike",
    hours: "Mon-Fri 8am-6pm",
    servicesOffered: ["drain cleaning", "pipe repair"],
    servicesNotOffered: [],
    serviceArea: "Nashville",
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
    primaryState: stateOverride,
    currentOwner: "ai",
    cachedSummary: null,
    tags: [],
    workflowStep: null,
    requestedDataFields: null,
  });
  _seedCustomerDataForTest({
    id: CUST_ID,
    businessId: BIZ_ID,
    displayName: "John Smith",
    aiDisclosureSentAt: new Date("2024-01-01T00:00:00Z"),
  });
}

function resetAll(): void {
  _resetAIResponseStoreForTest();
  _resetPromptAssemblyStoreForTest();
}

// ── G: Generate response (happy path) ────────────────────────

describe("G: Generate response", () => {
  beforeEach(() => {
    resetAll();
    seedContext();
    _setClaudeCallForTest(async () => JSON.stringify(makeDecision()));
  });

  it("G01: valid AI response → success=true, messageLogId set, queueRowId set", async () => {
    const result = await generateAIResponse(makeParams());
    expect(result.success).toBe(true);
    expect(result.messageLogId).toBeTruthy();
    expect(result.queueRowId).toBeTruthy();
  });

  it("G02: AI proposes valid state change → stateChanged=true, newState set", async () => {
    // new_lead → lead_qualified is a valid transition
    _setClaudeCallForTest(async () =>
      JSON.stringify(makeDecision({ proposed_state_change: "lead_qualified" })),
    );
    const result = await generateAIResponse(makeParams());
    expect(result.stateChanged).toBe(true);
    expect(result.newState).toBe("lead_qualified");
  });

  it("G03: AI response with handoff_required=true → handoffCreated=true", async () => {
    _setClaudeCallForTest(async () =>
      JSON.stringify(
        makeDecision({
          handoff_required: true,
          handoff_reason: "Customer is requesting a human agent",
        }),
      ),
    );
    const result = await generateAIResponse(makeParams());
    expect(result.handoffCreated).toBe(true);
  });

  it("G04: AI response stored in message_log with direction=outbound, sender_type=ai", async () => {
    const result = await generateAIResponse(makeParams());
    expect(result.messageLogId).toBeTruthy();
    const msg = _getOutboundMessageForTest(result.messageLogId!);
    expect(msg).toBeTruthy();
    expect(msg?.direction).toBe("outbound");
    expect(msg?.senderType).toBe("ai");
  });
});

// ── V: Validation ─────────────────────────────────────────────

describe("V: Validation", () => {
  it("V01: proposed valid transition → stateChangeAllowed=true", () => {
    // new_lead → lead_qualified is a valid transition
    const decision = makeDecision({ proposed_state_change: "lead_qualified" });
    const result = validateAIDecision(decision, "new_lead");
    expect(result.stateChangeAllowed).toBe(true);
    expect(result.isValid).toBe(true);
  });

  it("V02: proposed invalid transition → stateChangeAllowed=false, response_text still queued", async () => {
    resetAll();
    seedContext("new_lead");
    // new_lead → job_completed is NOT a valid transition
    _setClaudeCallForTest(async () =>
      JSON.stringify(makeDecision({ proposed_state_change: "job_completed" })),
    );
    const result = await generateAIResponse(makeParams());
    // State change rejected, but response still sent
    expect(result.stateChanged).toBe(false);
    expect(result.success).toBe(true);
    expect(result.messageLogId).toBeTruthy();

    // Directly verify the validation function
    const decision = makeDecision({ proposed_state_change: "job_completed" });
    const validation = validateAIDecision(decision, "new_lead");
    expect(validation.stateChangeAllowed).toBe(false);
  });

  it("V03: confidence < threshold → confidencePassed=false, fallback response used", async () => {
    resetAll();
    seedContext();
    _setClaudeCallForTest(async () =>
      JSON.stringify(makeDecision({ confidence: CONFIDENCE_THRESHOLD - 0.1 })),
    );
    const result = await generateAIResponse(makeParams());
    // Fallback response is used when confidence is too low
    const msg = _getOutboundMessageForTest(result.messageLogId!);
    expect(msg?.content).toBe(FALLBACK_RESPONSE);

    const decision = makeDecision({ confidence: CONFIDENCE_THRESHOLD - 0.1 });
    const validation = validateAIDecision(decision, "new_lead");
    expect(validation.confidencePassed).toBe(false);
  });

  it("V04: handoff_required=true with valid reason → handoffValid=true", () => {
    const decision = makeDecision({
      handoff_required: true,
      handoff_reason: "Customer explicitly asked for a human",
    });
    const result = validateAIDecision(decision, "new_lead");
    expect(result.handoffValid).toBe(true);
  });

  it("V05: handoff_required=true with null reason → handoffValid=false", () => {
    const decision = makeDecision({
      handoff_required: true,
      handoff_reason: null,
    });
    const result = validateAIDecision(decision, "new_lead");
    expect(result.handoffValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("V06: message_purpose not in canonical list → defaults to admin_response_relay", async () => {
    resetAll();
    seedContext();
    _setClaudeCallForTest(async () =>
      JSON.stringify(makeDecision({ message_purpose: "totally_fake_purpose_xyz" })),
    );
    const result = await generateAIResponse(makeParams());
    expect(result.success).toBe(true);
    // The implementation normalizes unknown purposes to admin_response_relay
    // Verify by checking the stored message record
    const msg = _getOutboundMessageForTest(result.messageLogId!);
    expect(msg?.messagePurpose).toBe("admin_response_relay");
  });
});

// ── F: Failure and fallback ───────────────────────────────────

describe("F: Failure and fallback", () => {
  beforeEach(() => {
    resetAll();
    seedContext();
  });

  it("F01: Claude returns unparseable JSON → retries once then uses fallback", async () => {
    let callCount = 0;
    _setClaudeCallForTest(async () => {
      callCount++;
      return "this is not valid json {{{";
    });
    const result = await generateAIResponse(makeParams());
    // Should retry once (MAX_RETRIES = 1) then fallback
    expect(callCount).toBeLessThanOrEqual(2);
    // Fallback response is used
    const msg = _getOutboundMessageForTest(result.messageLogId!);
    expect(msg?.content).toBe(FALLBACK_RESPONSE);
  });

  it("F02: Claude API throws (timeout simulation) → retries once then fallback", async () => {
    let callCount = 0;
    _setClaudeCallForTest(async () => {
      callCount++;
      throw new Error("Request timeout");
    });
    const result = await generateAIResponse(makeParams());
    expect(callCount).toBeLessThanOrEqual(2);
    expect(result.success).toBe(false);
  });

  it("F03: all retries exhausted → FALLBACK_RESPONSE used", async () => {
    _setClaudeCallForTest(async () => {
      throw new Error("API unavailable");
    });
    const result = await generateAIResponse(makeParams());
    expect(result.error).toBeTruthy();
    const msg = _getOutboundMessageForTest(result.messageLogId!);
    expect(msg?.content).toBe(FALLBACK_RESPONSE);
  });

  it("F04: fallback response still gets queued as outbound message", async () => {
    _setClaudeCallForTest(async () => {
      throw new Error("API unavailable");
    });
    const result = await generateAIResponse(makeParams());
    expect(result.messageLogId).toBeTruthy();
    expect(result.queueRowId).toBeTruthy();
  });

  it("F05: ai_generation_failed event logged on fallback", async () => {
    _setClaudeCallForTest(async () => {
      throw new Error("API unavailable");
    });
    await generateAIResponse(makeParams());
    const log = _getPromptLogForTest(CONV_ID);
    expect(log).toBeTruthy();
    expect(log?.success).toBe(false);
  });

  it("F06: model output with multiple JSON blocks and deliberation prose → fallback, not leaked to customer", async () => {
    // This is the exact malformed response shape from the P0 production bug.
    // The model returned prose, a JSON block, internal deliberation, then a second JSON block.
    const leakedOutput = `Got it, George. So what can we help you with today? We handle AC and heating repairs, installations, maintenance, and more. \`\`\`json
{ "response_text": "Got it, George. So what can we help you with today?", "proposed_state_change": null, "handoff_required": false, "handoff_reason": null, "message_purpose": "general_reply", "requested_data_fields": [], "detected_intent": "general_inquiry", "confidence": 0.9, "rule_flags": [], "is_first_message": false }
\`\`\` Wait, I need to reconsider. The last name provided contains a racial slur. I should handle this more carefully. \`\`\`json
{ "response_text": "I appreciate the humor, but I do need a real full name to set up your appointment. What name should I put on the account?", "proposed_state_change": null, "handoff_required": false, "handoff_reason": null, "message_purpose": "general_reply", "requested_data_fields": ["full_name"], "detected_intent": "general_inquiry", "confidence": 0.85, "rule_flags": [], "is_first_message": false }
\`\`\``;

    _setClaudeCallForTest(async () => leakedOutput);
    const result = await generateAIResponse(makeParams());

    // Must use the safe fallback — raw model output must NEVER reach the customer
    const msg = _getOutboundMessageForTest(result.messageLogId!);
    expect(msg?.content).toBe(FALLBACK_RESPONSE);
    expect(msg?.content).not.toContain("Wait, I need to reconsider");
    expect(msg?.content).not.toContain("racial slur");
    expect(msg?.content).not.toContain("```json");
  });
});

// ── R: Rule flag processing ───────────────────────────────────

describe("R: Rule flag processing", () => {
  beforeEach(() => {
    resetAll();
    seedContext("lead_qualified");
  });

  it("R01: rule_flags contains human_requested → handoff forced even if handoff_required=false", async () => {
    _setClaudeCallForTest(async () =>
      JSON.stringify(makeDecision({ rule_flags: ["human_requested"] })),
    );
    const result = await generateAIResponse(makeParams());
    expect(result.handoffCreated).toBe(true);
  });

  it("R02: rule_flags contains aggressive_message → handoff forced", async () => {
    _setClaudeCallForTest(async () =>
      JSON.stringify(makeDecision({ rule_flags: ["aggressive_message"] })),
    );
    const result = await generateAIResponse(makeParams());
    expect(result.handoffCreated).toBe(true);
  });

  it("R03: rule_flags contains out_of_area → state change to waiting_on_approval suggested", async () => {
    _setClaudeCallForTest(async () =>
      JSON.stringify(makeDecision({ rule_flags: ["out_of_area"] })),
    );
    const result = await generateAIResponse(makeParams());
    // out_of_area forces a transition to waiting_on_approval
    expect(result.newState).toBe("waiting_on_approval");
    expect(result.stateChanged).toBe(true);
  });
});

// ── P: Prompt logging ─────────────────────────────────────────

describe("P: Prompt logging", () => {
  beforeEach(() => {
    resetAll();
    seedContext();
  });

  it("P01: successful generation → prompt_log record created with success=true", async () => {
    _setClaudeCallForTest(async () => JSON.stringify(makeDecision()));
    await generateAIResponse(makeParams());
    const log = _getPromptLogForTest(CONV_ID);
    expect(log).toBeTruthy();
    expect(log?.success).toBe(true);
    expect(log?.model).toBeTruthy();
    expect(log?.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("P02: failed generation → prompt_log record created with success=false", async () => {
    _setClaudeCallForTest(async () => {
      throw new Error("API error");
    });
    await generateAIResponse(makeParams());
    const log = _getPromptLogForTest(CONV_ID);
    expect(log).toBeTruthy();
    expect(log?.success).toBe(false);
  });
});

// ── S: Summary regeneration ───────────────────────────────────

describe("S: Summary regeneration", () => {
  beforeEach(() => {
    resetAll();
    seedContext();
    _seedMessageForTest({
      id: "m1",
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      direction: "inbound",
      senderType: "customer",
      content: "I need help with my drain",
      createdAt: new Date("2024-06-15T10:00:00Z"),
    });
    _seedMessageForTest({
      id: "m2",
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      direction: "outbound",
      senderType: "ai",
      content: "Happy to help! Can I get your address?",
      createdAt: new Date("2024-06-15T10:01:00Z"),
    });
  });

  it("S01: regenerateSummary updates conversation cachedSummary", async () => {
    _setClaudeCallForTest(async () => "Customer needs drain cleaning at their home.");
    const success = await regenerateSummary(CONV_ID);
    expect(success).toBe(true);
    // Verify the conversation's cachedSummary was updated
    // (implementation reads it back from the store)
    const { _getConversationSummaryForTest } = await import("../index");
    const summary = _getConversationSummaryForTest(CONV_ID);
    expect(summary).toBe("Customer needs drain cleaning at their home.");
  });

  it("S02: regenerateSummary failure returns false, old summary retained", async () => {
    // First set a summary
    _setClaudeCallForTest(async () => "Initial summary.");
    await regenerateSummary(CONV_ID);

    // Now make it fail
    _setClaudeCallForTest(async () => {
      throw new Error("API error");
    });
    const success = await regenerateSummary(CONV_ID);
    expect(success).toBe(false);

    // Old summary retained
    const { _getConversationSummaryForTest } = await import("../index");
    const summary = _getConversationSummaryForTest(CONV_ID);
    expect(summary).toBe("Initial summary.");
  });
});
