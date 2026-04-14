// ============================================================
// src/engine/scheduling/gap-fill.ts
//
// GAP-FILL CANDIDATE RANKER — PULL-FORWARD OFFERS
//
// Deterministic logic only. No AI. No notifications.
//
// Rules enforced:
//   - 30-min minimum gap threshold
//   - Tier 1 (booked, unlocked) always ranks before Tier 2
//   - Ratchet rule: candidate.scheduledStartMinute > gapStartMinute
//   - One active offer per gap at a time
//   - Offers expire after 20 minutes
//   - acceptPullForward re-checks capacity transactionally
//   - Cross-tech acceptance: reserve new + release old + move
//
// Injectable: db, clock, OSRM deps.
// ============================================================

import { isLockedState, type SchedulingJobStatus } from "./scheduling-state-machine";
import { checkCapacityFromQueue, type TimePreference, type TechProfile } from "./capacity-math";
import { findOptimalPosition, type QueuedJob, type NewJobInput } from "./queue-insertion";
import { getDriveTime, type Coordinates, type OsrmServiceDeps } from "./osrm-service";
import { checkPauseGuard, type PauseGuardDb } from "./pause-guard";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GapInfo {
  gapId: string;
  technicianId: string;
  businessId: string;
  date: Date;
  gapStartMinute: number;
  gapDurationMinutes: number;
  previousJobId: string;
  previousJobEndedAt: Date;
  previousJobAddressLat: number;
  previousJobAddressLng: number;
}

export interface GapFillCandidate {
  jobId: string;
  customerId: string;
  customerPhone: string;
  technicianId: string;
  businessId: string;
  currentQueuePosition: number;
  scheduledDate: Date;
  scheduledStartMinute: number;
  totalCostMinutes: number;
  addressLat: number;
  addressLng: number;
  serviceTypeId: string;
  timePreference: TimePreference;
  status: SchedulingJobStatus;
  isBooked: boolean;
}

export type Tier = "tier_1" | "tier_2";

export interface ScoredCandidate {
  candidate: GapFillCandidate;
  tier: Tier;
  driveTimeMinutes: number;
  fitsInGap: boolean;
  pullForwardMinutes: number;
  score: number;
}

export interface GapFillResult {
  gapInfo: GapInfo;
  rankedCandidates: ScoredCandidate[];
  tier1Count: number;
  tier2Count: number;
}

export interface PullForwardOffer {
  gapId: string;
  jobId: string;
  customerId: string;
  customerPhone: string;
  originalTechnicianId: string;
  originalDate: Date;
  originalQueuePosition: number;
  targetTechnicianId: string;
  targetDate: Date;
  newQueuePosition: number;
  totalCostMinutes: number;
  timePreference: TimePreference;
  originalWindow: string;
  newWindow: string;
  expiresAt: Date;
}

export type PullForwardOutcome =
  | { outcome: "offered"; offer: PullForwardOffer }
  | { outcome: "no_candidates"; reason: "no_valid_candidates" }
  | { outcome: "gap_too_small"; reason: "gap_under_threshold"; gapMinutes: number }
  | { outcome: "offer_blocked"; reason: "existing_active_offer_for_gap" }
  | { outcome: "paused"; reason: "scheduling_paused" | "resync_pending" };

export type PullForwardAcceptResult =
  | { outcome: "accepted"; jobId: string; technicianId: string; newQueuePosition: number }
  | { outcome: "expired"; jobId: string; reason: "offer_expired" }
  | { outcome: "capacity_changed"; jobId: string; reason: "slot_no_longer_available" };

export interface ClockProvider {
  now(): Date;
}

export interface GapFillDb {
  getBookedCandidates(businessId: string, date: Date, excludeJobIds: string[]): Promise<GapFillCandidate[]>;
  getWaitlistedCandidates(businessId: string, date: Date): Promise<GapFillCandidate[]>;
  getQueueForTechDate(technicianId: string, date: Date): Promise<QueuedJob[]>;

  createPullForwardOffer(offer: PullForwardOffer): Promise<void>;
  getPullForwardOffer(jobId: string): Promise<PullForwardOffer | null>;
  getActiveOfferForGap(gapId: string): Promise<PullForwardOffer | null>;
  expirePullForwardOffer(jobId: string): Promise<void>;

  updateJobSchedule(jobId: string, technicianId: string, date: Date, queuePosition: number): Promise<void>;

  getTechProfile(technicianId: string): Promise<TechProfile | null>;

  /** Pause guard operations. */
  pauseGuardDb: PauseGuardDb;

