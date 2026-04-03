import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, businessProcedure } from "~/server/api/trpc";

function todayStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function tomorrow() {
  const d = todayStart();
  d.setDate(d.getDate() + 1);
  return d;
}

const APPT_SELECT = {
  id: true,
  appointment_date: true,
  appointment_time: true,
  duration_minutes: true,
  service_type: true,
  status: true,
  dispatch_status: true,
  technician_name: true,
  address: true,
  is_recurring: true,
  conversation_id: true,
  conversations: {
    select: {
      contact_display_name: true,
      contact_handle: true,
    },
  },
} as const;

export const appointmentsRouter = createTRPCRouter({
  // ── 1. List ───────────────────────────────────────────────────────────────
  list: businessProcedure
    .input(
      z.object({
        view: z.enum(["upcoming", "past", "today", "all"]).default("today"),
        status: z.string().optional(),
        search: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { view, status, search, cursor, limit } = input;

      const today = todayStart();
      const tom = tomorrow();

      const dateFilter =
        view === "upcoming"
          ? { appointment_date: { gte: tom } }
          : view === "past"
            ? { appointment_date: { lt: today } }
            : view === "today"
              ? { appointment_date: { gte: today, lt: tom } }
              : {};

      const orderBy =
        view === "past"
          ? [
              { appointment_date: "desc" as const },
              { appointment_time: "desc" as const },
            ]
          : view === "all"
            ? [{ appointment_date: "desc" as const }]
            : [
                { appointment_date: "asc" as const },
                { appointment_time: "asc" as const },
              ];

      const rows = await ctx.db.appointments.findMany({
        where: {
          business_id: ctx.businessId,
          ...dateFilter,
          ...(status && { status: status as never }),
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
        select: APPT_SELECT,
        orderBy,
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
    .input(z.object({ appointmentId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const appt = await ctx.db.appointments.findFirst({
        where: { id: input.appointmentId, business_id: ctx.businessId },
        include: {
          conversations: {
            select: {
              id: true,
              contact_display_name: true,
              contact_handle: true,
              primary_state: true,
            },
          },
          appointment_change_requests: {
            select: {
              id: true,
              request_type: true,
              request_status: true,
              customer_reason: true,
              preferred_day_text: true,
              preferred_window_text: true,
              flexibility_notes: true,
              created_at: true,
            },
            orderBy: { created_at: "desc" },
          },
          recurring_services: {
            select: {
              id: true,
              service_type: true,
              frequency: true,
              preferred_day: true,
              preferred_time: true,
              status: true,
              start_date: true,
              end_date: true,
            },
          },
        },
      });

      if (!appt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Appointment not found",
        });
      }

      return appt;
    }),

  // ── 3. Update status ──────────────────────────────────────────────────────
  updateStatus: businessProcedure
    .input(
      z.object({
        appointmentId: z.string().uuid(),
        status: z.enum(["booked", "rescheduled", "canceled", "completed", "no_show"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.appointments.findFirst({
        where: { id: input.appointmentId, business_id: ctx.businessId },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Appointment not found",
        });
      }

      return ctx.db.appointments.update({
        where: { id: input.appointmentId },
        data: {
          status: input.status,
          updated_at: new Date(),
          ...(input.status === "completed" && { completed_at: new Date() }),
          ...(input.status === "canceled" && { canceled_at: new Date() }),
        },
      });
    }),

  // ── 4. Update dispatch ────────────────────────────────────────────────────
  updateDispatch: businessProcedure
    .input(
      z.object({
        appointmentId: z.string().uuid(),
        dispatchStatus: z
          .enum(["en_route", "delayed", "arrived", "on_site"])
          .nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.appointments.findFirst({
        where: { id: input.appointmentId, business_id: ctx.businessId },
        select: { id: true },
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Appointment not found",
        });
      }

      return ctx.db.appointments.update({
        where: { id: input.appointmentId },
        data: {
          dispatch_status: input.dispatchStatus,
          updated_at: new Date(),
        },
      });
    }),

  // ── 5. Create appointment ─────────────────────────────────────────────────
  create: businessProcedure
    .input(
      z.object({
        conversationId: z.string().uuid(),
        serviceType: z.string().optional(),
        appointmentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format"),
        appointmentTime: z.string().regex(/^\d{2}:\d{2}$/, "Use HH:mm format"),
        durationMinutes: z.number().int().min(1).optional(),
        address: z.string().optional(),
        technicianName: z.string().optional(),
        accessNotes: z.string().optional(),
        adminNotes: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const conv = await ctx.db.conversations.findFirst({
        where: { id: input.conversationId, business_id: ctx.businessId },
        select: { id: true, customer_id: true },
      });
      if (!conv) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Conversation not found",
        });
      }

      return ctx.db.appointments.create({
        data: {
          business_id: ctx.businessId,
          conversation_id: input.conversationId,
          customer_id: conv.customer_id,
          status: "booked",
          is_recurring: false,
          appointment_date: new Date(`${input.appointmentDate}T00:00:00Z`),
          appointment_time: new Date(`1970-01-01T${input.appointmentTime}:00Z`),
          ...(input.serviceType && { service_type: input.serviceType }),
          ...(input.durationMinutes && { duration_minutes: input.durationMinutes }),
          ...(input.address && { address: input.address }),
          ...(input.technicianName && { technician_name: input.technicianName }),
          ...(input.accessNotes && { access_notes: input.accessNotes }),
          ...(input.adminNotes && { admin_notes: input.adminNotes }),
        },
      });
    }),
});
