import { z } from "zod";
import { createTRPCRouter, businessProcedure, ownerProcedure } from "~/server/api/trpc";
import { ALL_DEFAULT_SERVICES, HVAC_CATEGORIES } from "~/engine/scheduling/hvac-service-defaults";

export const serviceEstimatesRouter = createTRPCRouter({
  /** Get all service estimates for the current business, grouped by category */
  list: businessProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.service_estimates.findMany({
      where: { business_id: ctx.businessId },
      orderBy: [{ category: "asc" }, { tier: "asc" }, { name: "asc" }],
    });
    return rows;
  }),

  /** Seed the 60 default HVAC services for a business (idempotent — skips if any exist) */
  seedDefaults: ownerProcedure.mutation(async ({ ctx }) => {
    const existing = await ctx.db.service_estimates.count({
      where: { business_id: ctx.businessId },
    });
    if (existing > 0) return { seeded: false, count: existing };

    await ctx.db.service_estimates.createMany({
      data: ALL_DEFAULT_SERVICES.map((s) => ({
        business_id: ctx.businessId,
        name: s.name,
        category: s.category,
        estimated_minutes: s.estimatedMinutes,
        is_active: s.tier === "required",
        is_default: true,
        tier: s.tier,
      })),
    });

    return { seeded: true, count: ALL_DEFAULT_SERVICES.length };
  }),

  /** Save service estimates from onboarding (bulk upsert) */
  saveFromOnboarding: ownerProcedure
    .input(
      z.array(
        z.object({
          name: z.string().min(1),
          category: z.string(),
          estimatedMinutes: z.number().int().positive(),
          isActive: z.boolean(),
          tier: z.enum(["required", "optional"]),
        }),
      ),
    )
    .mutation(async ({ ctx, input }) => {
      // Delete any existing defaults and re-insert with owner's adjustments
      await ctx.db.service_estimates.deleteMany({
        where: { business_id: ctx.businessId, is_default: true },
      });

      await ctx.db.service_estimates.createMany({
        data: input.map((s) => ({
          business_id: ctx.businessId,
          name: s.name,
          category: s.category,
          estimated_minutes: s.estimatedMinutes,
          is_active: s.isActive,
          is_default: true,
          tier: s.tier,
        })),
      });

      return { saved: true, count: input.length };
    }),

  /** Update a single service estimate (time or active status) */
  update: ownerProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        estimatedMinutes: z.number().int().positive().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.service_estimates.findFirst({
        where: { id: input.id, business_id: ctx.businessId },
      });
      if (!row) throw new Error("Service estimate not found");

      // Required services cannot be deactivated
      if (row.tier === "required" && input.isActive === false) {
        throw new Error("Required services cannot be deactivated");
      }

      return ctx.db.service_estimates.update({
        where: { id: input.id },
        data: {
          ...(input.estimatedMinutes !== undefined && { estimated_minutes: input.estimatedMinutes }),
          ...(input.isActive !== undefined && { is_active: input.isActive }),
          updated_at: new Date(),
        },
      });
    }),

  /** Add a custom service */
  addCustom: ownerProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        category: z.enum(HVAC_CATEGORIES as unknown as [string, ...string[]]),
        estimatedMinutes: z.number().int().positive().max(600),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.service_estimates.create({
        data: {
          business_id: ctx.businessId,
          name: input.name,
          category: input.category,
          estimated_minutes: input.estimatedMinutes,
          is_active: true,
          is_default: false,
          tier: "custom",
        },
      });
    }),

  /** Delete a custom service (only custom tier) */
  deleteCustom: ownerProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db.service_estimates.findFirst({
        where: { id: input.id, business_id: ctx.businessId },
      });
      if (!row) throw new Error("Service estimate not found");
      if (row.tier !== "custom") throw new Error("Only custom services can be deleted");

      await ctx.db.service_estimates.delete({ where: { id: input.id } });
      return { deleted: true };
    }),

  /** Get on-site cap minutes for the business */
  getOnsiteCap: businessProcedure.query(async ({ ctx }) => {
    const biz = await ctx.db.businesses.findUnique({
      where: { id: ctx.businessId },
      select: { onsite_cap_minutes: true },
    });
    return { onsiteCapMinutes: biz?.onsite_cap_minutes ?? 150 };
  }),

  /** Update on-site cap minutes */
  updateOnsiteCap: ownerProcedure
    .input(z.object({ onsiteCapMinutes: z.number().int().min(30).max(480) }))
    .mutation(async ({ ctx, input }) => {
      return ctx.db.businesses.update({
        where: { id: ctx.businessId },
        data: { onsite_cap_minutes: input.onsiteCapMinutes },
        select: { onsite_cap_minutes: true },
      });
    }),
});
