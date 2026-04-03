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

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
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
    const { start: todayStart, end: tomorrow } = todayRange();

    const [
      escalations,
      staleConversations,
      pendingApprovals,
      humanTakeovers,
      todayAppointments,
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

      // 3. Pending approvals (approval_requests needing owner decision)
      ctx.db.approval_requests.findMany({
        where: { business_id: ctx.businessId, status: "pending" },
        select: {
          id: true,
          request_type: true,
          ai_summary: true,
          created_at: true,
          conversations: {
            select: {
              id: true,
              contact_handle: true,
              contact_display_name: true,
              customers: { select: customerNameSelect },
            },
          },
        },
        orderBy: { created_at: "desc" },
        take: 20,
      }),

      // 4. Human takeovers (AI handed off; owner/admin needs to continue)
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

      // 5. Today's appointments (booked or rescheduled, not completed/canceled)
      ctx.db.appointments.findMany({
        where: {
          business_id: ctx.businessId,
          appointment_date: { gte: todayStart, lt: tomorrow },
          status: { in: ["booked", "rescheduled"] },
        },
        select: {
          id: true,
          appointment_date: true,
          appointment_time: true,
          service_type: true,
          status: true,
          customers: { select: customerNameSelect },
          conversations: {
            select: {
              id: true,
              contact_handle: true,
              contact_display_name: true,
            },
          },
        },
        orderBy: { appointment_time: "asc" },
        take: 20,
      }),
    ]);

    return {
      escalations,
      staleConversations,
      pendingApprovals,
      humanTakeovers,
      todayAppointments,
    };
  }),

  // ── Badge counts only (polled by nav) ─────────────────────────────────
  counts: businessProcedure.query(async ({ ctx }) => {
    const staleThreshold = thirtyMinAgo();
    const { start: todayStart, end: tomorrow } = todayRange();

    const [
      escalations,
      staleConversations,
      pendingApprovals,
      humanTakeovers,
      todayAppointments,
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
      ctx.db.approval_requests.count({
        where: { business_id: ctx.businessId, status: "pending" },
      }),
      ctx.db.conversations.count({
        where: {
          business_id: ctx.businessId,
          primary_state: "human_takeover_active",
          is_archived: false,
          closed_at: null,
        },
      }),
      ctx.db.appointments.count({
        where: {
          business_id: ctx.businessId,
          appointment_date: { gte: todayStart, lt: tomorrow },
          status: { in: ["booked", "rescheduled"] },
        },
      }),
    ]);

    return {
      escalations,
      staleConversations,
      pendingApprovals,
      humanTakeovers,
      todayAppointments,
      total:
        escalations +
        staleConversations +
        pendingApprovals +
        humanTakeovers +
        todayAppointments,
    };
  }),
});
