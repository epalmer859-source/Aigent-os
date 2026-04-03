// ============================================================
// src/engine/suppression/__tests__/hourly-limit.test.ts
//
// HOURLY HARD RATE LIMIT — G7 tests (Finding 8)
//
// Prevents runaway bugs from sending ≥10 messages per hour
// to a single conversation.  Applies to ALL purposes.
//
// Test categories:
//   HL01  10 outbound messages in last 60 min → suppress
//   HL02  9 outbound messages in last 60 min → send
//   HL03  10 messages but oldest is 61 min ago → send
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  shouldSendMessage,
  _resetSuppressionStoreForTest,
  _seedBusinessForTest,
  _seedCustomerForTest,
  _seedConversationForTest,
  _seedMessageLogForTest,
} from "../index";

import type { MessageContext } from "../contract";

// ── Constants ─────────────────────────────────────────────────

const BIZ_ID = "biz_hl_test";
const CUSTOMER_ID = "cust_hl_test";
const CONV_ID = "conv_hl_test";

// ── Helpers ───────────────────────────────────────────────────

// Use dispatch_notice (urgent) so G6 (24h cap) is skipped and G7 is
// the first gate that can fire.  G7 spec: applies to ALL purposes including urgent.
function makeContext(purpose = "dispatch_notice"): MessageContext {
  return {
    businessId: BIZ_ID,
    conversationId: CONV_ID,
    customerId: CUSTOMER_ID,
    messagePurpose: purpose,
    channel: "sms",
  };
}

function seedBase(): void {
  _seedBusinessForTest({
    id: BIZ_ID,
    isPaused: false,
    quietHoursStart: "22:00",
    quietHoursEnd: "06:00",
    timezone: "UTC",
  });
  _seedCustomerForTest({
    id: CUSTOMER_ID,
    businessId: BIZ_ID,
    consentStatus: "implied_inbound",
    doNotContact: false,
  });
  _seedConversationForTest({
    id: CONV_ID,
    businessId: BIZ_ID,
    customerId: CUSTOMER_ID,
    primaryState: "new_lead",
    isNoShow: false,
  });
}

function seedRecentOutbound(count: number, minutesAgoStart = 5): void {
  for (let i = 0; i < count; i++) {
    _seedMessageLogForTest({
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      direction: "outbound",
      senderType: "ai",
      createdAt: new Date(Date.now() - (minutesAgoStart + i) * 60 * 1000),
    });
  }
}

// ── HL: Hourly limit tests ────────────────────────────────────

describe("HL: Hourly hard rate limit (G7)", () => {
  beforeEach(() => {
    _resetSuppressionStoreForTest();
    seedBase();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("HL01: 10 outbound messages in last 60 minutes → suppress with hourly_hard_limit", async () => {
    seedRecentOutbound(10); // 10 messages, each 5-15 min ago

    const result = await shouldSendMessage(makeContext());

    expect(result.decision).toBe("suppress");
    expect(result.reason).toBe("hourly_hard_limit");
  });

  it("HL02: 9 outbound messages in last 60 minutes → send normally", async () => {
    seedRecentOutbound(9);

    const result = await shouldSendMessage(makeContext());

    expect(result.decision).toBe("send");
  });

  it("HL03: 10 messages but the oldest is 61 minutes ago (outside window) → send normally", async () => {
    vi.useFakeTimers();
    const now = new Date("2024-06-15T12:00:00.000Z");
    vi.setSystemTime(now);

    // 9 messages within the last 60 min (at 1–9 min ago)
    for (let i = 1; i <= 9; i++) {
      _seedMessageLogForTest({
        conversationId: CONV_ID,
        businessId: BIZ_ID,
        direction: "outbound",
        senderType: "ai",
        createdAt: new Date(now.getTime() - i * 60 * 1000),
      });
    }
    // 1 message at exactly 61 minutes ago — just outside the window
    _seedMessageLogForTest({
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      direction: "outbound",
      senderType: "ai",
      createdAt: new Date(now.getTime() - 61 * 60 * 1000),
    });

    const result = await shouldSendMessage(makeContext());

    // Only 9 within the last 60 min, so no suppression
    expect(result.decision).toBe("send");
  });
});
