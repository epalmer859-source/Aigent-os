import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";

const INDUSTRIES = [
  "house_cleaning", "commercial_cleaning", "lawn_care", "pressure_washing",
  "junk_removal", "painting", "garage_door", "landscaping", "handyman",
  "appliance_repair", "tree_service", "pool_service", "window_cleaning",
  "flooring", "plumbing", "hvac", "electrical", "auto_repair",
  "carpet_cleaning", "gutter_service", "detailing",
] as const;

const BusinessHoursDay = z.object({
  open: z.string(),
  close: z.string(),
  closed: z.boolean().default(false),
});

const OnboardingInput = z.object({
  // Step 1 — Basics
  businessName: z.string().min(1, "Business name is required"),
  industry: z.enum(INDUSTRIES),
  timezone: z.string().min(1, "Timezone is required"),
  joinCode: z.string().min(4, "Join code must be at least 4 characters"),
  // Step 2 — Contact
  urgentAlertPhone: z.string().optional(),
  urgentAlertEmail: z.string().email().optional().or(z.literal("")),
  preferredPhoneNumber: z.string().optional(),
  // Step 3 — Services
  servicesOffered: z.array(z.object({
    name: z.string().min(1),
    description: z.string().optional(),
  })).min(1, "At least one service is required"),
  servicesNotOffered: z.any().nullable().optional(),
  laborPricingMethod: z.string().nullable().optional(),
  // Step 4 — Scheduling
  businessHours: z.record(BusinessHoursDay),
  appointmentTypes: z.any().nullable().optional(),
  sameDayBookingAllowed: z.boolean().default(false),
  holidaysClosures: z.any().nullable().optional(),
  // Step 5 — Service Area
  serviceAreaList: z.any().nullable().optional(),
  serviceAreaExclusions: z.any().nullable().optional(),
  // Step 6 — Policies
  cancellationPolicy: z.string().optional(),
  warrantyPolicy: z.string().optional(),
  paymentMethods: z.string().optional(),
  customerPrep: z.string().optional(),
  // Step 7 — AI Personality
  aiSignoffName: z.string().optional(),
  aiToneDescription: z.string().optional(),
  alwaysSay: z.string().optional(),
  neverSay: z.string().optional(),
  supportedLanguages: z.string().default("English"),
  // Step 8 — Business Details
  emergencyRules: z.string().optional(),
  commonQuestions: z.string().optional(),
  typicalProcess: z.string().optional(),
  importantDetails: z.string().optional(),
  googleReviewLink: z.string().optional(),
  customerPhilosophy: z.string().optional(),
  // Step 9 — Industry Answers
  industryAnswers: z.record(z.string()).default({}),
});

export const onboardingRouter = createTRPCRouter({
  complete: protectedProcedure
    .input(OnboardingInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Guard: if user already has a business, reject
      const existingUser = await ctx.db.users.findUnique({
        where: { id: userId },
        select: { business_id: true },
      });
      if (existingUser?.business_id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You have already completed onboarding",
        });
      }

      // Check join code uniqueness
      const codeConflict = await ctx.db.businesses.findFirst({
        where: { join_code: input.joinCode },
        select: { id: true },
      });
      if (codeConflict) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That join code is already in use — please choose another",
        });
      }

      const result = await ctx.db.$transaction(async (tx) => {
        // 1. Create business
        const business = await tx.businesses.create({
          data: {
            owner_user_id: userId,
            business_name: input.businessName,
            industry: input.industry,
            timezone: input.timezone,
            join_code: input.joinCode,
            urgent_alert_phone: input.urgentAlertPhone ?? null,
            urgent_alert_email: input.urgentAlertEmail || null,
            preferred_phone_number: input.preferredPhoneNumber ?? null,
            google_review_link: input.googleReviewLink ?? null,
            ai_signoff_name: input.aiSignoffName ?? null,
            ai_tone_description: input.aiToneDescription ?? null,
            always_say: input.alwaysSay ?? null,
            never_say: input.neverSay ?? null,
            supported_languages: input.supportedLanguages,
            labor_pricing_method: input.laborPricingMethod ?? null,
            cancellation_policy: input.cancellationPolicy ?? null,
            warranty_policy: input.warrantyPolicy ?? null,
            payment_methods: input.paymentMethods ?? null,
            emergency_rules: input.emergencyRules ?? null,
            customer_prep: input.customerPrep ?? null,
            common_questions: input.commonQuestions ?? null,
            typical_process: input.typicalProcess ?? null,
            important_details: input.importantDetails ?? null,
            customer_philosophy: input.customerPhilosophy ?? null,
            onboarding_completed_at: new Date(),
          },
        });

        // 2. Create business_config
        await tx.business_config.create({
          data: {
            business_id: business.id,
            business_hours: input.businessHours,
            services_offered: input.servicesOffered,
            ...(input.servicesNotOffered != null && { services_not_offered: input.servicesNotOffered }),
            ...(input.appointmentTypes != null && { appointment_types: input.appointmentTypes }),
            same_day_booking_allowed: input.sameDayBookingAllowed,
            service_area_type: "list",
            ...(input.serviceAreaList != null && { service_area_list: input.serviceAreaList }),
            ...(input.serviceAreaExclusions != null && { service_area_exclusions: input.serviceAreaExclusions }),
            ...(input.holidaysClosures != null && { holidays_closures: input.holidaysClosures }),
            industry_answers: input.industryAnswers,
          },
        });

        // 3. Update user: set business_id + role
        await tx.users.update({
          where: { id: userId },
          data: { business_id: business.id, role: "owner" },
        });

        return { businessId: business.id };
      });

      return result;
    }),

  join: protectedProcedure
    .input(z.object({ joinCode: z.string().min(1, "Join code is required") }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const business = await ctx.db.businesses.findFirst({
        where: { join_code: input.joinCode },
        select: { id: true },
      });

      if (!business) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invalid join code — double-check with your owner",
        });
      }

      await ctx.db.users.update({
        where: { id: userId },
        data: { business_id: business.id, role: "admin" },
      });

      return { businessId: business.id };
    }),
});
