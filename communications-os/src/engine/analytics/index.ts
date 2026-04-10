// ============================================================
// src/engine/analytics/index.ts
//
// ANALYTICS tRPC QUERIES — IMPLEMENTATION
//
// All DB access would go through Prisma in production.
// This module maintains in-memory stores so the test suite
// runs without a real DB.
//
// Production Prisma patterns (examples):
//   await db.conversations.count({ where: { business_id, created_at: { gte, lte } } });
//   await db.message_log.groupBy({ by: ['direction', 'sender_type'], _count: true, where: { ... } });
//   await db.appointments.aggregate({ _count: { status: true }, where: { ... } });
//   await db.quotes.groupBy({ by: ['status'], _count: true, where: { ... } });
// ============================================================

import {
  ADMIN_SENDER_TYPES,
  REPEAT_CUSTOMER_TAG,
  type AnalyticsAppointmentRecord,
  type AnalyticsConversationRecord,
  type AnalyticsMessageRecord,
  type AnalyticsParams,
  type AnalyticsQuoteRecord,
  type AppointmentMetrics,
  type ConversationMetrics,
  type MessageMetrics,
  type OverviewMetrics,
  type QuoteMetrics,
} from "./contract";

// ── In-memory stores ──────────────────────────────────────────

const _conversations: AnalyticsConversationRecord[] = [];
const _messages: AnalyticsMessageRecord[] = [];
const _appointments: AnalyticsAppointmentRecord[] = [];
const _quotes: AnalyticsQuoteRecord[] = [];

// ── Date range filter helper ──────────────────────────────────

function _inRange(date: Date, params: AnalyticsParams): boolean {
  return (
    date >= params.dateRange.startDate && date <= params.dateRange.endDate
  );
}

// ── Production Prisma implementations ─────────────────────────

async function _getConversationMetricsFromDb(
  params: AnalyticsParams,
): Promise<ConversationMetrics> {
  const { db } = await import("~/server/db");
  const { startDate, endDate } = params.dateRange;
  const where = {
    business_id: params.businessId,
    created_at: { gte: startDate, lte: endDate },
  };
  const [total, newLeads, closedLost, closedCompleted, bookedConvs, reopenedCount] = await Promise.all([
    db.conversations.count({ where }),
    db.conversations.count({ where: { ...where, primary_state: "new_lead" as any } }),
    db.conversations.count({ where: { ...where, primary_state: "closed_lost" as any } }),
    db.conversations.count({ where: { ...where, primary_state: "closed_completed" as any } }),
    db.conversations.findMany({
      where: { ...where, appointments: { some: {} } },
      select: { created_at: true, appointments: { select: { created_at: true }, take: 1, orderBy: { created_at: "asc" as any } } },
    }),
    db.conversation_tags.count({
      where: {
        business_id: params.businessId,
        tag_code: REPEAT_CUSTOMER_TAG,
        is_active: true,
        created_at: { gte: startDate, lte: endDate },
      },
    }),
  ]);
  const convertedToBooked = bookedConvs.length;
  const avgTimeToBookingMs = bookedConvs.length > 0
    ? bookedConvs.reduce((sum, c) => {
        const appt = c.appointments[0];
        return sum + (appt ? appt.created_at.getTime() - c.created_at.getTime() : 0);
      }, 0) / bookedConvs.length
    : null;
  return { totalConversations: total, newLeads, convertedToBooked, closedLost, closedCompleted, avgTimeToBookingMs, reopenedCount };
}

async function _getMessageMetricsFromDb(
  params: AnalyticsParams,
): Promise<MessageMetrics> {
  const { db } = await import("~/server/db");
  const { startDate, endDate } = params.dateRange;
  const where = {
    business_id: params.businessId,
    created_at: { gte: startDate, lte: endDate },
  };
  const [totalInbound, totalOutbound, totalAIResponses, totalAdminMessages, messages] = await Promise.all([
    db.message_log.count({ where: { ...where, direction: "inbound" } }),
    db.message_log.count({ where: { ...where, direction: "outbound" } }),
    db.message_log.count({ where: { ...where, direction: "outbound", sender_type: "ai" } }),
    db.message_log.count({ where: { ...where, direction: "outbound", sender_type: { in: [...ADMIN_SENDER_TYPES] } } }),
    db.message_log.findMany({
      where,
      select: { direction: true, sender_type: true, conversation_id: true, created_at: true },
      orderBy: { created_at: "asc" as any },
    }),
  ]);
  const byConv = new Map<string, typeof messages>();
  for (const m of messages) {
    const list = byConv.get(m.conversation_id) ?? [];
    list.push(m);
    byConv.set(m.conversation_id, list);
  }
  const responseTimes: number[] = [];
  for (const msgs of byConv.values()) {
    for (let i = 0; i < msgs.length; i++) {
      const msg = msgs[i]!;
      if (msg.direction !== "inbound") continue;
      const next = msgs.slice(i + 1).find((m) => m.direction === "outbound" && m.sender_type === "ai");
      if (next) responseTimes.push(next.created_at.getTime() - msg.created_at.getTime());
    }
  }
  const avgAIResponseTimeMs = responseTimes.length > 0
    ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    : null;
  return { totalInbound, totalOutbound, totalAIResponses, totalAdminMessages, avgAIResponseTimeMs };
}

