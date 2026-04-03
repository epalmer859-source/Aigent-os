// ============================================================
// src/engine/web-chat/__tests__/web-chat.test.ts
//
// WEB CHAT ENDPOINT — UNIT TESTS
//
// Test categories:
//   WC01  First message creates session
//   WC02  Subsequent message reuses session
//   WC03  Expired session rejected
//   WC04  Invalid business ID rejected
//   WC05  Rate limit enforced
//   WC06  Session businessId mismatch rejected
//   WC07  Empty content rejected
//   WC08  Inbound handler called with channel = 'web_chat'
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";

import {
  handleWebChatMessage,
  _resetWebChatStoreForTest,
  _seedSessionForTest,
  _seedBusinessForTest,
  _setInboundHandlerForTest,
  _getSessionForTest,
} from "../index";

import {
  RATE_LIMIT_PER_HOUR,
  WEB_CHAT_CHANNEL,
  type WebChatInboundParams,
} from "../contract";

// ── Constants ─────────────────────────────────────────────────

const BIZ_ID = "biz_wc_001";
const OTHER_BIZ_ID = "biz_wc_002";

// ── Helpers ───────────────────────────────────────────────────

function seedBusiness(id = BIZ_ID): void {
  _seedBusinessForTest({ id, deletedAt: null });
}

function futureDate(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function pastDate(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

// ── Tests ─────────────────────────────────────────────────────

describe("WC: Web chat endpoint", () => {
  beforeEach(() => {
    _resetWebChatStoreForTest();
    seedBusiness();
    _setInboundHandlerForTest(async () => ({
      success: true,
      messageId: "msg_wc_001",
      customerId: "cust_wc_001",
      conversationId: "conv_wc_001",
    }));
  });

  it("WC01: first message with no sessionToken → creates session, returns sessionToken", async () => {
    const result = await handleWebChatMessage({
      businessId: BIZ_ID,
      content: "Hi, I need a quote for drain cleaning",
    });

    expect(result.success).toBe(true);
    expect(result.sessionToken).toBeTruthy();
    expect(result.messageId).toBe("msg_wc_001");

    // Session should be persisted
    const session = _getSessionForTest(result.sessionToken);
    expect(session).toBeTruthy();
    expect(session?.businessId).toBe(BIZ_ID);
    expect(session?.messageCount).toBe(1);
  });

  it("WC02: subsequent message with valid sessionToken → processes message, same session", async () => {
    // First message
    const first = await handleWebChatMessage({
      businessId: BIZ_ID,
      content: "Hello",
    });
    expect(first.success).toBe(true);
    const token = first.sessionToken;

    // Second message using same token
    const second = await handleWebChatMessage({
      businessId: BIZ_ID,
      content: "I also need a water heater installed",
      sessionToken: token,
    });

    expect(second.success).toBe(true);
    expect(second.sessionToken).toBe(token);

    const session = _getSessionForTest(token);
    expect(session?.messageCount).toBe(2);
  });

  it("WC03: expired session token → returns error session_expired", async () => {
    _seedSessionForTest({
      id: "expired_token_001",
      businessId: BIZ_ID,
      conversationId: null,
      customerId: null,
      messageCount: 5,
      createdAt: pastDate(25),
      expiresAt: pastDate(1), // expired 1 hour ago
    });

    const result = await handleWebChatMessage({
      businessId: BIZ_ID,
      content: "Still there?",
      sessionToken: "expired_token_001",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("session_expired");
  });

  it("WC04: invalid business ID → returns error", async () => {
    const result = await handleWebChatMessage({
      businessId: "nonexistent_biz",
      content: "Hello",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/business/i);
  });

  it("WC05: rate limit exceeded (messageCount at limit) → returns error rate_limited", async () => {
    _seedSessionForTest({
      id: "session_ratelimit",
      businessId: BIZ_ID,
      conversationId: "conv_001",
      customerId: "cust_001",
      messageCount: RATE_LIMIT_PER_HOUR, // already at the limit
      createdAt: new Date(),
      expiresAt: futureDate(23),
    });

    const result = await handleWebChatMessage({
      businessId: BIZ_ID,
      content: "One more message",
      sessionToken: "session_ratelimit",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("rate_limited");

    // messageCount must not have incremented
    const session = _getSessionForTest("session_ratelimit");
    expect(session?.messageCount).toBe(RATE_LIMIT_PER_HOUR);
  });

  it("WC06: session businessId mismatch → returns error session_mismatch", async () => {
    seedBusiness(OTHER_BIZ_ID);
    _seedSessionForTest({
      id: "session_mismatch_001",
      businessId: OTHER_BIZ_ID,
      conversationId: null,
      customerId: null,
      messageCount: 0,
      createdAt: new Date(),
      expiresAt: futureDate(23),
    });

    const result = await handleWebChatMessage({
      businessId: BIZ_ID, // different from session's businessId
      content: "Hello",
      sessionToken: "session_mismatch_001",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("session_mismatch");
  });

  it("WC07: empty content → returns validation error", async () => {
    const result = await handleWebChatMessage({
      businessId: BIZ_ID,
      content: "",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("WC08: valid message hands off to inbound handler with channel = web_chat", async () => {
    let capturedParams: WebChatInboundParams | undefined;
    _setInboundHandlerForTest(async (params) => {
      capturedParams = params;
      return { success: true, messageId: "msg_capture_001" };
    });

    await handleWebChatMessage({
      businessId: BIZ_ID,
      content: "Need a plumber today",
    });

    expect(capturedParams).toBeTruthy();
    expect(capturedParams?.channel).toBe(WEB_CHAT_CHANNEL);
    expect(capturedParams?.businessId).toBe(BIZ_ID);
    expect(capturedParams?.content).toBe("Need a plumber today");
  });
});
