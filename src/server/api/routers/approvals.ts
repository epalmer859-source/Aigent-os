import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, businessProcedure } from "~/server/api/trpc";

export const approvalsRouter = createTRPCRouter({
  // ── 1. List ───────────────────────────────────────────────────────────────
  list: businessProcedure
    .input(
      z.object({
        status: z.enum(["pending", "approved", "denied", "all"]).default("pending"),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { status, cursor, limit } = input;

      const rows = await ctx.db.approval_requests.findMany({
        where: {
          business_id: ctx.businessId,
          ...(status !== "all" && { status }),
          ...(cursor && { id: { lt: cursor } }),
        },
        select: {
          id: true,
          request_type: true,
          status: true,
          ai_summary: true,
          admin_notes: true,
          decided_by: true,
          decided_at: true,
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

      return { items: rows, nextCursor };
    }),

  // ── 2. Detail ─────────────────────────────────────────────────────────────
  detail: businessProcedure
    .input(z.object({ approvalId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.approval_requests.findFirst({
        where: { id: input.approvalId, business_id: ctx.businessId },
        include: {
          conversations: {
            select: {
              id: true,
              contact_display_name: true,
              contact_handle: true,
              primary_state: true,
              cached_summary: true,
            },
          },
          customers: {
            select: { id: true, display_name: true, consent_status: true },
          },
        },
      });

      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Approval request not found" });
      }

      return row;
    }),

  // ── 3. Decide ─────────────────────────────────────────────────────────────
  decide: businessProcedure
    .input(
      z.object({
        approvalId: z.string().uuid(),
        decision: z.enum(["approved", "denied"]),
        adminNotes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.approval_requests.findFirst({
        where: { id: input.approvalId, business_id: ctx.businessId },
        select: { id: true, status: true },
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Approval request not found" });
      }

      if (existing.status !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot decide an approval with status '${existing.status}'`,
        });
      }

      return ctx.db.approval_requests.update({
        where: { id: input.approvalId },
        data: {
          status: input.decision,
          decided_by: ctx.session.user.id,
          decided_at: new Date(),
          ...(input.adminNotes != null && { admin_notes: input.adminNotes }),
        },
      });
    }),
});
