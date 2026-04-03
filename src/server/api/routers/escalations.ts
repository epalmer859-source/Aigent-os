import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, businessProcedure } from "~/server/api/trpc";

const URGENCY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  standard: 2,
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  open: ["in_progress", "resolved"],
  in_progress: ["resolved"],
  resolved: [],
};

export const escalationsRouter = createTRPCRouter({
  // ── 1. List ───────────────────────────────────────────────────────────────
  list: businessProcedure
    .input(
      z.object({
        status: z.enum(["open", "in_progress", "resolved", "all"]).default("open"),
        urgency: z.enum(["standard", "high", "critical"]).optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { status, urgency, cursor, limit } = input;

      const rows = await ctx.db.escalations.findMany({
        where: {
          business_id: ctx.businessId,
          ...(status !== "all" && { status }),
          ...(urgency && { urgency }),
          ...(cursor && { id: { lt: cursor } }),
        },
        select: {
          id: true,
          category: true,
          status: true,
          urgency: true,
          ai_summary: true,
          resolution_note: true,
          resolved_by: true,
          resolved_at: true,
          created_at: true,
          conversation_id: true,
          conversations: {
            select: { contact_display_name: true, contact_handle: true },
          },
        },
        orderBy: { created_at: "desc" },
        take: limit + 1,
      });

      let nextCursor: string | undefined;
      if (rows.length > limit) {
        rows.pop();
        nextCursor = rows[rows.length - 1]?.id;
      }

      // Sort: critical → high → standard, then by created_at desc (stable)
      rows.sort((a, b) => {
        const ua = URGENCY_ORDER[a.urgency] ?? 3;
        const ub = URGENCY_ORDER[b.urgency] ?? 3;
        if (ua !== ub) return ua - ub;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

      return { items: rows, nextCursor };
    }),

  // ── 2. Detail ─────────────────────────────────────────────────────────────
  detail: businessProcedure
    .input(z.object({ escalationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.escalations.findFirst({
        where: { id: input.escalationId, business_id: ctx.businessId },
        include: {
          conversations: {
            select: {
              id: true,
              contact_display_name: true,
              contact_handle: true,
              primary_state: true,
              current_owner: true,
              cached_summary: true,
            },
          },
          customers: {
            select: { id: true, display_name: true },
          },
        },
      });

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Escalation not found" });
      }

      // Last 10 messages for this conversation
      const recentMessages = await ctx.db.message_log.findMany({
        where: {
          conversation_id: row.conversation_id,
          business_id: ctx.businessId,
        },
        select: {
          id: true,
          direction: true,
          sender_type: true,
          content: true,
          created_at: true,
        },
        orderBy: { created_at: "desc" },
        take: 10,
      });

      return {
        ...row,
        recentMessages: recentMessages.reverse(), // asc for display
      };
    }),

  // ── 3. Update status ──────────────────────────────────────────────────────
  updateStatus: businessProcedure
    .input(
      z.object({
        escalationId: z.string().uuid(),
        status: z.enum(["in_progress", "resolved"]),
        resolutionNote: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.escalations.findFirst({
        where: { id: input.escalationId, business_id: ctx.businessId },
        select: { id: true, status: true },
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Escalation not found" });
      }

      const allowed = VALID_TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(input.status)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot transition from '${existing.status}' to '${input.status}'`,
        });
      }

      if (input.status === "resolved" && existing.status === "in_progress" && !input.resolutionNote?.trim()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A resolution note is required when resolving from in_progress",
        });
      }

      return ctx.db.escalations.update({
        where: { id: input.escalationId },
        data: {
          status: input.status,
          ...(input.status === "resolved" && {
            resolved_by: ctx.session.user.id,
            resolved_at: new Date(),
            ...(input.resolutionNote != null && {
              resolution_note: input.resolutionNote,
            }),
          }),
        },
      });
    }),
});
