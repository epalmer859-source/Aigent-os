// ============================================================
// src/engine/prompt-assembly/__tests__/prompt-assembly.test.ts
//
// PROMPT ASSEMBLY ENGINE — UNIT TESTS
//
// All tests import assemblePrompt from "../index" which does NOT
// exist yet, so the entire suite fails to load (all tests are failing).
//
// Test categories:
//   L01-L10  Layer assembly (content present in systemPrompt)
//   H01-H04  Conversation history (ordering, mapping, count)
//   D01-D02  AI disclosure instruction
//   M01-M05  Metadata fields
//   S01-S04  State-specific instructions
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";

// ── Module under test (does not exist yet — all tests will fail) ──
import {
  assemblePrompt,
  _resetPromptAssemblyStoreForTest,
  _seedBusinessConfigForTest,
  _seedConversationDataForTest,
  _seedCustomerDataForTest,
  _seedMessageForTest,
} from "../index";

// ── Constants from contract ───────────────────────────────────
import {
  MAX_HISTORY_MESSAGES,
  AI_DISCLOSURE_TEMPLATE,
  RESPONSE_FORMAT_INSTRUCTION,
  type PromptContext,
  type AssembledPrompt,
  type ConversationMessage,
} from "../contract";

// ── Seed helpers ──────────────────────────────────────────────

const BIZ_ID = "biz_001";
const CONV_ID = "conv_001";
const CUST_ID = "cust_001";
const MSG_ID = "msg_inbound_001";

function seedDefaultBusiness(overrides: Record<string, unknown> = {}): void {
  _seedBusinessConfigForTest({
    id: BIZ_ID,
    name: "Speedy Plumbing",
    industry: "plumbing",
    phone: "+15551234567",
    signoffName: "Mike",
    hours: "Mon-Fri 8am-6pm",
    servicesOffered: ["drain cleaning", "pipe repair", "water heater installation"],
    servicesNotOffered: ["septic systems"],
    serviceArea: "Greater Nashville area",
    cancellationPolicy: "24-hour notice required",
    warrantyPolicy: "1-year labor warranty",
    paymentMethods: ["cash", "card", "check"],
    customerPhilosophy: "Treat every customer like family",
    customInstructions: null,
    ...overrides,
  });
}

function seedDefaultConversation(overrides: Record<string, unknown> = {}): void {
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
    ...overrides,
  });
}

function seedDefaultCustomer(overrides: Record<string, unknown> = {}): void {
  _seedCustomerDataForTest({
    id: CUST_ID,
    businessId: BIZ_ID,
    displayName: "John Smith",
    aiDisclosureSentAt: new Date("2024-01-01T00:00:00Z"), // already sent by default
    ...overrides,
  });
}

function makeContext(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    businessId: BIZ_ID,
    conversationId: CONV_ID,
    customerId: CUST_ID,
    inboundMessageId: MSG_ID,
    ...overrides,
  };
}

function seedOneMessage(
  id: string,
  direction: "inbound" | "outbound",
  content: string,
  createdAt: Date,
): void {
  _seedMessageForTest({
    id,
    conversationId: CONV_ID,
    businessId: BIZ_ID,
    direction,
    senderType: direction === "inbound" ? "customer" : "ai",
    content,
    createdAt,
  });
}

function resetAll(): void {
  _resetPromptAssemblyStoreForTest();
}

// ── L: Layer assembly ─────────────────────────────────────────

