// ============================================================
// src/engine/scheduling/scheduling-state-machine.ts
//
// SCHEDULING STATE MACHINE — JOB LIFECYCLE TRANSITIONS
//
// Completely separate from the conversation state machine.
// This controls scheduling_jobs status transitions only.
//
// Rules enforced:
//   - Valid transition map (spec-defined, no exceptions)
//   - One active job per tech (EN_ROUTE/ARRIVED/IN_PROGRESS)
//   - 5-minute minimum duration before COMPLETED/INCOMPLETE
//   - Lock states: cannot reorder/move locked jobs
//   - Terminal states: no further transitions
//   - End-of-day sweep: flag stuck jobs, never auto-close
//
// Injectable: db, now (clock) for deterministic testing.
// ============================================================

import { parseHHMM } from "./capacity-math";
import { toUtcDate } from "./timezone";
import type { ConversationState } from "../state-machine/contract";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SchedulingJobStatus =
  | "NOT_STARTED"
  | "EN_ROUTE"
  | "ARRIVED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "INCOMPLETE"
  | "CANCELED"
  | "NEEDS_REBOOK"
  | "BEYOND_SAME_DAY";

export type SchedulingTriggeredBy = "AI" | "OWNER" | "TECH" | "SYSTEM";

export interface SchedulingJobRecord {
  id: string;
  businessId: string;
  technicianId: string;
  customerId: string;
  status: SchedulingJobStatus;
  scheduledDate: Date;
  arrivedAt: Date | null;
  completedAt: Date | null;
  customerName?: string;
}

export interface SchedulingEventRecord {
  id: string;
  schedulingJobId: string;
  eventType: string;
  oldValue: string | null;
  newValue: string | null;
  triggeredBy: SchedulingTriggeredBy;
  timestamp: Date;
}

export interface TransitionResult {
  success: boolean;
  reason?: "invalid_transition" | "tech_has_active_job" | "minimum_duration_not_met";
  job?: SchedulingJobRecord;
}

export interface StuckJob {
  jobId: string;
  technicianId: string;
  customerName: string;
  hoursOverdue: number;
}

// ── Injectable DB contract ────────────────────────────────────────────────────

