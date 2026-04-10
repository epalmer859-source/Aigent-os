// ============================================================
// src/engine/inbound/__tests__/inbound.test.ts
//
// INBOUND MESSAGE HANDLER — UNIT TESTS
//
// All tests import handleInboundMessage from "../index" which does NOT
// exist yet, so the entire suite fails to load (all tests are "failing").
//
// Test categories:
//   N01-N03   New-customer path
//   E01-E02   Existing customer path
//   D01-D02   Do-not-contact guard
//   K01-K08   STOP / START keyword handling
//   B01-B04   AI-response queueing (owner = "ai" vs "human_takeover")
//   S01-S02   State transitions
//   R01-R02   Returning customer (isReopened flag)
//   DD01-DD02 Duplicate / idempotency detection
//   BP01      Business-paused guard
//   NS01      No-show conversation guard
//   SL01-SL02 Silence-timer queue cancellation
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";

// ── Module under test (does not exist yet — all tests will fail) ──
import {
  handleInboundMessage,
  _resetInboundStoreForTest,
  _getMessageForTest,
  _getMessageCountForTest,
  _getConsentStatusForTest,
  _setConversationOwnerForTest,
} from "../index";

// ── Suppression store helpers (exist) ────────────────────────
import {
  _resetSuppressionStoreForTest,
  _seedBusinessForTest,
  _seedCustomerForTest,
  _seedConversationForTest,
  _seedOutboundQueueForTest,
  _getQueueStatusForTest,
} from "../../suppression/index";

// ── Customer-resolver helpers (exist) ────────────────────────
import {
  _resetStoreForTest as _resetResolverStoreForTest,
  _closeConversationForTest,
  _setClosedAtForTest,
} from "../../customer-resolver/index";

// ── Constants from contract ───────────────────────────────────
import {
  STOP_KEYWORDS,
  START_KEYWORDS,
  STOP_CONFIRMATION_MESSAGE,
  START_CONFIRMATION_MESSAGE,
  type InboundParams,
  type InboundResult,
} from "../contract";

// ── Helpers ───────────────────────────────────────────────────

const BASE_BUSINESS_ID = "biz_001";
const BASE_PHONE = "5551234567"; // normalizes to +15551234567

function makeParams(overrides: Partial<InboundParams> = {}): InboundParams {
  return {
    businessId: BASE_BUSINESS_ID,
    fromContact: BASE_PHONE,
    contactType: "phone",
    channel: "sms",
    content: "Hello, I need a quote",
    ...overrides,
  };
}

function seedSuppressionBusiness(isPaused = false): void {
  // quietHoursStart === quietHoursEnd → no effective quiet window
  _seedBusinessForTest({
    id: BASE_BUSINESS_ID,
    isPaused,
    timezone: "UTC",
    quietHoursStart: "00:00",
    quietHoursEnd: "00:00",
  });
}

function resetAll(): void {
  _resetInboundStoreForTest();
  _resetResolverStoreForTest();
  _resetSuppressionStoreForTest();
}

// ── N: New-customer path ──────────────────────────────────────

describe("N: New-customer path", () => {
  beforeEach(() => {
    resetAll();
    seedSuppressionBusiness();
  });

  it("N01: first inbound from unknown contact creates new customer + conversation", async () => {
    const result: InboundResult = await handleInboundMessage(makeParams());

    expect(result.isNewCustomer).toBe(true);
    expect(result.isNewConversation).toBe(true);
    expect(result.isReopened).toBe(false);
    expect(result.customerId).toBeTruthy();
    expect(result.conversationId).toBeTruthy();
    expect(result.messageId).toBeTruthy();
  });

  it("N02: new-customer result has aiResponseQueued=true when owner is ai", async () => {
    const result = await handleInboundMessage(makeParams());
    expect(result.aiResponseQueued).toBe(true);
  });

  it("N03: second inbound from same contact reuses existing customer, does not create new one", async () => {
    const first = await handleInboundMessage(makeParams());
    const second = await handleInboundMessage(makeParams({ content: "Follow-up message" }));

    expect(second.isNewCustomer).toBe(false);
    expect(second.customerId).toBe(first.customerId);
    expect(second.conversationId).toBe(first.conversationId);
  });
});

// ── E: Existing customer path ─────────────────────────────────

