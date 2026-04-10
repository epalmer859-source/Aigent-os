// ============================================================
// src/server/api/routers/analytics.ts
//
// ANALYTICS tRPC ROUTER
//
// Thin wrapper over the analytics engine. All queries are
// filtered by ctx.businessId enforced by businessProcedure.
//
// Production: engine functions will delegate to Prisma aggregate
// queries. The in-memory stores used here are test-only.
// ============================================================

import { z } from "zod";
import { createTRPCRouter, businessProcedure } from "~/server/api/trpc";
import {
  getOverviewMetrics,
  getConversationMetrics,
  getMessageMetrics,
  getAppointmentMetrics,
  getQuoteMetrics,
} from "~/engine/analytics/index";

// Shared date range input schema
const dateRangeSchema = z.object({
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});

const analyticsInputSchema = z.object({
  dateRange: dateRangeSchema,
});

export const analyticsRouter = createTRPCRouter({
  // ── 1. Overview (all four metric groups) ──────────────────────────────────
  overview: businessProcedure
    .input(analyticsInputSchema)
    .query(async ({ ctx, input }) => {
      // Production:
      //   Run getConversationMetrics, getMessageMetrics, getAppointmentMetrics,
      //   getQuoteMetrics in parallel via db aggregation queries, then compose.
      return getOverviewMetrics({
        businessId: ctx.businessId,
        dateRange: input.dateRange,
      });
    }),

  // ── 2. Conversation metrics ────────────────────────────────────────────────
  conversations: businessProcedure
    .input(analyticsInputSchema)
    .query(async ({ ctx, input }) => {
      // Production:
      //   db.conversations.groupBy({ by: ['primary_state'], _count: true,
      //     where: { business_id, created_at: { gte, lte } } })
      return getConversationMetrics({
        businessId: ctx.businessId,
        dateRange: input.dateRange,
      });
    }),

  // ── 3. Message metrics ─────────────────────────────────────────────────────
  messages: businessProcedure
    .input(analyticsInputSchema)
    .query(async ({ ctx, input }) => {
      // Production:
      //   db.message_log.groupBy({ by: ['direction', 'sender_type'], _count: true,
      //     where: { business_id, created_at: { gte, lte } } })
      return getMessageMetrics({
        businessId: ctx.businessId,
        dateRange: input.dateRange,
      });
    }),

  // ── 4. Appointment metrics ─────────────────────────────────────────────────
  appointments: businessProcedure
    .input(analyticsInputSchema)
    .query(async ({ ctx, input }) => {
      // Production:
      //   db.appointments.groupBy({ by: ['status'], _count: true,
      //     where: { business_id, created_at: { gte, lte } } })
      return getAppointmentMetrics({
        businessId: ctx.businessId,
        dateRange: input.dateRange,
      });
    }),

  // ── 5. Quote metrics ───────────────────────────────────────────────────────
  quotes: businessProcedure
    .input(analyticsInputSchema)
    .query(async ({ ctx, input }) => {
      // Production:
      //   db.quotes.groupBy({ by: ['status'], _count: true,
      //     where: { business_id, created_at: { gte, lte } } })
      return getQuoteMetrics({
        businessId: ctx.businessId,
        dateRange: input.dateRange,
      });
    }),
});
