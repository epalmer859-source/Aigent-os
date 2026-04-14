// ============================================================
// src/engine/scheduling/capacity-math.ts
//
// CAPACITY MATH ENGINE — DETERMINISTIC SCHEDULING MATH
//
// AI never touches capacity decisions. This is pure arithmetic
// and atomic database transactions.
//
// Rules enforced:
//   - Duration multiplier stack (1.3x floor → short-duration
//     floor → volatility buffer → round to 5)
//   - Morning/afternoon sub-capacity validation
//   - Atomic reservation with row-level lock
//   - Capacity override is a HARD BLOCK — never bypassed
//   - Release clamps to zero (guards double-release)
//   - Revalidation flags overcapacity on profile changes
//
// Injectable: db (Prisma client) for production, in-memory
// stores for testing.
// ============================================================

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TechProfile {
  id: string;
  businessId: string;
  workingHoursStart: string; // "HH:MM"
  workingHoursEnd: string;   // "HH:MM"
  lunchStart: string;        // "HH:MM"
  lunchEnd: string;          // "HH:MM"
  overtimeCapMinutes: number;
}

export type VolatilityTier = "LOW" | "MEDIUM" | "HIGH";

export type TimePreference = "MORNING" | "AFTERNOON" | "SOONEST" | "NO_PREFERENCE";

export interface AvailableMinutes {
  totalMinutes: number;
  morningMinutes: number;
  afternoonMinutes: number;
}

export interface JobCost {
  bookedDurationMinutes: number;
  driveTimeMinutes: number;
  totalCostMinutes: number;
}

export interface CapacityCheck {
  fits: boolean;
  remainingTotal: number;
  remainingMorning: number;
  remainingAfternoon: number;
}

export interface ReservationResult {
  success: boolean;
  reason?: "no_capacity" | "no_morning_capacity" | "no_afternoon_capacity";
}

export interface CapacityViolation {
  technicianId: string;
  date: Date;
  violation: "total_overcapacity" | "morning_overcapacity" | "afternoon_overcapacity";
  reserved: number;
  available: number;
}


// ── Constants ─────────────────────────────────────────────────────────────────

const OWNER_ESTIMATE_FLOOR_MULTIPLIER = 1.3;
const SHORT_DURATION_THRESHOLD = 30;
const SHORT_DURATION_FLOOR = 45;

