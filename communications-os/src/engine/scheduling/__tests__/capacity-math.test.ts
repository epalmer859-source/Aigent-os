// ============================================================
// Capacity Math Engine — Tests
//
// Every test traces to a rule in unified-scheduling-spec.md.
// Uses in-memory stores — no real DB.
// ============================================================

import { describe, it, expect } from "vitest";
import {
  calculateAvailableMinutes,
  calculateJobCost,
  checkCapacity,
  reserveCapacity,
  releaseCapacity,
  revalidateCapacity,
  createInMemoryCapacityDb,
  parseHHMM,
  type TechProfile,
} from "../capacity-math";

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Standard 8-5 tech, 30-min lunch at noon. */
const STANDARD_TECH: TechProfile = {
  id: "tech-1",
  businessId: "biz-1",
  workingHoursStart: "08:00",
  workingHoursEnd: "17:00",
  lunchStart: "12:00",
  lunchEnd: "12:30",
  overtimeCapMinutes: 0,
};

/** Tech with 30 minutes overtime cap. */
const OVERTIME_TECH: TechProfile = {
  ...STANDARD_TECH,
  id: "tech-2",
  overtimeCapMinutes: 30,
};

/** Custom hours tech: 9-4, 1-hour lunch. */
const CUSTOM_TECH: TechProfile = {
  id: "tech-3",
  businessId: "biz-1",
  workingHoursStart: "09:00",
  workingHoursEnd: "16:00",
  lunchStart: "12:00",
  lunchEnd: "13:00",
  overtimeCapMinutes: 0,
};

const TODAY = new Date("2026-04-08");

// ── parseHHMM ─────────────────────────────────────────────────────────────────

describe("parseHHMM", () => {
  it("parses standard times", () => {
    expect(parseHHMM("08:00")).toBe(480);
    expect(parseHHMM("12:00")).toBe(720);
    expect(parseHHMM("17:00")).toBe(1020);
    expect(parseHHMM("00:00")).toBe(0);
    expect(parseHHMM("23:59")).toBe(1439);
  });

  it("rejects invalid formats", () => {
    expect(() => parseHHMM("8")).toThrow("Invalid time format");
    expect(() => parseHHMM("25:00")).toThrow("Invalid time value");
    expect(() => parseHHMM("12:60")).toThrow("Invalid time value");
  });
});

// ── calculateAvailableMinutes ─────────────────────────────────────────────────

describe("calculateAvailableMinutes", () => {
  it("standard 8-5 tech with 30-min lunch = 510 total, 240 morning, 270 afternoon", () => {
    const result = calculateAvailableMinutes(STANDARD_TECH);

    // (17:00 + 0) - 08:00 - 30 = 1020 - 480 - 30 = 510
    expect(result.totalMinutes).toBe(510);
    // 12:00 - 08:00 = 240
    expect(result.morningMinutes).toBe(240);
    // (17:00 + 0) - 12:30 = 1020 - 750 = 270
    expect(result.afternoonMinutes).toBe(270);
  });

  it("tech with 30-min overtime cap", () => {
    const result = calculateAvailableMinutes(OVERTIME_TECH);

    // (1020 + 30) - 480 - 30 = 540
    expect(result.totalMinutes).toBe(540);
    // Morning unchanged: 12:00 - 08:00 = 240
    expect(result.morningMinutes).toBe(240);
    // (1020 + 30) - 750 = 300
    expect(result.afternoonMinutes).toBe(300);
  });

  it("custom hours 9-4 with 1-hour lunch", () => {
    const result = calculateAvailableMinutes(CUSTOM_TECH);

    // (960 + 0) - 540 - 60 = 360
    expect(result.totalMinutes).toBe(360);
    // 12:00 - 09:00 = 180
    expect(result.morningMinutes).toBe(180);
    // (960 + 0) - 780 = 180
    expect(result.afternoonMinutes).toBe(180);
  });

  it("throws when workingHoursEnd <= workingHoursStart", () => {
    expect(() =>
      calculateAvailableMinutes({ ...STANDARD_TECH, workingHoursEnd: "08:00" }),
    ).toThrow("must be after workingHoursStart");

    expect(() =>
      calculateAvailableMinutes({ ...STANDARD_TECH, workingHoursEnd: "07:00" }),
    ).toThrow("must be after workingHoursStart");
  });

  it("throws when lunchStart < workingHoursStart", () => {
    expect(() =>
      calculateAvailableMinutes({ ...STANDARD_TECH, lunchStart: "07:00" }),
    ).toThrow("cannot be before workingHoursStart");
  });

  it("throws when lunchEnd <= lunchStart", () => {
    expect(() =>
      calculateAvailableMinutes({ ...STANDARD_TECH, lunchEnd: "12:00" }),
    ).toThrow("must be after lunchStart");

    expect(() =>
      calculateAvailableMinutes({ ...STANDARD_TECH, lunchEnd: "11:00" }),
    ).toThrow("must be after lunchStart");
  });

  it("throws when lunchEnd > workingHoursEnd", () => {
    expect(() =>
      calculateAvailableMinutes({ ...STANDARD_TECH, lunchEnd: "18:00" }),
    ).toThrow("cannot be after workingHoursEnd");
  });
});

