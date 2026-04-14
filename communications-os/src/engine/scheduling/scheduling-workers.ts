// ============================================================
// src/engine/scheduling/scheduling-workers.ts
//
// C4: SCHEDULING WORKERS — IDEMPOTENT CRON HANDLERS
//
// Each worker is designed to be called by a cron or queue system.
// All workers are idempotent: safe to retry without side effects.
//
// Workers:
//   1. morningReminderWorker — fires reminders for today's jobs
//   2. endOfDaySweepWorker — flags stuck jobs, never auto-closes
//
// Rules enforced:
//   - Business timezone is REQUIRED (no silent UTC fallback)
//   - Idempotency via dedupe keys (morning) and pure reads (sweep)
//   - Each run is scoped to one business
//
// Injectable: db, clock, AI generator, timezone.
// ============================================================

import { endOfDaySweep, type SchedulingStateMachineDb, type SchedulingJobStatus, type StuckJob } from "./scheduling-state-machine";
import { parseHHMM, type TechProfile } from "./capacity-math";
import { businessToday } from "./timezone";
import { checkPauseGuard, type PauseGuardDb } from "./pause-guard";
import type { QueuedJob } from "./queue-insertion";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WorkerClockProvider {
  now(): Date;
}

export interface MorningReminderWorkerDb {
  /** List all NOT_STARTED jobs for a business on a given date. */
  listNotStartedJobsForDate(businessId: string, date: Date): Promise<{ jobId: string }[]>;
  /** Check if a morning reminder has already been queued (dedupe). */
  hasPendingMorningReminder(jobId: string, date: Date): Promise<boolean>;
  /** Pause guard operations. */
  pauseGuardDb: PauseGuardDb;
}

export interface EndOfDaySweepWorkerDb extends SchedulingStateMachineDb {
  /** Get all active techs for a business with their profiles. */
  getActiveTechProfiles(businessId: string): Promise<Array<{ id: string; profile: TechProfile }>>;
  /** Pause guard operations. */
  pauseGuardDb: PauseGuardDb;
}

export interface BusinessConfig {
  businessId: string;
  timezone: string; // IANA timezone — REQUIRED, no fallback
  openTime?: string; // "HH:MM", defaults to "08:00"
}

// ── Result types ────────────────────────────────────────────────────────────

export interface MorningReminderWorkerResult {
  businessId: string;
  date: Date;
  jobsProcessed: number;
  remindersQueued: number;
  alreadyQueued: number;
}

export interface EndOfDaySweepWorkerResult {
  businessId: string;
  date: Date;
  timezone: string;
  stuckJobs: StuckJob[];
}

// ── 1. morningReminderWorker ────────────────────────────────────────────────

/**
 * Idempotent morning reminder worker.
 *
 * For each NOT_STARTED job on today's date, checks if a morning reminder
 * has already been queued (dedupe). If not, calls the provided `queueReminder`
 * callback to enqueue the reminder.
 *
 * The callback should call `onMorningReminderDue` from communication-wiring.
 * We don't import it here to avoid circular dependencies — the caller wires it.
 */
export async function morningReminderWorker(
  config: BusinessConfig,
  clock: WorkerClockProvider,
  db: MorningReminderWorkerDb,
  queueReminder: (jobId: string) => Promise<void>,
): Promise<MorningReminderWorkerResult> {
  // H8: Pause guard — block automated reminders when paused
  const pauseCheck = await checkPauseGuard(config.businessId, db.pauseGuardDb);
  if (!pauseCheck.allowed) {
    return {
      businessId: config.businessId,
      date: businessToday(config.timezone, clock.now()),
      jobsProcessed: 0,
      remindersQueued: 0,
      alreadyQueued: 0,
    };
  }

  const today = businessToday(config.timezone, clock.now());
  const jobs = await db.listNotStartedJobsForDate(config.businessId, today);

  let remindersQueued = 0;
  let alreadyQueued = 0;

  for (const job of jobs) {
    const hasPending = await db.hasPendingMorningReminder(job.jobId, today);

    if (hasPending) {
      alreadyQueued++;
      continue;
    }

    await queueReminder(job.jobId);
    remindersQueued++;
  }

  return {
    businessId: config.businessId,
    date: today,
    jobsProcessed: jobs.length,
    remindersQueued,
    alreadyQueued,
  };
}

