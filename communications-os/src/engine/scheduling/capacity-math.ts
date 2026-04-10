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

// ── Row shape for capacity_reservations ───────────────────────────────────────

export interface CapacityReservationRow {
  id: string;
  technician_id: string;
  business_id: string;
  date: Date;
  total_available_minutes: number;
  reserved_minutes: number;
  morning_reserved_minutes: number;
  afternoon_reserved_minutes: number;
}

// ── Injectable DB interface ───────────────────────────────────────────────────

export interface CapacityDb {
  getReservation(technicianId: string, date: Date): Promise<CapacityReservationRow | null>;
  updateReservation(
    technicianId: string,
    date: Date,
    data: {
      reserved_minutes: number;
      morning_reserved_minutes: number;
      afternoon_reserved_minutes: number;
    },
  ): Promise<void>;
  /**
   * Get or create a capacity_reservation row with a row-level lock.
   *
   * Contract for production Prisma adapter:
   *   1. SELECT ... FOR UPDATE WHERE technician_id = ? AND date = ?
   *   2. If no row, INSERT with ON CONFLICT DO NOTHING (handles race)
   *   3. Re-SELECT FOR UPDATE to get the winning row
   *   This guarantees exactly one row per [technicianId, date] even
   *   under concurrent first-time reservations.
   *
   * In-memory test adapter: simple get-or-create since there's no
   * real concurrency.
   */
  ensureReservationForUpdate(
    technicianId: string,
    date: Date,
    defaults: Omit<CapacityReservationRow, "id">,
  ): Promise<CapacityReservationRow>;
  getFutureReservations(technicianId: string, afterDate: Date): Promise<CapacityReservationRow[]>;
  getTechProfile(technicianId: string): Promise<TechProfile | null>;
  /**
   * Execute a callback inside a serializable transaction.
   * The callback receives a scoped db that supports ensureReservationForUpdate,
   * and updateReservation.
   */
  transaction<T>(fn: (tx: CapacityDb) => Promise<T>): Promise<T>;
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

// ── 3. checkCapacity ──────────────────────────────────────────────────────────

export async function checkCapacity(
  technicianId: string,
  date: Date,
  totalCostMinutes: number,
  timePreference: TimePreference,
  db: CapacityDb,
): Promise<CapacityCheck> {
  // Always derive capacity from current tech profile — single source of truth.
  // This prevents snapshot mismatch after profile edits.
  const tech = await db.getTechProfile(technicianId);
  if (!tech) {
    return { fits: false, remainingTotal: 0, remainingMorning: 0, remainingAfternoon: 0 };
  }
  const avail = calculateAvailableMinutes(tech);
  const row = await db.getReservation(technicianId, date);

  const reservedTotal = row?.reserved_minutes ?? 0;
  const reservedMorning = row?.morning_reserved_minutes ?? 0;
  const reservedAfternoon = row?.afternoon_reserved_minutes ?? 0;

  const remainingTotal = avail.totalMinutes - reservedTotal;
  const remainingMorning = avail.morningMinutes - reservedMorning;
  const remainingAfternoon = avail.afternoonMinutes - reservedAfternoon;

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

// ── 4. reserveCapacity ────────────────────────────────────────────────────────

export async function reserveCapacity(
  technicianId: string,
  date: Date,
  totalCostMinutes: number,
  timePreference: TimePreference,
  db: CapacityDb,
): Promise<ReservationResult> {
  return db.transaction(async (tx) => {
    const tech = await tx.getTechProfile(technicianId);
    if (!tech) return { success: false, reason: "no_capacity" as const };

    const avail = calculateAvailableMinutes(tech);
    const row = await tx.ensureReservationForUpdate(technicianId, date, {
      technician_id: technicianId,
      business_id: tech.businessId,
      date,
      total_available_minutes: avail.totalMinutes,
      reserved_minutes: 0,
      morning_reserved_minutes: 0,
      afternoon_reserved_minutes: 0,
    });
    const remainingTotal = avail.totalMinutes - row.reserved_minutes;
    const remainingMorning = avail.morningMinutes - row.morning_reserved_minutes;
    const remainingAfternoon = avail.afternoonMinutes - row.afternoon_reserved_minutes;

    // Check total capacity
    if (remainingTotal < totalCostMinutes) {
      return { success: false, reason: "no_capacity" as const };
    }

    // Check sub-capacity for time preference
    if (timePreference === "MORNING" && remainingMorning < totalCostMinutes) {
      return { success: false, reason: "no_morning_capacity" as const };
    }
    if (timePreference === "AFTERNOON" && remainingAfternoon < totalCostMinutes) {
      return { success: false, reason: "no_afternoon_capacity" as const };
    }

    // Reserve
    const newReserved = row.reserved_minutes + totalCostMinutes;
    const newMorning = timePreference === "MORNING"
      ? row.morning_reserved_minutes + totalCostMinutes
      : row.morning_reserved_minutes;
    const newAfternoon = timePreference === "AFTERNOON"
      ? row.afternoon_reserved_minutes + totalCostMinutes
      : row.afternoon_reserved_minutes;

    await tx.updateReservation(technicianId, date, {
      reserved_minutes: newReserved,
      morning_reserved_minutes: newMorning,
      afternoon_reserved_minutes: newAfternoon,
    });

    return { success: true };
  });
}

// ── 5. releaseCapacity ────────────────────────────────────────────────────────

export async function releaseCapacity(
  technicianId: string,
  date: Date,
  totalCostMinutes: number,
  timePreference: TimePreference,
  db: CapacityDb,
): Promise<void> {
  return db.transaction(async (tx) => {
    const existing = await tx.getReservation(technicianId, date);
    if (!existing) return; // Nothing to release — no reservation row exists

    const row = existing;

    // Clamp to zero — never go negative
    const newReserved = Math.max(0, row.reserved_minutes - totalCostMinutes);
    const newMorning = timePreference === "MORNING"
      ? Math.max(0, row.morning_reserved_minutes - totalCostMinutes)
      : row.morning_reserved_minutes;
    const newAfternoon = timePreference === "AFTERNOON"
      ? Math.max(0, row.afternoon_reserved_minutes - totalCostMinutes)
      : row.afternoon_reserved_minutes;

    await tx.updateReservation(technicianId, date, {
      reserved_minutes: newReserved,
      morning_reserved_minutes: newMorning,
      afternoon_reserved_minutes: newAfternoon,
    });
  });
}

// ── 6. revalidateCapacity ─────────────────────────────────────────────────────

export async function revalidateCapacity(
  technicianId: string,
  techProfile: TechProfile,
  db: CapacityDb,
  asOfDate?: Date,
): Promise<CapacityViolation[]> {
  const avail = calculateAvailableMinutes(techProfile);
  const cutoff = asOfDate ?? new Date();
  if (!asOfDate) cutoff.setUTCHours(0, 0, 0, 0);

  const futureRows = await db.getFutureReservations(technicianId, cutoff);
  const violations: CapacityViolation[] = [];

  for (const row of futureRows) {
    if (row.reserved_minutes > avail.totalMinutes) {
      violations.push({
        technicianId,
        date: row.date,
        violation: "total_overcapacity",
        reserved: row.reserved_minutes,
        available: avail.totalMinutes,
      });
    }
    if (row.morning_reserved_minutes > avail.morningMinutes) {
      violations.push({
        technicianId,
        date: row.date,
        violation: "morning_overcapacity",
        reserved: row.morning_reserved_minutes,
        available: avail.morningMinutes,
      });
    }
    if (row.afternoon_reserved_minutes > avail.afternoonMinutes) {
      violations.push({
        technicianId,
        date: row.date,
        violation: "afternoon_overcapacity",
        reserved: row.afternoon_reserved_minutes,
        available: avail.afternoonMinutes,
      });
    }
  }

  return violations;
}

// ── In-memory store for testing ───────────────────────────────────────────────

export function createInMemoryCapacityDb(techProfiles: TechProfile[]): CapacityDb {
  const reservations = new Map<string, CapacityReservationRow>();
  const profiles = new Map<string, TechProfile>();
  for (const tp of techProfiles) profiles.set(tp.id, tp);

  function key(techId: string, date: Date): string {
    return `${techId}::${dateKey(date)}`;
  }

  const db: CapacityDb = {
    async getReservation(technicianId, date) {
      return reservations.get(key(technicianId, date)) ?? null;
    },
    async updateReservation(technicianId, date, data) {
      const row = reservations.get(key(technicianId, date));
      if (!row) throw new Error("Reservation not found for update");
      row.reserved_minutes = data.reserved_minutes;
      row.morning_reserved_minutes = data.morning_reserved_minutes;
      row.afternoon_reserved_minutes = data.afternoon_reserved_minutes;
    },
    async ensureReservationForUpdate(technicianId, date, defaults) {
      const k = key(technicianId, date);
      const existing = reservations.get(k);
      if (existing) return existing;
      const row: CapacityReservationRow = { id: crypto.randomUUID(), ...defaults };
      reservations.set(k, row);
      return row;
    },
    async getFutureReservations(technicianId, afterDate) {
      const results: CapacityReservationRow[] = [];
      for (const row of reservations.values()) {
        if (row.technician_id === technicianId && row.date >= afterDate) {
          results.push(row);
        }
      }
      return results;
    },
    async getTechProfile(technicianId) {
      return profiles.get(technicianId) ?? null;
    },
    async transaction<T>(fn: (tx: CapacityDb) => Promise<T>): Promise<T> {
      // In-memory: just run the callback — no real locking needed
      return fn(db);
    },
  };

  return db;
}