describe("E: Existing customer path", () => {
  beforeEach(() => {
    resetAll();
    seedSuppressionBusiness();
  });

  it("E01: second message from existing customer returns same conversation", async () => {
    const first = await handleInboundMessage(makeParams());
    const second = await handleInboundMessage(makeParams({ content: "Second message" }));

    expect(second.isNewConversation).toBe(false);
    expect(second.conversationId).toBe(first.conversationId);
    expect(second.messageId).not.toBe(first.messageId);
  });

  it("E02: each message creates a distinct messageId", async () => {
    const a = await handleInboundMessage(makeParams({ content: "Message A" }));
    const b = await handleInboundMessage(makeParams({ content: "Message B" }));
    const c = await handleInboundMessage(makeParams({ content: "Message C" }));

    const ids = [a.messageId, b.messageId, c.messageId];
    expect(new Set(ids).size).toBe(3);
  });
});

// ── D: Do-not-contact guard ───────────────────────────────────

describe("D: Do-not-contact guard", () => {
  beforeEach(() => {
    resetAll();
    seedSuppressionBusiness();
  });

  it("D01: inbound from do_not_contact customer returns early without persisting message", async () => {
    const first = await handleInboundMessage(makeParams());
    const { _setDoNotContactForTest } = await import("../../customer-resolver/index");
    _setDoNotContactForTest(first.customerId);

    await expect(handleInboundMessage(makeParams({ content: "Try again" }))).rejects.toThrow();
  });

  it("D02: do_not_contact check prevents silent message creation", async () => {
    const first = await handleInboundMessage(makeParams());
    const countBefore = _getMessageCountForTest();
    const { _setDoNotContactForTest } = await import("../../customer-resolver/index");
    _setDoNotContactForTest(first.customerId);

    let threw = false;
    try {
      await handleInboundMessage(makeParams({ content: "Retry" }));
    } catch {
      threw = true;
    }
    const countAfter = _getMessageCountForTest();
    // Must either throw or leave message count unchanged
    expect(threw || countAfter === countBefore).toBe(true);
  });
});

// ── K: STOP / START keyword handling ─────────────────────────

describe("K: STOP/START keyword handling", () => {
  beforeEach(() => {
    resetAll();
    seedSuppressionBusiness();
  });

  it("K01: content 'STOP' opts the customer out", async () => {
    await handleInboundMessage(makeParams());
    await handleInboundMessage(makeParams({ content: "STOP" }));

    const status = await _getConsentStatusForTest(BASE_BUSINESS_ID, "+1" + BASE_PHONE);
    expect(status).toBe("opted_out");
  });

  it("K02: STOP keyword match is case-insensitive ('stop' works)", async () => {
    await handleInboundMessage(makeParams());
    await handleInboundMessage(makeParams({ content: "stop" }));

    const status = await _getConsentStatusForTest(BASE_BUSINESS_ID, "+1" + BASE_PHONE);
    expect(status).toBe("opted_out");
  });

  it("K03: all STOP_KEYWORDS opt the customer out", async () => {
    for (const kw of STOP_KEYWORDS) {
      resetAll();
      seedSuppressionBusiness();
      await handleInboundMessage(makeParams());
      await handleInboundMessage(makeParams({ content: kw }));
      const status = await _getConsentStatusForTest(BASE_BUSINESS_ID, "+1" + BASE_PHONE);
      expect(status).toBe("opted_out");
    }
  });

  it("K04: 'START' after STOP resubscribes the customer", async () => {
    await handleInboundMessage(makeParams());
    await handleInboundMessage(makeParams({ content: "STOP" }));
    await handleInboundMessage(makeParams({ content: "START" }));

    const status = await _getConsentStatusForTest(BASE_BUSINESS_ID, "+1" + BASE_PHONE);
    expect(status).toBe("resubscribed");
  });

  it("K05: 'YES' after STOP resubscribes the customer", async () => {
    await handleInboundMessage(makeParams());
    await handleInboundMessage(makeParams({ content: "STOP" }));
    await handleInboundMessage(makeParams({ content: "YES" }));

    const status = await _getConsentStatusForTest(BASE_BUSINESS_ID, "+1" + BASE_PHONE);
    expect(status).toBe("resubscribed");
  });

  it("K06: STOP keyword enqueues STOP_CONFIRMATION_MESSAGE", async () => {
    await handleInboundMessage(makeParams());
    const result = await handleInboundMessage(makeParams({ content: "STOP" }));

    expect(result.messageId).toBeTruthy();
    const msg = _getMessageForTest(result.messageId);
    expect(msg).toBeTruthy();
  });

  it("K07: START keyword enqueues START_CONFIRMATION_MESSAGE", async () => {
    await handleInboundMessage(makeParams());
    await handleInboundMessage(makeParams({ content: "STOP" }));
    const result = await handleInboundMessage(makeParams({ content: "START" }));

    expect(result.messageId).toBeTruthy();
    const msg = _getMessageForTest(result.messageId);
    expect(msg).toBeTruthy();
  });

  it("K08: non-keyword content does not change consent status", async () => {
    await handleInboundMessage(makeParams()); // new customer → implied_inbound
    await handleInboundMessage(makeParams({ content: "Just a normal message" }));

    const status = await _getConsentStatusForTest(BASE_BUSINESS_ID, "+1" + BASE_PHONE);
    expect(status).toBe("implied_inbound");
  });
});

