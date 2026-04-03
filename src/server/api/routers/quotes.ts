import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createTRPCRouter,
  businessProcedure,
  ownerProcedure,
} from "~/server/api/trpc";

const NEEDS_ACTION: string[] = ["intake_open", "under_review"];
const SENT_STATUSES: string[] = ["approved_to_send", "sent"];
const CLOSED_STATUSES: string[] = [
  "accepted",
  "declined",
  "superseded",
  "withdrawn",
  "expired",
];
const TERMINAL_STATUSES = new Set(["accepted", "declined", "withdrawn", "expired"]);

const QUOTE_LIST_SELECT = {
  id: true,
  status: true,
  requested_service: true,
  approved_amount: true,
  sent_at: true,
  expires_at: true,
  customer_responded_at: true,
  customer_response: true,
  conversation_id: true,
  created_at: true,
  updated_at: true,
  conversations: {
    select: {
      contact_display_name: true,
      contact_handle: true,
    },
  },
} as const;

export const quotesRouter = createTRPCRouter({
  // ── 1. List ───────────────────────────────────────────────────────────────
  list: businessProcedure
    .input(
      z.object({
        view: z
          .enum(["needs_action", "sent", "closed", "all"])
          .default("needs_action"),
        search: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { view, search, cursor, limit } = input;

      const statusFilter =
        view === "needs_action"
          ? { status: { in: NEEDS_ACTION as never[] } }
          : view === "sent"
            ? { status: { in: SENT_STATUSES as never[] } }
            : view === "closed"
              ? { status: { in: CLOSED_STATUSES as never[] } }
              : {};

      const rows = await ctx.db.quotes.findMany({
        where: {
          business_id: ctx.businessId,
          ...statusFilter,
          ...(search && {
            conversations: {
              OR: [
                {
                  contact_display_name: {
                    contains: search,
                    mode: "insensitive",
                  },
                },
                {
                  contact_handle: { contains: search, mode: "insensitive" },
                },
              ],
            },
          }),
          ...(cursor && { id: { lt: cursor } }),
        },
        select: QUOTE_LIST_SELECT,
        orderBy: { updated_at: "desc" },
        take: limit + 1,
      });

      let nextCursor: string | undefined;
      if (rows.length > limit) {
        rows.pop();
        nextCursor = rows[rows.length - 1]?.id;
      }

      return { items: rows, nextCursor };
    }),

  // ── 2. Detail ─────────────────────────────────────────────────────────────
  detail: businessProcedure
    .input(z.object({ quoteId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const quote = await ctx.db.quotes.findFirst({
        where: { id: input.quoteId, business_id: ctx.businessId },
        include: {
          conversations: {
            select: {
              id: true,
              contact_display_name: true,
              contact_handle: true,
              primary_state: true,
              channel: true,
            },
          },
          customers: {
            select: {
              id: true,
              display_name: true,
              consent_status: true,
            },
          },
        },
      });

      if (!quote) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Quote not found" });
      }

      // Related appointments for the same conversation
      const appointments = await ctx.db.appointments.findMany({
        where: {
          conversation_id: quote.conversation_id,
          business_id: ctx.businessId,
        },
        select: {
          id: true,
          appointment_date: true,
          appointment_time: true,
          status: true,
          service_type: true,
        },
        orderBy: { appointment_date: "desc" },
        take: 5,
      });

      return { ...quote, appointments };
    }),

  // ── 3. Approve (ownerProcedure) ───────────────────────────────────────────
  approve: ownerProcedure
    .input(
      z.object({
        quoteId: z.string().uuid(),
        approvedAmount: z.number().positive("Amount must be positive"),
        approvedTerms: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.quotes.findFirst({
        where: { id: input.quoteId, business_id: ctx.businessId },
        select: { id: true, status: true },
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Quote not found" });
      }

      if (!NEEDS_ACTION.includes(existing.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot approve a quote with status '${existing.status}'`,
        });
      }

      return ctx.db.quotes.update({
        where: { id: input.quoteId },
        data: {
          status: "approved_to_send",
          approved_amount: input.approvedAmount,
          ...(input.approvedTerms != null && {
            approved_terms: input.approvedTerms,
          }),
          approved_by: ctx.session.user.id,
          approved_at: new Date(),
          updated_at: new Date(),
        },
      });
    }),

  // ── 4. Withdraw ───────────────────────────────────────────────────────────
  withdraw: businessProcedure
    .input(z.object({ quoteId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.quotes.findFirst({
        where: { id: input.quoteId, business_id: ctx.businessId },
        select: { id: true, status: true },
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Quote not found" });
      }

      if (TERMINAL_STATUSES.has(existing.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot withdraw a quote with status '${existing.status}'`,
        });
      }

      return ctx.db.quotes.update({
        where: { id: input.quoteId },
        data: { status: "withdrawn", updated_at: new Date() },
      });
    }),
});
