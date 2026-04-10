// ============================================================
// src/engine/suppression/__tests__/suppression.test.ts
//
// SUPPRESSION ENGINE — CONTRACT + IMPLEMENTATION TESTS
//
// ALL TESTS FAIL until the implementation file is created at:
//   src/engine/suppression/index.ts
//
// The module-not-found import below intentionally causes this
// entire file to fail at load time.
//
// Test categories:
//   G — Global suppression rules (G1–G6)
//   P — Per-purpose suppression rules
//   D — Dedupe key collision
//   Q — cancelQuoteFollowups
//   C — cancelByDependency
//
// The implementation must maintain in-memory stores (same pattern as
// state-machine/index.ts) and expose the _seed* and _reset* helpers
// below for test isolation. No real DB connection is used.
// ============================================================

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import type { MessageContext } from "../contract";

// ⚠ This import will fail until the implementation exists.
// That is intentional — all tests below should fail until
// src/engine/suppression/index.ts is created.
import {
  shouldSendMessage,
  cancelQuoteFollowups,
  cancelByDependency,
  _resetSuppressionStoreForTest,
  _seedBusinessForTest,
  _seedCustomerForTest,
  _seedConversationForTest,
  _seedConversationTagForTest,
  _seedMessageLogForTest,
  _seedOutboundQueueForTest,
  _seedAppointmentChangeRequestForTest,
  _seedRecurringServiceForTest,
  _getQueueStatusForTest,
} from "../index";

// ── Fixed test IDs ────────────────────────────────────────────

const BIZ_ID = "biz-suppression-test";
const CUSTOMER_ID = "cust-suppression-test";
const CONV_ID = "conv-suppression-test";

// ── Helpers ───────────────────────────────────────────────────

function makeContext(overrides: Partial<MessageContext> = {}): MessageContext {
  return {
    businessId: BIZ_ID,
    conversationId: CONV_ID,
    customerId: CUSTOMER_ID,
    messagePurpose: "routine_followup_1",
    channel: "sms",
    ...overrides,
  };
}

/** Seed minimal valid state required for most tests to reach the rule under test. */
function seedBase(
  primaryState = "lead_qualified",
  overrides: {
    isPaused?: boolean;
    consentStatus?: "implied_inbound" | "opted_out" | "resubscribed";
    doNotContact?: boolean;
    isNoShow?: boolean;
  } = {},
): void {
  _seedBusinessForTest({
    id: BIZ_ID,
    isPaused: overrides.isPaused ?? false,
    quietHoursStart: "22:00",
    quietHoursEnd: "06:00",
    timezone: "UTC",
  });
  _seedCustomerForTest({
    id: CUSTOMER_ID,
    businessId: BIZ_ID,
    consentStatus: overrides.consentStatus ?? "implied_inbound",
    doNotContact: overrides.doNotContact ?? false,
  });
  _seedConversationForTest({
    id: CONV_ID,
    businessId: BIZ_ID,
    customerId: CUSTOMER_ID,
    primaryState,
    isNoShow: overrides.isNoShow ?? false,
  });
}

// Reset all in-memory state before every test.
beforeEach(() => {
  _resetSuppressionStoreForTest();
});

// ═══════════════════════════════════════════════════════════════
// G — GLOBAL SUPPRESSION RULES
// Checked in order G1→G6. First match wins.
// ═══════════════════════════════════════════════════════════════

