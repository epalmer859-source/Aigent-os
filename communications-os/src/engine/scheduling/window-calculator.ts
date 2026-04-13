// ============================================================
// src/engine/scheduling/window-calculator.ts
//
// WINDOW CALCULATOR — PURE FUNCTIONS, NO DB DEPENDENCY
//
// Calculates customer arrival windows based on three rules:
//
//   Rule 1 (Diagnostic):  start = arrival + 1hr, end = start + 3hr
//   Rule 2A (Known, high ≤ 2hr): start = arrival + 1hr, duration = 2hr
//   Rule 2B (Known, high 2hr1min–4hr): start = arrival + low estimate,
//     duration = max(2hr, spread + drive + 15min buffer)
//   Rule 3 (Known, high > 4hr): start = arrival + midpoint, end = start + 3hr
//
// All window start/end times round UP to nearest 15 minutes.
// ============================================================

// ── roundUpTo15 ─────────────────────────────────────────────────────────────

/**
 * Round a Date up to the nearest 15-minute increment.
 * 9:55 → 10:00, 11:08 → 11:15, 12:28 → 12:30, 12:00 → 12:00 (already aligned).
 */
export function roundUpTo15(date: Date): Date {
  const ms = date.getTime();
  const fifteenMin = 15 * 60 * 1000;
  const remainder = ms % fifteenMin;
  if (remainder === 0) return new Date(ms);
  return new Date(ms + (fifteenMin - remainder));
}

/**
 * Round minutes up to nearest 15.
 */
export function roundUpMinutesTo15(minutes: number): number {
  return Math.ceil(minutes / 15) * 15;
}

// ── Window result type ──────────────────────────────────────────────────────

export interface WindowResult {
  windowStart: Date;
  windowEnd: Date;
}

// ── Rule 1: Diagnostic Visits ───────────────────────────────────────────────

/**
 * Diagnostic window: start 1 hour after tech arrives, end = start + 3 hours.
 * Uses the scheduling protection cap (3 hours) for window duration.
 */
export function calculateDiagnosticWindow(techArrivalTime: Date): WindowResult {
  const rawStart = new Date(techArrivalTime.getTime() + 60 * 60 * 1000); // +1hr
  const windowStart = roundUpTo15(rawStart);
  const rawEnd = new Date(windowStart.getTime() + 3 * 60 * 60 * 1000); // +3hr
  const windowEnd = roundUpTo15(rawEnd);
  return { windowStart, windowEnd };
}

// ── Rules 2A / 2B / 3: Known Jobs ──────────────────────────────────────────

/**
 * Known job window. The high estimate determines which rule applies:
 *   high ≤ 120 min  → Rule 2A
 *   high 121–240 min → Rule 2B
 *   high > 240 min  → Rule 3
 */
export function calculateKnownJobWindow(
  techArrivalTime: Date,
  estimatedLowMinutes: number,
  estimatedHighMinutes: number,
  driveTimeMinutes: number,
): WindowResult {
  if (estimatedHighMinutes <= 120) {
    return rule2A(techArrivalTime);
  }
  if (estimatedHighMinutes <= 240) {
    return rule2B(techArrivalTime, estimatedLowMinutes, estimatedHighMinutes, driveTimeMinutes);
  }
  return rule3(techArrivalTime, estimatedLowMinutes, estimatedHighMinutes);
}

// ── Rule 2A: High estimate 2 hours or under ─────────────────────────────────

function rule2A(techArrivalTime: Date): WindowResult {
  const rawStart = new Date(techArrivalTime.getTime() + 60 * 60 * 1000); // +1hr
  const windowStart = roundUpTo15(rawStart);
  const rawEnd = new Date(windowStart.getTime() + 2 * 60 * 60 * 1000); // +2hr
  const windowEnd = roundUpTo15(rawEnd);
  return { windowStart, windowEnd };
}

// ── Rule 2B: High estimate above 2 hours up to 4 hours ──────────────────────

function rule2B(
  techArrivalTime: Date,
  estimatedLowMinutes: number,
  estimatedHighMinutes: number,
  driveTimeMinutes: number,
): WindowResult {
  // Window starts at tech's LOW estimate after arrival
  const rawStart = new Date(techArrivalTime.getTime() + estimatedLowMinutes * 60 * 1000);
  const windowStart = roundUpTo15(rawStart);

  // Duration depends on spread (high - low), minimum 2 hours
  const spread = estimatedHighMinutes - estimatedLowMinutes;
  let durationMinutes: number;

  if (spread <= 60) {
    // Spread 1 hour or less: exactly 2 hours, no drive, no buffer
    durationMinutes = 120;
  } else {
    // Spread 2+ hours: spread + drive time + 15 min buffer
    durationMinutes = Math.max(120, spread + driveTimeMinutes + 15);
  }

  const rawEnd = new Date(windowStart.getTime() + durationMinutes * 60 * 1000);
  const windowEnd = roundUpTo15(rawEnd);
  return { windowStart, windowEnd };
}

// ── Rule 3: High estimate over 4 hours ──────────────────────────────────────

function rule3(
  techArrivalTime: Date,
  estimatedLowMinutes: number,
  estimatedHighMinutes: number,
): WindowResult {
  // Window starts at midpoint of low and high estimate after arrival
  const midpointMinutes = Math.round((estimatedLowMinutes + estimatedHighMinutes) / 2);
  const rawStart = new Date(techArrivalTime.getTime() + midpointMinutes * 60 * 1000);
  const windowStart = roundUpTo15(rawStart);
  const rawEnd = new Date(windowStart.getTime() + 3 * 60 * 60 * 1000); // +3hr
  const windowEnd = roundUpTo15(rawEnd);
  return { windowStart, windowEnd };
}