describe("L: Layer assembly", () => {
  beforeEach(() => {
    resetAll();
    seedDefaultBusiness();
    seedDefaultConversation();
    seedDefaultCustomer();
  });

  it("L01: system prompt includes business name and industry", async () => {
    const result: AssembledPrompt = await assemblePrompt(makeContext());
    expect(result.systemPrompt).toContain("Speedy Plumbing");
    expect(result.systemPrompt).toContain("plumbing");
  });

  it("L02: system prompt includes services offered", async () => {
    const result = await assemblePrompt(makeContext());
    expect(result.systemPrompt).toContain("drain cleaning");
    expect(result.systemPrompt).toContain("pipe repair");
  });

  it("L03: system prompt includes business hours", async () => {
    const result = await assemblePrompt(makeContext());
    expect(result.systemPrompt).toContain("Mon-Fri 8am-6pm");
  });

  it("L04: system prompt includes current conversation state", async () => {
    const result = await assemblePrompt(makeContext());
    expect(result.systemPrompt).toContain("new_lead");
  });

  it("L05: system prompt includes customer name when available", async () => {
    const result = await assemblePrompt(makeContext());
    expect(result.systemPrompt).toContain("John Smith");
  });

  it("L06: system prompt includes conversation summary when available", async () => {
    seedDefaultConversation({ cachedSummary: "Customer needs urgent drain cleaning" });
    const result = await assemblePrompt(makeContext());
    expect(result.systemPrompt).toContain("Customer needs urgent drain cleaning");
  });

  it("L07: system prompt includes active conversation tags", async () => {
    seedDefaultConversation({ tags: ["urgent", "repeat_customer"] });
    const result = await assemblePrompt(makeContext());
    expect(result.systemPrompt).toContain("urgent");
    expect(result.systemPrompt).toContain("repeat_customer");
  });

  it("L08: system prompt includes industry-specific capabilities", async () => {
    const result = await assemblePrompt(makeContext());
    expect(result.metadata.capabilitiesIncluded).toBeGreaterThan(0);
    // Capabilities section must appear somewhere in the prompt
    expect(result.systemPrompt.length).toBeGreaterThan(200);
  });

  it("L09: system prompt includes industry-specific prohibitions", async () => {
    const result = await assemblePrompt(makeContext());
    expect(result.metadata.prohibitionsIncluded).toBeGreaterThan(0);
  });

  it("L10: system prompt ends with JSON response format instruction", async () => {
    const result = await assemblePrompt(makeContext());
    expect(result.systemPrompt).toContain(RESPONSE_FORMAT_INSTRUCTION);
    // Verify it is the last substantive content (within the last 500 chars)
    const tail = result.systemPrompt.slice(-500);
    expect(tail).toContain(RESPONSE_FORMAT_INSTRUCTION);
  });
});

// ── H: Conversation history ───────────────────────────────────

describe("H: Conversation history", () => {
  beforeEach(() => {
    resetAll();
    seedDefaultBusiness();
    seedDefaultConversation();
    seedDefaultCustomer();
  });

  it("H01: returns last 20 messages in chronological order when > 20 exist", async () => {
    // Seed 25 messages — only the last 20 should come back, oldest first.
    const base = new Date("2024-06-15T10:00:00Z").getTime();
    for (let i = 0; i < 25; i++) {
      seedOneMessage(
        `msg_${i}`,
        i % 2 === 0 ? "inbound" : "outbound",
        `Message ${i}`,
        new Date(base + i * 60_000),
      );
    }
    const result = await assemblePrompt(makeContext());
    expect(result.conversationHistory).toHaveLength(MAX_HISTORY_MESSAGES);
    // Must be chronological (timestamps ascending)
    for (let i = 1; i < result.conversationHistory.length; i++) {
      expect(result.conversationHistory[i]!.timestamp.getTime()).toBeGreaterThanOrEqual(
        result.conversationHistory[i - 1]!.timestamp.getTime(),
      );
    }
    // Last message should be msg_24 (the newest of the 25)
    expect(result.conversationHistory[MAX_HISTORY_MESSAGES - 1]!.content).toBe("Message 24");
  });

  it("H02: inbound messages map to role user, outbound to role assistant", async () => {
    seedOneMessage("m1", "inbound", "Customer question", new Date("2024-06-15T10:00:00Z"));
    seedOneMessage("m2", "outbound", "AI reply", new Date("2024-06-15T10:01:00Z"));
    const result = await assemblePrompt(makeContext());
    const user = result.conversationHistory.find((m: ConversationMessage) => m.content === "Customer question");
    const asst = result.conversationHistory.find((m: ConversationMessage) => m.content === "AI reply");
    expect(user?.role).toBe("user");
    expect(asst?.role).toBe("assistant");
  });

  it("H03: conversation with fewer than 20 messages returns all of them", async () => {
    for (let i = 0; i < 5; i++) {
      seedOneMessage(`msg_${i}`, "inbound", `Msg ${i}`, new Date(Date.now() + i * 1000));
    }
    const result = await assemblePrompt(makeContext());
    expect(result.conversationHistory).toHaveLength(5);
  });

  it("H04: empty conversation returns empty history array", async () => {
    const result = await assemblePrompt(makeContext());
    expect(result.conversationHistory).toHaveLength(0);
  });
});

// ── D: AI disclosure ──────────────────────────────────────────

