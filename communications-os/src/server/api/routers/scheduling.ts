// ============================================================
// src/server/api/routers/scheduling.ts
//
// tRPC ROUTER — SCHEDULING ENGINE
//
// Dashboard-facing operations for the scheduling engine.
// All mutations use production Prisma adapters wired to the
// shared db singleton. Workers are NOT here — they run from
// src/workers/main.ts on cron schedules.
// ============================================================

import { z } from "zod";
import { createTRPCRouter, businessProcedure, ownerProcedure } from "~/server/api/trpc";

import {
  createBookingOrchestratorDb,
  createRebookCascadeDb,
  createGapFillDb,
  createTransferDb,
  createSchedulingStateMachineDb,
  createCapacityDb,
  createPauseGuardDb,
  createOsrmDeps,
} from "~/engine/scheduling/prisma-scheduling-adapter";

import { bookJob, type BookingRequest } from "~/engine/scheduling/booking-orchestrator";
import { redistributeSickTechJobs } from "~/engine/scheduling/rebook-cascade";
import { detectGap, rankCandidates, acceptPullForward, createPullForwardOffer, type DetectGapInput } from "~/engine/scheduling/gap-fill";
import { evaluateFullDrift, recordJobDrift, type DriftRecord, type OriginalWindow } from "~/engine/scheduling/drift-tracker";
import { evaluateBatchTransfers, executeBatchSameDayTransfers } from "~/engine/scheduling/inter-tech-transfer";
import { transitionJobState } from "~/engine/scheduling/scheduling-state-machine";
import type { SchedulingJobStatus, SchedulingTriggeredBy } from "~/engine/scheduling/scheduling-state-machine";
import { transitionState as transitionConversationState } from "~/engine/state-machine/index";

import {
  onJobBooked,
  onTechEnRoute,
  onTechArrived,
  onJobCompleted,
  onJobCanceled,
  onSickTechNotice,
  onDriftCommunicationTriggered,
  onPullForwardOffer,
  onPullForwardAccepted,
} from "~/engine/scheduling/communication-wiring";
import type { AiTextGenerator } from "~/engine/scheduling/communication-wiring";

import {
  pauseScheduling,
  requestResync,
  resumeScheduling,
  buildResyncAudit,
  arrangeJobManually,
  resetToAI,
  startMyDay,
} from "~/engine/scheduling/pause-manual-controls";

import { createCommunicationWiringDb, createPauseManualDb, createAccountabilityDb } from "~/engine/scheduling/prisma-scheduling-adapter";
import { detectGpsMismatch, detectFastCompletion, persistGpsMismatch, persistFastCompletion } from "~/engine/scheduling/transition-hooks";

// ── Shared clocks ──────────────────────────────────────────────

const clock = { now: () => new Date() };

const commClock = {
  now: () => new Date(),
  today: () => {
    const d = new Date();
    return new Date(d.toISOString().split("T")[0]!);
  },
};

const transferClock = {
  now: () => new Date(),
  today: () => {
    const d = new Date();
    return new Date(d.toISOString().split("T")[0]!);
  },
};

// ── AI text generator (canned fallback — no live AI call) ──────

const cannedAiGenerator: AiTextGenerator = {
  async generateText() {
    return { outcome: "ai_unavailable" as const, content: "", usedFallback: true as const };
  },
};

// ── Router ─────────────────────────────────────────────────────