// ── calculateJobCost — multiplier stack ───────────────────────────────────────

describe("calculateJobCost", () => {
  it("owner says 45 min, HIGH volatility → exact walkthrough", () => {
    // Step 1: 45 × 1.3 = 58.5
    // Step 2: 58.5 >= 30, no floor
    // Step 3: 58.5 × 1.6 = 93.6
    // Step 4: ceilTo5(93.6) = 95
    const result = calculateJobCost(45, "HIGH", 15);

    expect(result.bookedDurationMinutes).toBe(95);
    expect(result.driveTimeMinutes).toBe(15);
    expect(result.totalCostMinutes).toBe(110);
  });

  it("owner says 20 min → short-duration floor kicks in", () => {
    // Step 1: 20 × 1.3 = 26
    // Step 2: 26 < 30 → floor to 45
    // Step 3: 45 × 1.2 (LOW) = 54
    // Step 4: ceilTo5(54) = 55
    const result = calculateJobCost(20, "LOW", 10);

    expect(result.bookedDurationMinutes).toBe(55);
    expect(result.driveTimeMinutes).toBe(10);
    expect(result.totalCostMinutes).toBe(65);
  });

  it("LOW vs HIGH volatility comparison on same base input", () => {
    const low = calculateJobCost(60, "LOW", 0);
    const high = calculateJobCost(60, "HIGH", 0);

    // 60 × 1.3 = 78 → not under 30
    // LOW:  78 × 1.2 = 93.6  → ceilTo5 = 95
    // HIGH: 78 × 1.6 = 124.8 → ceilTo5 = 125
    expect(low.bookedDurationMinutes).toBe(95);
    expect(high.bookedDurationMinutes).toBe(125);
    expect(high.bookedDurationMinutes).toBeGreaterThan(low.bookedDurationMinutes);
  });

  it("no extra buffer added after volatility multiplier", () => {
    // If there were an extra buffer, 45 × 1.3 = 58.5 × 1.4 = 81.9 → 85
    // With ANOTHER 1.x would be higher. We verify it's exactly 85.
    const result = calculateJobCost(45, "MEDIUM", 0);

    // 45 × 1.3 = 58.5 → not under 30 → × 1.4 = 81.9 → ceilTo5 = 85
    expect(result.bookedDurationMinutes).toBe(85);
  });

  it("rounds up to nearest 5 minutes", () => {
    // 50 × 1.3 = 65 → × 1.2 = 78 → ceilTo5(78) = 80
    const result = calculateJobCost(50, "LOW", 0);
    expect(result.bookedDurationMinutes).toBe(80);
    expect(result.bookedDurationMinutes % 5).toBe(0);
  });

  it("drive time is added AFTER rounding, not before", () => {
    // 45 × 1.3 = 58.5 → × 1.6 = 93.6 → ceilTo5 = 95
    // If drive was added before rounding: ceilTo5(93.6 + 7) = ceilTo5(100.6) = 105 ← wrong
    // Correct: 95 + 7 = 102
    const result = calculateJobCost(45, "HIGH", 7);

    expect(result.bookedDurationMinutes).toBe(95);
    expect(result.totalCostMinutes).toBe(102);
  });
});

