// ============================================================
// src/engine/scheduling/prisma-scheduling-adapter.ts
//
// PRODUCTION PRISMA ADAPTER — SCHEDULING ENGINE
//
// Implements all injectable DB interfaces for the scheduling
// engine modules using PrismaClient. Each interface maps to
// real Prisma queries with row-level locking where required.
//
// Import this once at startup and pass the adapter instances
// to the scheduling engine functions.
//
// NOT imported by tests — tests use in-memory fakes.
// ============================================================

import type { PrismaClient } from "../../../generated/prisma";
import type {
  TechProfile,
} from "./capacity-math";
import type { BookingOrchestratorDb } from "./booking-orchestrator";
import type { RebookCascadeDb, RebookableJob } from "./rebook-cascade";
import type { SchedulingStateMachineDb, SchedulingJobRecord, SchedulingEventRecord, SchedulingJobStatus, SchedulingTriggeredBy } from "./scheduling-state-machine";
import type {
  MorningReminderWorkerDb,
  EndOfDaySweepWorkerDb,
  PullForwardExpiryWorkerDb,
  SkillTagValidationWorkerDb,
  ManualPositionExpiryWorkerDb,
  EstimateTimeoutWorkerDb,
} from "./scheduling-workers";
import type { GapFillDb, PullForwardOffer, GapFillCandidate } from "./gap-fill";
import type { TransferDb, TransferableJob, TransferApproval } from "./inter-tech-transfer";
import type { PauseGuardDb } from "./pause-guard";
import type { QueuedJob } from "./queue-insertion";
import type { TechCandidate } from "./tech-assignment";
import type { Coordinates, OsrmServiceDeps } from "./osrm-service";
import type { TimePreference } from "./capacity-math";
import type { WindowRecalculatorDb, RecalcJob } from "./window-recalculator";

// ── Helpers ─────────────────────────────────────────────────────────────────

function dateToDateOnly(d: Date): Date {
  return new Date(d.toISOString().split("T")[0]!);
}

