import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, technicianProcedure } from "~/server/api/trpc";

export const techDashboardRouter = createTRPCRouter({
  /** Get today's job queue for the authenticated technician */
  myJobs: technicianProcedure
    .input(
      z
        .object({
          date: z.string().optional(), // ISO date string, defaults to today
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const dateStr = input?.date ?? new Date().toISOString().slice(0, 10);
      const targetDate = new Date(dateStr + "T00:00:00Z");

      const jobs = await ctx.db.scheduling_jobs.findMany({
        where: {
          technician_id: ctx.technicianId,
          scheduled_date: targetDate,
        },
        include: {
          customers: {
            select: {
              id: true,
              display_name: true,
              customer_contacts: {
                where: { contact_type: "phone", is_primary: true },
                select: { contact_value: true },
                take: 1,
              },
            },
          },
          service_types: {
            select: {
              id: true,
              name: true,
            },
          },
          appointments: {
            select: {
              conversations: {
                select: { cached_summary: true },
              },
            },
          },
        },
        orderBy: { queue_position: "asc" },
      });

      // Flatten customer phone and conversation summary onto each job
      return jobs.map((j) => ({
        ...j,
        customer_phone: j.customers?.customer_contacts?.[0]?.contact_value ?? null,
        job_summary: j.appointments?.conversations?.cached_summary ?? null,
      }));
    }),

  /** Update job status (en route, arrived, in progress, completed, etc.) */
  updateJobStatus: technicianProcedure
    .input(
      z.object({
        jobId: z.string().uuid(),
        status: z.enum([
          "NOT_STARTED",
          "EN_ROUTE",
          "ARRIVED",
          "IN_PROGRESS",
          "COMPLETED",
          "INCOMPLETE",
          "NEEDS_REBOOK",
        ]),
        completionNote: z
          .enum(["FIXED", "NEEDS_FOLLOWUP", "CUSTOMER_DECLINED"])
          .optional(),
        actualDurationMinutes: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify job belongs to this technician
      const job = await ctx.db.scheduling_jobs.findUnique({
        where: { id: input.jobId },
        select: { technician_id: true, status: true },
      });

      if (!job || job.technician_id !== ctx.technicianId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      const now = new Date();
      const data: Record<string, unknown> = {
        status: input.status,
        updated_at: now,
      };

      if (input.status === "ARRIVED" && job.status !== "ARRIVED") {
        data.arrived_at = now;
      }

      if (
        (input.status === "COMPLETED" || input.status === "INCOMPLETE") &&
        !job.status.match(/COMPLETED|INCOMPLETE/)
      ) {
        data.completed_at = now;
      }

      if (input.completionNote) {
        data.completion_note = input.completionNote;
      }

      if (input.actualDurationMinutes) {
        data.actual_duration_minutes = input.actualDurationMinutes;
      }

      const updated = await ctx.db.scheduling_jobs.update({
        where: { id: input.jobId },
        data,
      });

      return updated;
    }),

  /** Get a single job's full details */
  jobDetail: technicianProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const job = await ctx.db.scheduling_jobs.findUnique({
        where: { id: input.jobId },
        include: {
          customers: {
            select: {
              id: true,
              display_name: true,
              customer_contacts: {
                where: { contact_type: "phone", is_primary: true },
                select: { contact_value: true },
                take: 1,
              },
            },
          },
          service_types: {
            select: {
              id: true,
              name: true,
            },
          },
          appointments: {
            select: {
              conversations: {
                select: { cached_summary: true },
              },
            },
          },
        },
      });

      if (!job || job.technician_id !== ctx.technicianId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      return {
        ...job,
        customer_phone: job.customers?.customer_contacts?.[0]?.contact_value ?? null,
        job_summary: job.appointments?.conversations?.cached_summary ?? null,
      };
    }),

  /** Get upcoming jobs (future dates) */
  upcomingJobs: technicianProcedure.query(async ({ ctx }) => {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    // Get next 14 days of jobs
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + 14);

    const jobs = await ctx.db.scheduling_jobs.findMany({
      where: {
        technician_id: ctx.technicianId,
        scheduled_date: { gt: today, lte: futureDate },
        status: { notIn: ["CANCELED"] },
      },
      include: {
        customers: {
          select: {
            id: true,
            display_name: true,
            customer_contacts: {
              where: { contact_type: "phone", is_primary: true },
              select: { contact_value: true },
              take: 1,
            },
          },
        },
        service_types: { select: { id: true, name: true } },
        appointments: {
          select: {
            conversations: {
              select: { cached_summary: true },
            },
          },
        },
      },
      orderBy: [{ scheduled_date: "asc" }, { queue_position: "asc" }],
    });

    return jobs.map((j) => ({
      ...j,
      customer_phone: j.customers?.customer_contacts?.[0]?.contact_value ?? null,
      job_summary: j.appointments?.conversations?.cached_summary ?? null,
    }));
  }),

  /** Get completed job history (paginated) */
  completedHistory: technicianProcedure
    .input(
      z.object({
        cursor: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(50).default(10),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const skip = input?.cursor ?? 0;
      const take = input?.limit ?? 10;

      const [jobs, total] = await Promise.all([
        ctx.db.scheduling_jobs.findMany({
          where: {
            technician_id: ctx.technicianId,
            status: { in: ["COMPLETED", "INCOMPLETE"] },
          },
          include: {
            customers: { select: { id: true, display_name: true } },
            service_types: { select: { id: true, name: true } },
          },
          orderBy: { completed_at: "desc" },
          skip,
          take: take + 1, // fetch one extra to detect hasMore
        }),
        ctx.db.scheduling_jobs.count({
          where: {
            technician_id: ctx.technicianId,
            status: { in: ["COMPLETED", "INCOMPLETE"] },
          },
        }),
      ]);

      const hasMore = jobs.length > take;
      const items = hasMore ? jobs.slice(0, take) : jobs;

      return { items, total, hasMore, nextCursor: skip + take };
    }),

  /** Get completion stats */
  completionStats: technicianProcedure.query(async ({ ctx }) => {
    // All-time completed count
    const totalCompleted = await ctx.db.scheduling_jobs.count({
      where: {
        technician_id: ctx.technicianId,
        status: "COMPLETED",
      },
    });

    // This week completed
    const weekStart = new Date();
    weekStart.setUTCHours(0, 0, 0, 0);
    const day = weekStart.getUTCDay();
    weekStart.setDate(weekStart.getDate() - (day === 0 ? 6 : day - 1)); // Monday

    const thisWeekCompleted = await ctx.db.scheduling_jobs.count({
      where: {
        technician_id: ctx.technicianId,
        status: "COMPLETED",
        completed_at: { gte: weekStart },
      },
    });

    // Average duration from jobs with actual_duration_minutes
    const durationAgg = await ctx.db.scheduling_jobs.aggregate({
      where: {
        technician_id: ctx.technicianId,
        status: "COMPLETED",
        actual_duration_minutes: { not: null },
      },
      _avg: { actual_duration_minutes: true },
    });

    // Average jobs per day (completed jobs / distinct days with completions)
    const distinctDays = await ctx.db.scheduling_jobs.findMany({
      where: {
        technician_id: ctx.technicianId,
        status: "COMPLETED",
      },
      select: { scheduled_date: true },
      distinct: ["scheduled_date"],
    });

    const avgPerDay =
      distinctDays.length > 0
        ? Math.round((totalCompleted / distinctDays.length) * 10) / 10
        : 0;

    return {
      totalCompleted,
      thisWeekCompleted,
      avgDurationMinutes: Math.round(durationAgg._avg.actual_duration_minutes ?? 0),
      avgJobsPerDay: avgPerDay,
    };
  }),

  /** Get cancelled/no-show jobs */
  cancelledJobs: technicianProcedure.query(async ({ ctx }) => {
    return ctx.db.scheduling_jobs.findMany({
      where: {
        technician_id: ctx.technicianId,
        status: "CANCELED",
      },
      include: {
        customers: { select: { id: true, display_name: true } },
        service_types: { select: { id: true, name: true } },
      },
      orderBy: { updated_at: "desc" },
      take: 50,
    });
  }),

  /** Get technician's own profile info (full details for settings) */
  myProfile: technicianProcedure.query(async ({ ctx }) => {
    const tech = await ctx.db.technicians.findUnique({
      where: { id: ctx.technicianId },
      select: {
        id: true,
        name: true,
        phone: true,
        home_base_address: true,
        working_hours_start: true,
        working_hours_end: true,
        lunch_start: true,
        lunch_end: true,
        is_active: true,
      },
    });

    return tech;
  }),

  /** Update technician's own profile */
  updateMyProfile: technicianProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100).optional(),
        phone: z.string().max(20).optional(),
        home_base_address: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.db.technicians.update({
        where: { id: ctx.technicianId },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.phone !== undefined && { phone: input.phone || null }),
          ...(input.home_base_address !== undefined && { home_base_address: input.home_base_address }),
          updated_at: new Date(),
        },
        select: {
          id: true,
          name: true,
          phone: true,
          home_base_address: true,
        },
      });
    }),

  /** List all team members (users) with roles — visible to technicians */
  teamMembers: technicianProcedure.query(async ({ ctx }) => {
    return ctx.db.users.findMany({
      where: { business_id: ctx.businessId },
      select: {
        id: true,
        email: true,
        display_name: true,
        role: true,
      },
      orderBy: [{ role: "asc" }, { created_at: "asc" }],
    });
  }),

  /** List all technicians — name + phone only, no addresses (except own) */
  allTechnicians: technicianProcedure.query(async ({ ctx }) => {
    const techs = await ctx.db.technicians.findMany({
      where: { business_id: ctx.businessId },
      select: {
        id: true,
        name: true,
        phone: true,
        is_active: true,
        home_base_address: true,
      },
      orderBy: { name: "asc" },
    });

    // Strip address from other technicians — only show own address
    return techs.map((t) => ({
      id: t.id,
      name: t.name,
      phone: t.phone,
      is_active: t.is_active,
      home_base_address: t.id === ctx.technicianId ? t.home_base_address : null,
    }));
  }),
});