// ── checkCapacity ─────────────────────────────────────────────────────────────

describe("checkCapacity", () => {
  it("passes when room exists", async () => {
    const db = createInMemoryCapacityDb([STANDARD_TECH]);
    const result = await checkCapacity("tech-1", TODAY, 100, "NO_PREFERENCE", db);

    expect(result.fits).toBe(true);
    expect(result.remainingTotal).toBe(510);
  });

  it("fails when day is full", async () => {
    const db = createInMemoryCapacityDb([STANDARD_TECH]);
    // Reserve the full day first
    await reserveCapacity("tech-1", TODAY, 510, "NO_PREFERENCE", db);
    const result = await checkCapacity("tech-1", TODAY, 1, "NO_PREFERENCE", db);

    expect(result.fits).toBe(false);
    expect(result.remainingTotal).toBe(0);
  });

  it("MORNING preference checks morning sub-capacity", async () => {
    const db = createInMemoryCapacityDb([STANDARD_TECH]);
    // Fill up most of morning (240 total morning minutes)
    await reserveCapacity("tech-1", TODAY, 200, "MORNING", db);
    // 40 min remaining in morning — 50 min job won't fit morning
    const result = await checkCapacity("tech-1", TODAY, 50, "MORNING", db);

    expect(result.fits).toBe(false);
    expect(result.remainingMorning).toBe(40);
  });

  it("AFTERNOON preference checks afternoon sub-capacity", async () => {
    const db = createInMemoryCapacityDb([STANDARD_TECH]);
    // Fill most of afternoon (270 total afternoon minutes)
    await reserveCapacity("tech-1", TODAY, 250, "AFTERNOON", db);
    // 20 min remaining in afternoon — 25 min job won't fit
    const result = await checkCapacity("tech-1", TODAY, 25, "AFTERNOON", db);

    expect(result.fits).toBe(false);
    expect(result.remainingAfternoon).toBe(20);
  });

  it("SOONEST only checks total capacity", async () => {
    const db = createInMemoryCapacityDb([STANDARD_TECH]);
    // Fill morning completely
    await reserveCapacity("tech-1", TODAY, 240, "MORNING", db);
    // SOONEST should still fit (270 remaining total, morning full but doesn't matter)
    const result = await checkCapacity("tech-1", TODAY, 100, "SOONEST", db);

    expect(result.fits).toBe(true);
  });

  it("NO_PREFERENCE only checks total capacity", async () => {
    const db = createInMemoryCapacityDb([STANDARD_TECH]);
    // Fill afternoon completely
    await reserveCapacity("tech-1", TODAY, 270, "AFTERNOON", db);
    // NO_PREFERENCE should still fit (240 remaining total)
    const result = await checkCapacity("tech-1", TODAY, 100, "NO_PREFERENCE", db);

    expect(result.fits).toBe(true);
  });

  it("morning sub-capacity: 3 morning-only when only 2 fit = third rejected", async () => {
    const db = createInMemoryCapacityDb([STANDARD_TECH]);
    // Morning = 240 min. Each job costs 100 min.
    const r1 = await reserveCapacity("tech-1", TODAY, 100, "MORNING", db);
    expect(r1.success).toBe(true);

    const r2 = await reserveCapacity("tech-1", TODAY, 100, "MORNING", db);
    expect(r2.success).toBe(true);

    // Third: 40 min remaining in morning < 100
    const r3 = await reserveCapacity("tech-1", TODAY, 100, "MORNING", db);
    expect(r3.success).toBe(false);
    expect(r3.reason).toBe("no_morning_capacity");
  });
});

// ── reserveCapacity ───────────────────────────────────────────────────────────

