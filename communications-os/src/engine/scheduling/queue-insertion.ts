// ============================================================
// src/engine/scheduling/queue-insertion.ts
//
// QUEUE INSERTION OPTIMIZER — ORDERED QUEUE MANAGEMENT
//
// The queue is an ordered list constrained by available hours.
// Not time slots. Not blocks. Position matters.
//
// Rules enforced:
//   - Locked jobs (EN_ROUTE/ARRIVED/IN_PROGRESS) are immovable
//   - Manual-position jobs preserve relative order (not index)
//   - MORNING jobs must fit before morning cutoff
//   - AFTERNOON jobs must fit at or after morning cutoff
//   - Geographic optimization: minimize total added drive time
//   - Queue doesn't randomly reshuffle
//
// Injectable: OSRM service for drive time scoring.
// ============================================================

import { isLockedState, type SchedulingJobStatus } from "./scheduling-state-machine";
import { getDriveTime, type Coordinates, type OsrmServiceDeps } from "./osrm-service";
import { parseHHMM, type TechProfile } from "./capacity-math";

// ── Types ─────────────────────────────────────────────────────────────────────

export type TimePreference = "MORNING" | "AFTERNOON" | "SOONEST" | "NO_PREFERENCE";

export interface QueuedJob {
  id: string;
  queuePosition: number;
  status: SchedulingJobStatus;
  timePreference: TimePreference;
  addressLat: number;
  addressLng: number;
  manualPosition: boolean;
  /** H3: Date when manual position was set, null if not manual. */
  manualPositionSetDate?: Date | null;
  estimatedDurationMinutes: number;
  driveTimeMinutes: number;
  /** H2: Optimistic concurrency version. Incremented on every queue write. */
  queueVersion?: number;
}

export interface NewJobInput {
  id: string;
  addressLat: number;
  addressLng: number;
  timePreference: TimePreference;
  totalCostMinutes: number;
}

export interface InsertionResult {
  position: number;
  addedDriveTimeMinutes: number;
  valid: boolean;
  reason?: string;
}

export interface DriveTimeScore {
  addedDriveTimeMinutes: number;
}

// ── 1. getValidInsertionPoints ────────────────────────────────────────────────

export function getValidInsertionPoints(
  queue: QueuedJob[],
  newJob: NewJobInput,
  morningCutoffPosition?: number,
): number[] {
  if (queue.length === 0) return [0];

  // Find the first unlocked position
  let firstUnlocked = 0;
  while (firstUnlocked < queue.length && isLockedState(queue[firstUnlocked]!.status)) {
    firstUnlocked++;
  }

  // If everything is locked, no valid positions
  if (firstUnlocked === queue.length) {
    // Can still insert at the end if the end is after all locked jobs
    // But locked means immovable — we can only go after them
    // Actually, if ALL jobs are locked, the only valid spot is the end
    // But the spec says locked jobs cannot be reordered, and inserting
    // after all of them is valid.
    // However, if all are in terminal/active states, the queue is frozen.
    // Let's check: if all are locked, we can insert at the end.
    // Wait — re-read: "all positions locked -> []" per test spec.
    return [];
  }

  // Collect all candidate positions from firstUnlocked to queue.length
  const candidates: number[] = [];
  for (let i = firstUnlocked; i <= queue.length; i++) {
    candidates.push(i);
  }

  // Filter by time preference
  const cutoff = morningCutoffPosition ?? queue.length;
  let filtered: number[];

  switch (newJob.timePreference) {
    case "MORNING":
      filtered = candidates.filter((pos) => pos < cutoff);
      break;
    case "AFTERNOON":
      filtered = candidates.filter((pos) => pos >= cutoff);
      break;
    case "SOONEST":
    case "NO_PREFERENCE":
    default:
      filtered = candidates;
      break;
  }

  // Filter for manual-position order preservation.
  // Manual jobs are order-locked anchors. A new job can be inserted
  // in gaps around them, but the insertion must not cause manual jobs
  // to change their relative order with respect to each other.
  //
  // Since we're inserting ONE job into the queue (not reordering),
  // any gap position preserves relative order of existing jobs.
  // The key constraint is that we don't insert *between* a manual
  // job and whatever it's anchored relative to in a way that breaks
  // the invariant. Since insertion only shifts later jobs forward by 1,
  // relative order of all existing jobs is always preserved.
  //
  // So all candidate positions are valid w.r.t. manual ordering.
  // The manual constraint matters more for reorder/shuffle operations
  // (which this module doesn't do).

  return filtered;
}

// ── 2. scoreDriveTimeForInsertion ─────────────────────────────────────────────

export async function scoreDriveTimeForInsertion(
  queue: QueuedJob[],
  newJob: NewJobInput,
  position: number,
  techHomeBase: Coordinates,
  osrmDeps?: OsrmServiceDeps,
): Promise<DriveTimeScore> {
  const newCoords: Coordinates = { lat: newJob.addressLat, lng: newJob.addressLng };

  // Previous location: home base if position 0, else the job before
  const prevCoords: Coordinates =
    position === 0
      ? techHomeBase
      : { lat: queue[position - 1]!.addressLat, lng: queue[position - 1]!.addressLng };

  // Next location: the job currently at this position (if any)
  const hasNext = position < queue.length;
  const nextCoords: Coordinates | null = hasNext
    ? { lat: queue[position]!.addressLat, lng: queue[position]!.addressLng }
    : null;

  // Current leg: prev -> next (what exists without insertion)
  let currentLegMinutes = 0;
  if (nextCoords) {
    const currentLeg = await getDriveTime(prevCoords, nextCoords, osrmDeps);
    currentLegMinutes = currentLeg.durationMinutes;
  }

  // New legs: prev -> new + new -> next
  const prevToNew = await getDriveTime(prevCoords, newCoords, osrmDeps);
  let newToNextMinutes = 0;
  if (nextCoords) {
    const newToNext = await getDriveTime(newCoords, nextCoords, osrmDeps);
    newToNextMinutes = newToNext.durationMinutes;
  }

  const addedDriveTimeMinutes =
    prevToNew.durationMinutes + newToNextMinutes - currentLegMinutes;

  return { addedDriveTimeMinutes };
}

