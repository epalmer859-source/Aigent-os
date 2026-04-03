// ============================================================
// src/engine/analytics/__tests__/analytics.test.ts
//
// ANALYTICS tRPC QUERIES — UNIT TESTS
//
// Test categories:
//   AN01  getOverviewMetrics returns all four sub-metric groups
//   AN02  getConversationMetrics counts by state correctly
//   AN03  getConversationMetrics with empty data returns all zeros
//   AN04  getMessageMetrics counts inbound vs outbound correctly
//   AN05  getMessageMetrics counts AI vs admin messages correctly
//   AN06  getAppointmentMetrics calculates completionRate correctly
//   AN07  getAppointmentMetrics with zero appointments returns 0 rate
//   AN08  getQuoteMetrics calculates acceptanceRate correctly
//   AN09  dateRange filter — data outside range not counted
//   AN10  reopenedCount only counts conversations with repeat_customer tag
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";

import {
  getOverviewMetrics,
  getConversationMetrics,
  getMessageMetrics,
  getAppointmentMetrics,
  getQuoteMetrics,
  _resetAnalyticsStoreForTest,
  _seedConversationForTest,
  _seedMessageForTest,
  _seedAppointmentForTest,
  _seedQuoteForTest,
} from "../index";

// ── Constants ─────────────────────────────────────────────────

const BIZ_ID = "biz_an_001";

// ── Helpers ───────────────────────────────────────────────────

function dateRange(daysAgo: number, daysAhead = 0) {
  return {
    startDate: new Date(Date.now() - daysAgo * 86_400_000),
    endDate: new Date(Date.now() + daysAhead * 86_400_000),
  };
}

function withinRange(): Date {
  return new Date(Date.now() - 12 * 3600_000); // 12 hours ago
}

function outsideRange(): Date {
  return new Date(Date.now() - 10 * 86_400_000); // 10 days ago
}

let _id = 0;
function uid(prefix: string) {
  return `${prefix}_${++_id}`;
}

// ── Tests ─────────────────────────────────────────────────────