describe("reserveCapacity", () => {
  it("succeeds and reduces remaining minutes", async () => {
    const db = createInMemoryCapacityDb([STANDARD_TECH]);
    const result = await reserveCapacity("tech-1", TODAY, 100, "NO_PREFERENCE", db);

    expect(result.success).toBe(true);

    const check = await checkCapacity("tech-1", TODAY, 0, "NO_PREFERENCE", db);
    expect(check.remainingTotal).toBe(410); // 510 - 100
  });

  it("fails when no room", async () => {
    const db = createInMemoryCapacityDb([STANDARD_TECH]);
    const result = await reserveCapacity("tech-1", TODAY, 999, "NO_PREFERENCE", db);

    expect(result.success).toBe(false);
    expect(result.reason).toBe("no_capacity");
  });

  it("creates the CapacityReservation row if it doesn't exist", async () => {
    const db = createInMemoryCapacityDb([STANDARD_TECH]);

    // No row exists yet — reservation should auto-create
    const beforeRow = await db.getReservation("tech-1", TODAY);
    expect(beforeRow).toBeNull();

    await reserveCapacity("tech-1", TODAY, 50, "NO_PREFERENCE", db);

    const afterRow = await db.getReservation("tech-1", TODAY);
    expect(afterRow).not.toBeNull();
    expect(afterRow!.total_available_minutes).toBe(510);
    expect(afterRow!.reserved_minutes).toBe(50);
  });

  it("sequential competing reservations: one succeeds, one fails when only room for one", async () => {
    const db = createInMemoryCapacityDb([STANDARD_TECH]);
    // 510 total minutes. Two 300-min jobs. Only one fits.
    const r1 = await reserveCapacity("tech-1", TODAY, 300, "NO_PREFERENCE", db);
    const r2 = await reserveCapacity("tech-1", TODAY, 300, "NO_PREFERENCE", db);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(false);
    expect(r2.reason).toBe("no_capacity");
  });
});

// ── releaseCapacity ───────────────────────────────────────────────────────────

describe("releaseCapacity", () => {
  it("restores minutes correctly", async () => {
    const db = createInMemoryCapacityDb([STANDARD_TECH]);
    await reserveCapacity("tech-1", TODAY, 100, "MORNING", db);

    const before = await checkCapacity("tech-1", TODAY, 0, "NO_PREFERENCE", db);
    expect(before.remainingTotal).toBe(410);
    expect(before.remainingMorning).toBe(140);

    await releaseCapacity("tech-1", TODAY, 100, "MORNING", db);

    const after = await checkCapacity("tech-1", TODAY, 0, "NO_PREFERENCE", db);
    expect(after.remainingTotal).toBe(510);
    expect(after.remainingMorning).toBe(240);
  });

  it("clamps to zero, never goes negative", async () => {
    const db = createInMemoryCapacityDb([STANDARD_TECH]);
    // Reserve 50, then release 200 — should clamp to 0, not go to -150
    await reserveCapacity("tech-1", TODAY, 50, "MORNING", db);
    await releaseCapacity("tech-1", TODAY, 200, "MORNING", db);

    const row = await db.getReservation("tech-1", TODAY);
    expect(row!.reserved_minutes).toBe(0);
    expect(row!.morning_reserved_minutes).toBe(0);
  });

  it("no-ops gracefully when no reservation row exists", async () => {
    const db = createInMemoryCapacityDb([STANDARD_TECH]);
    // Release on a date with no reservation — should not throw
    await expect(
      releaseCapacity("tech-1", TODAY, 100, "NO_PREFERENCE", db),
    ).resolves.toBeUndefined();
  });
});

// ── revalidateCapacity ────────────────────────────────────────────────────────