async function _getAppointmentMetricsFromDb(
  params: AnalyticsParams,
): Promise<AppointmentMetrics> {
  const { db } = await import("~/server/db");
  const { startDate, endDate } = params.dateRange;
  const groups = await db.appointments.groupBy({
    by: ["status"],
    _count: { status: true },
    where: { business_id: params.businessId, created_at: { gte: startDate, lte: endDate } },
  });
  const countByStatus = Object.fromEntries(groups.map((g) => [g.status as string, g._count.status]));
  const totalBooked = countByStatus["booked"] ?? 0;
  const totalCompleted = countByStatus["completed"] ?? 0;
  const totalCanceled = countByStatus["canceled"] ?? 0;
  const totalNoShows = countByStatus["no_show"] ?? 0;
  const resolved = totalCompleted + totalCanceled + totalNoShows;
  const completionRate = resolved > 0 ? totalCompleted / resolved : 0;
  return { totalBooked, totalCompleted, totalCanceled, totalNoShows, completionRate };
}

async function _getQuoteMetricsFromDb(
  params: AnalyticsParams,
): Promise<QuoteMetrics> {
  const { db } = await import("~/server/db");
  const { startDate, endDate } = params.dateRange;
  const groups = await db.quotes.groupBy({
    by: ["status"],
    _count: { status: true },
    where: { business_id: params.businessId, created_at: { gte: startDate, lte: endDate } },
  });
  const countByStatus = Object.fromEntries(groups.map((g) => [g.status as string, g._count.status]));
  const totalSent = countByStatus["sent"] ?? 0;
  const totalAccepted = countByStatus["accepted"] ?? 0;
  const totalDeclined = countByStatus["declined"] ?? 0;
  const totalExpired = countByStatus["expired"] ?? 0;
  const resolved = totalAccepted + totalDeclined + totalExpired;
  const acceptanceRate = resolved > 0 ? totalAccepted / resolved : 0;
  return { totalSent, totalAccepted, totalDeclined, totalExpired, acceptanceRate };
}

// ── getConversationMetrics ────────────────────────────────────

export async function getConversationMetrics(
  params: AnalyticsParams,
): Promise<ConversationMetrics> {
  if (process.env.NODE_ENV !== "test") return _getConversationMetricsFromDb(params);
  // Production:
  //   db.conversations.groupBy({ by: ['primary_state'], _count: true,
  //     where: { business_id: params.businessId, created_at: { gte, lte } } })
  const rows = _conversations.filter(
    (c) => c.businessId === params.businessId && _inRange(c.createdAt, params),
  );

  const newLeads = rows.filter((c) => c.primaryState === "new_lead").length;
  const closedLost = rows.filter((c) => c.primaryState === "closed_lost").length;
  const closedCompleted = rows.filter(
    (c) => c.primaryState === "closed_completed",
  ).length;

  // convertedToBooked = conversations that have a bookedAt timestamp
  const convertedToBooked = rows.filter((c) => c.bookedAt !== null).length;

  // avgTimeToBookingMs = avg of (bookedAt - createdAt) for converted conversations
  const bookedRows = rows.filter((c) => c.bookedAt !== null);
  const avgTimeToBookingMs =
    bookedRows.length > 0
      ? bookedRows.reduce(
          (sum, c) => sum + (c.bookedAt!.getTime() - c.createdAt.getTime()),
          0,
        ) / bookedRows.length
      : null;

  const reopenedCount = rows.filter((c) =>
    c.tags.includes(REPEAT_CUSTOMER_TAG),
  ).length;

  return {
    totalConversations: rows.length,
    newLeads,
    convertedToBooked,
    closedLost,
    closedCompleted,
    avgTimeToBookingMs,
    reopenedCount,
  };
}

// ── getMessageMetrics ─────────────────────────────────────────