export interface SchedulingStateMachineDb {
  getJob(jobId: string): Promise<SchedulingJobRecord | null>;
  /** Count jobs for this tech in active states, excluding excludeJobId. */
  countActiveJobs(technicianId: string, excludeJobId: string): Promise<number>;
  /**
   * Count active jobs with a row-level lock (SELECT FOR UPDATE).
   * Prevents race conditions when two transitions for the same tech
   * run concurrently. Falls back to countActiveJobs in test/in-memory stores.
   */
  countActiveJobsForUpdate?(technicianId: string, excludeJobId: string): Promise<number>;
  updateJob(jobId: string, data: Partial<SchedulingJobRecord>): Promise<void>;
  createEvent(event: Omit<SchedulingEventRecord, "id">): Promise<void>;
  /** List all jobs for a given date that are currently IN_PROGRESS. */
  listInProgressJobsByDate(date: Date): Promise<SchedulingJobRecord[]>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTIVE_STATES: ReadonlySet<SchedulingJobStatus> = new Set([
  "EN_ROUTE",
  "ARRIVED",
  "IN_PROGRESS",
]);

const LOCKED_STATES: ReadonlySet<SchedulingJobStatus> = new Set([
  "EN_ROUTE",
  "ARRIVED",
  "IN_PROGRESS",
  "COMPLETED",
  "INCOMPLETE",
  "CANCELED",
  "BEYOND_SAME_DAY",
]);

const TERMINAL_STATES: ReadonlySet<SchedulingJobStatus> = new Set([
  "COMPLETED",
  "INCOMPLETE",
  "CANCELED",
  "BEYOND_SAME_DAY",
]);

const VALID_TRANSITIONS: Record<SchedulingJobStatus, readonly SchedulingJobStatus[]> = {
  NOT_STARTED: ["EN_ROUTE", "CANCELED", "NEEDS_REBOOK"],
  EN_ROUTE: ["ARRIVED", "NOT_STARTED"],
  ARRIVED: ["IN_PROGRESS"],
  IN_PROGRESS: ["COMPLETED", "INCOMPLETE", "BEYOND_SAME_DAY"],
  COMPLETED: [],
  INCOMPLETE: [],
  CANCELED: [],
  NEEDS_REBOOK: ["NOT_STARTED", "CANCELED"],
  BEYOND_SAME_DAY: [],
};

const MINIMUM_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const END_OF_DAY_GRACE_MS = 2 * 60 * 60 * 1000; // 2 hours

// ── C2: Scheduling → Conversation state mapping ─────────────────────────────
// Maps each scheduling job status to the conversation state it implies.
// null = no conversation transition needed for this scheduling state.

export const SCHEDULING_TO_CONVERSATION_MAP: Record<SchedulingJobStatus, ConversationState | null> = {
  NOT_STARTED: "booked",
  EN_ROUTE: "en_route",
  ARRIVED: null,               // conversation stays en_route
  IN_PROGRESS: "job_in_progress",
  COMPLETED: "job_completed",
  INCOMPLETE: "job_completed", // job attempt done from conversation perspective
  CANCELED: "resolved",
  NEEDS_REBOOK: null,          // scheduling-internal; conversation unchanged
  BEYOND_SAME_DAY: null,       // owner handles manually
};

// ── 1. isValidTransition ──────────────────────────────────────────────────────

export function isValidTransition(
  currentStatus: SchedulingJobStatus,
  newStatus: SchedulingJobStatus,
): boolean {
  return VALID_TRANSITIONS[currentStatus].includes(newStatus);
}

// ── 2. hasActiveJob ───────────────────────────────────────────────────────────

export async function hasActiveJob(
  techId: string,
  excludeJobId: string,
  db: SchedulingStateMachineDb,
): Promise<boolean> {
  // H6: Prefer SELECT FOR UPDATE when available (production Prisma adapter).
  // Falls back to unlocked count for in-memory test stores.
  const countFn = db.countActiveJobsForUpdate ?? db.countActiveJobs;
  const count = await countFn.call(db, techId, excludeJobId);
  return count > 0;
}

// ── 3. isLockedState ──────────────────────────────────────────────────────────

export function isLockedState(status: SchedulingJobStatus): boolean {
  return LOCKED_STATES.has(status);
}

// ── 4. isTerminalState ────────────────────────────────────────────────────────

export function isTerminalState(status: SchedulingJobStatus): boolean {
  return TERMINAL_STATES.has(status);
}

/**
 * Optional callback for C2 bridge: transitions the conversation state
 * in the same logical unit as the scheduling transition.
 */
export type ConversationTransitionFn = (
  conversationId: string,
  toState: ConversationState,
) => Promise<void>;

// ── 5. transitionJobState ─────────────────────────────────────────────────────

export async function transitionJobState(
  jobId: string,
  newStatus: SchedulingJobStatus,
  techId: string,
  triggeredBy: SchedulingTriggeredBy,
  db: SchedulingStateMachineDb,
  now?: Date,
  /** C2: optional conversation bridge. When provided with a conversationId,
   *  transitions the conversation state after the scheduling transition succeeds. */
  conversationBridge?: { conversationId: string; transitionFn: ConversationTransitionFn },
): Promise<TransitionResult> {
  const currentTime = now ?? new Date();

  // (a) Read current job
  const job = await db.getJob(jobId);
  if (!job) throw new Error(`Scheduling job not found: ${jobId}`);

  // (b) Use the job's actual technicianId for active-job checks
  const effectiveTechId = job.technicianId;

  // (c) Validate transition
  if (!isValidTransition(job.status, newStatus)) {
    return { success: false, reason: "invalid_transition" };
  }

  // (d) One active job per tech — only check when entering an active state
  if (ACTIVE_STATES.has(newStatus)) {
    const otherActive = await hasActiveJob(effectiveTechId, jobId, db);
    if (otherActive) {
      return { success: false, reason: "tech_has_active_job" };
    }
  }

  // (e) 5-minute minimum duration for COMPLETED/INCOMPLETE
  if (newStatus === "COMPLETED" || newStatus === "INCOMPLETE") {
    if (!job.arrivedAt) {
      return { success: false, reason: "minimum_duration_not_met" };
    }
    const elapsed = currentTime.getTime() - new Date(job.arrivedAt).getTime();
    if (elapsed < MINIMUM_DURATION_MS) {
      return { success: false, reason: "minimum_duration_not_met" };
    }
  }

  // (f) Apply state update + timestamps
  const oldStatus = job.status;
  const updates: Partial<SchedulingJobRecord> = { status: newStatus };

  if (newStatus === "ARRIVED") {
    updates.arrivedAt = currentTime;
  }
  if (newStatus === "COMPLETED" || newStatus === "INCOMPLETE") {
    updates.completedAt = currentTime;
  }
  // BEYOND_SAME_DAY intentionally does NOT set completedAt.
  // The job isn't "completed" — it exceeded same-day scope.
  // Owner handles project-scope work separately.

  await db.updateJob(jobId, updates);

  // (g) Write scheduling event
  await db.createEvent({
    schedulingJobId: jobId,
    eventType: "status_change",
    oldValue: oldStatus,
    newValue: newStatus,
    triggeredBy,
    timestamp: currentTime,
  });

  // (h) C2: Bridge to conversation state machine if callback provided
  if (conversationBridge) {
    const targetConvState = SCHEDULING_TO_CONVERSATION_MAP[newStatus];
    if (targetConvState) {
      await conversationBridge.transitionFn(
        conversationBridge.conversationId,
        targetConvState,
      );
    }
  }

  // (i) Return updated job
  const updatedJob: SchedulingJobRecord = { ...job, ...updates };
  return { success: true, job: updatedJob };
}

// ── 6. endOfDaySweep ──────────────────────────────────────────────────────────

export async function endOfDaySweep(
  date: Date,
  techEndTimes: Map<string, string>, // techId -> "HH:MM"
  db: SchedulingStateMachineDb,
  now?: Date,
  timezone: string = "UTC",
): Promise<StuckJob[]> {
  const currentTime = now ?? new Date();
  const tz = timezone;
  const jobs = await db.listInProgressJobsByDate(date);
  const stuck: StuckJob[] = [];

  for (const job of jobs) {
    const endTimeStr = techEndTimes.get(job.technicianId);
    if (!endTimeStr) continue; // No end time known — skip

    const endMinutes = parseHHMM(endTimeStr);

    // Build the tech's end-of-day timestamp in business-local time, convert to UTC
    const endOfDay = toUtcDate(endMinutes, date, tz);

    const overdueMs = currentTime.getTime() - endOfDay.getTime();
    if (overdueMs > END_OF_DAY_GRACE_MS) {
      stuck.push({
        jobId: job.id,
        technicianId: job.technicianId,
        customerName: job.customerName ?? "Unknown",
        hoursOverdue: Math.floor(overdueMs / 3_600_000),
      });
    }
  }

  return stuck;
}

// ── In-memory store for testing ───────────────────────────────────────────────

export function createInMemorySchedulingDb(
  initialJobs: SchedulingJobRecord[] = [],
): SchedulingStateMachineDb & {
  _jobs: Map<string, SchedulingJobRecord>;
  _events: SchedulingEventRecord[];
} {
  const jobs = new Map<string, SchedulingJobRecord>();
  for (const j of initialJobs) jobs.set(j.id, { ...j });
  const events: SchedulingEventRecord[] = [];

  return {
    _jobs: jobs,
    _events: events,

    async getJob(jobId) {
      const j = jobs.get(jobId);
      return j ? { ...j } : null;
    },

    async countActiveJobs(technicianId, excludeJobId) {
      let count = 0;
      for (const j of jobs.values()) {
        if (
          j.technicianId === technicianId &&
          j.id !== excludeJobId &&
          ACTIVE_STATES.has(j.status)
        ) {
          count++;
        }
      }
      return count;
    },

    async updateJob(jobId, data) {
      const j = jobs.get(jobId);
      if (!j) throw new Error(`Job not found: ${jobId}`);
      Object.assign(j, data);
    },

    async createEvent(event) {
      events.push({ id: crypto.randomUUID(), ...event });
    },

    async listInProgressJobsByDate(date) {
      const dateStr = date.toISOString().slice(0, 10);
      const results: SchedulingJobRecord[] = [];
      for (const j of jobs.values()) {
        if (
          j.status === "IN_PROGRESS" &&
          j.scheduledDate.toISOString().slice(0, 10) === dateStr
        ) {
          results.push({ ...j });
        }
      }
      return results;
    },
  };
}
