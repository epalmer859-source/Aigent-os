import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, businessProcedure } from "~/server/api/trpc";

export const conversationsRouter = createTRPCRouter({
  // ── 1. List ──────────────────────────────────────────────────────────────
  list: businessProcedure
    .input(
      z.object({
        status: z.string().optional(),
        search: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { status, search, cursor, limit } = input;

      const rows = await ctx.db.conversations.findMany({
        where: {
          business_id: ctx.businessId,
          ...(status && { primary_state: status as never }),
          ...(search && {
            OR: [
              { contact_display_name: { contains: search, mode: "insensitive" } },
              { contact_handle: { contains: search, mode: "insensitive" } },
            ],
          }),
          ...(cursor && { id: { lt: cursor } }),
        },
        select: {
          id: true,
          contact_display_name: true,
          contact_handle: true,
          channel: true,
          primary_state: true,
          current_owner: true,
          last_customer_message_at: true,
          updated_at: true,
          message_log_conversations_last_customer_message_idTomessage_log: {
            select: { content: true },
          },
        },
        orderBy: { updated_at: "desc" },
        take: limit + 1,
      });

      let nextCursor: string | undefined;
      if (rows.length > limit) {
        rows.pop();
        nextCursor = rows[rows.length - 1]?.id;
      }

      const items = rows.map((r) => ({
        ...r,
        preview:
          (
            r.message_log_conversations_last_customer_message_idTomessage_log
              ?.content ?? ""
          ).slice(0, 80) || null,
        message_log_conversations_last_customer_message_idTomessage_log:
          undefined,
      }));

      return { items, nextCursor };
    }),

  // ── 2. Detail ─────────────────────────────────────────────────────────────
  detail: businessProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const conv = await ctx.db.conversations.findFirst({
        where: { id: input.conversationId, business_id: ctx.businessId },
        include: {
          customers: {
            select: {
              id: true,
              display_name: true,
              consent_status: true,
              do_not_contact: true,
            },
          },
          message_log_message_log_conversation_idToconversations: {
            orderBy: { created_at: "asc" },
            select: {
              id: true,
              direction: true,
              channel: true,
              sender_type: true,
              sender_user_id: true,
              content: true,
              is_voice_transcript: true,
              created_at: true,
            },
          },
          escalations: {
            select: {
              id: true,
              category: true,
              status: true,
              urgency: true,
              ai_summary: true,
              created_at: true,
            },
          },
          quotes: {
            select: {
              id: true,
              status: true,
              approved_amount: true,
              sent_at: true,
              expires_at: true,
            },
          },
          appointments: {
            select: {
              id: true,
              appointment_date: true,
              appointment_time: true,
              status: true,
              technician_name: true,
            },
          },
        },
      });

      if (!conv) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      return conv;
    }),

  // ── 3. Send message ───────────────────────────────────────────────────────
  sendMessage: businessProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        content: z.string().min(1, "Message cannot be empty"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const conv = await ctx.db.conversations.findFirst({
        where: { id: input.conversationId, business_id: ctx.businessId },
        select: { id: true, channel: true },
      });
      if (!conv) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }

      const senderType =
        ctx.session.user.role === "owner" ? "owner" : "admin_team";

      const [message] = await ctx.db.$transaction([
        ctx.db.message_log.create({
          data: {
            business_id: ctx.businessId,
            conversation_id: input.conversationId,
            direction: "outbound",
            channel: conv.channel,
            sender_type: senderType,
            sender_user_id: ctx.session.user.id,
            content: input.content,
          },
        }),
        ctx.db.conversations.update({
          where: { id: input.conversationId },
          data: { updated_at: new Date() },
        }),
      ]);

      return message;
    }),

  // ── 4. Enable human takeover ──────────────────────────────────────────────
  enableTakeover: businessProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        reason: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conv = await ctx.db.conversations.findFirst({
        where: { id: input.conversationId, business_id: ctx.businessId },
        select: { id: true, primary_state: true },
      });
      if (!conv) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      if (conv.primary_state === "human_takeover_active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Conversation is already in human takeover",
        });
      }

      const business = await ctx.db.businesses.findUnique({
        where: { id: ctx.businessId },
        select: { default_takeover_timer_seconds: true },
      });
      const timerSec = business?.default_takeover_timer_seconds ?? 604800;
      const now = new Date();
      const expiresAt =
        timerSec > 0 ? new Date(now.getTime() + timerSec * 1000) : null;

      return ctx.db.conversations.update({
        where: { id: input.conversationId },
        data: {
          prior_state: conv.primary_state,
          primary_state: "human_takeover_active",
          current_owner: "human_takeover",
          human_takeover_enabled_at: now,
          human_takeover_expires_at: expiresAt,
          human_takeover_timer_seconds: null,
          updated_at: now,
        },
      });
    }),

  // ── 5. Disable human takeover ─────────────────────────────────────────────
  disableTakeover: businessProcedure
    .input(z.object({ conversationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const conv = await ctx.db.conversations.findFirst({
        where: { id: input.conversationId, business_id: ctx.businessId },
        select: { id: true, primary_state: true, prior_state: true },
      });
      if (!conv) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      if (conv.primary_state !== "human_takeover_active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Conversation is not in human takeover",
        });
      }

      const restoreState = conv.prior_state ?? "resolved";

      return ctx.db.conversations.update({
        where: { id: input.conversationId },
        data: {
          primary_state: restoreState as never,
          prior_state: null,
          current_owner: "ai",
          human_takeover_disabled_at: new Date(),
          human_takeover_expires_at: null,
          updated_at: new Date(),
        },
      });
    }),

  // ── 6. Update takeover timer ──────────────────────────────────────────────
  updateTakeoverTimer: businessProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        timerSeconds: z.number().int().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conv = await ctx.db.conversations.findFirst({
        where: { id: input.conversationId, business_id: ctx.businessId },
        select: { id: true, primary_state: true, human_takeover_enabled_at: true },
      });
      if (!conv) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Conversation not found" });
      }
      if (conv.primary_state !== "human_takeover_active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Conversation is not in human takeover",
        });
      }

      const base = conv.human_takeover_enabled_at ?? new Date();
      const expiresAt =
        input.timerSeconds > 0
          ? new Date(base.getTime() + input.timerSeconds * 1000)
          : null;

      return ctx.db.conversations.update({
        where: { id: input.conversationId },
        data: {
          human_takeover_timer_seconds: input.timerSeconds,
          human_takeover_expires_at: expiresAt,
          updated_at: new Date(),
        },
      });
    }),
});