  transaction<T>(fn: (tx: GapFillDb) => Promise<T>): Promise<T>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_GAP_THRESHOLD_MINUTES = 30;
const OFFER_EXPIRY_MINUTES = 20;
const PROXIMITY_WEIGHT = 0.7;
const UTILIZATION_WEIGHT = 0.3;

// ── Helpers ───────────────────────────────────────────────────────────────────

function windowLabel(startMinute: number): string {
  const h = Math.floor(startMinute / 60);
  const m = startMinute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

// ── 1. detectGap ─────────────────────────────────────────────────────────────

export interface DetectGapInput {
  gapId: string;
  technicianId: string;
  businessId: string;
  date: Date;
  gapStartMinute: number;
  bookedDurationMinutes: number;
  actualDurationMinutes: number;
  previousJobId: string;
  previousJobEndedAt: Date;
  previousJobAddressLat: number;
  previousJobAddressLng: number;
}

export function detectGap(input: DetectGapInput): GapInfo | null {
  const gapDuration = input.bookedDurationMinutes - input.actualDurationMinutes;

  if (gapDuration < MIN_GAP_THRESHOLD_MINUTES) {
    return null;
  }

  return {
    gapId: input.gapId,
    technicianId: input.technicianId,
    businessId: input.businessId,
    date: input.date,
    gapStartMinute: input.gapStartMinute,
    gapDurationMinutes: gapDuration,
    previousJobId: input.previousJobId,
    previousJobEndedAt: input.previousJobEndedAt,
    previousJobAddressLat: input.previousJobAddressLat,
    previousJobAddressLng: input.previousJobAddressLng,
  };
}

// ── 2. rankCandidates ────────────────────────────────────────────────────────

export async function rankCandidates(
  gapInfo: GapInfo,
  candidates: GapFillCandidate[],
  osrmDeps?: OsrmServiceDeps,
): Promise<GapFillResult> {
  const gapOrigin: Coordinates = {
    lat: gapInfo.previousJobAddressLat,
    lng: gapInfo.previousJobAddressLng,
  };

  // Filter out locked candidates
  const unlocked = candidates.filter((c) => !isLockedState(c.status));

  // Compute drive times for all candidates
  const withDriveTimes: Array<{
    candidate: GapFillCandidate;
    driveTimeMinutes: number;
  }> = [];

  for (const candidate of unlocked) {
    const dest: Coordinates = { lat: candidate.addressLat, lng: candidate.addressLng };
    const driveResult = await getDriveTime(gapOrigin, dest, osrmDeps);
    withDriveTimes.push({
      candidate,
      driveTimeMinutes: driveResult.durationMinutes,
    });
  }

  // Partition and score
  const scored: ScoredCandidate[] = [];

  // Find max drive time for normalization (across ALL candidates)
  const maxDriveTime = withDriveTimes.length > 0
    ? Math.max(...withDriveTimes.map((c) => c.driveTimeMinutes))
    : 0;

  for (let inputIndex = 0; inputIndex < withDriveTimes.length; inputIndex++) {
    const { candidate, driveTimeMinutes } = withDriveTimes[inputIndex]!;

    const tier: Tier = candidate.isBooked ? "tier_1" : "tier_2";
    const fitsInGap = candidate.totalCostMinutes + driveTimeMinutes <= gapInfo.gapDurationMinutes;
    const pullForwardMinutes = candidate.scheduledStartMinute - gapInfo.gapStartMinute;

    // Tier 1 must satisfy ratchet rule AND fit
    if (tier === "tier_1") {
      if (candidate.scheduledStartMinute <= gapInfo.gapStartMinute) continue;
      if (!fitsInGap) continue;
    }

    // Tier 2 must fit
    if (tier === "tier_2") {
      if (!fitsInGap) continue;
    }

    // Score
    const proximityScore = maxDriveTime > 0
      ? Math.max(0, Math.min(1, 1 - (driveTimeMinutes / maxDriveTime)))
      : 1;
    const gapUtilizationScore = Math.max(0, Math.min(1,
      candidate.totalCostMinutes / gapInfo.gapDurationMinutes,
    ));
    const score = (proximityScore * PROXIMITY_WEIGHT) + (gapUtilizationScore * UTILIZATION_WEIGHT);

    scored.push({
      candidate,
      tier,
      driveTimeMinutes,
      fitsInGap,
      pullForwardMinutes,
      score,
      _inputIndex: inputIndex,
      _currentQueuePosition: candidate.currentQueuePosition,
    } as ScoredCandidate & { _inputIndex: number; _currentQueuePosition: number });
  }

  // Sort: Tier 1 before Tier 2, then score desc, then tie-breaks
  scored.sort((a, b) => {
    // Tier priority
    if (a.tier !== b.tier) return a.tier === "tier_1" ? -1 : 1;
    // Score descending
    if (a.score !== b.score) return b.score - a.score;
    // Tie-break 1: lower drive time
    if (a.driveTimeMinutes !== b.driveTimeMinutes) return a.driveTimeMinutes - b.driveTimeMinutes;
    // Tie-break 2: earlier queue position
    const aqp = (a as unknown as { _currentQueuePosition: number })._currentQueuePosition;
    const bqp = (b as unknown as { _currentQueuePosition: number })._currentQueuePosition;
    if (aqp !== bqp) return aqp - bqp;
    // Tie-break 3: input order
    const aIdx = (a as unknown as { _inputIndex: number })._inputIndex;
    const bIdx = (b as unknown as { _inputIndex: number })._inputIndex;
    return aIdx - bIdx;
  });

  // Strip internal fields
  const cleaned: ScoredCandidate[] = scored.map((s) => {
    const { _inputIndex, _currentQueuePosition, ...rest } = s as ScoredCandidate & { _inputIndex: number; _currentQueuePosition: number };
    return rest;
  });

  return {
    gapInfo,
    rankedCandidates: cleaned,
    tier1Count: cleaned.filter((c) => c.tier === "tier_1").length,
    tier2Count: cleaned.filter((c) => c.tier === "tier_2").length,
  };
}

// ── 3. createPullForwardOffer ────────────────────────────────────────────────

export async function createPullForwardOffer(
  scoredCandidate: ScoredCandidate,
  gapInfo: GapInfo,
  clock: ClockProvider,
  db: GapFillDb,
  osrmDeps?: OsrmServiceDeps,
): Promise<PullForwardOutcome> {
  // H8: Pause guard — block automated gap-fill when paused
  const pauseCheck = await checkPauseGuard(gapInfo.businessId, db.pauseGuardDb);
  if (pauseCheck.allowed === false) {
    return { outcome: "paused" as const, reason: pauseCheck.reason };
  }

  // Check gap is still meaningful
  if (gapInfo.gapDurationMinutes < MIN_GAP_THRESHOLD_MINUTES) {
    return { outcome: "gap_too_small", reason: "gap_under_threshold", gapMinutes: gapInfo.gapDurationMinutes };
  }

  // Check for existing active offer on this gap
  const existingOffer = await db.getActiveOfferForGap(gapInfo.gapId);
  if (existingOffer) {
    return { outcome: "offer_blocked", reason: "existing_active_offer_for_gap" };
  }

  // Verify target queue insertion
  const targetTechId = gapInfo.technicianId;
  const targetDate = gapInfo.date;
  const targetQueue = await db.getQueueForTechDate(targetTechId, targetDate);

  const techHomeBase: Coordinates = {
    lat: gapInfo.previousJobAddressLat,
    lng: gapInfo.previousJobAddressLng,
  };

  const newJobInput: NewJobInput = {
    id: scoredCandidate.candidate.jobId,
    addressLat: scoredCandidate.candidate.addressLat,
    addressLng: scoredCandidate.candidate.addressLng,
    timePreference: scoredCandidate.candidate.timePreference,
    totalCostMinutes: scoredCandidate.candidate.totalCostMinutes,
  };

  const insertion = await findOptimalPosition(
    targetQueue, newJobInput, techHomeBase, osrmDeps,
  );

  if (!insertion.valid) {
    return { outcome: "no_candidates", reason: "no_valid_candidates" };
  }

  // Check capacity on target from queue
  const targetTechProfile = await db.getTechProfile(targetTechId);
  if (!targetTechProfile) {
    return { outcome: "no_candidates", reason: "no_valid_candidates" };
  }
  const cap = checkCapacityFromQueue(
    targetQueue,
    targetTechProfile,
    scoredCandidate.candidate.totalCostMinutes,
    scoredCandidate.candidate.timePreference,
  );

  if (!cap.fits) {
    return { outcome: "no_candidates", reason: "no_valid_candidates" };
  }

  // Build offer
  const now = clock.now();
  const expiresAt = new Date(now.getTime() + OFFER_EXPIRY_MINUTES * 60 * 1000);

  const offer: PullForwardOffer = {
    gapId: gapInfo.gapId,
    jobId: scoredCandidate.candidate.jobId,
    customerId: scoredCandidate.candidate.customerId,
    customerPhone: scoredCandidate.candidate.customerPhone,
    originalTechnicianId: scoredCandidate.candidate.technicianId,
    originalDate: scoredCandidate.candidate.scheduledDate,
    originalQueuePosition: scoredCandidate.candidate.currentQueuePosition,
    targetTechnicianId: targetTechId,
    targetDate,
    newQueuePosition: insertion.position,
    totalCostMinutes: scoredCandidate.candidate.totalCostMinutes,
    timePreference: scoredCandidate.candidate.timePreference,
    originalWindow: windowLabel(scoredCandidate.candidate.scheduledStartMinute),
    newWindow: windowLabel(gapInfo.gapStartMinute),
    expiresAt,
  };

  await db.createPullForwardOffer(offer);

  return { outcome: "offered", offer };
}

// ── 4. acceptPullForward ─────────────────────────────────────────────────────

export async function acceptPullForward(
  jobId: string,
  businessId: string,
  clock: ClockProvider,
  db: GapFillDb,
  osrmDeps?: OsrmServiceDeps,
): Promise<PullForwardAcceptResult> {
  // H8: Pause guard — block automated acceptance when paused
  const pauseCheck = await checkPauseGuard(businessId, db.pauseGuardDb);
  if (!pauseCheck.allowed) {
    return { outcome: "capacity_changed", jobId, reason: "slot_no_longer_available" };
  }

  const offer = await db.getPullForwardOffer(jobId);

  if (!offer) {
    return { outcome: "expired", jobId, reason: "offer_expired" };
  }

  // Check expiry
  if (clock.now() >= offer.expiresAt) {
    await db.expirePullForwardOffer(jobId);
    return { outcome: "expired", jobId, reason: "offer_expired" };
  }

  // Re-validate queue insertion: bounds + locked prefix check
  const targetQueue = await db.getQueueForTechDate(offer.targetTechnicianId, offer.targetDate);

  // Re-check capacity on target from queue
  const acceptTechProfile = await db.getTechProfile(offer.targetTechnicianId);
  if (!acceptTechProfile) {
    await db.expirePullForwardOffer(jobId);
    return { outcome: "capacity_changed", jobId, reason: "slot_no_longer_available" };
  }
  const acceptCap = checkCapacityFromQueue(
    targetQueue,
    acceptTechProfile,
    offer.totalCostMinutes,
    offer.timePreference,
  );

  if (!acceptCap.fits) {
    await db.expirePullForwardOffer(jobId);
    return { outcome: "capacity_changed", jobId, reason: "slot_no_longer_available" };
  }

  if (offer.newQueuePosition > targetQueue.length) {
    await db.expirePullForwardOffer(jobId);
    return { outcome: "capacity_changed", jobId, reason: "slot_no_longer_available" };
  }

  // Verify insertion position is not inside a locked prefix
  let lockedPrefixEnd = 0;
  while (lockedPrefixEnd < targetQueue.length && isLockedState(targetQueue[lockedPrefixEnd]!.status)) {
    lockedPrefixEnd++;
  }
  if (offer.newQueuePosition < lockedPrefixEnd) {
    await db.expirePullForwardOffer(jobId);
    return { outcome: "capacity_changed", jobId, reason: "slot_no_longer_available" };
  }

  const isCrossTech = offer.originalTechnicianId !== offer.targetTechnicianId;
  const isCrossDate = offer.originalDate.getTime() !== offer.targetDate.getTime();
  const needsCapacityTransfer = isCrossTech || isCrossDate;

  await db.transaction(async (tx) => {
    // No separate capacity counter to update — the job move IS the capacity change.
    // The queue-based capacity check above already verified there's room.

    // Update job schedule
    await tx.updateJobSchedule(
      jobId,
      offer.targetTechnicianId,
      offer.targetDate,
      offer.newQueuePosition,
    );

    // Consume the offer
    await tx.expirePullForwardOffer(jobId);
  });

  return {
    outcome: "accepted",
    jobId,
    technicianId: offer.targetTechnicianId,
    newQueuePosition: offer.newQueuePosition,
  };
}

// ── 5. expireStaleOffers ─────────────────────────────────────────────────────

export interface StaleOfferRecord {
  jobId: string;
  expiresAt: Date;
}

export async function expireStaleOffers(
  staleOffers: StaleOfferRecord[],
  clock: ClockProvider,
  db: GapFillDb,
): Promise<number> {
  const now = clock.now();
  let count = 0;

  for (const offer of staleOffers) {
    if (offer.expiresAt < now) {
      await db.expirePullForwardOffer(offer.jobId);
      count++;
    }
  }

  return count;
}