describe("AN: Analytics queries", () => {
  beforeEach(() => {
    _resetAnalyticsStoreForTest();
    _id = 0;
  });

  it("AN01: getOverviewMetrics returns all four sub-metric groups", async () => {
    const result = await getOverviewMetrics({
      businessId: BIZ_ID,
      dateRange: dateRange(7, 1),
    });

    expect(result).toHaveProperty("conversations");
    expect(result).toHaveProperty("messages");
    expect(result).toHaveProperty("appointments");
    expect(result).toHaveProperty("quotes");

    // Each group must have expected keys
    expect(result.conversations).toHaveProperty("totalConversations");
    expect(result.messages).toHaveProperty("totalInbound");
    expect(result.appointments).toHaveProperty("completionRate");
    expect(result.quotes).toHaveProperty("acceptanceRate");
  });

  it("AN02: getConversationMetrics counts by state correctly", async () => {
    const params = { businessId: BIZ_ID, dateRange: dateRange(7, 1) };
    const t = withinRange();

    _seedConversationForTest({ id: uid("conv"), businessId: BIZ_ID, primaryState: "new_lead", tags: [], createdAt: t, bookedAt: null });
    _seedConversationForTest({ id: uid("conv"), businessId: BIZ_ID, primaryState: "new_lead", tags: [], createdAt: t, bookedAt: null });
    _seedConversationForTest({ id: uid("conv"), businessId: BIZ_ID, primaryState: "booked", tags: [], createdAt: t, bookedAt: new Date(t.getTime() + 3600_000) });
    _seedConversationForTest({ id: uid("conv"), businessId: BIZ_ID, primaryState: "closed_lost", tags: [], createdAt: t, bookedAt: null });
    _seedConversationForTest({ id: uid("conv"), businessId: BIZ_ID, primaryState: "closed_completed", tags: [], createdAt: t, bookedAt: new Date(t.getTime() + 7200_000) });

    const result = await getConversationMetrics(params);

    expect(result.totalConversations).toBe(5);
    expect(result.newLeads).toBe(2);
    expect(result.convertedToBooked).toBe(2); // booked + closed_completed both reached booked
    expect(result.closedLost).toBe(1);
    expect(result.closedCompleted).toBe(1);
  });

  it("AN03: getConversationMetrics with empty data returns all zeros and null", async () => {
    const result = await getConversationMetrics({
      businessId: BIZ_ID,
      dateRange: dateRange(7, 1),
    });

    expect(result.totalConversations).toBe(0);
    expect(result.newLeads).toBe(0);
    expect(result.convertedToBooked).toBe(0);
    expect(result.closedLost).toBe(0);
    expect(result.closedCompleted).toBe(0);
    expect(result.avgTimeToBookingMs).toBeNull();
    expect(result.reopenedCount).toBe(0);
  });

  it("AN04: getMessageMetrics counts inbound vs outbound correctly", async () => {
    const t = withinRange();
    const params = { businessId: BIZ_ID, dateRange: dateRange(7, 1) };

    _seedMessageForTest({ id: uid("msg"), businessId: BIZ_ID, conversationId: "conv_001", direction: "inbound", senderType: "customer", createdAt: t });
    _seedMessageForTest({ id: uid("msg"), businessId: BIZ_ID, conversationId: "conv_001", direction: "inbound", senderType: "customer", createdAt: t });
    _seedMessageForTest({ id: uid("msg"), businessId: BIZ_ID, conversationId: "conv_001", direction: "outbound", senderType: "ai", createdAt: t });
    _seedMessageForTest({ id: uid("msg"), businessId: BIZ_ID, conversationId: "conv_001", direction: "outbound", senderType: "admin_team", createdAt: t });

    const result = await getMessageMetrics(params);

    expect(result.totalInbound).toBe(2);
    expect(result.totalOutbound).toBe(2);
  });

  it("AN05: getMessageMetrics counts AI vs admin messages correctly", async () => {
    const t = withinRange();
    const params = { businessId: BIZ_ID, dateRange: dateRange(7, 1) };

    _seedMessageForTest({ id: uid("msg"), businessId: BIZ_ID, conversationId: "conv_001", direction: "outbound", senderType: "ai", createdAt: t });
    _seedMessageForTest({ id: uid("msg"), businessId: BIZ_ID, conversationId: "conv_001", direction: "outbound", senderType: "ai", createdAt: t });
    _seedMessageForTest({ id: uid("msg"), businessId: BIZ_ID, conversationId: "conv_001", direction: "outbound", senderType: "admin_team", createdAt: t });
    _seedMessageForTest({ id: uid("msg"), businessId: BIZ_ID, conversationId: "conv_001", direction: "outbound", senderType: "owner", createdAt: t });

    const result = await getMessageMetrics(params);

    expect(result.totalAIResponses).toBe(2);
    expect(result.totalAdminMessages).toBe(2);
  });

  it("AN06: getAppointmentMetrics calculates completionRate correctly", async () => {
    const t = withinRange();
    const params = { businessId: BIZ_ID, dateRange: dateRange(7, 1) };

    _seedAppointmentForTest({ id: uid("appt"), businessId: BIZ_ID, status: "completed", createdAt: t });
    _seedAppointmentForTest({ id: uid("appt"), businessId: BIZ_ID, status: "completed", createdAt: t });
    _seedAppointmentForTest({ id: uid("appt"), businessId: BIZ_ID, status: "completed", createdAt: t });
    _seedAppointmentForTest({ id: uid("appt"), businessId: BIZ_ID, status: "canceled", createdAt: t });
    _seedAppointmentForTest({ id: uid("appt"), businessId: BIZ_ID, status: "no_show", createdAt: t });

    const result = await getAppointmentMetrics(params);

    expect(result.totalCompleted).toBe(3);
    expect(result.totalCanceled).toBe(1);
    expect(result.totalNoShows).toBe(1);
    // completionRate = 3 / (3 + 1 + 1) = 0.6
    expect(result.completionRate).toBeCloseTo(0.6);
  });

  it("AN07: getAppointmentMetrics with zero appointments returns 0 rate", async () => {
    const result = await getAppointmentMetrics({
      businessId: BIZ_ID,
      dateRange: dateRange(7, 1),
    });

    expect(result.totalBooked).toBe(0);
    expect(result.completionRate).toBe(0);
  });

  it("AN08: getQuoteMetrics calculates acceptanceRate correctly", async () => {
    const t = withinRange();
    const params = { businessId: BIZ_ID, dateRange: dateRange(7, 1) };

    _seedQuoteForTest({ id: uid("quote"), businessId: BIZ_ID, status: "accepted", createdAt: t });
    _seedQuoteForTest({ id: uid("quote"), businessId: BIZ_ID, status: "accepted", createdAt: t });
    _seedQuoteForTest({ id: uid("quote"), businessId: BIZ_ID, status: "declined", createdAt: t });
    _seedQuoteForTest({ id: uid("quote"), businessId: BIZ_ID, status: "expired", createdAt: t });
    // 'sent' status is not yet resolved — excluded from rate denominator
    _seedQuoteForTest({ id: uid("quote"), businessId: BIZ_ID, status: "sent", createdAt: t });

    const result = await getQuoteMetrics(params);

    expect(result.totalSent).toBe(1);
    expect(result.totalAccepted).toBe(2);
    expect(result.totalDeclined).toBe(1);
    expect(result.totalExpired).toBe(1);
    // acceptanceRate = 2 / (2 + 1 + 1) = 0.5
    expect(result.acceptanceRate).toBeCloseTo(0.5);
  });

  it("AN09: dateRange filter — data outside range is not counted", async () => {
    const inside = withinRange();
    const outside = outsideRange(); // 10 days ago, outside 7-day window
    const params = { businessId: BIZ_ID, dateRange: dateRange(7, 1) };

    _seedConversationForTest({ id: uid("conv"), businessId: BIZ_ID, primaryState: "new_lead", tags: [], createdAt: inside, bookedAt: null });
    _seedConversationForTest({ id: uid("conv"), businessId: BIZ_ID, primaryState: "new_lead", tags: [], createdAt: outside, bookedAt: null });

    _seedMessageForTest({ id: uid("msg"), businessId: BIZ_ID, conversationId: "c1", direction: "inbound", senderType: "customer", createdAt: inside });
    _seedMessageForTest({ id: uid("msg"), businessId: BIZ_ID, conversationId: "c1", direction: "inbound", senderType: "customer", createdAt: outside });

    _seedAppointmentForTest({ id: uid("appt"), businessId: BIZ_ID, status: "completed", createdAt: inside });
    _seedAppointmentForTest({ id: uid("appt"), businessId: BIZ_ID, status: "completed", createdAt: outside });

    _seedQuoteForTest({ id: uid("quote"), businessId: BIZ_ID, status: "accepted", createdAt: inside });
    _seedQuoteForTest({ id: uid("quote"), businessId: BIZ_ID, status: "accepted", createdAt: outside });

    const convResult = await getConversationMetrics(params);
    expect(convResult.totalConversations).toBe(1);

    const msgResult = await getMessageMetrics(params);
    expect(msgResult.totalInbound).toBe(1);

    const apptResult = await getAppointmentMetrics(params);
    expect(apptResult.totalCompleted).toBe(1);

    const quoteResult = await getQuoteMetrics(params);
    expect(quoteResult.totalAccepted).toBe(1);
  });

  it("AN10: reopenedCount only counts conversations with repeat_customer tag", async () => {
    const t = withinRange();
    const params = { businessId: BIZ_ID, dateRange: dateRange(7, 1) };

    _seedConversationForTest({ id: uid("conv"), businessId: BIZ_ID, primaryState: "booked", tags: ["repeat_customer"], createdAt: t, bookedAt: t });
    _seedConversationForTest({ id: uid("conv"), businessId: BIZ_ID, primaryState: "booked", tags: ["repeat_customer", "urgent"], createdAt: t, bookedAt: t });
    _seedConversationForTest({ id: uid("conv"), businessId: BIZ_ID, primaryState: "new_lead", tags: [], createdAt: t, bookedAt: null });
    _seedConversationForTest({ id: uid("conv"), businessId: BIZ_ID, primaryState: "new_lead", tags: ["urgent"], createdAt: t, bookedAt: null });

    const result = await getConversationMetrics(params);

    expect(result.reopenedCount).toBe(2);
    expect(result.totalConversations).toBe(4);
  });
});
