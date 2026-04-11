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
            },
          },
          service_types: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: { queue_position: "asc" },
      });

      return jobs;
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
            },
          },
          service_types: {
            select: {
              id: true,
              name: true,
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

      return job;
    }),

  /** Get technician's own profile info */
  myProfile: technicianProcedure.query(async ({ ctx }) => {
    const tech = await ctx.db.technicians.findUnique({
      where: { id: ctx.technicianId },
      select: {
        id: true,
        name: true,
        working_hours_start: true,
        working_hours_end: true,
        lunch_start: true,
        lunch_end: true,
        is_active: true,
      },
    });

    return tech;
  }),
});
