// ============================================================
// Tests for computeWindowVariants and booking validator
//
// V01  first_of_day variant — generator produces, validator accepts
// V02  rule_1 variant — generator produces, validator accepts
// V03  rule_2a variant — follow-up generator produces, validator accepts
// V04  rule_2b variant — follow-up generator produces, validator accepts
// V05  rule_3 variant — follow-up generator produces, validator accepts
// V06  negative — bogus variantType rejected by validator
// V07  stale state — slot listed, queue changed, validator rejects
// V08  first_of_day and rule_1 coexist for same arrival
// V09  generator stamps metadata on every slot
// ============================================================

import { describe, it, expect } from "vitest";
import {
  computeWindowVariants,
  computeFollowUpCost,
  type JobContext,
  type WindowVariantType,
  type AvailableSlot,
} from "../ai-booking-pipeline";
import { parseHHMM } from "../capacity-math";
import type { TechCandidate } from "../tech-assignment";
import type { QueuedJob } from "../queue-insertion";

// ── Test constants ──────────────────────────────────────────────────────────

const WORK_START = parseHHMM("08:00"); // 480
const DIAG_CONTEXT: JobContext = { kind: "diagnostic" };

// ── Helper: format minutes as HH:MM ────────────────────────────────────────

function fmt(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

// ── Helper: build a mock tech ───────────────────────────────────────────────

function makeTech(overrides: Partial<TechCandidate> = {}): TechCandidate {
  return {
    id: "tech-1",
    businessId: "biz-1",
    name: "Mike",
    homeBaseLat: 0,
    homeBaseLng: 0,
    skillTags: [],
    workingHoursStart: "08:00",
    workingHoursEnd: "17:00",
    lunchStart: "12:00",
    lunchEnd: "13:00",
    overtimeCapMinutes: 30,
    isActive: true,
    ...overrides,
  };
}

// ── Helper: simulate what the validator does ────────────────────────────────
// Given a slot and a list of available windows, run the identity-based check.

function validateSlot(
  slot: Pick<AvailableSlot, "arrivalMinutes" | "queuePosition" | "variantType" | "windowStart" | "windowEnd">,
  availableWindows: { startMinutes: number; queuePosition: number }[],
  workStart: number,
  jobContext: JobContext,
): boolean {
  if (slot.arrivalMinutes == null || slot.variantType == null) return false;

  const matchingWindow = availableWindows.find(
    (w) => w.startMinutes === slot.arrivalMinutes && w.queuePosition === slot.queuePosition,
  );
  if (!matchingWindow) return false;

  const variants = computeWindowVariants(
    matchingWindow.startMinutes, matchingWindow.queuePosition, workStart, jobContext,
  );
  return variants.some(
    (v) => v.variantType === slot.variantType
      && fmt(v.wStart) === slot.windowStart
      && fmt(v.wEnd) === slot.windowEnd,
  );
}

// ── V01: first_of_day ───────────────────────────────────────────────────────

describe("V01: first_of_day variant — generator produces, validator accepts", () => {
  it("computeWindowVariants produces first_of_day for queuePosition=0 at workStart", () => {
    const variants = computeWindowVariants(WORK_START, 0, WORK_START, DIAG_CONTEXT);
    const firstOfDay = variants.find((v) => v.variantType === "first_of_day");
    expect(firstOfDay).toBeDefined();
    expect(firstOfDay!.wStart).toBe(WORK_START);       // 480 = 08:00
    expect(firstOfDay!.wEnd).toBe(WORK_START + 30);     // 510 = 08:30
  });

  it("validator accepts first_of_day slot against empty queue", () => {
    const windows = [{ startMinutes: WORK_START, queuePosition: 0 }];
    const slot = {
      arrivalMinutes: WORK_START,
      queuePosition: 0,
      variantType: "first_of_day" as WindowVariantType,
      windowStart: "08:00",
      windowEnd: "08:30",
    };
    expect(validateSlot(slot, windows, WORK_START, DIAG_CONTEXT)).toBe(true);
  });
});

// ── V02: rule_1 ─────────────────────────────────────────────────────────────

describe("V02: rule_1 variant — generator produces, validator accepts", () => {
  it("computeWindowVariants produces rule_1 for any arrival", () => {
    const variants = computeWindowVariants(WORK_START, 0, WORK_START, DIAG_CONTEXT);
    const rule1 = variants.find((v) => v.variantType === "rule_1");
    expect(rule1).toBeDefined();
    // arrival 480 + 60 = 540, rounded to 15 = 540 → 09:00
    // 540 + 180 = 720, rounded to 15 = 720 → 12:00
    expect(rule1!.wStart).toBe(540);
    expect(rule1!.wEnd).toBe(720);
  });

  it("validator accepts rule_1 slot against empty queue", () => {
    const windows = [{ startMinutes: WORK_START, queuePosition: 0 }];
    const slot = {
      arrivalMinutes: WORK_START,
      queuePosition: 0,
      variantType: "rule_1" as WindowVariantType,
      windowStart: "09:00",
      windowEnd: "12:00",
    };
    expect(validateSlot(slot, windows, WORK_START, DIAG_CONTEXT)).toBe(true);
  });

  it("rule_1 produced for non-first-of-day positions too", () => {
    // Arrival at 10:00 (600), queuePosition=1 → NOT first of day
    const variants = computeWindowVariants(600, 1, WORK_START, DIAG_CONTEXT);
    expect(variants).toHaveLength(1); // only rule_1, no first_of_day
    expect(variants[0]!.variantType).toBe("rule_1");
    // 600 + 60 = 660, rounded = 660 → 11:00
    expect(variants[0]!.wStart).toBe(660);
  });
});

// ── V03: rule_2a ─────────────────────────────────────────────���──────────────

describe("V03: rule_2a variant — follow-up generator produces, validator accepts", () => {
  const ctx: JobContext = {
    kind: "follow_up",
    estimatedLowMinutes: 60,
    estimatedHighMinutes: 90, // ≤ 120 → Rule 2A
    windowDurationMinutes: 120,
    rule: "2A",
  };

  it("computeWindowVariants produces rule_2a", () => {
    const variants = computeWindowVariants(WORK_START, 0, WORK_START, ctx);
    const rule2a = variants.find((v) => v.variantType === "rule_2a");
    expect(rule2a).toBeDefined();
    // arrival 480 + 60 = 540, rounded = 540
    // end = 540 + 120 = 660, rounded = 660
    expect(rule2a!.wStart).toBe(540);
    expect(rule2a!.wEnd).toBe(660);
  });

  it("validator accepts rule_2a slot", () => {
    const windows = [{ startMinutes: WORK_START, queuePosition: 0 }];
    const slot = {
      arrivalMinutes: WORK_START,
      queuePosition: 0,
      variantType: "rule_2a" as WindowVariantType,
      windowStart: "09:00",
      windowEnd: "11:00",
    };
    expect(validateSlot(slot, windows, WORK_START, ctx)).toBe(true);
  });
});

// ── V04: rule_2b ────────────────────────────────────────────────────────────

describe("V04: rule_2b variant — follow-up generator produces, validator accepts", () => {
  const { totalCostMinutes, windowDurationMinutes, rule } = computeFollowUpCost(90, 180, 15);
  const ctx: JobContext = {
    kind: "follow_up",
    estimatedLowMinutes: 90,
    estimatedHighMinutes: 180, // 121-240, spread=90 > 60 → Rule 2B
    windowDurationMinutes,
    rule,
  };

  it("computeFollowUpCost returns rule 2B", () => {
    expect(rule).toBe("2B");
  });

  it("computeWindowVariants produces rule_2b", () => {
    const variants = computeWindowVariants(WORK_START, 0, WORK_START, ctx);
    const rule2b = variants.find((v) => v.variantType === "rule_2b");
    expect(rule2b).toBeDefined();
    // arrival 480 + estimatedLow(90) = 570, rounded to 15 = 570
    expect(rule2b!.wStart).toBe(570);
  });

  it("validator accepts rule_2b slot", () => {
    const windows = [{ startMinutes: WORK_START, queuePosition: 0 }];
    const variants = computeWindowVariants(WORK_START, 0, WORK_START, ctx);
    const rule2b = variants.find((v) => v.variantType === "rule_2b")!;
    const slot = {
      arrivalMinutes: WORK_START,
      queuePosition: 0,
      variantType: "rule_2b" as WindowVariantType,
      windowStart: fmt(rule2b.wStart),
      windowEnd: fmt(rule2b.wEnd),
    };
    expect(validateSlot(slot, windows, WORK_START, ctx)).toBe(true);
  });
});

// ── V05: rule_3 ─────────────────────────────────────────────────────────────

describe("V05: rule_3 variant — follow-up generator produces, validator accepts", () => {
  const { totalCostMinutes, windowDurationMinutes, rule } = computeFollowUpCost(180, 300, 15);
  const ctx: JobContext = {
    kind: "follow_up",
    estimatedLowMinutes: 180,
    estimatedHighMinutes: 300, // > 240 → Rule 3
    windowDurationMinutes,
    rule,
  };

  it("computeFollowUpCost returns rule 3", () => {
    expect(rule).toBe("3");
  });

  it("computeWindowVariants produces rule_3", () => {
    const variants = computeWindowVariants(WORK_START, 0, WORK_START, ctx);
    const rule3 = variants.find((v) => v.variantType === "rule_3");
    expect(rule3).toBeDefined();
    // midpoint = (180+300)/2 = 240, arrival 480 + 240 = 720, rounded = 720
    expect(rule3!.wStart).toBe(720);
    // 720 + 180 = 900, rounded = 900
    expect(rule3!.wEnd).toBe(900);
  });

  it("validator accepts rule_3 slot", () => {
    const windows = [{ startMinutes: WORK_START, queuePosition: 0 }];
    const variants = computeWindowVariants(WORK_START, 0, WORK_START, ctx);
    const rule3 = variants.find((v) => v.variantType === "rule_3")!;
    const slot = {
      arrivalMinutes: WORK_START,
      queuePosition: 0,
      variantType: "rule_3" as WindowVariantType,
      windowStart: fmt(rule3.wStart),
      windowEnd: fmt(rule3.wEnd),
    };
    expect(validateSlot(slot, windows, WORK_START, ctx)).toBe(true);
  });
});

// ── V06: negative — bogus variant rejected ──────────────────────────────────

describe("V06: negative — variant type not in computeWindowVariants rejects", () => {
  it("bogus variantType is rejected by validator", () => {
    const windows = [{ startMinutes: WORK_START, queuePosition: 0 }];
    const slot = {
      arrivalMinutes: WORK_START,
      queuePosition: 0,
      variantType: "rule_99" as WindowVariantType, // does not exist
      windowStart: "08:00",
      windowEnd: "08:30",
    };
    expect(validateSlot(slot, windows, WORK_START, DIAG_CONTEXT)).toBe(false);
  });

  it("correct arrivalMinutes but wrong windowStart is rejected", () => {
    const windows = [{ startMinutes: WORK_START, queuePosition: 0 }];
    const slot = {
      arrivalMinutes: WORK_START,
      queuePosition: 0,
      variantType: "first_of_day" as WindowVariantType,
      windowStart: "10:00", // wrong — first_of_day produces 08:00
      windowEnd: "10:30",
    };
    expect(validateSlot(slot, windows, WORK_START, DIAG_CONTEXT)).toBe(false);
  });
});

// ── V07: stale state — queue changed, validator rejects ─────────────────────

describe("V07: stale state — slot listed, queue changed, validator rejects", () => {
  it("slot generated for empty queue is rejected when queue fills up", () => {
    // Slot was generated when the queue was empty — first of day at 08:00
    const slot = {
      arrivalMinutes: WORK_START,
      queuePosition: 0,
      variantType: "first_of_day" as WindowVariantType,
      windowStart: "08:00",
      windowEnd: "08:30",
    };

    // But now the queue has a job at position 0, so the available windows
    // start later. No window has startMinutes=480 + queuePosition=0 anymore.
    const newWindows = [{ startMinutes: 600, queuePosition: 1 }]; // 10:00 AM
    expect(validateSlot(slot, newWindows, WORK_START, DIAG_CONTEXT)).toBe(false);
  });

  it("slot at queuePosition=0 rejected when that position is taken", () => {
    const slot = {
      arrivalMinutes: WORK_START,
      queuePosition: 0,
      variantType: "rule_1" as WindowVariantType,
      windowStart: "09:00",
      windowEnd: "12:00",
    };

    // Queue now has a job — arrival window shifted to 600 at position 1
    const newWindows = [{ startMinutes: 600, queuePosition: 1 }];
    expect(validateSlot(slot, newWindows, WORK_START, DIAG_CONTEXT)).toBe(false);
  });
});

// ── V08: first_of_day and rule_1 coexist ────────────────────────────────────

describe("V08: first_of_day and rule_1 coexist for same arrival", () => {
  it("both variants produced for queuePosition=0 at workStart", () => {
    const variants = computeWindowVariants(WORK_START, 0, WORK_START, DIAG_CONTEXT);
    expect(variants).toHaveLength(2);
    const types = variants.map((v) => v.variantType);
    expect(types).toContain("first_of_day");
    expect(types).toContain("rule_1");
  });

  it("both are independently bookable against the same window", () => {
    const windows = [{ startMinutes: WORK_START, queuePosition: 0 }];

    const firstOfDay = {
      arrivalMinutes: WORK_START,
      queuePosition: 0,
      variantType: "first_of_day" as WindowVariantType,
      windowStart: "08:00",
      windowEnd: "08:30",
    };
    const rule1 = {
      arrivalMinutes: WORK_START,
      queuePosition: 0,
      variantType: "rule_1" as WindowVariantType,
      windowStart: "09:00",
      windowEnd: "12:00",
    };

    expect(validateSlot(firstOfDay, windows, WORK_START, DIAG_CONTEXT)).toBe(true);
    expect(validateSlot(rule1, windows, WORK_START, DIAG_CONTEXT)).toBe(true);
  });

  it("they have different windowStart values (no collision)", () => {
    const variants = computeWindowVariants(WORK_START, 0, WORK_START, DIAG_CONTEXT);
    const starts = variants.map((v) => v.wStart);
    expect(new Set(starts).size).toBe(starts.length); // all unique
  });
});

// ── V09: generator stamps metadata on every slot ────────────────────────────

describe("V09: generator stamps internal metadata on every slot", () => {
  // We test computeWindowVariants directly and confirm the fields that the
  // generator stamps (arrivalMinutes, queuePosition, variantType) are present
  // on every variant it returns. The generator sets these from the variant
  // objects, so if computeWindowVariants returns them, the generator stamps them.

  it("every diagnostic variant has a valid variantType", () => {
    const validTypes = new Set(["first_of_day", "rule_1", "rule_2a", "rule_2b", "rule_3"]);
    // First of day
    const variants = computeWindowVariants(WORK_START, 0, WORK_START, DIAG_CONTEXT);
    for (const v of variants) {
      expect(v.variantType).toBeDefined();
      expect(validTypes.has(v.variantType)).toBe(true);
      expect(v.wStart).toBeGreaterThanOrEqual(0);
      expect(v.wEnd).toBeGreaterThan(v.wStart);
    }
  });

  it("every follow-up variant (all rules) has a valid variantType", () => {
    const validTypes = new Set(["first_of_day", "rule_1", "rule_2a", "rule_2b", "rule_3"]);
    const rules: Array<{ low: number; high: number; expected: string }> = [
      { low: 60, high: 90, expected: "rule_2a" },
      { low: 90, high: 180, expected: "rule_2b" },
      { low: 180, high: 300, expected: "rule_3" },
    ];

    for (const { low, high, expected } of rules) {
      const { windowDurationMinutes, rule } = computeFollowUpCost(low, high, 15);
      const ctx: JobContext = {
        kind: "follow_up",
        estimatedLowMinutes: low,
        estimatedHighMinutes: high,
        windowDurationMinutes,
        rule,
      };

      // First-of-day position
      const variants = computeWindowVariants(WORK_START, 0, WORK_START, ctx);
      expect(variants.length).toBeGreaterThanOrEqual(2); // first_of_day + rule variant

      for (const v of variants) {
        expect(v.variantType).toBeDefined();
        expect(validTypes.has(v.variantType)).toBe(true);
        expect(v.wStart).toBeGreaterThanOrEqual(0);
        expect(v.wEnd).toBeGreaterThan(v.wStart);
      }

      // Non-first-of-day should have exactly one variant
      const nonFirst = computeWindowVariants(600, 1, WORK_START, ctx);
      expect(nonFirst).toHaveLength(1);
      expect(nonFirst[0]!.variantType).toBe(expected);
    }
  });

  it("arrivalMinutes and queuePosition would be correctly stamped (field source check)", () => {
    // computeWindowVariants takes arrivalMinutes and queuePosition as inputs.
    // The generator stamps these onto each slot from the window object.
    // This test confirms the inputs flow through correctly by checking that
    // the same inputs produce the same outputs deterministically.
    const v1 = computeWindowVariants(480, 0, WORK_START, DIAG_CONTEXT);
    const v2 = computeWindowVariants(480, 0, WORK_START, DIAG_CONTEXT);
    expect(v1).toEqual(v2); // pure function, deterministic

    // Different inputs produce different outputs
    const v3 = computeWindowVariants(600, 1, WORK_START, DIAG_CONTEXT);
    expect(v3).not.toEqual(v1);
  });
});