describe("D: AI disclosure", () => {
  beforeEach(() => {
    resetAll();
    seedDefaultBusiness();
    seedDefaultConversation();
  });

  it("D01: ai_disclosure_sent_at is null → prompt includes first-message disclosure instruction", async () => {
    seedDefaultCustomer({ aiDisclosureSentAt: null });
    const result = await assemblePrompt(makeContext());
    // Should include the disclosure instruction (interpolated or template)
    expect(result.systemPrompt).toContain("first message");
    expect(result.systemPrompt).toContain("MUST include the AI disclosure");
  });

  it("D02: ai_disclosure_sent_at is set → prompt does NOT include disclosure instruction", async () => {
    seedDefaultCustomer({ aiDisclosureSentAt: new Date("2024-01-01T00:00:00Z") });
    const result = await assemblePrompt(makeContext());
    expect(result.systemPrompt).not.toContain("MUST include the AI disclosure");
  });
});

// ── M: Metadata ───────────────────────────────────────────────

describe("M: Metadata", () => {
  beforeEach(() => {
    resetAll();
    seedDefaultBusiness();
    seedDefaultConversation();
    seedDefaultCustomer();
  });

  it("M01: metadata includes correct business name and industry", async () => {
    const result = await assemblePrompt(makeContext());
    expect(result.metadata.businessName).toBe("Speedy Plumbing");
    expect(result.metadata.industry).toBe("plumbing");
  });

  it("M02: metadata.messageCount matches actual conversationHistory length", async () => {
    seedOneMessage("m1", "inbound", "Hi", new Date("2024-06-15T10:00:00Z"));
    seedOneMessage("m2", "outbound", "Hello", new Date("2024-06-15T10:01:00Z"));
    const result = await assemblePrompt(makeContext());
    expect(result.metadata.messageCount).toBe(result.conversationHistory.length);
    expect(result.metadata.messageCount).toBe(2);
  });

  it("M03: metadata.promptTokenEstimate is a positive number", async () => {
    const result = await assemblePrompt(makeContext());
    expect(result.metadata.promptTokenEstimate).toBeGreaterThan(0);
    expect(typeof result.metadata.promptTokenEstimate).toBe("number");
  });

  it("M04: metadata.capabilitiesIncluded > 0 for a known industry (plumbing)", async () => {
    const result = await assemblePrompt(makeContext());
    expect(result.metadata.capabilitiesIncluded).toBeGreaterThan(0);
  });

  it("M05: metadata.prohibitionsIncluded > 0 for a known industry (plumbing)", async () => {
    const result = await assemblePrompt(makeContext());
    expect(result.metadata.prohibitionsIncluded).toBeGreaterThan(0);
  });
});

// ── S: State-specific instructions ───────────────────────────

describe("S: State-specific instructions", () => {
  beforeEach(() => {
    resetAll();
    seedDefaultBusiness();
    seedDefaultCustomer();
  });

  it("S01: state = new_lead → prompt includes intake instructions", async () => {
    seedDefaultConversation({ primaryState: "new_lead" });
    const result = await assemblePrompt(makeContext());
    // new_lead: collect service need, address, preferred time
    expect(result.systemPrompt).toContain("new_lead");
    expect(result.systemPrompt.toLowerCase()).toMatch(/collect|service need|intake/);
  });

  it("S02: state = booking_in_progress → prompt includes scheduling instructions", async () => {
    seedDefaultConversation({ primaryState: "booking_in_progress" });
    const result = await assemblePrompt(makeContext());
    expect(result.systemPrompt).toContain("booking_in_progress");
    expect(result.systemPrompt.toLowerCase()).toMatch(/schedul|address|preferred time|book/);
  });

  it("S03: state = quote_sent → prompt includes follow-up instructions", async () => {
    seedDefaultConversation({ primaryState: "quote_sent" });
    const result = await assemblePrompt(makeContext());
    expect(result.systemPrompt).toContain("quote_sent");
    expect(result.systemPrompt.toLowerCase()).toMatch(/follow.?up|quote|decision/);
  });

  it("S04: state = job_completed → prompt includes closeout instructions", async () => {
    seedDefaultConversation({ primaryState: "job_completed" });
    const result = await assemblePrompt(makeContext());
    expect(result.systemPrompt).toContain("job_completed");
    expect(result.systemPrompt.toLowerCase()).toMatch(/close.?out|review|complete|satisfaction/);
  });
});