// ── 2. endOfDaySweepWorker ──────────────────────────────────────────────────

/**
 * Idempotent end-of-day sweep worker.
 *
 * Uses the business timezone to determine end-of-day timestamps.
 * Returns stuck jobs (IN_PROGRESS past end time + grace period).
 * Never auto-closes — caller decides what to do with stuck jobs.
 *
 * Idempotent because endOfDaySweep is a pure read: it does not mutate
 * any job state. Callers may safely retry without side effects.
 */
export async function endOfDaySweepWorker(
  config: BusinessConfig,
  clock: WorkerClockProvider,
  db: EndOfDaySweepWorkerDb,
): Promise<EndOfDaySweepWorkerResult> {
  // H8: Pause guard — block automated sweep when paused
  const pauseCheck = await checkPauseGuard(config.businessId, db.pauseGuardDb);
  if (!pauseCheck.allowed) {
    return {
      businessId: config.businessId,
      date: businessToday(config.timezone, clock.now()),
      timezone: config.timezone,
      stuckJobs: [],
    };
  }

  const now = clock.now();
  const today = businessToday(config.timezone, now);
  const techs = await db.getActiveTechProfiles(config.businessId);

  // Build techId → end-of-work-day map from profiles
  const techEndTimes = new Map<string, string>();
  for (const tech of techs) {
    techEndTimes.set(tech.id, tech.profile.workingHoursEnd);
  }

  // Use clock.now() as the date reference for toUtcDate inside endOfDaySweep.
  // businessToday() returns midnight UTC which can land on the wrong local day
  // when the business is behind UTC. clock.now() is always on the correct local day.
  const stuckJobs = await endOfDaySweep(
    now,          // reference date — on the correct local day
    techEndTimes,
    db,
    now,
    config.timezone, // never "UTC" fallback — always business timezone
  );

  return {
    businessId: config.businessId,
    date: today,    // for reporting: the business date
    timezone: config.timezone,
    stuckJobs,
  };
}

// ── 3. pullForwardExpiryWorker ─────────────────────────────────────────────
//
// F12: Expire pull-forward offers that have passed their expires_at.

export interface PullForwardExpiryWorkerDb {
  expireOffers(now: Date): Promise<number>;
}

export interface PullForwardExpiryWorkerResult {
  expiredCount: number;
}

export async function pullForwardExpiryWorker(
  clock: WorkerClockProvider,
  db: PullForwardExpiryWorkerDb,
): Promise<PullForwardExpiryWorkerResult> {
  const expiredCount = await db.expireOffers(clock.now());
  return { expiredCount };
}

// ── 4. skillTagValidationWorker ────────────────────────────────────────────
//
// F13: Flag jobs assigned to techs who lack the matching skill tag.

export interface SkillTagValidationWorkerDb {
  /** List jobs for a date that have a service_type_id not in their tech's skill tags. */
  findMismatchedJobs(businessId: string, date: Date): Promise<Array<{
    jobId: string;
    technicianId: string;
    serviceTypeId: string;
  }>>;
  pauseGuardDb: PauseGuardDb;
}

export interface SkillTagValidationWorkerResult {
  businessId: string;
  date: Date;
  mismatches: Array<{ jobId: string; technicianId: string; serviceTypeId: string }>;
}

export async function skillTagValidationWorker(
  config: BusinessConfig,
  clock: WorkerClockProvider,
  db: SkillTagValidationWorkerDb,
): Promise<SkillTagValidationWorkerResult> {
  const pauseCheck = await checkPauseGuard(config.businessId, db.pauseGuardDb);
  if (!pauseCheck.allowed) {
    return {
      businessId: config.businessId,
      date: businessToday(config.timezone, clock.now()),
      mismatches: [],
    };
  }

  const today = businessToday(config.timezone, clock.now());
  const mismatches = await db.findMismatchedJobs(config.businessId, today);

  return {
    businessId: config.businessId,
    date: today,
    mismatches,
  };
}

// ── 5. manualPositionExpiryWorker ──────────────────────────────────────────
//
// F14: Clear manual_position flags older than 24 hours (H3 enforcement).

const MANUAL_POSITION_EXPIRY_HOURS = 24;

