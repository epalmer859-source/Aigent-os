import { createTRPCRouter, businessProcedure } from "~/server/api/trpc";

const CLOSED_STATES = [
  "resolved",
  "closed_unqualified",
  "closed_lost",
  "closed_completed",
] as const;

function thirtyMinAgo() {
  return new Date(Date.now() - 30 * 60 * 1000);
}

// Shared select shapes
const convCoreSelect = {
  id: true,
  channel: true,
  contact_handle: true,
  contact_display_name: true,
  primary_state: true,
} as const;

const customerNameSelect = {
  display_name: true,
} as const;

const latestMsgSelect = {
  content: true,
  created_at: true,
  direction: true,
} as const;

export const dashboardRouter = createTRPCRouter({
  // ── Full urgent items list ─────────────────────────────────────────────
  urgentItems: businessProcedure.query(async ({ ctx }) => {
    const staleThreshold = thirtyMinAgo();

    const [
      escalations,
      staleConversations,
      humanTakeovers,
    ] = await Promise.all([
      // 1. Open escalations
      ctx.db.escalations.findMany({
        where: { business_id: ctx.businessId, status: "open" },
        select: {
          id: true,
          category: true,
          urgency: true,
          ai_summary: true,
          created_at: true,
          conversations: {
            select: {
              ...convCoreSelect,
              customers: { select: customerNameSelect },
              message_log_conversations_last_customer_message_idTomessage_log: {
                select: latestMsgSelect,
              },
            },
          },
        },
        orderBy: { created_at: "desc" },
        take: 20,
      }),

      // 2. Stale AI conversations (customer messaged 30+ min ago, AI owns it)
      ctx.db.conversations.findMany({
        where: {
          business_id: ctx.businessId,
          current_owner: "ai",
          is_archived: false,
          closed_at: null,
          last_customer_message_at: { lt: staleThreshold, not: null },
          primary_state: { notIn: [...CLOSED_STATES] },
        },
        select: {
          ...convCoreSelect,
          last_customer_message_at: true,
          customers: { select: customerNameSelect },
          message_log_conversations_last_customer_message_idTomessage_log: {
            select: latestMsgSelect,
          },
        },
        orderBy: { last_customer_message_at: "asc" }, // most stale first
        take: 20,
      }),

      // 3. Human takeovers (AI handed off; owner/admin needs to continue)
      ctx.db.conversations.findMany({
        where: {
          business_id: ctx.businessId,
          primary_state: "human_takeover_active",
          is_archived: false,
          closed_at: null,
        },
        select: {
          ...convCoreSelect,
          prior_state: true,
          human_takeover_enabled_at: true,
          customers: { select: customerNameSelect },
        },
        orderBy: { human_takeover_enabled_at: "desc" },
        take: 20,
      }),
    ]);

    return {
      escalations,
      staleConversations,
      humanTakeovers,
    };
  }),

  // ── Badge counts only (polled by nav) ─────────────────────────────────
  counts: businessProcedure.query(async ({ ctx }) => {
    const staleThreshold = thirtyMinAgo();

    const [
      escalations,
      staleConversations,
      humanTakeovers,
    ] = await Promise.all([
      ctx.db.escalations.count({
        where: { business_id: ctx.businessId, status: "open" },
      }),
      ctx.db.conversations.count({
        where: {
          business_id: ctx.businessId,
          current_owner: "ai",
          is_archived: false,
          closed_at: null,
          last_customer_message_at: { lt: staleThreshold, not: null },
          primary_state: { notIn: [...CLOSED_STATES] },
        },
      }),
      ctx.db.conversations.count({
        where: {
          business_id: ctx.businessId,
          primary_state: "human_takeover_active",
          is_archived: false,
          closed_at: null,
        },
      }),
    ]);

    return {
      escalations,
      staleConversations,
      humanTakeovers,
      total:
        escalations +
        staleConversations +
        humanTakeovers,
    };
  }),
});
