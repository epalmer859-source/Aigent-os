// ============================================================
// src/engine/suppression/__tests__/weird-hours.test.ts
//
// WEIRD-HOURS DEFERRAL — Doc 02 §5 tests (Finding 5)
//
// Follow-up messages scheduled within the 6-hour pre-quiet window
// are deferred when the last AI outbound was also in that window.
//
// All tests use UTC timezone with quietHours 22:00–06:00.
// Weird window = [16:00, 22:00).
//
// Test categories:
//   WH01  follow-up at 17:00, last AI at 16:00 → defer to 07:00
//   WH02  follow-up at 15:00 (outside 6h window) → send
//   WH03  booking_confirmation at 17:00 → send (not a follow-up)
//   WH04  follow-up at 17:00 but no previous AI message in window → send
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

const BIZ_ID = "biz_wh_test";
const CUSTOMER_ID = "cust_wh_test";
const CONV_ID = "conv_wh_test";

// ── Helpers ───────────────────────────────────────────────────

function makeContext(purpose: string): MessageContext {
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

// ── WH: Weird-hours tests ─────────────────────────────────────

describe("WH: Weird-hours deferral (Doc 02 §5)", () => {
  beforeEach(() => {
    _resetSuppressionStoreForTest();
    seedBase();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("WH01: follow-up at 17:00 UTC, last AI message at 16:00 UTC → defer to 07:00 next day", async () => {
    // Fix "now" to 17:00 UTC (in the 6h pre-quiet window 16:00–22:00)
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T17:00:00.000Z"));

    // Seed a prior AI outbound at 16:00 UTC (also in the window)
    _seedMessageLogForTest({
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      direction: "outbound",
      senderType: "ai",
      createdAt: new Date("2024-06-15T16:00:00.000Z"),
    });

    const result = await shouldSendMessage(makeContext("routine_followup_1"));

    expect(result.decision).toBe("defer");
    expect(result.reason).toBe("weird_hours");
    // deferUntil should be 07:00 on 2024-06-16 (06:00 quiet end + 1h)
    expect(result.deferUntil).toBeDefined();
    const deferHour = result.deferUntil!.getUTCHours();
    expect(deferHour).toBe(7);
  });

  it("WH02: follow-up at 15:00 UTC (outside 6h window) → send normally", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T15:00:00.000Z")); // 15:00, window starts at 16:00

    _seedMessageLogForTest({
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      direction: "outbound",
      senderType: "ai",
      createdAt: new Date("2024-06-15T14:00:00.000Z"),
    });

    const result = await shouldSendMessage(makeContext("routine_followup_1"));

    expect(result.decision).toBe("send");
  });

  it("WH03: booking_confirmation at 17:00 → send normally (not a follow-up purpose)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T17:00:00.000Z"));

    _seedMessageLogForTest({
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      direction: "outbound",
      senderType: "ai",
      createdAt: new Date("2024-06-15T16:30:00.000Z"),
    });

    // booking_confirmation is not in the weird-hours followup set
    const result = await shouldSendMessage(makeContext("booking_confirmation"));

    expect(result.decision).toBe("send");
  });

  it("WH04: follow-up at 17:00 but no previous AI message in weird window → send normally", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T17:00:00.000Z"));

    // Seed a message OUTSIDE the window (at 10:00, well before 16:00)
    _seedMessageLogForTest({
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      direction: "outbound",
      senderType: "ai",
      createdAt: new Date("2024-06-15T10:00:00.000Z"),
    });

    const result = await shouldSendMessage(makeContext("quote_followup_1"));

    // Last AI message (10:00) was NOT in the weird window [16:00, 22:00) → send
    expect(result.decision).toBe("send");
  });
});