export const schedulingRouter = createTRPCRouter({
  // ── List technicians for this business ──────────────────────
  listTechnicians: businessProcedure.query(async ({ ctx }) => {
    return ctx.db.technicians.findMany({
      where: { business_id: ctx.businessId },
      select: {
        id: true,
        name: true,
        is_active: true,
        working_hours_start: true,
        working_hours_end: true,
        lunch_start: true,
        lunch_end: true,
        home_base_address: true,
      },
      orderBy: { name: "asc" },
    });
  }),

  // ── Booking ────────────────────────────────────────────────
  bookJob: businessProcedure
    .input(
      z.object({
        jobId: z.string().uuid(),
        technicianId: z.string().uuid(),
        customerId: z.string().uuid(),
        customerName: z.string(),
        scheduledDate: z.string().datetime(),
        timePreference: z.enum(["MORNING", "AFTERNOON", "SOONEST", "NO_PREFERENCE"]),
        totalCostMinutes: z.number().int().positive(),
        addressLat: z.number(),
        addressLng: z.number(),
        serviceType: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = createBookingOrchestratorDb(ctx.db);
      const osrmDeps = createOsrmDeps();

      const tech = await ctx.db.technicians.findUniqueOrThrow({
        where: { id: input.technicianId },
        select: { home_base_lat: true, home_base_lng: true },
      });

      const request: BookingRequest = {
        ...input,
        businessId: ctx.businessId,
        scheduledDate: new Date(input.scheduledDate),
      };

      const result = await bookJob(
        request,
        { lat: tech.home_base_lat, lng: tech.home_base_lng },
        db,
        clock,
        osrmDeps,
      );

      // F3: Fire confirmation communication AFTER commit
      if (result.success) {
        const commDb = createCommunicationWiringDb(ctx.db);
        onJobBooked(input.jobId, commDb, commClock, cannedAiGenerator).catch((err) => {
          console.error(`[scheduling:bookJob] onJobBooked failed for ${input.jobId}:`, err);
        });
      }

      return result;
    }),

  // ── Job state transitions ──────────────────────────────────
  transitionJob: businessProcedure
    .input(
      z.object({
        jobId: z.string().uuid(),
        technicianId: z.string().uuid(),
        newStatus: z.enum([
          "NOT_STARTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS",
          "COMPLETED", "INCOMPLETE", "CANCELED", "NEEDS_REBOOK",
          "BEYOND_SAME_DAY",
        ]),
        triggeredBy: z.enum(["AI", "OWNER", "TECH", "SYSTEM"]),
        // F18: Optional GPS for mismatch detection on ARRIVED
        technicianGpsLat: z.number().optional(),
        technicianGpsLng: z.number().optional(),
        jobAddressLat: z.number().optional(),
        jobAddressLng: z.number().optional(),
        // F19: Optional estimate info for fast-completion flagging on COMPLETED
        estimatedDurationMinutes: z.number().optional(),
        arrivedAt: z.string().datetime().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = createSchedulingStateMachineDb(ctx.db);

      // F21: Look up conversation for this scheduling job via appointments
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

      const result = await transitionJobState(
        input.jobId,
        input.newStatus as SchedulingJobStatus,
        input.technicianId,
        input.triggeredBy as SchedulingTriggeredBy,
        db,
        clock.now(),
        conversationBridge,
      );

      // F4: Fire communication events AFTER state transition commit
      const commDb = createCommunicationWiringDb(ctx.db);
      const fireComm = async () => {
        switch (input.newStatus) {
          case "EN_ROUTE":
            await onTechEnRoute(input.jobId, commDb, commClock, cannedAiGenerator);
            break;
          case "ARRIVED":
            await onTechArrived(input.jobId, commDb, commClock, cannedAiGenerator);
            break;
          case "COMPLETED":
            await onJobCompleted(input.jobId, commDb, commClock, cannedAiGenerator);
            break;
          case "CANCELED":
            await onJobCanceled(input.jobId, commDb);
            break;
        }
      };
      fireComm().catch((err) => {
        console.error(`[scheduling:transitionJob] communication wiring failed for ${input.jobId} → ${input.newStatus}:`, err);
      });

      // F18: GPS mismatch detection + persistence on ARRIVED
      let gpsMismatch: ReturnType<typeof detectGpsMismatch> | undefined;
      if (
        input.newStatus === "ARRIVED" &&
        input.technicianGpsLat != null && input.technicianGpsLng != null &&
        input.jobAddressLat != null && input.jobAddressLng != null
      ) {
        gpsMismatch = detectGpsMismatch({
          jobId: input.jobId,
          technicianGpsLat: input.technicianGpsLat,
          technicianGpsLng: input.technicianGpsLng,
          jobAddressLat: input.jobAddressLat,
          jobAddressLng: input.jobAddressLng,
        });
        if (gpsMismatch.flagged) {
          console.warn(
            `[scheduling:transitionJob] F18 GPS mismatch: job ${input.jobId} distance=${gpsMismatch.distanceKm}km (threshold=${gpsMismatch.thresholdKm}km)`,
          );
          // Persist mismatch + check owner flag threshold
          const accountabilityDb = createAccountabilityDb(ctx.db);
          persistGpsMismatch(
            { technicianId: input.technicianId, businessId: ctx.businessId, mismatchResult: gpsMismatch },
            accountabilityDb,
            clock.now(),
          ).catch((err) => {
            console.error(`[scheduling:transitionJob] GPS mismatch persistence failed for ${input.jobId}:`, err);
          });
        }
      }

      // F19: Suspiciously fast completion flagging + persistence on COMPLETED
      let fastCompletion: ReturnType<typeof detectFastCompletion> | undefined;
      if (
        input.newStatus === "COMPLETED" &&
        input.estimatedDurationMinutes != null &&
        input.arrivedAt != null
      ) {
        fastCompletion = detectFastCompletion({
          jobId: input.jobId,
          estimatedDurationMinutes: input.estimatedDurationMinutes,
          arrivedAt: new Date(input.arrivedAt),
          completedAt: clock.now(),
        });
        if (fastCompletion.flagged) {
          console.warn(
            `[scheduling:transitionJob] F19 fast completion: job ${input.jobId} actual=${fastCompletion.actualMinutes}min (${fastCompletion.percentOfEstimate}% of estimate)`,
          );
          // Persist flag + alert owner
          const accountabilityDb = createAccountabilityDb(ctx.db);
          persistFastCompletion(
            { technicianId: input.technicianId, businessId: ctx.businessId, completionResult: fastCompletion },
            accountabilityDb,
            clock.now(),
          ).catch((err) => {
            console.error(`[scheduling:transitionJob] Fast completion persistence failed for ${input.jobId}:`, err);
          });
        }
      }

      // Auto-trigger drift evaluation on COMPLETED (blueprint: event-driven on job completion)
      if (input.newStatus === "COMPLETED" && input.estimatedDurationMinutes != null) {
        const actualMinutes = fastCompletion?.actualMinutes ?? input.estimatedDurationMinutes;
        const driftRecord = recordJobDrift(input.jobId, input.estimatedDurationMinutes, actualMinutes);
        // Single-job drift evaluation — fires communication if threshold exceeded
        const evaluation = evaluateFullDrift(
          [driftRecord],
          [0], // projected start not known here — use 0 as placeholder
          [{ windowStart: 0, windowEnd: 0 }], // window not available here
          720, // noon as default lunch start
        );
        if (evaluation.length > 0 && evaluation[0]!.action !== "silent") {
          const driftCommDb = createCommunicationWiringDb(ctx.db);
          for (const ev of evaluation) {
            if (ev.action === "communicate_customer" || ev.action === "full_recalculation") {
              onDriftCommunicationTriggered(
                ev.jobId,
                { action: "communicate_customer", reason: ev.reason ?? "drift" },
                driftCommDb, commClock, cannedAiGenerator,
              ).catch((err) => {
                console.error(`[scheduling:transitionJob] auto-drift communication failed for ${ev.jobId}:`, err);
              });
            }
          }
        }
      }

      return { ...result, gpsMismatch, fastCompletion };
    }),

  // ── Sick tech rebook ───────────────────────────────────────
  redistributeSickTech: ownerProcedure
    .input(
      z.object({
        technicianId: z.string().uuid(),
        date: z.string().datetime(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = createRebookCascadeDb(ctx.db);
      const osrmDeps = createOsrmDeps();

      const businessDayProvider = {
        getNextBusinessDays: (startDate: Date, count: number): Date[] => {
          const days: Date[] = [];
          const current = new Date(startDate);
          while (days.length < count) {
            current.setDate(current.getDate() + 1);
            if (current.getDay() !== 0 && current.getDay() !== 6) {
              days.push(new Date(current));
            }
          }
          return days;
        },
      };

      const result = await redistributeSickTechJobs(
        input.technicianId,
        new Date(input.date),
        ctx.businessId,
        businessDayProvider,
        db,
        osrmDeps,
      );

      // F6: Fire sick-tech communication AFTER rebook commit
      const commDb = createCommunicationWiringDb(ctx.db);
      const affectedJobs = result.redistributed
        .filter((r) => r.outcome === "rebooked" || r.outcome === "needs_rebook")
        .map((r) => ({
          jobId: r.jobId,
          outcome: r.outcome as "rebooked" | "needs_rebook",
          newDate: r.outcome === "rebooked" ? r.date : undefined,
        }));
      if (affectedJobs.length > 0) {
        onSickTechNotice(affectedJobs, commDb, commClock, cannedAiGenerator).catch((err) => {
          console.error(`[scheduling:redistributeSickTech] onSickTechNotice failed:`, err);
        });
      }

      return result;
    }),

  // ── Gap-fill: detect + rank candidates ─────────────────────
  detectAndRankGap: businessProcedure
    .input(
      z.object({
        gapId: z.string(),
        technicianId: z.string().uuid(),
        date: z.string().datetime(),
        gapStartMinute: z.number().int(),
        bookedDurationMinutes: z.number().int(),
        actualDurationMinutes: z.number().int(),
        previousJobId: z.string().uuid(),
        previousJobEndedAt: z.string().datetime(),
        previousJobAddressLat: z.number(),
        previousJobAddressLng: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const gapInput: DetectGapInput = {
        ...input,
        businessId: ctx.businessId,
        date: new Date(input.date),
        previousJobEndedAt: new Date(input.previousJobEndedAt),
      };

      const gap = detectGap(gapInput);
      if (!gap) return { outcome: "gap_too_small" as const, gap: null, ranked: null };

      const db = createGapFillDb(ctx.db);
      const osrmDeps = createOsrmDeps();

      // Fetch candidates from both tiers
      const booked = await db.getBookedCandidates(ctx.businessId, gap.date, [gap.previousJobId]);
      const waitlisted = await db.getWaitlistedCandidates(ctx.businessId, gap.date);
      const allCandidates = [...booked, ...waitlisted];

      const result = await rankCandidates(gap, allCandidates, osrmDeps);
      const ranked = result.rankedCandidates;

      // Auto-create offer for top candidate if available
      if (ranked.length > 0) {
        const topCandidate = ranked[0]!;
        const offerResult = await createPullForwardOffer(topCandidate, gap, commClock, db, osrmDeps);

        if (offerResult.outcome === "offered") {
          const commDb = createCommunicationWiringDb(ctx.db);
          onPullForwardOffer(
            topCandidate.candidate.jobId,
            gap.gapId,
            offerResult.offer.newWindow,
            offerResult.offer.expiresAt,
            commDb, commClock, cannedAiGenerator,
          ).catch((err) => {
            console.error(`[scheduling:detectAndRankGap] onPullForwardOffer failed:`, err);
          });
        }

        return { outcome: "ranked" as const, gap, ranked, offer: offerResult };
      }

      return { outcome: "ranked" as const, gap, ranked, offer: null };
    }),

  // ── Gap-fill: accept pull-forward offer ────────────────────
  acceptPullForward: businessProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const db = createGapFillDb(ctx.db);
      const result = await acceptPullForward(input.jobId, ctx.businessId, clock, db);

      // Fire onPullForwardAccepted communication
      if (result.outcome === "accepted") {
        const commDb = createCommunicationWiringDb(ctx.db);
        onPullForwardAccepted(
          input.jobId, "updated position", commDb, commClock, cannedAiGenerator,
        ).catch((err) => {
          console.error(`[scheduling:acceptPullForward] onPullForwardAccepted failed:`, err);
        });
      }

      return result;
    }),

  // ── Drift evaluation + communication ────────────────────────
  evaluateDrift: businessProcedure
    .input(
      z.object({
        driftRecords: z.array(z.object({
          jobId: z.string().uuid(),
          estimatedDurationMinutes: z.number(),
          actualDurationMinutes: z.number(),
        })),
        projectedStarts: z.array(z.number()),
        originalWindows: z.array(z.object({
          windowStart: z.number(),
          windowEnd: z.number(),
        })),
        lunchStartMinutes: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const records: DriftRecord[] = input.driftRecords.map((r) =>
        recordJobDrift(r.jobId, r.estimatedDurationMinutes, r.actualDurationMinutes),
      );
      const windows: OriginalWindow[] = input.originalWindows;
      const evaluations = evaluateFullDrift(
        records, input.projectedStarts, windows, input.lunchStartMinutes,
      );

      // Fire communication for jobs that need customer notification
      const commDb = createCommunicationWiringDb(ctx.db);
      for (const ev of evaluations) {
        if (ev.action === "communicate_customer" || ev.action === "full_recalculation") {
          onDriftCommunicationTriggered(
            ev.jobId,
            { action: "communicate_customer", reason: ev.reason ?? "drift" },
            commDb, commClock, cannedAiGenerator,
          ).catch((err) => {
            console.error(`[scheduling:evaluateDrift] drift communication failed for ${ev.jobId}:`, err);
          });
        }
      }

      return { evaluations };
    }),

  // ── Transfer: evaluate all jobs for a tech on a date ───────
  evaluateBatchTransfers: businessProcedure
    .input(
      z.object({
        technicianId: z.string().uuid(),
        date: z.string().datetime(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = createTransferDb(ctx.db);
      const osrmDeps = createOsrmDeps();
      return evaluateBatchTransfers(
        input.technicianId,
        new Date(input.date),
        transferClock,
        db,
        osrmDeps,
      );
    }),

  // ── Transfer: execute all recommended same-day transfers ───
  executeBatchTransfers: businessProcedure
    .input(
      z.object({
        technicianId: z.string().uuid(),
        date: z.string().datetime(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = createTransferDb(ctx.db);
      const osrmDeps = createOsrmDeps();

      // Evaluate first, then execute recommended ones
      const evaluation = await evaluateBatchTransfers(
        input.technicianId,
        new Date(input.date),
        transferClock,
        db,
        osrmDeps,
      );

      if (evaluation.recommended.length === 0) {
        return { transferred: [], capacityChanged: [], blocked: [] };
      }

      return executeBatchSameDayTransfers(
        evaluation.recommended,
        ctx.businessId,
        db,
        osrmDeps,
      );
    }),

  // ── Pause scheduling (F11) ──────────────────────────────────
  pauseScheduling: ownerProcedure
    .mutation(async ({ ctx }) => {
      const db = createPauseManualDb(ctx.db);
      return pauseScheduling(ctx.businessId, ctx.session.user.id, commClock, db);
    }),

  // ── Request resync (F11) ──────────────────────────────────
  requestResync: ownerProcedure
    .mutation(async ({ ctx }) => {
      const db = createPauseManualDb(ctx.db);
      return requestResync(ctx.businessId, ctx.session.user.id, commClock, db);
    }),

  // ── Resume scheduling (F11) ────────────────────────────────
  resumeScheduling: ownerProcedure
    .mutation(async ({ ctx }) => {
      const db = createPauseManualDb(ctx.db);
      return resumeScheduling(ctx.businessId, ctx.session.user.id, commClock, db);
    }),

  // ── Build resync audit ─────────────────────────────────────
  buildResyncAudit: ownerProcedure
    .input(z.object({ date: z.string().datetime() }))
    .query(async ({ ctx, input }) => {
      const db = createPauseManualDb(ctx.db);
      return buildResyncAudit(ctx.businessId, new Date(input.date), db);
    }),

  // ── Get scheduling mode ────────────────────────────────────
  getSchedulingMode: businessProcedure.query(async ({ ctx }) => {
    const pauseGuardDb = createPauseGuardDb(ctx.db);
    return pauseGuardDb.getSchedulingMode(ctx.businessId);
  }),

  // ── Arrange job manually ───────────────────────────────────
  arrangeJobManually: ownerProcedure
    .input(
      z.object({
        jobId: z.string().uuid(),
        newPosition: z.number().int().min(0),
        technicianId: z.string().uuid(),
        date: z.string().datetime(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = createPauseManualDb(ctx.db);
      return arrangeJobManually(
        input.jobId,
        input.newPosition,
        input.technicianId,
        new Date(input.date),
        db,
      );
    }),

  // ── Reset to AI optimization ───────────────────────────────
  resetToAI: ownerProcedure
    .input(
      z.object({
        technicianId: z.string().uuid(),
        date: z.string().datetime(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = createPauseManualDb(ctx.db);
      const osrmDeps = createOsrmDeps();
      return resetToAI(input.technicianId, new Date(input.date), db, osrmDeps);
    }),

  // ── Start my day ───────────────────────────────────────────
  startMyDay: businessProcedure
    .input(
      z.object({
        technicianId: z.string().uuid(),
        date: z.string().datetime(),
        gpsLat: z.number(),
        gpsLng: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const db = createPauseManualDb(ctx.db);
      const osrmDeps = createOsrmDeps();
      return startMyDay(
        {
          technicianId: input.technicianId,
          date: new Date(input.date),
          gpsLat: input.gpsLat,
          gpsLng: input.gpsLng,
        },
        db,
        commClock,
        osrmDeps,
      );
    }),

  // ── Get capacity for a tech on a date ──────────────────────
  getCapacity: businessProcedure
    .input(
      z.object({
        technicianId: z.string().uuid(),
        date: z.string().datetime(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const capacityDb = createCapacityDb(ctx.db);
      return capacityDb.getReservation(input.technicianId, new Date(input.date));
    }),

  // ── Get queue for a tech on a date ─────────────────────────
  getQueue: businessProcedure
    .input(
      z.object({
        technicianId: z.string().uuid(),
        date: z.string().datetime(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const db = createBookingOrchestratorDb(ctx.db);
      return db.getQueueForTechDate(input.technicianId, new Date(input.date));
    }),
});