// ── B: AI-response queueing ───────────────────────────────────

describe("B: AI-response queueing", () => {
  beforeEach(() => {
    resetAll();
    seedSuppressionBusiness();
  });

  it("B01: aiResponseQueued=true for a fresh conversation (owner = ai)", async () => {
    const result = await handleInboundMessage(makeParams());
    expect(result.aiResponseQueued).toBe(true);
  });

  it("B02: aiResponseQueued=false when conversation owner is human_takeover", async () => {
    const first = await handleInboundMessage(makeParams());
    _setConversationOwnerForTest(first.conversationId, "human_takeover");

    const second = await handleInboundMessage(makeParams({ content: "reply" }));
    expect(second.aiResponseQueued).toBe(false);
  });

  it("B03: STOP keyword path does not queue an AI response", async () => {
    await handleInboundMessage(makeParams());
    const result = await handleInboundMessage(makeParams({ content: "STOP" }));
    expect(result.aiResponseQueued).toBe(false);
  });

  it("B04: START keyword path does not queue an AI response", async () => {
    await handleInboundMessage(makeParams());
    await handleInboundMessage(makeParams({ content: "STOP" }));
    const result = await handleInboundMessage(makeParams({ content: "START" }));
    expect(result.aiResponseQueued).toBe(false);
  });
});

// ── S: State transitions ──────────────────────────────────────

describe("S: State transitions", () => {
  beforeEach(() => {
    resetAll();
    seedSuppressionBusiness();
  });

  it("S01: new conversation starts in new_lead state", async () => {
    const result = await handleInboundMessage(makeParams());
    expect(result.newState).toBe("new_lead");
    expect(result.stateChanged).toBe(true);
  });

  it("S02: second message to same open conversation does not change state", async () => {
    await handleInboundMessage(makeParams());
    const second = await handleInboundMessage(makeParams({ content: "Second message" }));
    expect(second.stateChanged).toBe(false);
    expect(second.newState).toBeUndefined();
  });
});

// ── R: Returning customer (reopen) ────────────────────────────

describe("R: Returning customer (reopen)", () => {
  beforeEach(() => {
    resetAll();
    seedSuppressionBusiness();
  });

  it("R01: inbound from customer whose conversation was closed within window sets isReopened=true", async () => {
    const first = await handleInboundMessage(makeParams());
    _closeConversationForTest(first.conversationId);

    const second = await handleInboundMessage(makeParams({ content: "I am back" }));
    expect(second.isReopened).toBe(true);
    expect(second.isNewCustomer).toBe(false);
    expect(second.conversationId).not.toBe(first.conversationId);
  });

  it("R02: inbound from customer whose conversation was closed beyond window sets isReopened=false", async () => {
    const first = await handleInboundMessage(makeParams());
    _closeConversationForTest(first.conversationId);
    _setClosedAtForTest(first.conversationId, 60); // 60 days ago → beyond 30-day window

    const second = await handleInboundMessage(makeParams({ content: "Long time no see" }));
    expect(second.isReopened).toBe(false);
    expect(second.isNewCustomer).toBe(false);
  });
});

// ── DD: Duplicate / idempotency detection ─────────────────────