export interface ManualPositionExpiryWorkerDb {
  /** Clear manual_position flag on jobs where manualPositionSetDate is older than cutoff. */
  clearExpiredManualPositions(cutoffDate: Date): Promise<number>;
  pauseGuardDb: PauseGuardDb;
}

export interface ManualPositionExpiryWorkerResult {
  businessId: string;
  expiredCount: number;
}

export async function manualPositionExpiryWorker(
  config: BusinessConfig,
  clock: WorkerClockProvider,
  db: ManualPositionExpiryWorkerDb,
): Promise<ManualPositionExpiryWorkerResult> {
  const pauseCheck = await checkPauseGuard(config.businessId, db.pauseGuardDb);
  if (!pauseCheck.allowed) {
    return { businessId: config.businessId, expiredCount: 0 };
  }

  const cutoff = new Date(clock.now().getTime() - MANUAL_POSITION_EXPIRY_HOURS * 60 * 60 * 1000);
  const expiredCount = await db.clearExpiredManualPositions(cutoff);

  return { businessId: config.businessId, expiredCount };
}

// ── 6. estimateTimeoutWorker ───────────────────────────────────────────────
//
// Two-checkpoint system for prompting techs for time estimates after arrival.
// CHECKPOINT 1 (30 min): First estimate prompt — "What did you find?"
// CHECKPOINT 2 (60 min): Gentle reminder — "Just need a quick update"
// Both only fire if tech_confirmed_type is still null (no estimate submitted).

const ESTIMATE_PROMPT_MINUTES = 30;   // checkpoint 1: first prompt
const ESTIMATE_REMINDER_MINUTES = 60; // checkpoint 2: reminder

export interface EstimateTimeoutWorkerDb {
  /** List ARRIVED/IN_PROGRESS jobs where arrived_at is older than the cutoff and no estimate submitted. */
  findJobsWithoutEstimate(businessId: string, cutoffDate: Date): Promise<Array<{
    jobId: string;
    technicianId: string;
    arrivedAt: Date;
  }>>;
  /** Check if a message with the given dedupe key already exists (not failed/canceled). */
  hasDedupeKey(dedupeKey: string): Promise<boolean>;
  pauseGuardDb: PauseGuardDb;
}

export interface EstimateTimeoutWorkerResult {
  businessId: string;
  promptsSent: number;
  remindersSent: number;
}

export async function estimateTimeoutWorker(
  config: BusinessConfig,
  clock: WorkerClockProvider,
  db: EstimateTimeoutWorkerDb,
  queuePrompt: (jobId: string) => Promise<void>,
  queueReminder: (jobId: string) => Promise<void>,
): Promise<EstimateTimeoutWorkerResult> {
  const pauseCheck = await checkPauseGuard(config.businessId, db.pauseGuardDb);
  if (!pauseCheck.allowed) {
    return { businessId: config.businessId, promptsSent: 0, remindersSent: 0 };
  }

  const now = clock.now().getTime();
  const cutoff30 = new Date(now - ESTIMATE_PROMPT_MINUTES * 60 * 1000);
  const cutoff60 = new Date(now - ESTIMATE_REMINDER_MINUTES * 60 * 1000);

  // Get all jobs that have been on-site 30+ minutes without an estimate
  const eligibleJobs = await db.findJobsWithoutEstimate(config.businessId, cutoff30);

  let promptsSent = 0;
  let remindersSent = 0;

  for (const job of eligibleJobs) {
    const arrivedMs = job.arrivedAt.getTime();

    // CHECKPOINT 2: 60+ minutes — send reminder if not already sent
    if (arrivedMs <= cutoff60.getTime()) {
      const reminderKey = `scheduling_tech_estimate_prompt:${job.jobId}:estimate_prompt_60`;
      const hasReminder = await db.hasDedupeKey(reminderKey);
      if (!hasReminder) {
        await queueReminder(job.jobId);
        remindersSent++;
      }
      // Also ensure checkpoint 1 was sent (in case worker was down earlier)
      const promptKey = `scheduling_tech_estimate_prompt:${job.jobId}:estimate_prompt_30`;
      const hasPrompt = await db.hasDedupeKey(promptKey);
      if (!hasPrompt) {
        await queuePrompt(job.jobId);
        promptsSent++;
      }
      continue;
    }

    // CHECKPOINT 1: 30+ minutes — send first estimate prompt if not already sent
    const promptKey = `scheduling_tech_estimate_prompt:${job.jobId}:estimate_prompt_30`;
    const hasPrompt = await db.hasDedupeKey(promptKey);
    if (!hasPrompt) {
      await queuePrompt(job.jobId);
      promptsSent++;
    }
  }

  return {
    businessId: config.businessId,
    promptsSent,
    remindersSent,
  };
}