describe("G — Global suppression rules", () => {
  it("G01: business is_paused → suppress all customer-facing purposes", async () => {
    seedBase("lead_qualified", { isPaused: true });
    const result = await shouldSendMessage(makeContext());
    expect(result.decision).toBe("suppress");
    expect(result.reason).toBe("business_paused");
  });

  it("G02: business is_paused but purpose = pause_message → send", async () => {
    seedBase("lead_qualified", { isPaused: true });
    const result = await shouldSendMessage(
      makeContext({ messagePurpose: "pause_message" }),
    );
    expect(result.decision).toBe("send");
  });

  it("G03: customer consent_status = opted_out → suppress", async () => {
    seedBase("lead_qualified", { consentStatus: "opted_out" });
    const result = await shouldSendMessage(makeContext());
    expect(result.decision).toBe("suppress");
    expect(result.reason).toBe("opted_out");
  });

  it("G04: conversation is_no_show = true → suppress", async () => {
    seedBase("booked", { isNoShow: true });
    const result = await shouldSendMessage(
      makeContext({ messagePurpose: "appointment_reminder_24h" }),
    );
    expect(result.decision).toBe("suppress");
    expect(result.reason).toBe("no_show");
  });

  it("G05: customer do_not_contact = true → suppress customer-facing purpose", async () => {
    seedBase("lead_qualified", { doNotContact: true });
    const result = await shouldSendMessage(makeContext());
    expect(result.decision).toBe("suppress");
    expect(result.reason).toBe("do_not_contact");
  });

  it("G06: customer do_not_contact = true → allow internal message", async () => {
    seedBase("lead_qualified", { doNotContact: true });
    const result = await shouldSendMessage(
      makeContext({ messagePurpose: "escalation_alert" }),
    );
    // Internal messages are not suppressed by do_not_contact.
    expect(result.decision).toBe("send");
  });

  it("G07: conversation tag do_not_contact (is_active=true) → suppress customer-facing", async () => {
    seedBase("lead_qualified");
    _seedConversationTagForTest({
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      tagCode: "do_not_contact",
      isActive: true,
    });
    const result = await shouldSendMessage(makeContext());
    expect(result.decision).toBe("suppress");
    expect(result.reason).toBe("do_not_contact");
  });

  it("G08: current time in quiet hours + non-urgent non-exempt purpose → defer", async () => {
    // Set system time to 23:00 UTC — within the business's 22:00–06:00 quiet window.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T23:00:00.000Z"));
    try {
      seedBase("lead_qualified");
      const result = await shouldSendMessage(
        makeContext({ messagePurpose: "routine_followup_1" }),
      );
      expect(result.decision).toBe("defer");
      expect(result.reason).toBe("quiet_hours");
      expect(result.deferUntil).toBeInstanceOf(Date);
    } finally {
      vi.useRealTimers();
    }
  });

  it("G09: current time in quiet hours + dispatch_notice (urgent) → send", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T23:00:00.000Z"));
    try {
      seedBase("en_route");
      const result = await shouldSendMessage(
        makeContext({ messagePurpose: "dispatch_notice" }),
      );
      expect(result.decision).toBe("send");
    } finally {
      vi.useRealTimers();
    }
  });

  it("G10: current time in quiet hours + missed_call_fallback (exempt) → send", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T23:00:00.000Z"));
    try {
      seedBase("new_lead");
      const result = await shouldSendMessage(
        makeContext({ messagePurpose: "missed_call_fallback" }),
      );
      expect(result.decision).toBe("send");
    } finally {
      vi.useRealTimers();
    }
  });

  it("G11: current time in quiet hours + handoff_response (exempt) → send", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T23:00:00.000Z"));
    try {
      seedBase("complaint_open");
      const result = await shouldSendMessage(
        makeContext({ messagePurpose: "handoff_response" }),
      );
      expect(result.decision).toBe("send");
    } finally {
      vi.useRealTimers();
    }
  });

  it("G12: rolling 24h cap already hit (2 non-urgent sent) + non-urgent purpose → suppress", async () => {
    seedBase("lead_qualified");
    const recentTime = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago
    _seedMessageLogForTest({
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      direction: "outbound",
      senderType: "ai",
      createdAt: recentTime,
    });
    _seedMessageLogForTest({
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      direction: "outbound",
      senderType: "ai",
      createdAt: recentTime,
    });
    const result = await shouldSendMessage(makeContext());
    expect(result.decision).toBe("suppress");
    expect(result.reason).toBe("24h_cap");
  });

  it("G13: rolling 24h cap hit + dispatch_notice (urgent, exempt from cap) → send", async () => {
    seedBase("en_route");
    const recentTime = new Date(Date.now() - 30 * 60 * 1000);
    _seedMessageLogForTest({
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      direction: "outbound",
      senderType: "ai",
      createdAt: recentTime,
    });
    _seedMessageLogForTest({
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      direction: "outbound",
      senderType: "ai",
      createdAt: recentTime,
    });
    const result = await shouldSendMessage(
      makeContext({ messagePurpose: "dispatch_notice" }),
    );
    expect(result.decision).toBe("send");
  });

  it("G14: all global checks pass, no per-purpose blocks → send", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T14:00:00.000Z")); // 2 PM UTC — well outside 22:00-06:00
    try {
      seedBase("lead_qualified");
      const result = await shouldSendMessage(makeContext());
      expect(result.decision).toBe("send");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// P — PER-PURPOSE SUPPRESSION RULES
// Only reached after all global checks pass.
// ═══════════════════════════════════════════════════════════════

describe("P — Per-purpose suppression rules", () => {
  it("P01: routine_followup_1 + conversation in override state → suppress", async () => {
    seedBase("complaint_open");
    const result = await shouldSendMessage(
      makeContext({ messagePurpose: "routine_followup_1" }),
    );
    expect(result.decision).toBe("suppress");
  });

  it("P02: routine_followup_1 + conversation in closed state → suppress", async () => {
    seedBase("closed_completed");
    const result = await shouldSendMessage(
      makeContext({ messagePurpose: "routine_followup_1" }),
    );
    expect(result.decision).toBe("suppress");
  });

  it("P03: routine_followup_1 + routine state, no per-purpose blocks → send", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T14:00:00.000Z")); // 2 PM UTC — well outside 22:00-06:00
    try {
      seedBase("lead_qualified");
      const result = await shouldSendMessage(
        makeContext({ messagePurpose: "routine_followup_1" }),
      );
      expect(result.decision).toBe("send");
    } finally {
      vi.useRealTimers();
    }
  });

  it("P04: quote_followup_1 + conversation in override state → suppress", async () => {
    seedBase("billing_dispute_open");
    const result = await shouldSendMessage(
      makeContext({ messagePurpose: "quote_followup_1" }),
    );
    expect(result.decision).toBe("suppress");
  });

  it("P05: appointment_reminder_24h + override state → suppress", async () => {
    seedBase("safety_issue_open");
    const result = await shouldSendMessage(
      makeContext({ messagePurpose: "appointment_reminder_24h" }),
    );
    expect(result.decision).toBe("suppress");
  });

  it("P06: appointment_reminder_24h + accepted_from_customer change request → suppress", async () => {
    seedBase("booked");
    _seedAppointmentChangeRequestForTest({
      id: "acr-001",
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      requestStatus: "accepted_from_customer",
    });
    const result = await shouldSendMessage(
      makeContext({ messagePurpose: "appointment_reminder_24h" }),
    );
    expect(result.decision).toBe("suppress");
    expect(result.reason).toBe("appointment_change_requested");
  });

  it("P07: appointment_reminder_24h + state = booked, no blocks → send", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T14:00:00.000Z")); // 2 PM UTC — well outside 22:00-06:00
    try {
      seedBase("booked");
      const result = await shouldSendMessage(
        makeContext({ messagePurpose: "appointment_reminder_24h" }),
      );
      expect(result.decision).toBe("send");
    } finally {
      vi.useRealTimers();
    }
  });

  it("P08: appointment_reminder_24h + state = en_route → suppress (not in allowed states)", async () => {
    seedBase("en_route");
    const result = await shouldSendMessage(
      makeContext({ messagePurpose: "appointment_reminder_24h" }),
    );
    expect(result.decision).toBe("suppress");
  });

  it("P09: appointment_reminder_3h + state = en_route → send (en_route is allowed for 3h)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T14:00:00.000Z")); // 2 PM UTC — well outside 22:00-06:00
    try {
      seedBase("en_route");
      const result = await shouldSendMessage(
        makeContext({ messagePurpose: "appointment_reminder_3h" }),
      );
      expect(result.decision).toBe("send");
    } finally {
      vi.useRealTimers();
    }
  });

  it("P10: closeout + override state → suppress", async () => {
    seedBase("complaint_open");
    const result = await shouldSendMessage(
      makeContext({ messagePurpose: "closeout" }),
    );
    expect(result.decision).toBe("suppress");
  });

  it("P11: closeout + negative_service_signal tag → suppress", async () => {
    seedBase("job_completed");
    _seedConversationTagForTest({
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      tagCode: "negative_service_signal",
      isActive: true,
    });
    const result = await shouldSendMessage(
      makeContext({ messagePurpose: "closeout" }),
    );
    expect(result.decision).toBe("suppress");
    expect(result.reason).toBe("negative_service_signal");
  });

  it("P12: closeout + closeout_blocked tag → suppress", async () => {
    seedBase("job_completed");
    _seedConversationTagForTest({
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      tagCode: "closeout_blocked",
      isActive: true,
    });
    const result = await shouldSendMessage(
      makeContext({ messagePurpose: "closeout" }),
    );
    expect(result.decision).toBe("suppress");
    expect(result.reason).toBe("closeout_blocked");
  });

  it("P13: closeout + state = job_completed, no blocking tags → send", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T14:00:00.000Z")); // 2 PM UTC — well outside 22:00-06:00
    try {
      seedBase("job_completed");
      const result = await shouldSendMessage(
        makeContext({ messagePurpose: "closeout" }),
      );
      expect(result.decision).toBe("send");
    } finally {
      vi.useRealTimers();
    }
  });

  it("P14: stale_waiting_customer_update + any override state → suppress", async () => {
    seedBase("incident_liability_open");
    const result = await shouldSendMessage(
      makeContext({ messagePurpose: "stale_waiting_customer_update" }),
    );
    expect(result.decision).toBe("suppress");
  });

  it("P15: stale_waiting_customer_update + non-override non-closed state → send", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T14:00:00.000Z")); // 2 PM UTC — well outside 22:00-06:00
    try {
      seedBase("waiting_on_admin_quote");
      const result = await shouldSendMessage(
        makeContext({ messagePurpose: "stale_waiting_customer_update" }),
      );
      expect(result.decision).toBe("send");
    } finally {
      vi.useRealTimers();
    }
  });

  it("P16: recurring_reminder + recurring_services.status = paused → suppress", async () => {
    seedBase("booked");
    const SERVICE_ID = "svc-test-001";
    _seedRecurringServiceForTest({
      id: SERVICE_ID,
      businessId: BIZ_ID,
      status: "paused",
    });
    const result = await shouldSendMessage(
      makeContext({
        messagePurpose: "recurring_reminder",
        recurringServiceId: SERVICE_ID,
      }),
    );
    expect(result.decision).toBe("suppress");
    expect(result.reason).toBe("recurring_service_paused");
  });

  it("P17: recurring_reminder + active service, no blocks → send", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T14:00:00.000Z")); // 2 PM UTC — well outside 22:00-06:00
    try {
      seedBase("booked");
      const SERVICE_ID = "svc-test-002";
      _seedRecurringServiceForTest({
        id: SERVICE_ID,
        businessId: BIZ_ID,
        status: "active",
      });
      const result = await shouldSendMessage(
        makeContext({
          messagePurpose: "recurring_reminder",
          recurringServiceId: SERVICE_ID,
        }),
      );
      expect(result.decision).toBe("send");
    } finally {
      vi.useRealTimers();
    }
  });

  it("P18: missed_call_fallback + human_takeover_active → suppress", async () => {
    seedBase("human_takeover_active");
    const result = await shouldSendMessage(
      makeContext({ messagePurpose: "missed_call_fallback" }),
    );
    expect(result.decision).toBe("suppress");
  });

  it("P19: missed_call_fallback + normal state → send", async () => {
    seedBase("new_lead");
    const result = await shouldSendMessage(
      makeContext({ messagePurpose: "missed_call_fallback" }),
    );
    expect(result.decision).toBe("send");
  });

  it("P20: booking_confirmation + human_takeover_active → suppress", async () => {
    seedBase("human_takeover_active");
    const result = await shouldSendMessage(
      makeContext({ messagePurpose: "booking_confirmation" }),
    );
    expect(result.decision).toBe("suppress");
  });
});

