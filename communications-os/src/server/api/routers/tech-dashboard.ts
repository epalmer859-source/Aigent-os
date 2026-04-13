import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, technicianProcedure } from "~/server/api/trpc";
import { transitionJobState } from "~/engine/scheduling/scheduling-state-machine";
import type { SchedulingJobStatus, SchedulingTriggeredBy } from "~/engine/scheduling/scheduling-state-machine";
import { transitionState as transitionConversationState } from "~/engine/state-machine/index";
import {
  onJobCompleted,
  onReviewRequested,
  onFollowUpCreated,
} from "~/engine/scheduling/communication-wiring";
import type { AiTextGenerator } from "~/engine/scheduling/communication-wiring";
import {
  createSchedulingStateMachineDb,
  createCommunicationWiringDb,
  createAccountabilityDb,
  createWindowRecalculatorDb,
} from "~/engine/scheduling/prisma-scheduling-adapter";
import { detectFastCompletion, persistFastCompletion } from "~/engine/scheduling/transition-hooks";
import { recalculateDownstreamWindows } from "~/engine/scheduling/window-recalculator";
import { recordJobDrift, evaluateFullDrift } from "~/engine/scheduling/drift-tracker";
import { onDriftCommunicationTriggered } from "~/engine/scheduling/communication-wiring";

const clock = { now: () => new Date() };

const commClock = {
  now: () => new Date(),
  today: () => {
    const d = new Date();
    return new Date(d.toISOString().split("T")[0]!);
  },
};

