// ============================================================
// src/engine/scheduling/transition-hooks.ts
//
// POST-TRANSITION VALIDATION HOOKS
//
// Pure detection functions (no side effects) plus async
// persistence functions that record flags and auto-alert owners.
//
// Hooks:
//   F18 — GPS mismatch detection on ARRIVED + persistence
//   F19 — Suspiciously-fast-done flagging on COMPLETED + persistence
// ============================================================

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GpsMismatchInput {
  jobId: string;
  technicianGpsLat: number;
  technicianGpsLng: number;
  jobAddressLat: number;
  jobAddressLng: number;
}

export interface GpsMismatchResult {
  flagged: boolean;
  distanceKm: number;
  thresholdKm: number;
  jobId: string;
}

export interface FastCompletionInput {
  jobId: string;
  estimatedDurationMinutes: number;
  arrivedAt: Date;
  completedAt: Date;
}

export interface FastCompletionResult {
  flagged: boolean;
  actualMinutes: number;
  estimatedMinutes: number;
  percentOfEstimate: number;
  jobId: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Maximum distance in km between tech GPS and job address to not flag.
 * Blueprint says "15+ min from job address" — at ~30 mph average urban speed,
 * 15 min ≈ 12 km road distance ÷ 1.4 road factor ≈ 8 km haversine.
 */
const GPS_MISMATCH_THRESHOLD_KM = 8.0;

/** A job completed in less than this fraction of estimated time is flagged. */
const FAST_COMPLETION_THRESHOLD = 0.50; // 50% — blueprint: "under 50% of estimated duration"

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Haversine distance between two lat/lng points in km.
 */
function haversineDistanceKm(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ── F18: GPS mismatch detection ──────────────────────────────────────────────

/**
 * Check if the technician's GPS location at arrival is too far from the job
 * address. Returns flagged=true if distance exceeds threshold.
 *
 * Called after ARRIVED transition when GPS coordinates are available.
 */
export function detectGpsMismatch(input: GpsMismatchInput): GpsMismatchResult {
  const distanceKm = haversineDistanceKm(
    input.technicianGpsLat, input.technicianGpsLng,
    input.jobAddressLat, input.jobAddressLng,
  );

  return {
    flagged: distanceKm > GPS_MISMATCH_THRESHOLD_KM,
    distanceKm: Math.round(distanceKm * 100) / 100,
    thresholdKm: GPS_MISMATCH_THRESHOLD_KM,
    jobId: input.jobId,
  };
}

// ── F19: Suspiciously fast completion ────────────────────────────────────────

/**
 * Flag a job if it was completed in less than 50% of the estimated duration.
 *
 * Called after COMPLETED transition.
 */
export function detectFastCompletion(input: FastCompletionInput): FastCompletionResult {
  const actualMs = input.completedAt.getTime() - input.arrivedAt.getTime();
  const actualMinutes = actualMs / 60_000;
  const percentOfEstimate = input.estimatedDurationMinutes > 0
    ? actualMinutes / input.estimatedDurationMinutes
    : 1;

  return {
    flagged: percentOfEstimate < FAST_COMPLETION_THRESHOLD,
    actualMinutes: Math.round(actualMinutes * 10) / 10,
    estimatedMinutes: input.estimatedDurationMinutes,
    percentOfEstimate: Math.round(percentOfEstimate * 100),
    jobId: input.jobId,
  };
}

// ── Accountability Persistence ──────────────────────────────────────────────
//
// Blueprint: "3+ mismatches per tech → owner auto-flagged"
// Blueprint: "Suspiciously fast done → owner auto-flagged under tech's profile"

/** GPS mismatch auto-flag threshold. */
const GPS_MISMATCH_OWNER_FLAG_THRESHOLD = 3;

export interface AccountabilityDb {
  /** Record a GPS mismatch event for a technician. */
  recordGpsMismatch(technicianId: string, jobId: string, distanceKm: number, timestamp: Date): Promise<void>;
  /** Get the count of GPS mismatches for a tech in the last 30 days. */
  getGpsMismatchCount(technicianId: string, since: Date): Promise<number>;
  /** Record a fast-completion flag for a technician. */
  recordFastCompletion(technicianId: string, jobId: string, percentOfEstimate: number, timestamp: Date): Promise<void>;
  /** Enqueue an owner alert notification. */
  enqueueOwnerAlert(businessId: string, alertType: string, technicianId: string, details: string, dedupeKey: string): Promise<void>;
}

export interface GpsPersistenceInput {
  technicianId: string;
  businessId: string;
  mismatchResult: GpsMismatchResult;
}

export interface GpsPersistenceResult {
  recorded: boolean;
  totalMismatches: number;
  ownerFlagged: boolean;
}

/**
 * Persist a GPS mismatch and check if the tech has hit the owner-flag threshold.
 * Blueprint: "3+ mismatches per tech → owner auto-flagged under tech's profile."
 */
export async function persistGpsMismatch(
  input: GpsPersistenceInput,
  db: AccountabilityDb,
  now: Date,
): Promise<GpsPersistenceResult> {
  if (!input.mismatchResult.flagged) {
    return { recorded: false, totalMismatches: 0, ownerFlagged: false };
  }

  await db.recordGpsMismatch(
    input.technicianId,
    input.mismatchResult.jobId,
    input.mismatchResult.distanceKm,
    now,
  );

  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const totalMismatches = await db.getGpsMismatchCount(input.technicianId, thirtyDaysAgo);

  let ownerFlagged = false;
  if (totalMismatches >= GPS_MISMATCH_OWNER_FLAG_THRESHOLD) {
    const dedupeKey = `gps_mismatch_alert:${input.technicianId}:${now.toISOString().split("T")[0]}`;
    await db.enqueueOwnerAlert(
      input.businessId,
      "gps_mismatch_threshold",
      input.technicianId,
      `Tech has ${totalMismatches} GPS mismatches in the last 30 days (threshold: ${GPS_MISMATCH_OWNER_FLAG_THRESHOLD})`,
      dedupeKey,
    );
    ownerFlagged = true;
  }

  return { recorded: true, totalMismatches, ownerFlagged };
}

export interface FastCompletionPersistenceInput {
  technicianId: string;
  businessId: string;
  completionResult: FastCompletionResult;
}

export interface FastCompletionPersistenceResult {
  recorded: boolean;
  ownerFlagged: boolean;
}

/**
 * Persist a fast-completion flag and alert the owner.
 * Blueprint: "Suspiciously fast done → accepted, owner auto-flagged under tech's profile."
 */
export async function persistFastCompletion(
  input: FastCompletionPersistenceInput,
  db: AccountabilityDb,
  now: Date,
): Promise<FastCompletionPersistenceResult> {
  if (!input.completionResult.flagged) {
    return { recorded: false, ownerFlagged: false };
  }

  await db.recordFastCompletion(
    input.technicianId,
    input.completionResult.jobId,
    input.completionResult.percentOfEstimate,
    now,
  );

  const dedupeKey = `fast_completion_alert:${input.completionResult.jobId}`;
  await db.enqueueOwnerAlert(
    input.businessId,
    "fast_completion",
    input.technicianId,
    `Job ${input.completionResult.jobId} completed in ${input.completionResult.actualMinutes} min (${input.completionResult.percentOfEstimate}% of ${input.completionResult.estimatedMinutes} min estimate)`,
    dedupeKey,
  );

  return { recorded: true, ownerFlagged: true };
}