// ═══════════════════════════════════════════════════════════════
// D — DEDUPE KEY COLLISION
// ═══════════════════════════════════════════════════════════════

describe("D — Dedupe key collision", () => {
  it("D01: duplicate dedupe_key exists in non-terminal status → suppress", async () => {
    seedBase("lead_qualified");
    const dedupeKey = `routine_followup_1:${CONV_ID}:active-cycle`;
    _seedOutboundQueueForTest({
      id: "oq-dup-001",
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      messagePurpose: "routine_followup_1",
      dedupeKey,
      status: "pending",
    });
    const result = await shouldSendMessage(makeContext({ dedupeKey }));
    expect(result.decision).toBe("suppress");
    expect(result.reason).toBe("duplicate_dedupe_key");
  });

  it("D02: duplicate dedupe_key exists but status = sent (terminal) → send", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T14:00:00.000Z")); // 2 PM UTC — well outside 22:00-06:00
    try {
      seedBase("lead_qualified");
      const dedupeKey = `routine_followup_1:${CONV_ID}:old-cycle`;
      _seedOutboundQueueForTest({
        id: "oq-term-001",
        conversationId: CONV_ID,
        businessId: BIZ_ID,
        messagePurpose: "routine_followup_1",
        dedupeKey,
        status: "sent",
      });
      const result = await shouldSendMessage(makeContext({ dedupeKey }));
      expect(result.decision).toBe("send");
    } finally {
      vi.useRealTimers();
    }
  });

  it("D03: duplicate dedupe_key exists but status = canceled (terminal) → send", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T14:00:00.000Z")); // 2 PM UTC — well outside 22:00-06:00
    try {
      seedBase("lead_qualified");
      const dedupeKey = `routine_followup_1:${CONV_ID}:canceled-cycle`;
      _seedOutboundQueueForTest({
        id: "oq-term-002",
        conversationId: CONV_ID,
        businessId: BIZ_ID,
        messagePurpose: "routine_followup_1",
        dedupeKey,
        status: "canceled",
      });
      const result = await shouldSendMessage(makeContext({ dedupeKey }));
      expect(result.decision).toBe("send");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Q — cancelQuoteFollowups
// ═══════════════════════════════════════════════════════════════

describe("Q — cancelQuoteFollowups", () => {
  it("Q01: cancels all pending quote_followup_1 and quote_followup_final rows", async () => {
    const id1 = "oq-qf-001";
    const id2 = "oq-qf-002";
    _seedOutboundQueueForTest({
      id: id1,
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      messagePurpose: "quote_followup_1",
      dedupeKey: `quote_followup_1:${CONV_ID}:1`,
      status: "pending",
    });
    _seedOutboundQueueForTest({
      id: id2,
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      messagePurpose: "quote_followup_final",
      dedupeKey: `quote_followup_final:${CONV_ID}:1`,
      status: "deferred",
    });
    await cancelQuoteFollowups(CONV_ID);
    expect(_getQueueStatusForTest(id1)).toBe("canceled");
    expect(_getQueueStatusForTest(id2)).toBe("canceled");
  });

  it("Q02: returns count of rows canceled", async () => {
    _seedOutboundQueueForTest({
      id: "oq-qf-c1",
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      messagePurpose: "quote_followup_1",
      dedupeKey: `quote_followup_1:${CONV_ID}:c1`,
      status: "pending",
    });
    _seedOutboundQueueForTest({
      id: "oq-qf-c2",
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      messagePurpose: "quote_followup_final",
      dedupeKey: `quote_followup_final:${CONV_ID}:c2`,
      status: "pending",
    });
    const count = await cancelQuoteFollowups(CONV_ID);
    expect(count).toBe(2);
  });

  it("Q03: does not affect already-sent or already-failed rows", async () => {
    const sentId = "oq-qf-sent";
    const failId = "oq-qf-fail";
    _seedOutboundQueueForTest({
      id: sentId,
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      messagePurpose: "quote_followup_1",
      dedupeKey: `quote_followup_1:${CONV_ID}:sent`,
      status: "sent",
    });
    _seedOutboundQueueForTest({
      id: failId,
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      messagePurpose: "quote_followup_final",
      dedupeKey: `quote_followup_final:${CONV_ID}:fail`,
      status: "failed_terminal",
    });
    const count = await cancelQuoteFollowups(CONV_ID);
    expect(count).toBe(0);
    expect(_getQueueStatusForTest(sentId)).toBe("sent");
    expect(_getQueueStatusForTest(failId)).toBe("failed_terminal");
  });
});

// ═══════════════════════════════════════════════════════════════
// C — cancelByDependency
// ═══════════════════════════════════════════════════════════════

describe("C — cancelByDependency", () => {
  it("C01: cancels all non-terminal queue rows matching dependency prefix", async () => {
    const quoteId = "quote-abc-123";
    const id1 = "oq-dep-001";
    const id2 = "oq-dep-002";
    _seedOutboundQueueForTest({
      id: id1,
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      messagePurpose: "stale_waiting_internal_ping",
      dedupeKey: `stale_waiting_internal_ping:quote:${quoteId}:immediate`,
      status: "pending",
    });
    _seedOutboundQueueForTest({
      id: id2,
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      messagePurpose: "stale_waiting_customer_update",
      dedupeKey: `stale_waiting_customer_update:quote:${quoteId}:6h`,
      status: "deferred",
    });
    await cancelByDependency("quote", quoteId);
    expect(_getQueueStatusForTest(id1)).toBe("canceled");
    expect(_getQueueStatusForTest(id2)).toBe("canceled");
  });

  it("C02: returns count of rows canceled", async () => {
    const schedId = "sched-xyz-456";
    _seedOutboundQueueForTest({
      id: "oq-dep-c1",
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      messagePurpose: "stale_waiting_internal_ping",
      dedupeKey: `stale_waiting_internal_ping:scheduling:${schedId}:immediate`,
      status: "pending",
    });
    _seedOutboundQueueForTest({
      id: "oq-dep-c2",
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      messagePurpose: "stale_waiting_internal_ping",
      dedupeKey: `stale_waiting_internal_ping:scheduling:${schedId}:6h`,
      status: "claimed",
    });
    const count = await cancelByDependency("scheduling", schedId);
    expect(count).toBe(2);
  });

  it("C03: does not affect terminal rows with matching prefix", async () => {
    const partsId = "parts-pqr-789";
    const sentId = "oq-dep-sent";
    const canceledId = "oq-dep-canceled";
    _seedOutboundQueueForTest({
      id: sentId,
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      messagePurpose: "stale_waiting_customer_update_parts",
      dedupeKey: `stale_waiting_customer_update_parts:parts:${partsId}:6h`,
      status: "sent",
    });
    _seedOutboundQueueForTest({
      id: canceledId,
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      messagePurpose: "stale_waiting_customer_update_parts",
      dedupeKey: `stale_waiting_customer_update_parts:parts:${partsId}:24h`,
      status: "canceled",
    });
    const count = await cancelByDependency("parts", partsId);
    expect(count).toBe(0);
    expect(_getQueueStatusForTest(sentId)).toBe("sent");
    expect(_getQueueStatusForTest(canceledId)).toBe("canceled");
  });
});
