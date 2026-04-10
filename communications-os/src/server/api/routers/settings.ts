import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, businessProcedure, ownerProcedure } from "~/server/api/trpc";
import {
  getCalendarConnection,
  saveCalendarConnection,
} from "~/engine/calendar-sync/index";

export const settingsRouter = createTRPCRouter({
  // ── 1. Get business + config ──────────────────────────────────────────────
  getBusiness: businessProcedure.query(async ({ ctx }) => {
    const business = await ctx.db.businesses.findUnique({
      where: { id: ctx.businessId },
      include: { business_config: true },
    });
    if (!business) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Business not found" });
    }
    return business;
  }),

  // ── 2. Update business ────────────────────────────────────────────────────
  updateBusiness: ownerProcedure
    .input(
      z.object({
        business_name: z.string().min(1).optional(),
        timezone: z.string().optional(),
        join_code: z.string().min(4).optional(),
        google_review_link: z.string().optional(),
        preferred_phone_number: z.string().optional(),
        urgent_alert_phone: z.string().optional(),
        urgent_alert_email: z.string().email().optional().or(z.literal("")),
        ai_signoff_name: z.string().optional(),
        ai_tone_description: z.string().optional(),
        always_say: z.string().optional(),
        never_say: z.string().optional(),
        supported_languages: z.string().optional(),
        multilingual_enabled: z.boolean().optional(),
        ai_call_answering_enabled: z.boolean().optional(),
        rough_estimate_mode_enabled: z.boolean().optional(),
        labor_pricing_method: z.string().optional(),
        payment_management_enabled: z.boolean().optional(),
        cancellation_policy: z.string().optional(),
        warranty_policy: z.string().optional(),
        payment_methods: z.string().optional(),
        emergency_rules: z.string().optional(),
        customer_prep: z.string().optional(),
        common_questions: z.string().optional(),
        typical_process: z.string().optional(),
        important_details: z.string().optional(),
        customer_philosophy: z.string().optional(),
        takeover_notification_message: z.string().optional(),
        quote_expiry_days: z.number().int().min(1).optional(),
        auto_close_days: z.number().int().min(1).optional(),
        default_takeover_timer_seconds: z.number().int().min(0).optional(),
        quiet_hours_start: z.string().optional(),
        quiet_hours_end: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // If join_code changing, check uniqueness
      if (input.join_code) {
        const conflict = await ctx.db.businesses.findFirst({
          where: { join_code: input.join_code, id: { not: ctx.businessId } },
          select: { id: true },
        });
        if (conflict) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "That join code is already in use",
          });
        }
      }

      const {
        quiet_hours_start,
        quiet_hours_end,
        urgent_alert_email,
        ...rest
      } = input;

      return ctx.db.businesses.update({
        where: { id: ctx.businessId },
        data: {
          ...rest,
          ...(urgent_alert_email !== undefined && {
            urgent_alert_email: urgent_alert_email || null,
          }),
          ...(quiet_hours_start !== undefined && {
            quiet_hours_start: new Date(`1970-01-01T${quiet_hours_start}:00Z`),
          }),
          ...(quiet_hours_end !== undefined && {
            quiet_hours_end: new Date(`1970-01-01T${quiet_hours_end}:00Z`),
          }),
          updated_at: new Date(),
        },
      });
    }),

  // ── 3. Update business config ─────────────────────────────────────────────
  updateBusinessConfig: ownerProcedure
    .input(
      z.object({
        business_hours: z.record(z.any()).optional(),
        holidays_closures: z.any().optional(),
        service_area_list: z.any().optional(),
        service_area_exclusions: z.any().optional(),
        services_offered: z.array(z.object({ name: z.string(), description: z.string().optional() })).optional(),
        services_not_offered: z.any().optional(),
        owner_approval_job_types: z.any().optional(),
        appointment_types: z.any().optional(),
        same_day_booking_allowed: z.boolean().optional(),
        secondary_contacts: z.any().optional(),
        urgent_tab_categories: z.any().optional(),
        notification_defaults: z.any().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const config = await ctx.db.business_config.findUnique({
        where: { business_id: ctx.businessId },
        select: { id: true },
      });
      if (!config) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Business config not found" });
      }

      const {
        business_hours,
        holidays_closures,
        service_area_list,
        service_area_exclusions,
        services_offered,
        services_not_offered,
        owner_approval_job_types,
        appointment_types,
        same_day_booking_allowed,
        secondary_contacts,
        urgent_tab_categories,
        notification_defaults,
      } = input;

      return ctx.db.business_config.update({
        where: { business_id: ctx.businessId },
        data: {
          ...(business_hours !== undefined && { business_hours }),
          ...(holidays_closures !== undefined && { holidays_closures }),
          ...(service_area_list !== undefined && { service_area_list }),
          ...(service_area_exclusions !== undefined && { service_area_exclusions }),
          ...(services_offered !== undefined && { services_offered }),
          ...(services_not_offered !== undefined && { services_not_offered }),
          ...(owner_approval_job_types !== undefined && { owner_approval_job_types }),
          ...(appointment_types !== undefined && { appointment_types }),
          ...(same_day_booking_allowed !== undefined && { same_day_booking_allowed }),
          ...(secondary_contacts !== undefined && { secondary_contacts }),
          ...(urgent_tab_categories !== undefined && { urgent_tab_categories }),
          ...(notification_defaults !== undefined && { notification_defaults }),
          updated_at: new Date(),
        },
      });
    }),

  // ── 4. Get team ───────────────────────────────────────────────────────────
  getTeam: businessProcedure.query(async ({ ctx }) => {
    return ctx.db.users.findMany({
      where: { business_id: ctx.businessId },
      select: {
        id: true,
        email: true,
        display_name: true,
        role: true,
        created_at: true,
      },
      orderBy: [{ role: "asc" }, { created_at: "asc" }],
    });
  }),

  // ── 5. Change user role ───────────────────────────────────────────────────
  changeUserRole: ownerProcedure
    .input(
      z.object({
        userId: z.string().uuid(),
        newRole: z.enum(["owner", "admin"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot change your own role",
        });
      }

      // Count owners before potentially demoting
      if (input.newRole === "admin") {
        const ownerCount = await ctx.db.users.count({
          where: { business_id: ctx.businessId, role: "owner" },
        });
        if (ownerCount <= 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot demote the last owner",
          });
        }
      }

      const target = await ctx.db.users.findFirst({
        where: { id: input.userId, business_id: ctx.businessId },
        select: { id: true },
      });
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      return ctx.db.users.update({
        where: { id: input.userId },
        data: { role: input.newRole },
        select: { id: true, email: true, display_name: true, role: true },
      });
    }),

  // ── 6. Remove user ────────────────────────────────────────────────────────
  removeUser: ownerProcedure
    .input(z.object({ userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You cannot remove yourself",
        });
      }

      const target = await ctx.db.users.findFirst({
        where: { id: input.userId, business_id: ctx.businessId },
        select: { id: true, role: true },
      });
      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      }

      if (target.role === "owner") {
        const ownerCount = await ctx.db.users.count({
          where: { business_id: ctx.businessId, role: "owner" },
        });
        if (ownerCount <= 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Cannot remove the last owner",
          });
        }
      }

      await ctx.db.users.update({
        where: { id: input.userId },
        data: { business_id: null, role: "admin" },
      });

      return { success: true };
    }),

  // ── 7. Pause/unpause business ─────────────────────────────────────────────
  pauseBusiness: ownerProcedure
    .input(
      z.object({
        isPaused: z.boolean(),
        pauseMessage: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.businesses.update({
        where: { id: ctx.businessId },
        data: {
          is_paused: input.isPaused,
          ...(input.pauseMessage !== undefined && {
            pause_message: input.pauseMessage || null,
          }),
          updated_at: new Date(),
        },
      });
    }),

  // ── 8. Get Google Calendar connection ─────────────────────────────────────
  getCalendarConnection: businessProcedure.query(async ({ ctx }) => {
    // Production:
    //   db.calendar_connections.findFirst({
    //     where: { business_id: ctx.businessId, is_active: true },
    //   })
    return getCalendarConnection(ctx.businessId);
  }),

  // ── 9. Save Google Calendar connection ────────────────────────────────────
  saveCalendarConnection: ownerProcedure
    .input(
      z.object({
        googleCalendarId: z.string().min(1),
        accessToken: z.string().min(1),
        refreshToken: z.string().min(1),
        tokenExpiresAt: z.coerce.date(),
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Production:
      //   db.calendar_connections.upsert({
      //     where: { business_id: ctx.businessId },
      //     create: { business_id: ctx.businessId, ...input },
      //     update: { ...input, updated_at: new Date() },
      //   })
      return saveCalendarConnection({
        businessId: ctx.businessId,
        googleCalendarId: input.googleCalendarId,
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        tokenExpiresAt: input.tokenExpiresAt,
        isActive: input.isActive,
      });
    }),

  // ── Technicians ────────────────────────────────────────────────────────────
  getTechnicians: businessProcedure.query(async ({ ctx }) => {
    const config = await ctx.db.business_config.findUnique({
      where: { business_id: ctx.businessId },
      select: { technicians: true },
    });
    const raw = config?.technicians;
    return Array.isArray(raw) ? (raw as string[]) : [];
  }),

  addTechnician: ownerProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const config = await ctx.db.business_config.findUnique({
        where: { business_id: ctx.businessId },
        select: { technicians: true },
      });
      const list: string[] = Array.isArray(config?.technicians) ? (config.technicians as string[]) : [];
      if (list.includes(input.name)) {
        throw new TRPCError({ code: "CONFLICT", message: "Technician already exists" });
      }
      list.push(input.name);
      await ctx.db.business_config.update({
        where: { business_id: ctx.businessId },
        data: { technicians: list as any, updated_at: new Date() },
      });
      return list;
    }),

  removeTechnician: ownerProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const config = await ctx.db.business_config.findUnique({
        where: { business_id: ctx.businessId },
        select: { technicians: true },
      });
      const list: string[] = Array.isArray(config?.technicians) ? (config.technicians as string[]) : [];
      const filtered = list.filter((t) => t !== input.name);
      await ctx.db.business_config.update({
        where: { business_id: ctx.businessId },
        data: { technicians: filtered as any, updated_at: new Date() },
      });
      return filtered;
    }),
});