describe("revalidateCapacity", () => {
  it("flags overcapacity day after profile change reduces total hours", async () => {
    const db = createInMemoryCapacityDb([STANDARD_TECH]);
    // Reserve 500 of 510 total minutes
    await reserveCapacity("tech-1", TODAY, 500, "NO_PREFERENCE", db);

    // Now the tech's hours shrink: 9-4 with 1-hr lunch = 360 total
    const shrunkProfile: TechProfile = {
      ...STANDARD_TECH,
      workingHoursStart: "09:00",
      workingHoursEnd: "16:00",
      lunchStart: "12:00",
      lunchEnd: "13:00",
    };

    const violations = await revalidateCapacity("tech-1", shrunkProfile, db, TODAY);

    expect(violations.length).toBeGreaterThanOrEqual(1);
    const totalViolation = violations.find((v) => v.violation === "total_overcapacity");
    expect(totalViolation).toBeDefined();
    expect(totalViolation!.reserved).toBe(500);
    expect(totalViolation!.available).toBe(360);
  });

  it("flags morning overcapacity specifically", async () => {
    const db = createInMemoryCapacityDb([STANDARD_TECH]);
    // Reserve 230 in morning (of 240 available)
    await reserveCapacity("tech-1", TODAY, 230, "MORNING", db);

    // Profile change: start at 10 instead of 8 → morning = 12:00 - 10:00 = 120
    const laterStart: TechProfile = {
      ...STANDARD_TECH,
      workingHoursStart: "10:00",
    };

    const violations = await revalidateCapacity("tech-1", laterStart, db, TODAY);

    const morningViolation = violations.find((v) => v.violation === "morning_overcapacity");
    expect(morningViolation).toBeDefined();
    expect(morningViolation!.reserved).toBe(230);
    expect(morningViolation!.available).toBe(120);
  });

  it("flags afternoon overcapacity specifically", async () => {
    const db = createInMemoryCapacityDb([STANDARD_TECH]);
    // Reserve 260 in afternoon (of 270 available)
    await reserveCapacity("tech-1", TODAY, 260, "AFTERNOON", db);

    // Profile change: end at 16 instead of 17 → afternoon = 960 - 750 = 210
    const earlierEnd: TechProfile = {
      ...STANDARD_TECH,
      workingHoursEnd: "16:00",
    };

    const violations = await revalidateCapacity("tech-1", earlierEnd, db, TODAY);

    const afternoonViolation = violations.find((v) => v.violation === "afternoon_overcapacity");
    expect(afternoonViolation).toBeDefined();
    expect(afternoonViolation!.reserved).toBe(260);
    expect(afternoonViolation!.available).toBe(210);
  });

  it("returns empty array when no violations", async () => {
    const db = createInMemoryCapacityDb([STANDARD_TECH]);
    // Reserve a small amount
    await reserveCapacity("tech-1", TODAY, 50, "NO_PREFERENCE", db);

    const violations = await revalidateCapacity("tech-1", STANDARD_TECH, db, TODAY);
    expect(violations).toEqual([]);
  });

  it("returns empty array when no future reservations exist", async () => {
    const db = createInMemoryCapacityDb([STANDARD_TECH]);
    const violations = await revalidateCapacity("tech-1", STANDARD_TECH, db, TODAY);
    expect(violations).toEqual([]);
  });
});

// ── businessId on auto-created reservation ────────────────────────────────────

describe("businessId usage", () => {
  it("uses tech.businessId when auto-creating a reservation row", async () => {
    const tech: TechProfile = { ...STANDARD_TECH, id: "tech-biz", businessId: "biz-42" };
    const db = createInMemoryCapacityDb([tech]);

    await reserveCapacity("tech-biz", TODAY, 50, "NO_PREFERENCE", db);

    const row = await db.getReservation("tech-biz", TODAY);
    expect(row).not.toBeNull();
    expect(row!.business_id).toBe("biz-42");
  });
});

// ── Consistent capacity snapshot ──────────────────────────────────────────────