// ── 7. morningBriefingWorker ──────────────────────────────────────────────
//
// Blueprint: "Morning briefing sender — Daily, 30min before open —
// Queue summary to each tech."
// Sends each tech their daily queue summary.

export interface MorningBriefingWorkerDb {
  /** List active techs for a business with their profiles. */
  getActiveTechsWithJobs(businessId: string, date: Date): Promise<Array<{
    technicianId: string;
    technicianName: string;
    jobCount: number;
    totalMinutes: number;
  }>>;
  /** Check if a morning briefing has already been queued (dedupe). */
  hasPendingMorningBriefing(technicianId: string, date: Date): Promise<boolean>;
  pauseGuardDb: PauseGuardDb;
}

export interface MorningBriefingWorkerResult {
  businessId: string;
  date: Date;
  techsProcessed: number;
  briefingsQueued: number;
  alreadyQueued: number;
}

export async function morningBriefingWorker(
  config: BusinessConfig,
  clock: WorkerClockProvider,
  db: MorningBriefingWorkerDb,
  queueBriefing: (technicianId: string, technicianName: string, jobCount: number, totalMinutes: number) => Promise<void>,
): Promise<MorningBriefingWorkerResult> {
  const pauseCheck = await checkPauseGuard(config.businessId, db.pauseGuardDb);
  if (!pauseCheck.allowed) {
    return {
      businessId: config.businessId,
      date: businessToday(config.timezone, clock.now()),
      techsProcessed: 0,
      briefingsQueued: 0,
      alreadyQueued: 0,
    };
  }

  const today = businessToday(config.timezone, clock.now());
  const techs = await db.getActiveTechsWithJobs(config.businessId, today);

  let briefingsQueued = 0;
  let alreadyQueued = 0;

  for (const tech of techs) {
    if (tech.jobCount === 0) continue;

    const hasPending = await db.hasPendingMorningBriefing(tech.technicianId, today);
    if (hasPending) {
      alreadyQueued++;
      continue;
    }

    await queueBriefing(tech.technicianId, tech.technicianName, tech.jobCount, tech.totalMinutes);
    briefingsQueued++;
  }

  return {
    businessId: config.businessId,
    date: today,
    techsProcessed: techs.length,
    briefingsQueued,
    alreadyQueued,
  };
}

// ── 8. timerCheckInWorker ─────────────────────────────────────────────────
//
// Blueprint: "Timer check-in — Every 60s — 'Still on this one?'
// when estimated duration passes."
// Flags IN_PROGRESS jobs where on-site time exceeds the tech's estimate.

const TIMER_CHECKIN_GRACE_MINUTES = 5; // grace buffer before prompting

export interface TimerCheckInWorkerDb {
  /** List IN_PROGRESS jobs where arrivedAt + estimatedDuration has passed. */
  findOverrunningJobs(businessId: string, cutoffDate: Date): Promise<Array<{
    jobId: string;
    technicianId: string;
    arrivedAt: Date;
    estimatedDurationMinutes: number;
  }>>;
  /** Check if a timer check-in prompt has already been sent for this job. */
  hasTimerCheckIn(jobId: string): Promise<boolean>;
  pauseGuardDb: PauseGuardDb;
}

export interface TimerCheckInWorkerResult {
  businessId: string;
  overrunningJobs: Array<{ jobId: string; technicianId: string }>;
  checkInsQueued: number;
}