/** Format a Date as "H:MM AM/PM" for customer-facing display. */
function formatTimeForCustomer(d: Date): string {
  const h24 = d.getHours();
  const m = d.getMinutes();
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

// ── PauseGuardDb ────────────────────────────────────────────────────────────

export function createPauseGuardDb(prisma: PrismaClient): PauseGuardDb {
  return {
    async getSchedulingMode(businessId: string) {
      const biz = await prisma.businesses.findUniqueOrThrow({
        where: { id: businessId },
        select: { scheduling_mode: true },
      });
      return { mode: biz.scheduling_mode };
    },
  };
}

// ── getTechProfile helper ──────────────────────────────────────────────────

export async function getTechProfile(prisma: PrismaClient, technicianId: string): Promise<TechProfile | null> {
  const tech = await prisma.technicians.findUnique({
    where: { id: technicianId },
  });
  if (!tech) return null;
  return {
    id: tech.id,
    businessId: tech.business_id,
    workingHoursStart: tech.working_hours_start,
    workingHoursEnd: tech.working_hours_end,
    lunchStart: tech.lunch_start,
    lunchEnd: tech.lunch_end,
    overtimeCapMinutes: tech.overtime_cap_minutes,
  };
}

// ── SchedulingStateMachineDb ────────────────────────────────────────────────

export function createSchedulingStateMachineDb(prisma: PrismaClient): SchedulingStateMachineDb {
  return {
    async getJob(jobId: string): Promise<SchedulingJobRecord | null> {
      const row = await prisma.scheduling_jobs.findUnique({ where: { id: jobId } });
      if (!row) return null;
      return {
        id: row.id,
        businessId: row.business_id,
        technicianId: row.technician_id,
        customerId: row.customer_id,
        status: row.status as SchedulingJobStatus,
        scheduledDate: row.scheduled_date,
        arrivedAt: row.arrived_at,
        completedAt: row.completed_at,
      };
    },

    async countActiveJobs(technicianId: string, excludeJobId: string): Promise<number> {
      return prisma.scheduling_jobs.count({
        where: {
          technician_id: technicianId,
          id: { not: excludeJobId },
          status: { in: ["NOT_STARTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"] },
        },
      });
    },

    // H6: SELECT FOR UPDATE path — row-level locking on active job count
    async countActiveJobsForUpdate(technicianId: string, excludeJobId: string): Promise<number> {
      const result = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) as count
        FROM scheduling_jobs
        WHERE technician_id = ${technicianId}::uuid
          AND id != ${excludeJobId}::uuid
          AND status IN ('NOT_STARTED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS')
        FOR UPDATE
      `;
      return Number(result[0]?.count ?? 0);
    },

    async updateJob(jobId: string, data: Partial<SchedulingJobRecord>) {
      const update: Record<string, unknown> = { updated_at: new Date() };
      if (data.status !== undefined) update.status = data.status;
      if (data.arrivedAt !== undefined) update.arrived_at = data.arrivedAt;
      if (data.completedAt !== undefined) update.completed_at = data.completedAt;
      if (data.scheduledDate !== undefined) update.scheduled_date = dateToDateOnly(data.scheduledDate);
      await prisma.scheduling_jobs.update({ where: { id: jobId }, data: update });
    },

    async createEvent(event: Omit<SchedulingEventRecord, "id">) {
      await prisma.scheduling_events.create({
        data: {
          scheduling_job_id: event.schedulingJobId,
          event_type: event.eventType,
          old_value: event.oldValue,
          new_value: event.newValue ?? "",
          triggered_by: event.triggeredBy as SchedulingTriggeredBy,
          timestamp: event.timestamp,
        },
      });
    },

    async listInProgressJobsByDate(date: Date): Promise<SchedulingJobRecord[]> {
      const rows = await prisma.scheduling_jobs.findMany({
        where: {
          scheduled_date: dateToDateOnly(date),
          status: "IN_PROGRESS",
        },
        orderBy: { queue_position: "asc" },
      });
      return rows.map((r) => ({
        id: r.id,
        businessId: r.business_id,
        technicianId: r.technician_id,
        customerId: r.customer_id,
        status: r.status as SchedulingJobStatus,
        scheduledDate: r.scheduled_date,
        arrivedAt: r.arrived_at,
        completedAt: r.completed_at,
      }));
    },
  };
}

// ── Shared queue reader ─────────────────────────────────────────────────────

async function getQueueForTechDate(prisma: PrismaClient, technicianId: string, date: Date): Promise<QueuedJob[]> {
  const rows = await prisma.scheduling_jobs.findMany({
    where: {
      technician_id: technicianId,
      scheduled_date: dateToDateOnly(date),
      status: { notIn: ["CANCELED"] },
    },
    orderBy: { queue_position: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    queuePosition: r.queue_position,
    status: r.status as SchedulingJobStatus,
    timePreference: r.time_preference as TimePreference,
    addressLat: r.address_lat,
    addressLng: r.address_lng,
    manualPosition: r.manual_position,
    manualPositionSetDate: r.manual_position_set_date,
    estimatedDurationMinutes: r.estimated_duration_minutes,
    driveTimeMinutes: r.drive_time_minutes,
    queueVersion: r.queue_version,
  }));
}

// ── BookingOrchestratorDb ───────────────────────────────────────────────────

export function createBookingOrchestratorDb(prisma: PrismaClient): BookingOrchestratorDb {
  const pauseGuardDb = createPauseGuardDb(prisma);

  const db: BookingOrchestratorDb = {
    pauseGuardDb,

    async getQueueForTechDate(technicianId: string, date: Date): Promise<QueuedJob[]> {
      return getQueueForTechDate(prisma, technicianId, date);
    },

    async getTechProfile(technicianId: string): Promise<TechProfile | null> {
      return getTechProfile(prisma, technicianId);
    },

    async createSchedulingJob(job) {
      await prisma.scheduling_jobs.create({
        data: {
          id: job.id,
          business_id: job.businessId,
          technician_id: job.technicianId,
          customer_id: job.customerId,
          service_type_id: job.serviceType,
          status: job.status as SchedulingJobStatus,
          scheduled_date: dateToDateOnly(job.scheduledDate),
          queue_position: job.queuePosition,
          time_preference: job.timePreference as TimePreference,
          estimated_duration_minutes: job.totalCostMinutes,
          drive_time_minutes: job.driveTimeMinutes ?? 0,
          address_lat: job.addressLat,
          address_lng: job.addressLng,
          address_text: job.addressText || "",
          job_notes: job.jobNotes ?? null,
          window_start: job.windowStart ?? undefined,
          window_end: job.windowEnd ?? undefined,
          queue_version: 0,
          rebook_count: 0,
        },
      });
    },

    async createAppointment(appt) {
      const row = await prisma.appointments.create({
        data: {
          business_id: appt.businessId,
          customer_id: appt.customerId,
          scheduling_job_id: appt.schedulingJobId,
          appointment_date: dateToDateOnly(appt.appointmentDate),
          appointment_time: appt.appointmentTime,
          duration_minutes: appt.durationMinutes,
          address: appt.address || null,
          technician_name: appt.technicianName,
          service_type: appt.serviceType,
          status: "booked",
        },
      });
      return row.id;
    },

    async createSchedulingEvent(event) {
      await prisma.scheduling_events.create({
        data: {
          scheduling_job_id: event.schedulingJobId,
          event_type: event.eventType,
          old_value: event.oldValue,
          new_value: event.newValue,
          triggered_by: event.triggeredBy as SchedulingTriggeredBy,
          timestamp: event.timestamp,
        },
      });
    },

    async transaction<T>(fn: (tx: BookingOrchestratorDb) => Promise<T>): Promise<T> {
      // If prisma is already a transaction client ($transaction won't exist),
      // run the callback directly — we're already inside a transaction.
      if (typeof (prisma as unknown as Record<string, unknown>).$transaction !== "function") {
        return fn(db);
      }
      return prisma.$transaction(async (tx) => {
        const txDb = createBookingOrchestratorDb(tx as unknown as PrismaClient);
        return fn(txDb);
      });
    },
  };

  return db;
}

// ── RebookCascadeDb ─────────────────────────────────────────────────────────

export function createRebookCascadeDb(prisma: PrismaClient): RebookCascadeDb {
  const pauseGuardDb = createPauseGuardDb(prisma);

  const db: RebookCascadeDb = {
    pauseGuardDb,

    async getTechProfile(technicianId: string): Promise<TechProfile | null> {
      return getTechProfile(prisma, technicianId);
    },

    async getJob(jobId: string): Promise<RebookableJob | null> {
      const row = await prisma.scheduling_jobs.findUnique({ where: { id: jobId } });
      if (!row) return null;
      return {
        jobId: row.id,
        technicianId: row.technician_id,
        businessId: row.business_id,
        serviceTypeId: row.service_type_id,
        scheduledDate: row.scheduled_date,
        timePreference: row.time_preference as TimePreference,
        totalCostMinutes: row.estimated_duration_minutes,
        addressLat: row.address_lat,
        addressLng: row.address_lng,
        status: row.status as SchedulingJobStatus,
        queuePosition: row.queue_position,
        manualPosition: row.manual_position,
        rebookCount: row.rebook_count,
      };
    },

    async getQueueForTechDate(technicianId: string, date: Date): Promise<QueuedJob[]> {
      return getQueueForTechDate(prisma, technicianId, date);
    },

    async listJobsForTechDate(technicianId: string, date: Date): Promise<RebookableJob[]> {
      const rows = await prisma.scheduling_jobs.findMany({
        where: {
          technician_id: technicianId,
          scheduled_date: dateToDateOnly(date),
          status: { notIn: ["CANCELED"] },
        },
        orderBy: { queue_position: "asc" },
      });
      return rows.map((r) => ({
        jobId: r.id,
        technicianId: r.technician_id,
        businessId: r.business_id,
        serviceTypeId: r.service_type_id,
        scheduledDate: r.scheduled_date,
        timePreference: r.time_preference as TimePreference,
        totalCostMinutes: r.estimated_duration_minutes,
        addressLat: r.address_lat,
        addressLng: r.address_lng,
        status: r.status as SchedulingJobStatus,
        queuePosition: r.queue_position,
        manualPosition: r.manual_position,
        rebookCount: r.rebook_count,
      }));
    },

    async listOtherActiveTechs(businessId: string, excludeTechnicianId: string): Promise<TechCandidate[]> {
      const techs = await prisma.technicians.findMany({
        where: {
          business_id: businessId,
          is_active: true,
          id: { not: excludeTechnicianId },
        },
        include: { skill_tags: true },
      });
      return techs.map((t) => ({
        id: t.id,
        businessId: t.business_id,
        name: t.name,
        homeBaseLat: t.home_base_lat,
        homeBaseLng: t.home_base_lng,
        skillTags: t.skill_tags.map((s) => s.service_type_id),
        workingHoursStart: t.working_hours_start,
        workingHoursEnd: t.working_hours_end,
        lunchStart: t.lunch_start,
        lunchEnd: t.lunch_end,
        overtimeCapMinutes: t.overtime_cap_minutes,
        isActive: t.is_active,
      }));
    },

    async updateJobSchedule(jobId, technicianId, date, queuePosition) {
      await prisma.scheduling_jobs.update({
        where: { id: jobId },
        data: {
          technician_id: technicianId,
          scheduled_date: dateToDateOnly(date),
          queue_position: queuePosition,
          updated_at: new Date(),
        },
      });
    },

    async incrementRebookCount(jobId: string) {
      await prisma.scheduling_jobs.update({
        where: { id: jobId },
        data: { rebook_count: { increment: 1 }, updated_at: new Date() },
      });
    },

    async markJobNeedsRebook(jobId: string) {
      await prisma.scheduling_jobs.update({
        where: { id: jobId },
        data: { status: "NEEDS_REBOOK", updated_at: new Date() },
      });
    },

    async createRebookQueueEntry(jobId, originalDate, originalTechnicianId, reason) {
      const job = await prisma.scheduling_jobs.findUniqueOrThrow({ where: { id: jobId } });
      await prisma.rebook_queue.create({
        data: {
          business_id: job.business_id,
          scheduling_job_id: jobId,
          original_date: dateToDateOnly(originalDate),
          original_technician_id: originalTechnicianId,
          reason,
        },
      });
    },

    async transaction<T>(fn: (tx: RebookCascadeDb) => Promise<T>): Promise<T> {
      return prisma.$transaction(async (tx) => {
        const txDb = createRebookCascadeDb(tx as unknown as PrismaClient);
        return fn(txDb);
      });
    },
  };

  return db;
}

// ── MorningReminderWorkerDb ─────────────────────────────────────────────────

export function createMorningReminderWorkerDb(prisma: PrismaClient): MorningReminderWorkerDb {
  return {
    pauseGuardDb: createPauseGuardDb(prisma),

    async listNotStartedJobsForDate(businessId: string, date: Date) {
      const rows = await prisma.scheduling_jobs.findMany({
        where: {
          business_id: businessId,
          scheduled_date: dateToDateOnly(date),
          status: "NOT_STARTED",
        },
        select: { id: true },
        orderBy: { queue_position: "asc" },
      });
      return rows.map((r) => ({ jobId: r.id }));
    },

    async hasPendingMorningReminder(jobId: string, date: Date) {
      // Dedupe key format matches communication-wiring.ts:
      // "scheduling_morning_reminder:{jobId}:{YYYY-MM-DD}"
      const dateStr = date.toISOString().split("T")[0]!;
      const dedupeKey = `scheduling_morning_reminder:${jobId}:${dateStr}`;
      const existing = await prisma.outbound_queue.findFirst({
        where: {
          dedupe_key: dedupeKey,
          status: { notIn: ["failed_terminal", "canceled"] },
        },
        select: { id: true },
      });
      return existing !== null;
    },
  };
}

// ── EndOfDaySweepWorkerDb ───────────────────────────────────────────────────

export function createEndOfDaySweepWorkerDb(prisma: PrismaClient): EndOfDaySweepWorkerDb {
  const stateMachineDb = createSchedulingStateMachineDb(prisma);

  return {
    ...stateMachineDb,
    pauseGuardDb: createPauseGuardDb(prisma),

    async getActiveTechProfiles(businessId: string) {
      const techs = await prisma.technicians.findMany({
        where: { business_id: businessId, is_active: true },
      });
      return techs.map((t) => ({
        id: t.id,
        profile: {
          id: t.id,
          businessId: t.business_id,
          workingHoursStart: t.working_hours_start,
          workingHoursEnd: t.working_hours_end,
          lunchStart: t.lunch_start,
          lunchEnd: t.lunch_end,
          overtimeCapMinutes: t.overtime_cap_minutes,
        },
      }));
    },
  };
}

// ── GapFillDb ──────────────────────────────────────────────────────────────

export function createGapFillDb(prisma: PrismaClient): GapFillDb {
  const pauseGuardDb = createPauseGuardDb(prisma);

  const db: GapFillDb = {
    pauseGuardDb,

    async getTechProfile(technicianId: string): Promise<TechProfile | null> {
      return getTechProfile(prisma, technicianId);
    },

    async getBookedCandidates(businessId: string, date: Date, excludeJobIds: string[]): Promise<GapFillCandidate[]> {
      const rows = await prisma.scheduling_jobs.findMany({
        where: {
          business_id: businessId,
          scheduled_date: dateToDateOnly(date),
          status: "NOT_STARTED",
          id: excludeJobIds.length > 0 ? { notIn: excludeJobIds } : undefined,
        },
        include: { customers: { include: { customer_contacts: true } } },
        orderBy: { queue_position: "asc" },
      });
      return rows.map((r) => ({
        jobId: r.id,
        customerId: r.customer_id,
        customerPhone: r.customers?.customer_contacts?.find((c) => c.contact_type === "phone")?.contact_value ?? "",
        technicianId: r.technician_id,
        businessId: r.business_id,
        currentQueuePosition: r.queue_position,
        scheduledDate: r.scheduled_date,
        scheduledStartMinute: 0, // computed by caller from queue
        totalCostMinutes: r.estimated_duration_minutes,
        addressLat: r.address_lat,
        addressLng: r.address_lng,
        serviceTypeId: r.service_type_id,
        timePreference: r.time_preference as TimePreference,
        status: r.status as SchedulingJobStatus,
        isBooked: true,
      }));
    },

    async getWaitlistedCandidates(businessId: string, date: Date): Promise<GapFillCandidate[]> {
      const rows = await prisma.scheduling_jobs.findMany({
        where: {
          business_id: businessId,
          scheduled_date: dateToDateOnly(date),
          status: "NEEDS_REBOOK",
        },
        include: { customers: { include: { customer_contacts: true } } },
        orderBy: { queue_position: "asc" },
      });
      return rows.map((r) => ({
        jobId: r.id,
        customerId: r.customer_id,
        customerPhone: r.customers?.customer_contacts?.find((c) => c.contact_type === "phone")?.contact_value ?? "",
        technicianId: r.technician_id,
        businessId: r.business_id,
        currentQueuePosition: r.queue_position,
        scheduledDate: r.scheduled_date,
        scheduledStartMinute: 0,
        totalCostMinutes: r.estimated_duration_minutes,
        addressLat: r.address_lat,
        addressLng: r.address_lng,
        serviceTypeId: r.service_type_id,
        timePreference: r.time_preference as TimePreference,
        status: r.status as SchedulingJobStatus,
        isBooked: false,
      }));
    },

    async getQueueForTechDate(technicianId: string, date: Date): Promise<QueuedJob[]> {
      return getQueueForTechDate(prisma, technicianId, date);
    },

    async createPullForwardOffer(offer: PullForwardOffer): Promise<void> {
      await prisma.pull_forward_offers.create({
        data: {
          gap_id: offer.gapId,
          scheduling_job_id: offer.jobId,
          customer_id: offer.customerId,
          customer_phone: offer.customerPhone,
          original_technician_id: offer.originalTechnicianId,
          original_date: dateToDateOnly(offer.originalDate),
          original_queue_position: offer.originalQueuePosition,
          target_technician_id: offer.targetTechnicianId,
          target_date: dateToDateOnly(offer.targetDate),
          new_queue_position: offer.newQueuePosition,
          total_cost_minutes: offer.totalCostMinutes,
          time_preference: offer.timePreference as TimePreference,
          original_window: offer.originalWindow,
          new_window: offer.newWindow,
          expires_at: offer.expiresAt,
        },
      });
    },

    async getPullForwardOffer(jobId: string): Promise<PullForwardOffer | null> {
      const row = await prisma.pull_forward_offers.findFirst({
        where: { scheduling_job_id: jobId, status: "active" },
        orderBy: { created_at: "desc" },
      });
      if (!row) return null;
      return mapPullForwardOffer(row);
    },

    async getActiveOfferForGap(gapId: string): Promise<PullForwardOffer | null> {
      const row = await prisma.pull_forward_offers.findFirst({
        where: { gap_id: gapId, status: "active" },
        orderBy: { created_at: "desc" },
      });
      if (!row) return null;
      return mapPullForwardOffer(row);
    },

    async expirePullForwardOffer(jobId: string): Promise<void> {
      await prisma.pull_forward_offers.updateMany({
        where: { scheduling_job_id: jobId, status: "active" },
        data: { status: "expired", updated_at: new Date() },
      });
    },

    async updateJobSchedule(jobId: string, technicianId: string, date: Date, queuePosition: number): Promise<void> {
      await prisma.scheduling_jobs.update({
        where: { id: jobId },
        data: {
          technician_id: technicianId,
          scheduled_date: dateToDateOnly(date),
          queue_position: queuePosition,
          updated_at: new Date(),
        },
      });
    },

    async transaction<T>(fn: (tx: GapFillDb) => Promise<T>): Promise<T> {
      return prisma.$transaction(async (tx) => {
        const txDb = createGapFillDb(tx as unknown as PrismaClient);
        return fn(txDb);
      });
    },
  };

  return db;
}

function mapPullForwardOffer(row: {
  gap_id: string;
  scheduling_job_id: string;
  customer_id: string;
  customer_phone: string;
  original_technician_id: string;
  original_date: Date;
  original_queue_position: number;
  target_technician_id: string;
  target_date: Date;
  new_queue_position: number;
  total_cost_minutes: number;
  time_preference: string;
  original_window: string;
  new_window: string;
  expires_at: Date;
}): PullForwardOffer {
  return {
    gapId: row.gap_id,
    jobId: row.scheduling_job_id,
    customerId: row.customer_id,
    customerPhone: row.customer_phone,
    originalTechnicianId: row.original_technician_id,
    originalDate: row.original_date,
    originalQueuePosition: row.original_queue_position,
    targetTechnicianId: row.target_technician_id,
    targetDate: row.target_date,
    newQueuePosition: row.new_queue_position,
    totalCostMinutes: row.total_cost_minutes,
    timePreference: row.time_preference as TimePreference,
    originalWindow: row.original_window,
    newWindow: row.new_window,
    expiresAt: row.expires_at,
  };
}

// ── TransferDb ─────────────────────────────────────────────────────────────

export function createTransferDb(prisma: PrismaClient): TransferDb {
  const pauseGuardDb = createPauseGuardDb(prisma);

  const db: TransferDb = {
    pauseGuardDb,

    async getTechProfile(technicianId: string): Promise<TechProfile | null> {
      return getTechProfile(prisma, technicianId);
    },

    async getJob(jobId: string): Promise<TransferableJob | null> {
      const row = await prisma.scheduling_jobs.findUnique({ where: { id: jobId } });
      if (!row) return null;
      return mapTransferableJob(row);
    },

    async getTransferableJobsForTechDate(technicianId: string, date: Date): Promise<TransferableJob[]> {
      const rows = await prisma.scheduling_jobs.findMany({
        where: {
          technician_id: technicianId,
          scheduled_date: dateToDateOnly(date),
          status: { in: ["NOT_STARTED", "NEEDS_REBOOK"] },
        },
        orderBy: { queue_position: "asc" },
      });
      return rows.map(mapTransferableJob);
    },

    async getQueueForTechDate(technicianId: string, date: Date): Promise<QueuedJob[]> {
      return getQueueForTechDate(prisma, technicianId, date);
    },

    async listOtherActiveTechs(businessId: string, excludeTechnicianId: string): Promise<TechCandidate[]> {
      const techs = await prisma.technicians.findMany({
        where: {
          business_id: businessId,
          is_active: true,
          id: { not: excludeTechnicianId },
        },
        include: { skill_tags: true },
      });
      return techs.map((t) => ({
        id: t.id,
        businessId: t.business_id,
        name: t.name,
        homeBaseLat: t.home_base_lat,
        homeBaseLng: t.home_base_lng,
        skillTags: t.skill_tags.map((s) => s.service_type_id),
        workingHoursStart: t.working_hours_start,
        workingHoursEnd: t.working_hours_end,
        lunchStart: t.lunch_start,
        lunchEnd: t.lunch_end,
        overtimeCapMinutes: t.overtime_cap_minutes,
        isActive: t.is_active,
      }));
    },

    async getTransferCountToday(jobId: string, date: Date): Promise<number> {
      return prisma.transfer_events.count({
        where: {
          scheduling_job_id: jobId,
          created_at: {
            gte: dateToDateOnly(date),
            lt: new Date(dateToDateOnly(date).getTime() + 86400000),
          },
        },
      });
    },

    async getTechHomeBase(technicianId: string): Promise<Coordinates> {
      const tech = await prisma.technicians.findUniqueOrThrow({
        where: { id: technicianId },
        select: { home_base_lat: true, home_base_lng: true },
      });
      return { lat: tech.home_base_lat, lng: tech.home_base_lng };
    },

    async updateJobSchedule(jobId: string, technicianId: string, date: Date, queuePosition: number): Promise<void> {
      await prisma.scheduling_jobs.update({
        where: { id: jobId },
        data: {
          technician_id: technicianId,
          scheduled_date: dateToDateOnly(date),
          queue_position: queuePosition,
          updated_at: new Date(),
        },
      });
    },

    async incrementTransferCount(jobId: string): Promise<void> {
      await prisma.scheduling_jobs.update({
        where: { id: jobId },
        data: { transfer_count: { increment: 1 }, updated_at: new Date() },
      });
    },

    async createTransferEvent(event: {
      jobId: string;
      fromTechnicianId: string;
      toTechnicianId: string;
      fromDate: Date;
      toDate: Date;
      fromQueuePosition: number;
      toQueuePosition: number;
      approvalType: TransferApproval;
      netDriveTimeSavingMinutes: number;
    }): Promise<void> {
      await prisma.transfer_events.create({
        data: {
          scheduling_job_id: event.jobId,
          from_technician_id: event.fromTechnicianId,
          to_technician_id: event.toTechnicianId,
          from_date: dateToDateOnly(event.fromDate),
          to_date: dateToDateOnly(event.toDate),
          from_queue_position: event.fromQueuePosition,
          to_queue_position: event.toQueuePosition,
          approval_type: event.approvalType as TransferApproval,
          net_drive_time_saving_minutes: event.netDriveTimeSavingMinutes,
        },
      });
    },

    async transaction<T>(fn: (tx: TransferDb) => Promise<T>): Promise<T> {
      return prisma.$transaction(async (tx) => {
        const txDb = createTransferDb(tx as unknown as PrismaClient);
        return fn(txDb);
      });
    },
  };

  return db;
}

function mapTransferableJob(row: {
  id: string;
  technician_id: string;
  business_id: string;
  service_type_id: string;
  scheduled_date: Date;
  estimated_duration_minutes: number;
  address_lat: number;
  address_lng: number;
  time_preference: string;
  status: string;
  queue_position: number;
  manual_position: boolean;
  transfer_count: number;
}): TransferableJob {
  return {
    jobId: row.id,
    technicianId: row.technician_id,
    businessId: row.business_id,
    serviceTypeId: row.service_type_id,
    scheduledDate: row.scheduled_date,
    scheduledStartMinute: 0, // computed by caller from queue position
    totalCostMinutes: row.estimated_duration_minutes,
    addressLat: row.address_lat,
    addressLng: row.address_lng,
    timePreference: row.time_preference as TimePreference,
    status: row.status as SchedulingJobStatus,
    queuePosition: row.queue_position,
    manualPosition: row.manual_position,
    transferCount: row.transfer_count,
  };
}

// ── CommunicationWiringDb ──────────────────────────────────────────────────

import type {
  CommunicationWiringDb,
  SchedulingOutboundMessage,
  SchedulingMessagePurpose,
  SchedulingJobWithContext,
  MessageChannel,
} from "./communication-wiring";

export function createCommunicationWiringDb(prisma: PrismaClient): CommunicationWiringDb {
  function mapOutboundRow(row: {
    id: string;
    business_id: string;
    conversation_id: string | null;
    scheduling_job_id: string | null;
    message_purpose: string;
    audience_type: string;
    channel: string;
    recipient_phone: string | null;
    recipient_email: string | null;
    content: string | null;
    dedupe_key: string;
    is_urgent: boolean;
    quiet_hours_restricted: boolean;
    scheduled_send_at: Date | null;
    status: string;
  }): SchedulingOutboundMessage {
    return {
      messageId: row.id,
      businessId: row.business_id,
      conversationId: row.conversation_id,
      schedulingJobId: row.scheduling_job_id ?? "",
      purpose: row.message_purpose as SchedulingMessagePurpose,
      audience: row.audience_type as "customer" | "technician" | "owner",
      channel: row.channel as MessageChannel,
      recipientPhone: row.recipient_phone,
      recipientEmail: row.recipient_email,
      content: row.content ?? "",
      dedupeKey: row.dedupe_key,
      isUrgent: row.is_urgent,
      quietHoursRestricted: row.quiet_hours_restricted,
      scheduledSendAt: row.scheduled_send_at,
      status: row.status as "pending" | "deferred",
    };
  }

  const db: CommunicationWiringDb = {
    async getSchedulingJob(jobId: string): Promise<SchedulingJobWithContext | null> {
      const row = await prisma.scheduling_jobs.findUnique({
        where: { id: jobId },
        include: {
          service_types: { select: { name: true } },
          customers: {
            select: {
              display_name: true,
              customer_contacts: {
                where: { is_primary: true },
                select: { contact_type: true, contact_value: true },
                take: 2,
              },
            },
          },
        },
      });
      if (!row) return null;

      const contacts = row.customers?.customer_contacts ?? [];
      const phone = contacts.find((c) => c.contact_type === "phone")?.contact_value ?? null;
      const email = contacts.find((c) => c.contact_type === "email")?.contact_value ?? null;

      return {
        jobId: row.id,
        businessId: row.business_id,
        technicianId: row.technician_id,
        customerName: row.customers?.display_name ?? null,
        customerPhone: phone,
        customerEmail: email,
        serviceType: row.service_types?.name ?? "service",
        scheduledDate: row.scheduled_date,
        status: row.status,
      };
    },

    async getConversationForJob(jobId: string) {
      // Path: scheduling_jobs → appointments (via scheduling_job_id) → conversations
      const appt = await prisma.appointments.findFirst({
        where: { scheduling_job_id: jobId },
        select: {
          conversation_id: true,
          conversations: {
            select: {
              id: true,
              channel: true,
              contact_handle: true,
              customers: {
                select: {
                  customer_contacts: {
                    where: { is_primary: true },
                    select: { contact_type: true, contact_value: true },
                    take: 2,
                  },
                },
              },
            },
          },
        },
      });

      if (!appt?.conversations) return null;

      const conv = appt.conversations;
      const contacts = conv.customers?.customer_contacts ?? [];
      const phone = contacts.find((c) => c.contact_type === "phone")?.contact_value
        ?? conv.contact_handle ?? null;
      const email = contacts.find((c) => c.contact_type === "email")?.contact_value ?? null;

      return {
        conversationId: conv.id,
        channel: conv.channel as MessageChannel,
        customerPhone: phone,
        customerEmail: email,
      };
    },

    async getBusinessInfo(businessId: string) {
      const biz = await prisma.businesses.findUnique({
        where: { id: businessId },
        select: {
          business_name: true,
          quiet_hours_start: true,
          quiet_hours_end: true,
          timezone: true,
          preferred_phone_number: true,
        },
      });
      if (!biz) return null;

      // quiet_hours_start/end are stored as Time(6) — extract HH:MM
      const formatTime = (d: Date): string => {
        const h = d.getUTCHours().toString().padStart(2, "0");
        const m = d.getUTCMinutes().toString().padStart(2, "0");
        return `${h}:${m}`;
      };

      return {
        businessName: biz.business_name,
        quietHoursStart: formatTime(biz.quiet_hours_start),
        quietHoursEnd: formatTime(biz.quiet_hours_end),
        timezone: biz.timezone,
        preferredPhone: biz.preferred_phone_number,
      };
    },

    async getTechnicianInfo(technicianId: string) {
      const tech = await prisma.technicians.findUnique({
        where: { id: technicianId },
        select: { name: true },
      });
      if (!tech) return null;
      // Tech phone not stored in technicians table — return name only.
      // Tech-facing messages will use null phone until tech contacts are added.
      return { name: tech.name, phone: "" };
    },

    async getQueuePositionContext(jobId: string) {
      const job = await prisma.scheduling_jobs.findUnique({
        where: { id: jobId },
        select: {
          queue_position: true,
          technician_id: true,
          scheduled_date: true,
          window_start: true,
          window_end: true,
        },
      });
      if (!job) return null;

      const totalJobs = await prisma.scheduling_jobs.count({
        where: {
          technician_id: job.technician_id,
          scheduled_date: job.scheduled_date,
          status: { notIn: ["CANCELED"] },
        },
      });

      const pos = job.queue_position;
      let windowStart: string | null = null;
      let windowEnd: string | null = null;
      let softEstimate: string | null = null;

      if (job.window_start && job.window_end) {
        // Use persisted window times — format as "H:MM AM/PM"
        windowStart = formatTimeForCustomer(job.window_start);
        windowEnd = formatTimeForCustomer(job.window_end);
      } else {
        // Fallback for jobs booked before window persistence
        if (pos <= 1) {
          windowStart = "first thing in the morning";
          windowEnd = "mid-morning";
        } else if (pos === 2) {
          windowStart = "late morning";
          windowEnd = "early afternoon";
        } else if (pos === 3) {
          softEstimate = "afternoon";
        }
      }

      return {
        position: pos,
        totalJobs,
        estimatedWindowStart: windowStart,
        estimatedWindowEnd: windowEnd,
        softEstimate,
      };
    },

    async enqueueOutboundMessage(message: SchedulingOutboundMessage): Promise<void> {
      await prisma.outbound_queue.create({
        data: {
          id: message.messageId,
          business_id: message.businessId,
          conversation_id: message.conversationId,
          scheduling_job_id: message.schedulingJobId || null,
          message_purpose: message.purpose,
          audience_type: message.audience as string as any,
          channel: message.channel as string as any,
          recipient_phone: message.recipientPhone,
          recipient_email: message.recipientEmail,
          content: message.content,
          dedupe_key: message.dedupeKey,
          is_urgent: message.isUrgent,
          quiet_hours_restricted: message.quietHoursRestricted,
          scheduled_send_at: message.scheduledSendAt,
          status: message.status as string as any,
        },
      });
    },

    async getPendingOrDeferredByDedupeKey(dedupeKey: string): Promise<SchedulingOutboundMessage | null> {
      const row = await prisma.outbound_queue.findFirst({
        where: {
          dedupe_key: dedupeKey,
          status: { in: ["pending", "deferred"] },
        },
      });
      if (!row) return null;
      return mapOutboundRow(row as any);
    },

    async getMessageCountForRecipientSince(recipientPhone: string, sinceDate: Date): Promise<number> {
      return prisma.outbound_queue.count({
        where: {
          recipient_phone: recipientPhone,
          created_at: { gte: sinceDate },
          status: { notIn: ["canceled", "failed_terminal"] },
        },
      });
    },

    async getNonUrgentMessageCountForConversationSince(conversationId: string, sinceDate: Date): Promise<number> {
      return prisma.outbound_queue.count({
        where: {
          conversation_id: conversationId,
          is_urgent: false,
          created_at: { gte: sinceDate },
          status: { notIn: ["canceled", "failed_terminal"] },
        },
      });
    },

    async getPendingMessagesForJob(jobId: string, purpose: SchedulingMessagePurpose): Promise<SchedulingOutboundMessage[]> {
      const rows = await prisma.outbound_queue.findMany({
        where: {
          scheduling_job_id: jobId,
          message_purpose: purpose,
          status: { in: ["pending", "deferred"] },
        },
      });
      return rows.map((r) => mapOutboundRow(r as any));
    },

    async cancelPendingMessages(jobId: string, purpose: SchedulingMessagePurpose): Promise<number> {
      const result = await prisma.outbound_queue.updateMany({
        where: {
          scheduling_job_id: jobId,
          message_purpose: purpose,
          status: { in: ["pending", "deferred"] },
        },
        data: { status: "canceled" },
      });
      return result.count;
    },

    async transaction<T>(fn: (tx: CommunicationWiringDb) => Promise<T>): Promise<T> {
      return prisma.$transaction(async (txPrisma) => {
        const txDb = createCommunicationWiringDb(txPrisma as unknown as PrismaClient);
        return fn(txDb);
      });
    },
  };

  return db;
}

// ── SendTimeVerifyDb ───────────────────────────────────────────────────────

import type { SendTimeVerifyDb } from "./send-time-verify";

export function createSendTimeVerifyDb(prisma: PrismaClient): SendTimeVerifyDb {
  return {
    async getJobStatus(jobId: string) {
      const row = await prisma.scheduling_jobs.findUnique({
        where: { id: jobId },
        select: { status: true },
      });
      if (!row) return null;
      return row.status as SchedulingJobStatus;
    },
  };
}

// ── PullForwardExpiryWorkerDb ──────────────────────────────────────────────

export function createPullForwardExpiryWorkerDb(prisma: PrismaClient): PullForwardExpiryWorkerDb {
  return {
    async expireOffers(now: Date): Promise<number> {
      const result = await prisma.pull_forward_offers.updateMany({
        where: {
          status: "active",
          expires_at: { lte: now },
        },
        data: { status: "expired", updated_at: now },
      });
      return result.count;
    },
  };
}

// ── SkillTagValidationWorkerDb ────────────────────────────────────────────

export function createSkillTagValidationWorkerDb(prisma: PrismaClient): SkillTagValidationWorkerDb {
  return {
    pauseGuardDb: createPauseGuardDb(prisma),

    async findMismatchedJobs(businessId: string, date: Date) {
      // Find jobs where the tech does not have a skill tag matching the job's service type
      const jobs = await prisma.scheduling_jobs.findMany({
        where: {
          business_id: businessId,
          scheduled_date: dateToDateOnly(date),
          status: { notIn: ["CANCELED", "COMPLETED"] },
        },
        select: {
          id: true,
          technician_id: true,
          service_type_id: true,
        },
      });

      if (jobs.length === 0) return [];

      // Get all skill tags for the relevant techs
      const techIds = [...new Set(jobs.map((j) => j.technician_id))];
      const skillTags = await prisma.technician_skill_tags.findMany({
        where: { technician_id: { in: techIds } },
        select: { technician_id: true, service_type_id: true },
      });

      const techSkillSet = new Map<string, Set<string>>();
      for (const tag of skillTags) {
        if (!techSkillSet.has(tag.technician_id)) {
          techSkillSet.set(tag.technician_id, new Set());
        }
        techSkillSet.get(tag.technician_id)!.add(tag.service_type_id);
      }

      return jobs
        .filter((j) => {
          const skills = techSkillSet.get(j.technician_id);
          return !skills || !skills.has(j.service_type_id);
        })
        .map((j) => ({
          jobId: j.id,
          technicianId: j.technician_id,
          serviceTypeId: j.service_type_id,
        }));
    },
  };
}

// ── ManualPositionExpiryWorkerDb ──────────────────────────────────────────

export function createManualPositionExpiryWorkerDb(prisma: PrismaClient): ManualPositionExpiryWorkerDb {
  return {
    pauseGuardDb: createPauseGuardDb(prisma),

    async clearExpiredManualPositions(cutoffDate: Date): Promise<number> {
      const result = await prisma.scheduling_jobs.updateMany({
        where: {
          manual_position: true,
          manual_position_set_date: { lte: cutoffDate },
          status: { notIn: ["CANCELED", "COMPLETED"] },
        },
        data: {
          manual_position: false,
          manual_position_set_date: null,
          updated_at: new Date(),
        },
      });
      return result.count;
    },
  };
}

// ── EstimateTimeoutWorkerDb ────────────────────────────────────────────────

export function createEstimateTimeoutWorkerDb(prisma: PrismaClient): EstimateTimeoutWorkerDb {
  return {
    pauseGuardDb: createPauseGuardDb(prisma),

    async findJobsWithoutEstimate(businessId: string, cutoffDate: Date) {
      const rows = await prisma.scheduling_jobs.findMany({
        where: {
          business_id: businessId,
          status: { in: ["ARRIVED", "IN_PROGRESS"] },
          arrived_at: { lte: cutoffDate },
          tech_confirmed_type: null, // no estimate submitted
        },
        select: { id: true, technician_id: true, arrived_at: true },
      });
      return rows
        .filter((r) => r.arrived_at !== null)
        .map((r) => ({
          jobId: r.id,
          technicianId: r.technician_id,
          arrivedAt: r.arrived_at!,
        }));
    },

    async hasDedupeKey(dedupeKey: string) {
      const existing = await prisma.outbound_queue.findFirst({
        where: {
          dedupe_key: dedupeKey,
          status: { notIn: ["failed_terminal", "canceled"] },
        },
        select: { id: true },
      });
      return existing !== null;
    },
  };
}

// ── PauseManualDb ─────────────────────────────────────────────────────────

import type { PauseManualDb, SchedulingMode, SchedulingModeState, TechInfo } from "./pause-manual-controls";
import type { CancellationDb, CustomerAppointment } from "./cancellation-pipeline";

export function createPauseManualDb(prisma: PrismaClient): PauseManualDb {
  const db: PauseManualDb = {

    async getSchedulingMode(businessId: string): Promise<SchedulingModeState> {
      const biz = await prisma.businesses.findUniqueOrThrow({
        where: { id: businessId },
        select: { scheduling_mode: true },
      });
      return { businessId, mode: biz.scheduling_mode as SchedulingMode };
    },

    async setSchedulingMode(businessId: string, mode: SchedulingMode, _userId: string, _timestamp: Date) {
      await prisma.businesses.update({
        where: { id: businessId },
        data: { scheduling_mode: mode },
      });
    },

    async createModeEvent(event) {
      await prisma.scheduling_mode_events.create({
        data: {
          business_id: event.businessId,
          from_mode: event.fromMode,
          to_mode: event.toMode,
          user_id: event.userId,
          timestamp: event.timestamp,
        },
      });
    },

    async getActiveTechsForBusiness(businessId: string): Promise<TechInfo[]> {
      const techs = await prisma.technicians.findMany({
        where: { business_id: businessId, is_active: true },
      });
      return techs.map((t) => ({
        id: t.id,
        name: t.name,
        businessId: t.business_id,
        isActive: t.is_active,
        profile: {
          id: t.id,
          businessId: t.business_id,
          workingHoursStart: t.working_hours_start,
          workingHoursEnd: t.working_hours_end,
          lunchStart: t.lunch_start,
          lunchEnd: t.lunch_end,
          overtimeCapMinutes: t.overtime_cap_minutes,
        },
      }));
    },

    async getQueueForTechDate(technicianId: string, date: Date) {
      return getQueueForTechDate(prisma, technicianId, date);
    },

    async getOrphanedJobs(businessId: string, date: Date) {
      // Orphaned = scheduled for this date but assigned to inactive tech
      const rows = await prisma.scheduling_jobs.findMany({
        where: {
          business_id: businessId,
          scheduled_date: dateToDateOnly(date),
          status: { notIn: ["CANCELED", "COMPLETED"] },
          technicians: { is_active: false },
        },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    },

    async updateQueueOrder(technicianId: string, date: Date, queue) {
      for (let i = 0; i < queue.length; i++) {
        const job = queue[i]!;
        await prisma.scheduling_jobs.update({
          where: { id: job.id },
          data: {
            queue_position: i,
            manual_position: job.manualPosition,
            manual_position_set_date: job.manualPositionSetDate ?? null,
            updated_at: new Date(),
          },
        });
      }
    },

    async setManualPosition(jobId: string, manual: boolean) {
      await prisma.scheduling_jobs.update({
        where: { id: jobId },
        data: {
          manual_position: manual,
          manual_position_set_date: manual ? new Date() : null,
          updated_at: new Date(),
        },
      });
    },

    async clearAllManualFlags(technicianId: string, date: Date) {
      const result = await prisma.scheduling_jobs.updateMany({
        where: {
          technician_id: technicianId,
          scheduled_date: dateToDateOnly(date),
          manual_position: true,
          status: { notIn: ["CANCELED"] },
        },
        data: {
          manual_position: false,
          manual_position_set_date: null,
          updated_at: new Date(),
        },
      });
      return result.count;
    },

    async getTechHomeBase(technicianId: string) {
      const tech = await prisma.technicians.findUniqueOrThrow({
        where: { id: technicianId },
        select: { home_base_lat: true, home_base_lng: true },
      });
      return { lat: tech.home_base_lat, lng: tech.home_base_lng };
    },

    async isStartingMyDayUsed(technicianId: string, date: Date) {
      const existing = await prisma.starting_my_day_log.findUnique({
        where: {
          technician_id_date: {
            technician_id: technicianId,
            date: dateToDateOnly(date),
          },
        },
      });
      return existing !== null;
    },

    async markStartingMyDayUsed(technicianId: string, date: Date) {
      await prisma.starting_my_day_log.create({
        data: {
          technician_id: technicianId,
          date: dateToDateOnly(date),
        },
      });
    },

    async updateFirstJobDriveTime(technicianId: string, date: Date, driveTimeMinutes: number) {
      const firstJob = await prisma.scheduling_jobs.findFirst({
        where: {
          technician_id: technicianId,
          scheduled_date: dateToDateOnly(date),
          status: { notIn: ["CANCELED"] },
        },
        orderBy: { queue_position: "asc" },
        select: { id: true },
      });
      if (firstJob) {
        await prisma.scheduling_jobs.update({
          where: { id: firstJob.id },
          data: { drive_time_minutes: driveTimeMinutes, updated_at: new Date() },
        });
      }
    },

    async getTechProfile(technicianId: string): Promise<TechProfile | null> {
      return getTechProfile(prisma, technicianId);
    },

    async transaction<T>(fn: (tx: PauseManualDb) => Promise<T>): Promise<T> {
      return prisma.$transaction(async (tx) => {
        const txDb = createPauseManualDb(tx as unknown as PrismaClient);
        return fn(txDb);
      });
    },
  };

  return db;
}

// ── Accountability Adapter (GPS mismatch + fast completion persistence) ──

import type { AccountabilityDb } from "./transition-hooks";

export function createAccountabilityDb(prisma: PrismaClient): AccountabilityDb {
  return {
    async recordGpsMismatch(technicianId, jobId, distanceKm, timestamp) {
      // Store in scheduling_events as an audit trail
      await prisma.scheduling_events.create({
        data: {
          scheduling_job_id: jobId,
          event_type: "gps_mismatch",
          old_value: null,
          new_value: `${distanceKm}km`,
          triggered_by: "SYSTEM",
          timestamp,
        },
      });
    },
    async getGpsMismatchCount(technicianId, since) {
      const count = await prisma.scheduling_events.count({
        where: {
          event_type: "gps_mismatch",
          timestamp: { gte: since },
          scheduling_jobs: { technician_id: technicianId },
        },
      });
      return count;
    },
    async recordFastCompletion(technicianId, jobId, percentOfEstimate, timestamp) {
      await prisma.scheduling_events.create({
        data: {
          scheduling_job_id: jobId,
          event_type: "fast_completion",
          old_value: null,
          new_value: `${percentOfEstimate}%`,
          triggered_by: "SYSTEM",
          timestamp,
        },
      });
    },
    async enqueueOwnerAlert(businessId, alertType, technicianId, details, dedupeKey) {
      // Check dedupe first
      const existing = await prisma.outbound_queue.findFirst({
        where: {
          business_id: businessId,
          dedupe_key: dedupeKey,
          status: { in: ["pending", "deferred", "claimed", "sent"] },
        },
        select: { id: true },
      });
      if (existing) return;

      await prisma.outbound_queue.create({
        data: {
          business_id: businessId,
          message_purpose: `scheduling_${alertType}`,
          audience_type: "owner",
          channel: "sms",
          content: details,
          dedupe_key: dedupeKey,
          is_urgent: false,
          status: "pending",
        },
      });
    },
  };
}

// ── Morning Briefing Worker Adapter ───────────────────────────────────────

import type { MorningBriefingWorkerDb } from "./scheduling-workers";

export function createMorningBriefingWorkerDb(prisma: PrismaClient): MorningBriefingWorkerDb {
  return {
    async getActiveTechsWithJobs(businessId, date) {
      const dateOnly = dateToDateOnly(date);
      const techs = await prisma.technicians.findMany({
        where: { business_id: businessId, is_active: true },
        select: { id: true, name: true },
      });

      const results: Array<{ technicianId: string; technicianName: string; jobCount: number; totalMinutes: number }> = [];
      for (const tech of techs) {
        const jobs = await prisma.scheduling_jobs.findMany({
          where: { technician_id: tech.id, scheduled_date: dateOnly, status: "NOT_STARTED" },
          select: { estimated_duration_minutes: true },
        });
        results.push({
          technicianId: tech.id,
          technicianName: tech.name,
          jobCount: jobs.length,
          totalMinutes: jobs.reduce((sum, j) => sum + j.estimated_duration_minutes, 0),
        });
      }
      return results;
    },
    async hasPendingMorningBriefing(technicianId, date) {
      const dateStr = date.toISOString().split("T")[0]!;
      const dedupeKey = `scheduling_morning_briefing:${technicianId}:${dateStr}`;
      const existing = await prisma.outbound_queue.findFirst({
        where: { dedupe_key: dedupeKey, status: { in: ["pending", "deferred", "claimed"] } },
        select: { id: true },
      });
      return existing !== null;
    },
    pauseGuardDb: createPauseGuardDb(prisma),
  };
}

// ── Timer Check-In Worker Adapter ────────────────────────────────────────

import type { TimerCheckInWorkerDb } from "./scheduling-workers";

export function createTimerCheckInWorkerDb(prisma: PrismaClient): TimerCheckInWorkerDb {
  return {
    async findOverrunningJobs(businessId, cutoffDate) {
      // Jobs IN_PROGRESS where arrivedAt + estimatedDuration + grace < now
      // cutoffDate already accounts for grace. We need arrivedAt + estimate < cutoffDate.
      const jobs = await prisma.scheduling_jobs.findMany({
        where: {
          business_id: businessId,
          status: "IN_PROGRESS",
          arrived_at: { not: null },
        },
        select: {
          id: true,
          technician_id: true,
          arrived_at: true,
          estimated_duration_minutes: true,
        },
      });

      return jobs.filter((j) => {
        const arrivedAt = j.arrived_at!;
        const expectedEnd = new Date(arrivedAt.getTime() + j.estimated_duration_minutes * 60 * 1000);
        return expectedEnd <= cutoffDate;
      }).map((j) => ({
        jobId: j.id,
        technicianId: j.technician_id,
        arrivedAt: j.arrived_at!,
        estimatedDurationMinutes: j.estimated_duration_minutes,
      }));
    },
    async hasTimerCheckIn(jobId) {
      const dedupeKey = `scheduling_timer_checkin:${jobId}`;
      const existing = await prisma.outbound_queue.findFirst({
        where: { dedupe_key: dedupeKey, status: { in: ["pending", "deferred", "claimed", "sent"] } },
        select: { id: true },
      });
      return existing !== null;
    },
    pauseGuardDb: createPauseGuardDb(prisma),
  };
}

// ── Project Scope Prompt Worker Adapter ──────────────────────────────────

import type { ProjectScopePromptWorkerDb } from "./scheduling-workers";

export function createProjectScopePromptWorkerDb(prisma: PrismaClient): ProjectScopePromptWorkerDb {
  return {
    async findLongRunningJobs(businessId, cutoffDate) {
      const jobs = await prisma.scheduling_jobs.findMany({
        where: {
          business_id: businessId,
          status: "IN_PROGRESS",
          arrived_at: { lte: cutoffDate },
        },
        select: {
          id: true,
          technician_id: true,
          arrived_at: true,
        },
      });
      return jobs.map((j) => ({
        jobId: j.id,
        technicianId: j.technician_id,
        arrivedAt: j.arrived_at!,
      }));
    },
    async hasProjectScopePrompt(jobId) {
      const dedupeKey = `scheduling_project_scope:${jobId}`;
      const existing = await prisma.outbound_queue.findFirst({
        where: { dedupe_key: dedupeKey, status: { in: ["pending", "deferred", "claimed", "sent"] } },
        select: { id: true },
      });
      return existing !== null;
    },
    pauseGuardDb: createPauseGuardDb(prisma),
  };
}

// ── Heartbeat Adapter ────────────────────────────────────────────────────

import type { HeartbeatDb } from "./scheduling-workers";

// In-memory heartbeat store — lightweight, no schema change needed.
// In a production multi-instance deployment, replace with a database table.
const heartbeatStore = new Map<string, Date>();

export function createHeartbeatDb(): HeartbeatDb {
  return {
    async recordHeartbeat(workerName, timestamp) {
      heartbeatStore.set(workerName, timestamp);
    },
    async getLastHeartbeat(workerName) {
      return heartbeatStore.get(workerName) ?? null;
    },
  };
}

// ── WindowRecalculatorDb ───────────────────────────────────────────────────

export function createWindowRecalculatorDb(prisma: PrismaClient): WindowRecalculatorDb {
  return {
    async getJobsForTechOnDate(technicianId: string, date: Date): Promise<RecalcJob[]> {
      const dateOnly = dateToDateOnly(date);
      const nextDay = new Date(dateOnly);
      nextDay.setDate(nextDay.getDate() + 1);

      const jobs = await prisma.scheduling_jobs.findMany({
        where: {
          technician_id: technicianId,
          scheduled_date: { gte: dateOnly, lt: nextDay },
          status: { notIn: ["CANCELED"] },
        },
        orderBy: { queue_position: "asc" },
        select: {
          id: true,
          customer_id: true,
          queue_position: true,
          estimated_duration_minutes: true,
          window_start: true,
          window_end: true,
          status: true,
          customers: { select: { display_name: true } },
        },
      });

      return jobs.map((j) => ({
        id: j.id,
        customerId: j.customer_id,
        customerName: j.customers?.display_name ?? null,
        queuePosition: j.queue_position,
        estimatedDurationMinutes: j.estimated_duration_minutes ?? 60,
        driveTimeMinutes: 15, // V1 hardcoded
        windowStart: j.window_start,
        windowEnd: j.window_end,
        status: j.status,
      }));
    },

    async getFollowUpEstimates(jobId: string) {
      const followUp = await prisma.follow_up_requests.findFirst({
        where: { follow_up_job_id: jobId },
        select: {
          estimated_low_minutes: true,
          estimated_high_minutes: true,
        },
      });
      if (!followUp || followUp.estimated_low_minutes == null || followUp.estimated_high_minutes == null) {
        return null;
      }
      return {
        estimatedLowMinutes: followUp.estimated_low_minutes,
        estimatedHighMinutes: followUp.estimated_high_minutes,
      };
    },

    async updateJobWindow(jobId: string, windowStart: Date, windowEnd: Date) {
      await prisma.scheduling_jobs.update({
        where: { id: jobId },
        data: { window_start: windowStart, window_end: windowEnd },
      });
    },
  };
}

// ── CancellationDb ─────────────────────────────────────────────────────────

export function createCancellationDb(prisma: PrismaClient): CancellationDb {
  return {
    async findCustomerIdsByPhone(businessId: string, phone: string): Promise<string[]> {
      // Fuzzy match: strip non-digits from stored values and compare
      // Use raw SQL for the digit-only comparison
      const rows = await prisma.$queryRaw<{ customer_id: string }[]>`
        SELECT DISTINCT customer_id
        FROM customer_contacts
        WHERE business_id = ${businessId}::uuid
          AND contact_type = 'phone'
          AND regexp_replace(contact_value, '[^0-9]', '', 'g') LIKE '%' || ${phone} || '%'
      `;
      return rows.map((r) => r.customer_id);
    },

    async findActiveAppointments(businessId: string, customerIds: string[]): Promise<CustomerAppointment[]> {
      const rows = await prisma.appointments.findMany({
        where: {
          business_id: businessId,
          customer_id: { in: customerIds },
          status: { in: ["booked", "rescheduled"] },
          appointment_date: { gte: dateToDateOnly(new Date()) },
        },
        include: {
          scheduling_jobs: {
            select: {
              id: true,
              window_start: true,
              window_end: true,
              technicians: { select: { name: true } },
            },
          },
        },
        orderBy: { appointment_date: "asc" },
      });

      return rows.map((r) => {
        const ws = r.scheduling_jobs?.window_start;
        const we = r.scheduling_jobs?.window_end;
        return {
          appointmentId: r.id,
          schedulingJobId: r.scheduling_job_id,
          techName: r.scheduling_jobs?.technicians?.name ?? r.technician_name ?? "Your technician",
          date: r.appointment_date instanceof Date
            ? r.appointment_date.toISOString().split("T")[0]!
            : String(r.appointment_date).split("T")[0]!,
          windowStart: ws ? formatTimeForCustomer(ws) : "TBD",
          windowEnd: we ? formatTimeForCustomer(we) : "TBD",
          serviceDescription: r.service_type ?? "Service appointment",
          status: r.status,
        };
      });
    },

    async getSchedulingJobForAppointment(appointmentId: string) {
      const appt = await prisma.appointments.findUnique({
        where: { id: appointmentId },
        select: { scheduling_job_id: true },
      });
      if (!appt?.scheduling_job_id) return null;

      const job = await prisma.scheduling_jobs.findUnique({
        where: { id: appt.scheduling_job_id },
        select: {
          id: true,
          technician_id: true,
          scheduled_date: true,
          status: true,
        },
      });
      if (!job) return null;

      return {
        jobId: job.id,
        technicianId: job.technician_id,
        scheduledDate: job.scheduled_date,
        status: job.status as import("./scheduling-state-machine").SchedulingJobStatus,
      };
    },

    async updateAppointmentCanceled(appointmentId: string, reason: string, canceledBy: string) {
      await prisma.appointments.update({
        where: { id: appointmentId },
        data: {
          status: "canceled",
          canceled_at: new Date(),
          cancellation_reason: reason,
          canceled_by: canceledBy,
        },
      });
    },

    async transitionJobToCanceled(jobId: string) {
      await prisma.scheduling_jobs.update({
        where: { id: jobId },
        data: {
          status: "CANCELED",
          updated_at: new Date(),
        },
      });
      // Create scheduling event for audit
      await prisma.scheduling_events.create({
        data: {
          scheduling_job_id: jobId,
          event_type: "status_change",
          old_value: "NOT_STARTED",
          new_value: "CANCELED",
          triggered_by: "SYSTEM",
        },
      });
    },

    async cancelPendingMessages(jobId: string): Promise<number> {
      const result = await prisma.outbound_queue.updateMany({
        where: {
          scheduling_job_id: jobId,
          status: "pending",
        },
        data: {
          status: "canceled",
        },
      });
      return result.count;
    },
  };
}

// ── RescheduleDb ───────────────────────────────────────────────────────────

import type { RescheduleDb } from "./reschedule-pipeline";

export function createRescheduleDb(prisma: PrismaClient): RescheduleDb {
  const self: RescheduleDb = {
    async getQueueForTechDate(technicianId: string, date: Date): Promise<QueuedJob[]> {
      return getQueueForTechDate(prisma, technicianId, date);
    },

    async getTechCandidate(technicianId: string) {
      const t = await prisma.technicians.findUnique({
        where: { id: technicianId },
        include: { skill_tags: true },
      });
      if (!t) return null;
      return {
        id: t.id,
        businessId: t.business_id,
        name: t.name,
        homeBaseLat: t.home_base_lat,
        homeBaseLng: t.home_base_lng,
        skillTags: t.skill_tags.map((s: { service_type_id: string }) => s.service_type_id),
        workingHoursStart: t.working_hours_start,
        workingHoursEnd: t.working_hours_end,
        lunchStart: t.lunch_start,
        lunchEnd: t.lunch_end,
        overtimeCapMinutes: t.overtime_cap_minutes,
        isActive: t.is_active,
      };
    },

    async updateSchedulingJob(jobId, data) {
      await prisma.scheduling_jobs.update({
        where: { id: jobId },
        data: {
          technician_id: data.technicianId,
          scheduled_date: dateToDateOnly(data.scheduledDate),
          queue_position: data.queuePosition,
          window_start: data.windowStart,
          window_end: data.windowEnd,
          rebook_count: data.rebookCount,
          updated_at: new Date(),
        },
      });
    },

    async updateAppointment(appointmentId, data) {
      await prisma.appointments.update({
        where: { id: appointmentId },
        data: {
          appointment_date: dateToDateOnly(data.appointmentDate),
          appointment_time: data.appointmentTime,
          technician_name: data.technicianName,
          updated_at: new Date(),
        },
      });
    },

    async createSchedulingEvent(event) {
      await prisma.scheduling_events.create({
        data: {
          scheduling_job_id: event.schedulingJobId,
          event_type: event.eventType,
          old_value: event.oldValue,
          new_value: event.newValue,
          triggered_by: event.triggeredBy as SchedulingTriggeredBy,
          timestamp: event.timestamp,
        },
      });
    },

    async getCurrentRebookCount(jobId) {
      const row = await prisma.scheduling_jobs.findUnique({
        where: { id: jobId },
        select: { rebook_count: true },
      });
      return row?.rebook_count ?? 0;
    },

    async transaction<T>(fn: (tx: RescheduleDb) => Promise<T>): Promise<T> {
      return prisma.$transaction(async (txClient) => {
        return fn(createRescheduleDb(txClient as unknown as PrismaClient));
      });
    },
  };

  return self;
}

// ── OSRM Production Config ─────────────────────────────────────────────────

/**
 * Creates OsrmServiceDeps from the OSRM_BASE_URL environment variable.
 * Falls back to http://localhost:5000 (OSRM default) when not set.
 */
export function createOsrmDeps(): OsrmServiceDeps {
  return {
    baseUrl: process.env.OSRM_BASE_URL ?? "http://localhost:5000",
  };
}