export async function getMessageMetrics(
  params: AnalyticsParams,
): Promise<MessageMetrics> {
  if (process.env.NODE_ENV !== "test") return _getMessageMetricsFromDb(params);
  // Production:
  //   db.message_log.groupBy({ by: ['direction', 'sender_type'], _count: true,
  //     where: { business_id: params.businessId, created_at: { gte, lte } } })
  const rows = _messages.filter(
    (m) => m.businessId === params.businessId && _inRange(m.createdAt, params),
  );

  const inbound = rows.filter((m) => m.direction === "inbound");
  const outbound = rows.filter((m) => m.direction === "outbound");

  const totalAIResponses = outbound.filter(
    (m) => m.senderType === "ai",
  ).length;
  const totalAdminMessages = outbound.filter((m) =>
    (ADMIN_SENDER_TYPES as readonly string[]).includes(m.senderType),
  ).length;

  // avgAIResponseTimeMs: for each inbound message, find the next AI outbound
  // in the same conversation and measure the delta.
  // Production: this would be a windowed SQL query.
  const byConv = new Map<string, AnalyticsMessageRecord[]>();
  for (const m of rows) {
    const list = byConv.get(m.conversationId) ?? [];
    list.push(m);
    byConv.set(m.conversationId, list);
  }

  const responseTimes: number[] = [];
  for (const msgs of byConv.values()) {
    const sorted = [...msgs].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    for (let i = 0; i < sorted.length; i++) {
      const msg = sorted[i]!;
      if (msg.direction !== "inbound") continue;
      // Find next AI outbound after this inbound
      const next = sorted
        .slice(i + 1)
        .find(
          (m) => m.direction === "outbound" && m.senderType === "ai",
        );
      if (next) {
        responseTimes.push(next.createdAt.getTime() - msg.createdAt.getTime());
      }
    }
  }

  const avgAIResponseTimeMs =
    responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : null;

  return {
    totalInbound: inbound.length,
    totalOutbound: outbound.length,
    totalAIResponses,
    totalAdminMessages,
    avgAIResponseTimeMs,
  };
}

// ── getAppointmentMetrics ─────────────────────────────────────

export async function getAppointmentMetrics(
  params: AnalyticsParams,
): Promise<AppointmentMetrics> {
  if (process.env.NODE_ENV !== "test") return _getAppointmentMetricsFromDb(params);
  // Production:
  //   db.appointments.groupBy({ by: ['status'], _count: true,
  //     where: { business_id: params.businessId, created_at: { gte, lte } } })
  const rows = _appointments.filter(
    (a) => a.businessId === params.businessId && _inRange(a.createdAt, params),
  );

  const totalBooked = rows.filter((a) => a.status === "booked").length;
  const totalCompleted = rows.filter((a) => a.status === "completed").length;
  const totalCanceled = rows.filter((a) => a.status === "canceled").length;
  const totalNoShows = rows.filter((a) => a.status === "no_show").length;

  const resolved = totalCompleted + totalCanceled + totalNoShows;
  const completionRate = resolved > 0 ? totalCompleted / resolved : 0;

  return {
    totalBooked,
    totalCompleted,
    totalCanceled,
    totalNoShows,
    completionRate,
  };
}

// ── getQuoteMetrics ───────────────────────────────────────────

export async function getQuoteMetrics(
  params: AnalyticsParams,
): Promise<QuoteMetrics> {
  if (process.env.NODE_ENV !== "test") return _getQuoteMetricsFromDb(params);
  // Production:
  //   db.quotes.groupBy({ by: ['status'], _count: true,
  //     where: { business_id: params.businessId, created_at: { gte, lte } } })
  const rows = _quotes.filter(
    (q) => q.businessId === params.businessId && _inRange(q.createdAt, params),
  );

  const totalSent = rows.filter((q) => q.status === "sent").length;
  const totalAccepted = rows.filter((q) => q.status === "accepted").length;
  const totalDeclined = rows.filter((q) => q.status === "declined").length;
  const totalExpired = rows.filter((q) => q.status === "expired").length;

  // acceptanceRate denominator = resolved quotes only (accepted + declined + expired)
  const resolved = totalAccepted + totalDeclined + totalExpired;
  const acceptanceRate = resolved > 0 ? totalAccepted / resolved : 0;

  return {
    totalSent,
    totalAccepted,
    totalDeclined,
    totalExpired,
    acceptanceRate,
  };
}

// ── getOverviewMetrics ────────────────────────────────────────

export async function getOverviewMetrics(
  params: AnalyticsParams,
): Promise<OverviewMetrics> {
  // Production: run all four aggregations in parallel
  //   const [conversations, messages, appointments, quotes] =
  //     await Promise.all([...]);
  const [conversations, messages, appointments, quotes] = await Promise.all([
    getConversationMetrics(params),
    getMessageMetrics(params),
    getAppointmentMetrics(params),
    getQuoteMetrics(params),
  ]);

  return { conversations, messages, appointments, quotes };
}

// ── Test helpers ──────────────────────────────────────────────

export function _resetAnalyticsStoreForTest(): void {
  _conversations.length = 0;
  _messages.length = 0;
  _appointments.length = 0;
  _quotes.length = 0;
}

export function _seedConversationForTest(
  data: Record<string, unknown>,
): void {
  // Production: db.conversations.upsert({ ... })
  _conversations.push(data as unknown as AnalyticsConversationRecord);
}

export function _seedMessageForTest(data: Record<string, unknown>): void {
  // Production: db.message_log.create({ data: { ... } })
  _messages.push(data as unknown as AnalyticsMessageRecord);
}

export function _seedAppointmentForTest(data: Record<string, unknown>): void {
  // Production: db.appointments.create({ data: { ... } })
  _appointments.push(data as unknown as AnalyticsAppointmentRecord);
}

export function _seedQuoteForTest(data: Record<string, unknown>): void {
  // Production: db.quotes.create({ data: { ... } })
  _quotes.push(data as unknown as AnalyticsQuoteRecord);
}