export async function timerCheckInWorker(
  config: BusinessConfig,
  clock: WorkerClockProvider,
  db: TimerCheckInWorkerDb,
  queueCheckIn: (jobId: string) => Promise<void>,
): Promise<TimerCheckInWorkerResult> {
  const pauseCheck = await checkPauseGuard(config.businessId, db.pauseGuardDb);
  if (!pauseCheck.allowed) {
    return { businessId: config.businessId, overrunningJobs: [], checkInsQueued: 0 };
  }

  // Cutoff: jobs where arrivedAt + estimatedDuration + grace < now
  const cutoff = new Date(clock.now().getTime() - TIMER_CHECKIN_GRACE_MINUTES * 60 * 1000);
  const overrunning = await db.findOverrunningJobs(config.businessId, cutoff);

  let checkInsQueued = 0;
  for (const job of overrunning) {
    const hasCheckIn = await db.hasTimerCheckIn(job.jobId);
    if (!hasCheckIn) {
      await queueCheckIn(job.jobId);
      checkInsQueued++;
    }
  }

  return {
    businessId: config.businessId,
    overrunningJobs: overrunning.map((j) => ({ jobId: j.jobId, technicianId: j.technicianId })),
    checkInsQueued,
  };
}

// ── 9. projectScopePromptWorker ───────────────────────────────────────────
//
// Blueprint: "60-min project scope prompt — Every 60s —
// 'Standard visit or more extensive?' at 60-min mark."
// Prompts tech if job has been IN_PROGRESS for 60+ minutes.

const PROJECT_SCOPE_THRESHOLD_MINUTES = 60;

export interface ProjectScopePromptWorkerDb {
  /** List IN_PROGRESS jobs where arrivedAt is > 60 minutes ago. */
  findLongRunningJobs(businessId: string, cutoffDate: Date): Promise<Array<{
    jobId: string;
    technicianId: string;
    arrivedAt: Date;
  }>>;
  /** Check if a project scope prompt has already been sent for this job. */
  hasProjectScopePrompt(jobId: string): Promise<boolean>;
  pauseGuardDb: PauseGuardDb;
}

export interface ProjectScopePromptWorkerResult {
  businessId: string;
  longRunningJobs: Array<{ jobId: string; technicianId: string }>;
  promptsQueued: number;
}

export async function projectScopePromptWorker(
  config: BusinessConfig,
  clock: WorkerClockProvider,
  db: ProjectScopePromptWorkerDb,
  queuePrompt: (jobId: string) => Promise<void>,
): Promise<ProjectScopePromptWorkerResult> {
  const pauseCheck = await checkPauseGuard(config.businessId, db.pauseGuardDb);
  if (!pauseCheck.allowed) {
    return { businessId: config.businessId, longRunningJobs: [], promptsQueued: 0 };
  }

  const cutoff = new Date(clock.now().getTime() - PROJECT_SCOPE_THRESHOLD_MINUTES * 60 * 1000);
  const longRunning = await db.findLongRunningJobs(config.businessId, cutoff);

  let promptsQueued = 0;
  for (const job of longRunning) {
    const hasPrompt = await db.hasProjectScopePrompt(job.jobId);
    if (!hasPrompt) {
      await queuePrompt(job.jobId);
      promptsQueued++;
    }
  }

  return {
    businessId: config.businessId,
    longRunningJobs: longRunning.map((j) => ({ jobId: j.jobId, technicianId: j.technicianId })),
    promptsQueued,
  };
}

// ── 10. workerHeartbeatWorker ─────────────────────────────────────────────
//
// Blueprint: "Worker heartbeat — Every 60s — Log heartbeat.
// 5-min gap → dashboard alert."
// Records a heartbeat timestamp. If the last heartbeat is > 5 min old
// on the next check, the caller should surface an alert.

const HEARTBEAT_STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export interface HeartbeatDb {
  /** Record a heartbeat with current timestamp. */
  recordHeartbeat(workerName: string, timestamp: Date): Promise<void>;
  /** Get the last heartbeat timestamp for a given worker. */
  getLastHeartbeat(workerName: string): Promise<Date | null>;
}

export interface HeartbeatResult {
  workerName: string;
  timestamp: Date;
  stale: boolean;
  gapMs: number | null;
}

export async function workerHeartbeatWorker(
  workerName: string,
  clock: WorkerClockProvider,
  db: HeartbeatDb,
): Promise<HeartbeatResult> {
  const now = clock.now();
  const lastBeat = await db.getLastHeartbeat(workerName);

  let stale = false;
  let gapMs: number | null = null;

  if (lastBeat) {
    gapMs = now.getTime() - lastBeat.getTime();
    stale = gapMs > HEARTBEAT_STALE_THRESHOLD_MS;
  }

  await db.recordHeartbeat(workerName, now);

  return { workerName, timestamp: now, stale, gapMs };
}