const cannedAiGenerator: AiTextGenerator = {
  async generateText() {
    return { outcome: "ai_unavailable" as const, content: "", usedFallback: true as const };
  },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve the best phone number: prefer customer_contacts phone, fall back to contact_handle only if it's not a UUID. */
function resolvePhone(
  contacts: { contact_type: string; contact_value: string }[],
  contactHandle: string | null | undefined,
): string | null {
  const phoneContact = contacts.find((c) => c.contact_type === "phone");
  if (phoneContact) return phoneContact.contact_value;
  // contact_handle may be a web-chat session UUID — don't show that as a phone number
  if (contactHandle && !UUID_RE.test(contactHandle)) return contactHandle;
  return null;
}

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
                select: { contact_type: true, contact_value: true },
              },
              conversations: {
                select: { cached_summary: true, contact_handle: true },
                orderBy: { updated_at: "desc" },
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

      return jobs.map((j) => ({
          ...j,
          customer_phone: resolvePhone(
            j.customers?.customer_contacts ?? [],
            j.customers?.conversations?.[0]?.contact_handle,
          ),
          job_summary:
            j.appointments?.conversations?.cached_summary
            ?? j.customers?.conversations?.[0]?.cached_summary
            ?? null,
      }));
    }),

  /** Update job status for non-completion transitions (en route, arrived, in progress).
   *  For COMPLETED/INCOMPLETE, use completeJobWithOutcome instead. */
  updateJobStatus: technicianProcedure
    .input(
      z.object({
        jobId: z.string().uuid(),
        status: z.enum([
          "NOT_STARTED",
          "EN_ROUTE",
          "ARRIVED",
          "IN_PROGRESS",
          "NEEDS_REBOOK",
        ]),
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

      const updated = await ctx.db.scheduling_jobs.update({
        where: { id: input.jobId },
        data,
      });

      return updated;
    }),

  /** Complete a job with outcome — the only completion path.
   *  Wraps transitionJobState + communication wiring + follow-up pipeline. */
  completeJobWithOutcome: technicianProcedure
    .input(
      z.object({
        jobId: z.string().uuid(),
        outcome: z.enum(["FIXED", "NEEDS_FOLLOWUP", "CUSTOMER_DECLINED"]),
        requestReview: z.boolean().default(false),
        // Required when outcome is NEEDS_FOLLOWUP
        followUp: z.object({
          description: z.string().min(1),
          estimatedLowMinutes: z.number().int().positive(),
          estimatedHighMinutes: z.number().int().positive(),
          needsParts: z.boolean().default(false),
          partsDescription: z.string().optional(),
          partsExpectedDate: z.string().optional(),
          partsNotes: z.string().optional(),
          needsAdditionalTech: z.boolean().default(false),
          additionalTechReason: z.string().optional(),
        }).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 1. Verify job belongs to this technician and load context
      const job = await ctx.db.scheduling_jobs.findUnique({
        where: { id: input.jobId },
        select: {
          id: true,
          technician_id: true,
          business_id: true,
          customer_id: true,
          status: true,
          estimated_duration_minutes: true,
          arrived_at: true,
          scheduled_date: true,
        },
      });

      if (!job || job.technician_id !== ctx.technicianId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      // Validate: NEEDS_FOLLOWUP requires follow-up details
      if (input.outcome === "NEEDS_FOLLOWUP" && !input.followUp) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Follow-up details are required when outcome is NEEDS_FOLLOWUP",
        });
      }

      // Validate: estimatedHighMinutes must be >= estimatedLowMinutes
      if (input.followUp && input.followUp.estimatedHighMinutes < input.followUp.estimatedLowMinutes) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "High estimate must be greater than or equal to low estimate",
        });
      }

      // Validate: max spread is 3 hours (180 min)
      if (input.followUp && (input.followUp.estimatedHighMinutes - input.followUp.estimatedLowMinutes) > 180) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Estimate spread cannot exceed 3 hours",
        });
      }

      // Validate: max high estimate is 9 hours (540 min)
      if (input.followUp && input.followUp.estimatedHighMinutes > 540) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "High estimate cannot exceed 9 hours",
        });
      }

      // 2. Transition job state via scheduling state machine
      const smDb = createSchedulingStateMachineDb(ctx.db);

      // Look up conversation bridge for scheduling → conversation state sync
      let conversationBridge: { conversationId: string; transitionFn: (cId: string, toState: any) => Promise<void> } | undefined;
      const appointment = await ctx.db.appointments.findFirst({
        where: { scheduling_job_id: input.jobId },
        select: { conversation_id: true },
      });
      if (appointment?.conversation_id) {
        conversationBridge = {
          conversationId: appointment.conversation_id,
          transitionFn: async (conversationId, toState) => {
            await transitionConversationState(conversationId, toState, "system", "system");
          },
        };
      }

      const transitionResult = await transitionJobState(
        input.jobId,
        "COMPLETED" as SchedulingJobStatus,
        ctx.technicianId,
        "TECH" as SchedulingTriggeredBy,
        smDb,
        clock.now(),
        conversationBridge,
      );

      if (!transitionResult.success) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Cannot complete job: ${transitionResult.reason}`,
        });
      }

      // 3. Write completion_note to the job
      const now = clock.now();
      await ctx.db.scheduling_jobs.update({
        where: { id: input.jobId },
        data: {
          completion_note: input.outcome,
          updated_at: now,
        },
      });

      // 4. Fire communication wiring (customer completion SMS)
      const commDb = createCommunicationWiringDb(ctx.db);
      onJobCompleted(input.jobId, commDb, commClock, cannedAiGenerator).catch((err) => {
        console.error(`[techDashboard:completeJobWithOutcome] onJobCompleted failed for ${input.jobId}:`, err);
      });

      // 4b. Window recalculation: recalculate downstream windows after job completion
      // Baseline = current time + V1 drive time (15 min) to next job
      if (job.scheduled_date) {
        const windowRecalcDb = createWindowRecalculatorDb(ctx.db);
        const driveToNextMs = 15 * 60 * 1000;
        const baselineArrival = new Date(clock.now().getTime() + driveToNextMs);
        recalculateDownstreamWindows(
          ctx.technicianId,
          input.jobId,
          baselineArrival,
          job.scheduled_date,
          windowRecalcDb,
        ).then((recalcResult) => {
          if (recalcResult.notifications.length > 0) {
            for (const n of recalcResult.notifications) {
              console.log(`[techDashboard:completeJobWithOutcome] window recalc notification: job=${n.jobId} reason=${n.reason}`);
              // TODO: Queue customer notification SMS for window changes
            }
          }
        }).catch((err) => {
          console.error(`[techDashboard:completeJobWithOutcome] window recalculation failed for ${input.jobId}:`, err);
        });
      }

      // 5. F19: Fast completion detection
      if (job.estimated_duration_minutes && job.arrived_at) {
        const fastCompletion = detectFastCompletion({
          jobId: input.jobId,
          estimatedDurationMinutes: job.estimated_duration_minutes,
          arrivedAt: job.arrived_at,
          completedAt: now,
        });
        if (fastCompletion.flagged) {
          console.warn(
            `[techDashboard:completeJobWithOutcome] F19 fast completion: job ${input.jobId} actual=${fastCompletion.actualMinutes}min (${fastCompletion.percentOfEstimate}% of estimate)`,
          );
          const accountabilityDb = createAccountabilityDb(ctx.db);
          persistFastCompletion(
            { technicianId: ctx.technicianId, businessId: ctx.businessId, completionResult: fastCompletion },
            accountabilityDb,
            now,
          ).catch((err) => {
            console.error(`[techDashboard:completeJobWithOutcome] Fast completion persistence failed for ${input.jobId}:`, err);
          });
        }

        // Auto-trigger drift evaluation
        const driftRecord = recordJobDrift(input.jobId, job.estimated_duration_minutes, fastCompletion.actualMinutes);
        const evaluation = evaluateFullDrift(
          [driftRecord],
          [0],
          [{ windowStart: 0, windowEnd: 0 }],
          720,
        );
        if (evaluation.length > 0 && evaluation[0]!.action !== "silent") {
          for (const ev of evaluation) {
            if (ev.action === "communicate_customer" || ev.action === "full_recalculation") {
              onDriftCommunicationTriggered(
                ev.jobId,
                { action: "communicate_customer", reason: ev.reason ?? "drift" },
                commDb, commClock, cannedAiGenerator,
              ).catch((err) => {
                console.error(`[techDashboard:completeJobWithOutcome] drift communication failed for ${ev.jobId}:`, err);
              });
            }
          }
        }
      }

      // 6. Outcome-specific actions
      let followUpRequestId: string | null = null;

      if (input.outcome === "NEEDS_FOLLOWUP" && input.followUp) {
        // Create follow_up_requests row
        const followUpRow = await ctx.db.follow_up_requests.create({
          data: {
            business_id: ctx.businessId,
            scheduling_job_id: input.jobId,
            customer_id: job.customer_id,
            technician_id: ctx.technicianId,
            description: input.followUp.description,
            estimated_low_minutes: input.followUp.estimatedLowMinutes,
            estimated_high_minutes: input.followUp.estimatedHighMinutes,
            needs_parts: input.followUp.needsParts,
            parts_description: input.followUp.partsDescription ?? null,
            parts_expected_date: input.followUp.partsExpectedDate
              ? new Date(input.followUp.partsExpectedDate)
              : null,
            parts_notes: input.followUp.partsNotes ?? null,
            needs_additional_tech: input.followUp.needsAdditionalTech,
            additional_tech_reason: input.followUp.additionalTechReason ?? null,
            status: "pending",
          },
        });
        followUpRequestId = followUpRow.id;

        // Fire follow-up outreach communication to customer
        onFollowUpCreated(input.jobId, commDb, commClock, cannedAiGenerator).catch((err) => {
          console.error(`[techDashboard:completeJobWithOutcome] onFollowUpCreated failed for ${input.jobId}:`, err);
        });
      }

      if (input.outcome === "FIXED" && input.requestReview) {
        // Look up google_review_link from businesses table
        const biz = await ctx.db.businesses.findUnique({
          where: { id: ctx.businessId },
          select: { google_review_link: true },
        });
        if (biz?.google_review_link) {
          onReviewRequested(input.jobId, biz.google_review_link, commDb, commClock, cannedAiGenerator).catch((err) => {
            console.error(`[techDashboard:completeJobWithOutcome] onReviewRequested failed for ${input.jobId}:`, err);
          });
        }
      }

      return {
        success: true,
        jobId: input.jobId,
        outcome: input.outcome,
        followUpRequestId,
      };
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
                select: { contact_type: true, contact_value: true },
              },
              conversations: {
                select: { cached_summary: true, contact_handle: true },
                orderBy: { updated_at: "desc" },
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
        customer_phone: resolvePhone(
          job.customers?.customer_contacts ?? [],
          job.customers?.conversations?.[0]?.contact_handle,
        ),
        job_summary:
          job.appointments?.conversations?.cached_summary
          ?? job.customers?.conversations?.[0]?.cached_summary
          ?? null,
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
              select: { contact_type: true, contact_value: true },
            },
            conversations: {
              select: { cached_summary: true, contact_handle: true },
              orderBy: { updated_at: "desc" },
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
        customer_phone: resolvePhone(
          j.customers?.customer_contacts ?? [],
          j.customers?.conversations?.[0]?.contact_handle,
        ),
        job_summary:
          j.appointments?.conversations?.cached_summary
          ?? j.customers?.conversations?.[0]?.cached_summary
          ?? null,
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
            customers: {
              select: {
                id: true,
                display_name: true,
                customer_contacts: {
                  select: { contact_type: true, contact_value: true },
                },
                conversations: {
                  select: { cached_summary: true, contact_handle: true },
                  orderBy: { updated_at: "desc" },
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
          orderBy: { completed_at: "desc" },
          skip,
          take: take + 1,
        }),
        ctx.db.scheduling_jobs.count({
          where: {
            technician_id: ctx.technicianId,
            status: { in: ["COMPLETED", "INCOMPLETE"] },
          },
        }),
      ]);

      const hasMore = jobs.length > take;
      const items = (hasMore ? jobs.slice(0, take) : jobs).map((j) => ({
          ...j,
          customer_phone: resolvePhone(
            j.customers?.customer_contacts ?? [],
            j.customers?.conversations?.[0]?.contact_handle,
          ),
          job_summary:
            j.appointments?.conversations?.cached_summary
            ?? j.customers?.conversations?.[0]?.cached_summary
            ?? null,
      }));

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
    const jobs = await ctx.db.scheduling_jobs.findMany({
      where: {
        technician_id: ctx.technicianId,
        status: "CANCELED",
      },
      include: {
        customers: {
          select: {
            id: true,
            display_name: true,
            customer_contacts: {
              select: { contact_type: true, contact_value: true },
            },
            conversations: {
              select: { cached_summary: true, contact_handle: true },
              orderBy: { updated_at: "desc" },
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
      orderBy: { updated_at: "desc" },
      take: 50,
    });

    return jobs.map((j) => ({
        ...j,
        customer_phone: resolvePhone(
          j.customers?.customer_contacts ?? [],
          j.customers?.conversations?.[0]?.contact_handle,
        ),
        job_summary:
          j.appointments?.conversations?.cached_summary
          ?? j.customers?.conversations?.[0]?.cached_summary
          ?? null,
    }));
  }),

  /** Check if a job is a return visit (has a linked follow_up_requests record).
   *  Used by the UI to determine which completion scenario to show. */
  checkFollowUpStatus: technicianProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Check if this job is the follow-up job for a prior follow_up_request
      const followUpRequest = await ctx.db.follow_up_requests.findFirst({
        where: { follow_up_job_id: input.jobId },
        select: {
          id: true,
          description: true,
          estimated_low_minutes: true,
          estimated_high_minutes: true,
          needs_parts: true,
          parts_description: true,
          needs_additional_tech: true,
        },
      });

      return {
        isReturnVisit: !!followUpRequest,
        followUpRequest: followUpRequest ?? null,
      };
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