// ── 3. findOptimalPosition ────────────────────────────────────────────────────

export async function findOptimalPosition(
  queue: QueuedJob[],
  newJob: NewJobInput,
  techHomeBase: Coordinates,
  osrmDeps?: OsrmServiceDeps,
  morningCutoffPosition?: number,
): Promise<InsertionResult> {
  const validPoints = getValidInsertionPoints(queue, newJob, morningCutoffPosition);

  if (validPoints.length === 0) {
    return {
      position: -1,
      addedDriveTimeMinutes: 0,
      valid: false,
      reason: "no_valid_position",
    };
  }

  let bestPosition = validPoints[0]!;
  let bestScore = Infinity;

  for (const pos of validPoints) {
    const score = await scoreDriveTimeForInsertion(
      queue, newJob, pos, techHomeBase, osrmDeps,
    );
    // Tie-break: lowest drive time, then earliest position
    if (
      score.addedDriveTimeMinutes < bestScore ||
      (score.addedDriveTimeMinutes === bestScore && pos < bestPosition)
    ) {
      bestScore = score.addedDriveTimeMinutes;
      bestPosition = pos;
    }
  }

  return {
    position: bestPosition,
    addedDriveTimeMinutes: bestScore,
    valid: true,
  };
}

// ── 4. insertAtPosition ───────────────────────────────────────────────────────

export function insertAtPosition(
  queue: QueuedJob[],
  newJob: NewJobInput,
  position: number,
): QueuedJob[] {
  if (position < 0 || position > queue.length) {
    throw new Error(
      `Invalid insertion position: ${position}. Queue length: ${queue.length}.`,
    );
  }

  // Build the inserted job as a QueuedJob
  const insertedJob: QueuedJob = {
    id: newJob.id,
    queuePosition: 0, // will be recomputed
    status: "NOT_STARTED",
    timePreference: newJob.timePreference,
    addressLat: newJob.addressLat,
    addressLng: newJob.addressLng,
    manualPosition: false,
    estimatedDurationMinutes: newJob.totalCostMinutes, // best available
    driveTimeMinutes: 0,
  };

  // Create new array — do not mutate input
  const result: QueuedJob[] = [
    ...queue.slice(0, position).map((j) => ({ ...j })),
    insertedJob,
    ...queue.slice(position).map((j) => ({ ...j })),
  ];

  // Recompute sequential queuePosition
  for (let i = 0; i < result.length; i++) {
    result[i]!.queuePosition = i;
  }

  return result;
}

// ── 5. calculateMorningCutoffPosition ─────────────────────────────────────────

export function calculateMorningCutoffPosition(
  queue: QueuedJob[],
  techProfile: TechProfile,
): number {
  if (queue.length === 0) return 0;

  const start = parseHHMM(techProfile.workingHoursStart);
  const lunchStart = parseHHMM(techProfile.lunchStart);
  const morningMinutes = lunchStart - start;

  let cumulative = 0;
  for (let i = 0; i < queue.length; i++) {
    const job = queue[i]!;
    const jobTime = job.estimatedDurationMinutes + job.driveTimeMinutes;
    cumulative += jobTime;
    if (cumulative > morningMinutes) {
      return i;
    }
  }

  // All jobs fit in the morning — cutoff is at the end
  return queue.length;
}

// ── 6. H2: Queue version validation ─────────────────────────────────────────

/**
 * Validates that the queue hasn't changed since it was read by comparing
 * the expected version against the current version.
 *
 * Call this before writing queue mutations. If it returns false, the caller
 * must re-read the queue and retry.
 *
 * In production, this maps to an optimistic-concurrency WHERE clause:
 *   UPDATE ... WHERE queue_version = expectedVersion
 * which returns 0 rows affected on conflict.
 */
export function validateQueueVersion(
  queue: QueuedJob[],
  expectedVersion: number,
): boolean {
  if (queue.length === 0) return true;
  // All jobs in a tech/date queue share the same version
  const currentVersion = queue[0]!.queueVersion ?? 0;
  return currentVersion === expectedVersion;
}

/**
 * Increments the queue version on all jobs in the queue.
 * Call this after every successful queue mutation.
 */
export function bumpQueueVersion(queue: QueuedJob[]): QueuedJob[] {
  if (queue.length === 0) return queue;
  const currentVersion = queue[0]!.queueVersion ?? 0;
  const newVersion = currentVersion + 1;
  return queue.map((j) => ({ ...j, queueVersion: newVersion }));
}

// ── 7. H3: Manual position expiry ──────────────────────────────────────────

/**
 * Clears manual position flags that have expired (older than maxAgeDays).
 * Returns a new queue with expired manual flags cleared.
 *
 * Production cron should call this daily per business.
 */
export function clearExpiredManualPositions(
  queue: QueuedJob[],
  now: Date,
  maxAgeDays: number = 7,
): { queue: QueuedJob[]; clearedCount: number } {
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  let clearedCount = 0;

  const updated = queue.map((job) => {
    if (
      job.manualPosition &&
      job.manualPositionSetDate &&
      now.getTime() - new Date(job.manualPositionSetDate).getTime() > maxAgeMs
    ) {
      clearedCount++;
      return { ...job, manualPosition: false, manualPositionSetDate: null };
    }
    return { ...job };
  });

  return { queue: updated, clearedCount };
}