const VOLATILITY_MULTIPLIERS: Record<VolatilityTier, number> = {
  LOW: 1.2,
  MEDIUM: 1.4,
  HIGH: 1.6,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Parse "HH:MM" into minutes from midnight. No Date objects. */
export function parseHHMM(time: string): number {
  const parts = time.split(":");
  if (parts.length !== 2) throw new Error(`Invalid time format: "${time}". Expected "HH:MM".`);
  const h = parseInt(parts[0]!, 10);
  const m = parseInt(parts[1]!, 10);
  if (isNaN(h) || isNaN(m) || h < 0 || h > 23 || m < 0 || m > 59) {
    throw new Error(`Invalid time value: "${time}".`);
  }
  return h * 60 + m;
}

/** Round up to nearest 5 minutes. */
function ceilTo5(minutes: number): number {
  return Math.ceil(minutes / 5) * 5;
}

/** Normalize date to YYYY-MM-DD in UTC for consistent comparison. */
function dateKey(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

// ── 1. calculateAvailableMinutes ──────────────────────────────────────────────

export function calculateAvailableMinutes(tech: TechProfile): AvailableMinutes {
  const start = parseHHMM(tech.workingHoursStart);
  const end = parseHHMM(tech.workingHoursEnd);
  const lunchStart = parseHHMM(tech.lunchStart);
  const lunchEnd = parseHHMM(tech.lunchEnd);

  // Schedule sanity validation
  if (end <= start) {
    throw new Error(`workingHoursEnd (${tech.workingHoursEnd}) must be after workingHoursStart (${tech.workingHoursStart}).`);
  }
  if (lunchStart < start) {
    throw new Error(`lunchStart (${tech.lunchStart}) cannot be before workingHoursStart (${tech.workingHoursStart}).`);
  }
  if (lunchEnd <= lunchStart) {
    throw new Error(`lunchEnd (${tech.lunchEnd}) must be after lunchStart (${tech.lunchStart}).`);
  }
  if (lunchEnd > end) {
    throw new Error(`lunchEnd (${tech.lunchEnd}) cannot be after workingHoursEnd (${tech.workingHoursEnd}).`);
  }

  const lunchDuration = lunchEnd - lunchStart;

  const totalMinutes = (end + tech.overtimeCapMinutes) - start - lunchDuration;
  const morningMinutes = lunchStart - start;
  const afternoonMinutes = (end + tech.overtimeCapMinutes) - lunchEnd;

  return { totalMinutes, morningMinutes, afternoonMinutes };
}

// ── 2. calculateJobCost ───────────────────────────────────────────────────────

export function calculateJobCost(
  baseDurationMinutes: number,
  volatilityTier: VolatilityTier,
  driveTimeMinutes: number,
): JobCost {
  // Step 1: 1.3x floor multiplier on owner estimate
  let duration = baseDurationMinutes * OWNER_ESTIMATE_FLOOR_MULTIPLIER;

  // Step 2: Short-duration check — if under 30, floor to 45
  if (duration < SHORT_DURATION_THRESHOLD) {
    duration = SHORT_DURATION_FLOOR;
  }

  // Step 3: Volatility buffer (this IS the buffer — no separate buffer after)
  duration = duration * VOLATILITY_MULTIPLIERS[volatilityTier];

  // Step 4: Round up to nearest 5
  const bookedDurationMinutes = ceilTo5(duration);

  // Drive time added AFTER rounding
  const totalCostMinutes = bookedDurationMinutes + driveTimeMinutes;

  return { bookedDurationMinutes, driveTimeMinutes, totalCostMinutes };
}

/**
 * Apply volatility buffer and round to nearest 5 minutes.
 * No owner floor (1.3x), no short-duration floor.
 * Used for tech on-site estimates where the duration comes from the tech, not the owner.
 */
export function applyVolatilityAndRound(
  durationMinutes: number,
  volatilityTier: VolatilityTier,
  driveTimeMinutes: number,
): JobCost {
  const buffered = durationMinutes * VOLATILITY_MULTIPLIERS[volatilityTier];
  const bookedDurationMinutes = ceilTo5(buffered);
  const totalCostMinutes = bookedDurationMinutes + driveTimeMinutes;
  return { bookedDurationMinutes, driveTimeMinutes, totalCostMinutes };
}

// ── 3. checkCapacityFromQueue ─────────────────────────────────────────────────
//
// Single source of truth for capacity: the actual queue of scheduling_jobs.
// No separate counter table — compute reserved minutes by walking the queue.

import type { QueuedJob } from "./queue-insertion";

/**
 * Check whether a new job of `totalCostMinutes` fits into a tech's day,
 * computed from the actual queue (ground truth).
 *
 * This replaces the old checkCapacity that read from capacity_reservations,
 * a running counter that drifted out of sync.
 */
export function checkCapacityFromQueue(
  queue: QueuedJob[],
  tech: TechProfile,
  totalCostMinutes: number,
  timePreference: TimePreference,
): CapacityCheck {
  const avail = calculateAvailableMinutes(tech);
  const lunchStartMin = parseHHMM(tech.lunchStart);
  const lunchEndMin = parseHHMM(tech.lunchEnd);

  let actualReserved = 0;
  let morningReserved = 0;
  let afternoonReserved = 0;
  let cursor = parseHHMM(tech.workingHoursStart);

  for (const job of queue) {
    if (cursor >= lunchStartMin && cursor < lunchEndMin) {
      cursor = lunchEndMin;
    }
    const jobCost = job.estimatedDurationMinutes;
    actualReserved += jobCost;
    if (cursor < lunchStartMin) {
      morningReserved += jobCost;
    } else {
      afternoonReserved += jobCost;
    }
    const serviceDur = job.estimatedDurationMinutes - (job.driveTimeMinutes || 0);
    cursor += serviceDur + (job.driveTimeMinutes || 15);
  }

  const remainingTotal = avail.totalMinutes - actualReserved;
  const remainingMorning = avail.morningMinutes - morningReserved;
  const remainingAfternoon = avail.afternoonMinutes - afternoonReserved;

  return {
    fits: fitsCapacity(remainingTotal, remainingMorning, remainingAfternoon, totalCostMinutes, timePreference),
    remainingTotal,
    remainingMorning,
    remainingAfternoon,
  };
}

function fitsCapacity(
  remainingTotal: number,
  remainingMorning: number,
  remainingAfternoon: number,
  cost: number,
  pref: TimePreference,
): boolean {
  if (remainingTotal < cost) return false;
  if (pref === "MORNING" && remainingMorning < cost) return false;
  if (pref === "AFTERNOON" && remainingAfternoon < cost) return false;
  return true;
}