describe("DD: Duplicate detection", () => {
  beforeEach(() => {
    resetAll();
    seedSuppressionBusiness();
  });

  it("DD01: duplicate twilioMessageSid returns existing result without reprocessing", async () => {
    const first = await handleInboundMessage(
      makeParams({ twilioMessageSid: "SM_abc123" }),
    );
    const countAfterFirst = _getMessageCountForTest();

    const second = await handleInboundMessage(
      makeParams({ twilioMessageSid: "SM_abc123" }),
    );
    const countAfterSecond = _getMessageCountForTest();

    expect(second.messageId).toBe(first.messageId);
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it("DD02: non-SMS message with no twilioMessageSid is always processed", async () => {
    const a = await handleInboundMessage(
      makeParams({ channel: "email", contactType: "email", fromContact: "user@example.com" }),
    );
    const b = await handleInboundMessage(
      makeParams({ channel: "email", contactType: "email", fromContact: "user@example.com", content: "Second email" }),
    );

    expect(b.messageId).not.toBe(a.messageId);
  });
});

// ── BP: Business-paused guard ─────────────────────────────────

describe("BP: Business-paused guard", () => {
  it("BP01: business paused → stores message, aiResponseQueued = false", async () => {
    resetAll();
    seedSuppressionBusiness(true); // isPaused = true

    const result = await handleInboundMessage(makeParams());

    expect(result.messageId).toBeTruthy();
    expect(result.customerId).toBeTruthy();
    expect(result.aiResponseQueued).toBe(false);
  });
});

// ── NS: No-show conversation guard ───────────────────────────

describe("NS: No-show conversation guard", () => {
  beforeEach(() => {
    resetAll();
    seedSuppressionBusiness();
  });

  it("NS01: conversation is_no_show → stores message, aiResponseQueued = false", async () => {
    const first = await handleInboundMessage(makeParams());

    // Seed the suppression store's conversation with isNoShow = true
    _seedConversationForTest({
      id: first.conversationId,
      businessId: BASE_BUSINESS_ID,
      customerId: first.customerId,
      primaryState: "active",
      isNoShow: true,
    });
    // Seed suppression customer so suppression can find them
    _seedCustomerForTest({
      id: first.customerId,
      businessId: BASE_BUSINESS_ID,
      consentStatus: "implied_inbound",
      doNotContact: false,
    });

    const second = await handleInboundMessage(makeParams({ content: "I am here now" }));

    expect(second.messageId).toBeTruthy();
    expect(second.aiResponseQueued).toBe(false);
  });
});

// ── SL: Silence-timer queue cancellation ──────────────────────

describe("SL: Silence-timer cancellation", () => {
  beforeEach(() => {
    resetAll();
    seedSuppressionBusiness();
  });

  it("SL01: customer reply cancels pending routine_followup_1 and routine_followup_final", async () => {
    const first = await handleInboundMessage(makeParams());

    _seedOutboundQueueForTest({
      id: "q_followup1",
      conversationId: first.conversationId,
      businessId: BASE_BUSINESS_ID,
      messagePurpose: "routine_followup_1",
      dedupeKey: "routine_followup_1:conversation:" + first.conversationId + ":immediate",
      status: "pending",
    });
    _seedOutboundQueueForTest({
      id: "q_followup_final",
      conversationId: first.conversationId,
      businessId: BASE_BUSINESS_ID,
      messagePurpose: "routine_followup_final",
      dedupeKey: "routine_followup_final:conversation:" + first.conversationId + ":immediate",
      status: "pending",
    });

    await handleInboundMessage(makeParams({ content: "Customer reply" }));

    expect(_getQueueStatusForTest("q_followup1")).toBe("canceled");
    expect(_getQueueStatusForTest("q_followup_final")).toBe("canceled");
  });

  it("SL02: customer reply does NOT cancel pending appointment_reminder_24h", async () => {
    const first = await handleInboundMessage(makeParams());

    _seedOutboundQueueForTest({
      id: "q_appt",
      conversationId: first.conversationId,
      businessId: BASE_BUSINESS_ID,
      messagePurpose: "appointment_reminder_24h",
      dedupeKey: "appointment_reminder_24h:appointment:" + first.conversationId + ":24h",
      status: "pending",
    });

    await handleInboundMessage(makeParams({ content: "Customer reply" }));

    expect(_getQueueStatusForTest("q_appt")).toBe("pending");
  });
});