describe("consistent capacity snapshot after profile changes", () => {
  it("checkCapacity uses current profile, not stale row total_available_minutes", async () => {
    const db = createInMemoryCapacityDb([STANDARD_TECH]);
    // Reserve 400 of 510 total — creates row with total_available_minutes=510
    await reserveCapacity("tech-1", TODAY, 400, "NO_PREFERENCE", db);

    // Simulate profile change: tech now works 9-4 (360 total)
    // Update the profile in the db store
    const shrunkTech: TechProfile = {
      ...STANDARD_TECH,
      workingHoursStart: "09:00",
      workingHoursEnd: "16:00",
      lunchStart: "12:00",
      lunchEnd: "13:00",
    };
    const dbWithUpdated = createInMemoryCapacityDb([shrunkTech]);
    // Copy the existing reservation into the new db
    const existingRow = await db.getReservation("tech-1", TODAY);
    await dbWithUpdated.ensureReservationForUpdate("tech-1", TODAY, {
      technician_id: existingRow!.technician_id,
      business_id: existingRow!.business_id,
      date: existingRow!.date,
      total_available_minutes: existingRow!.total_available_minutes, // stale 510
      reserved_minutes: existingRow!.reserved_minutes, // 400
      morning_reserved_minutes: existingRow!.morning_reserved_minutes,
      afternoon_reserved_minutes: existingRow!.afternoon_reserved_minutes,
    });

    // checkCapacity should use profile's 360, not row's stale 510
    // remaining = 360 - 400 = -40 → doesn't fit even 1 minute
    const check = await checkCapacity("tech-1", TODAY, 1, "NO_PREFERENCE", dbWithUpdated);
    expect(check.fits).toBe(false);
    expect(check.remainingTotal).toBe(-40);
  });

  it("reserveCapacity uses current profile for capacity check", async () => {
    const db = createInMemoryCapacityDb([STANDARD_TECH]);
    // Reserve 350 of 510 total
    await reserveCapacity("tech-1", TODAY, 350, "NO_PREFERENCE", db);

    // Now shrink profile to 360 total — only 10 min remaining
    const shrunkTech: TechProfile = {
      ...STANDARD_TECH,
      workingHoursStart: "09:00",
      workingHoursEnd: "16:00",
      lunchStart: "12:00",
      lunchEnd: "13:00",
    };
    const dbWithUpdated = createInMemoryCapacityDb([shrunkTech]);
    const existingRow = await db.getReservation("tech-1", TODAY);
    await dbWithUpdated.ensureReservationForUpdate("tech-1", TODAY, {
      technician_id: existingRow!.technician_id,
      business_id: existingRow!.business_id,
      date: existingRow!.date,
      total_available_minutes: existingRow!.total_available_minutes, // stale 510
      reserved_minutes: existingRow!.reserved_minutes, // 350
      morning_reserved_minutes: existingRow!.morning_reserved_minutes,
      afternoon_reserved_minutes: existingRow!.afternoon_reserved_minutes,
    });

    // With stale row: 510 - 350 = 160 → would fit 50 min job
    // With fresh profile: 360 - 350 = 10 → should NOT fit 50 min job
    const result = await reserveCapacity("tech-1", TODAY, 50, "NO_PREFERENCE", dbWithUpdated);
    expect(result.success).toBe(false);
    expect(result.reason).toBe("no_capacity");
  });
});

// ── Create-if-missing contract ────────────────────────────────────────────────

describe("ensureReservationForUpdate contract", () => {
  it("returns existing row if already created (simulates second concurrent caller)", async () => {
    const db = createInMemoryCapacityDb([STANDARD_TECH]);

    // First reservation creates the row
    await reserveCapacity("tech-1", TODAY, 100, "NO_PREFERENCE", db);
    const row1 = await db.getReservation("tech-1", TODAY);
    expect(row1!.reserved_minutes).toBe(100);

    // Second call to ensureReservationForUpdate returns the existing row,
    // NOT a new row with defaults — simulates the production race-safe contract
    const row2 = await db.ensureReservationForUpdate("tech-1", TODAY, {
      technician_id: "tech-1",
      business_id: "biz-1",
      date: TODAY,
      total_available_minutes: 510,
      reserved_minutes: 0, // defaults would reset to 0, but existing row should win
      morning_reserved_minutes: 0,
      afternoon_reserved_minutes: 0,
    });

    expect(row2.reserved_minutes).toBe(100); // existing row preserved, not overwritten
    expect(row2.id).toBe(row1!.id); // same row
  });
});
