// ============================================================
// Duration Intelligence — Tests
//
// Every test traces to a rule in unified-scheduling-spec.md.
// No DB calls. Pure function tests.
// ============================================================

import { describe, it, expect } from "vitest";
import {
  classifyServiceType,
  getBookedDuration,
  getUnknownTierDuration,
  processOnSiteEstimate,
  handleEstimateTimeout,
  logClassificationResult,
  type ServiceTypeRecord,
} from "../duration-intelligence";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const HVAC_NOT_COOLING: ServiceTypeRecord = {
  id: "st-1",
  name: "HVAC — Not Cooling",
  industry: "hvac",
  baseDurationMinutes: 60,
  volatilityTier: "HIGH",
  symptomPhrases: ["not cooling", "won't cool", "warm air", "no cold air"],
  propertyTypeVariants: {
    residential: 60,
    commercial: 90,
  },
};

const HVAC_NO_POWER: ServiceTypeRecord = {
  id: "st-2",
  name: "HVAC — No Power",
  industry: "hvac",
  baseDurationMinutes: 45,
  volatilityTier: "HIGH",
  symptomPhrases: ["won't turn on", "no power", "keeps tripping", "dead"],
};

const HVAC_WATER_LEAK: ServiceTypeRecord = {
  id: "st-3",
  name: "HVAC — Water Leak",
  industry: "hvac",
  baseDurationMinutes: 50,
  volatilityTier: "MEDIUM",
  symptomPhrases: ["leaking water", "water leak", "dripping"],
};

const LOCKSMITH_LOCKOUT: ServiceTypeRecord = {
  id: "st-4",
  name: "Lockout Service",
  industry: "locksmith",
  baseDurationMinutes: 30,
  volatilityTier: "LOW",
  symptomPhrases: ["locked out", "can't get in", "lost my keys", "keys inside"],
};

const CARPET_BASIC: ServiceTypeRecord = {
  id: "st-5",
  name: "Carpet Cleaning — Standard",
  industry: "carpet_cleaning",
  baseDurationMinutes: 45,
  volatilityTier: "LOW",
  symptomPhrases: ["carpet cleaning", "clean my carpets", "stain removal"],
  propertyTypeVariants: {
    residential: 45,
    commercial: 120,
    multi_unit: 180,
  },
};

const ALL_HVAC = [HVAC_NOT_COOLING, HVAC_NO_POWER, HVAC_WATER_LEAK];
const ALL_TYPES = [...ALL_HVAC, LOCKSMITH_LOCKOUT, CARPET_BASIC];

// ── classifyServiceType ───────────────────────────────────────────────────────

describe("classifyServiceType", () => {
  it("exact phrase match returns correct service type", () => {
    const result = classifyServiceType("not cooling", "hvac", ALL_HVAC);
    expect(result).not.toBeNull();
    expect(result!.serviceType.id).toBe("st-1");
    expect(result!.matchedPhrases).toContain("not cooling");
  });

  it("partial/substring match works", () => {
    const result = classifyServiceType(
      "My AC unit is not cooling the house at all",
      "hvac",
      ALL_HVAC,
    );
    expect(result).not.toBeNull();
    expect(result!.serviceType.id).toBe("st-1");
  });

  it("case-insensitive matching works", () => {
    const result = classifyServiceType("WON'T TURN ON", "hvac", ALL_HVAC);
    expect(result).not.toBeNull();
    expect(result!.serviceType.id).toBe("st-2");
  });

  it("no match returns null", () => {
    const result = classifyServiceType("making a weird noise", "hvac", ALL_HVAC);
    expect(result).toBeNull();
  });

  it("multiple phrases per service type: any match counts", () => {
    const result = classifyServiceType("keeps tripping the breaker", "hvac", ALL_HVAC);
    expect(result).not.toBeNull();
    expect(result!.serviceType.id).toBe("st-2");
    expect(result!.matchedPhrases).toContain("keeps tripping");
  });

  it("empty description returns null", () => {
    expect(classifyServiceType("", "hvac", ALL_HVAC)).toBeNull();
    expect(classifyServiceType("   ", "hvac", ALL_HVAC)).toBeNull();
  });

  it("only considers service types for the given industry", () => {
    // "locked out" matches locksmith but we're searching hvac
    const result = classifyServiceType("locked out", "hvac", ALL_TYPES);
    expect(result).toBeNull();
  });

  describe("deterministic tie-break", () => {
    it("most matched phrases wins", () => {
      // Description matches TWO phrases for not-cooling, ONE for no-power
      const result = classifyServiceType(
        "my unit won't cool and there's warm air",
        "hvac",
        ALL_HVAC,
      );
      expect(result).not.toBeNull();
      expect(result!.serviceType.id).toBe("st-1"); // 2 matches beats 0
      expect(result!.matchedPhrases.length).toBe(2);
    });

    it("longest phrase breaks tie when match counts are equal", () => {
      // Create two types with one match each but different phrase lengths
      const typeShort: ServiceTypeRecord = {
        ...HVAC_NOT_COOLING,
        id: "short",
        symptomPhrases: ["broken"],
      };
      const typeLong: ServiceTypeRecord = {
        ...HVAC_NO_POWER,
        id: "long",
        symptomPhrases: ["system is broken"],
      };

      const result = classifyServiceType(
        "my system is broken",
        "hvac",
        [typeShort, typeLong],
      );
      expect(result).not.toBeNull();
      expect(result!.serviceType.id).toBe("long"); // longer phrase wins
    });

    it("first in input order breaks remaining ties", () => {
      const typeA: ServiceTypeRecord = {
        ...HVAC_NOT_COOLING,
        id: "type-a",
        symptomPhrases: ["broken"],
      };
      const typeB: ServiceTypeRecord = {
        ...HVAC_NO_POWER,
        id: "type-b",
        symptomPhrases: ["broken"],
      };

      const result = classifyServiceType("broken", "hvac", [typeA, typeB]);
      expect(result).not.toBeNull();
      expect(result!.serviceType.id).toBe("type-a"); // first in array
    });
  });
});

// ── getBookedDuration ─────────────────────────────────────────────────────────

describe("getBookedDuration", () => {
  it("uses property type variant when available", () => {
    // commercial variant = 90 min for HVAC not cooling
    const result = getBookedDuration(HVAC_NOT_COOLING, "commercial", 15);

    // 90 × 1.3 = 117 → not under 30 → × 1.6 (HIGH) = 187.2 → ceilTo5 = 190
    expect(result.bookedDurationMinutes).toBe(190);
    expect(result.driveTimeMinutes).toBe(15);
    expect(result.totalCostMinutes).toBe(205);
  });

  it("falls back to base duration when no variant exists", () => {
    // HVAC no power has no propertyTypeVariants
    const result = getBookedDuration(HVAC_NO_POWER, "residential", 10);

    // 45 × 1.3 = 58.5 → not under 30 → × 1.6 (HIGH) = 93.6 → ceilTo5 = 95
    expect(result.bookedDurationMinutes).toBe(95);
    expect(result.totalCostMinutes).toBe(105);
  });

  it("falls back to base when property type not in variants", () => {
    // HVAC not cooling has residential + commercial, but not multi_unit
    const result = getBookedDuration(HVAC_NOT_COOLING, "multi_unit", 0);

    // base = 60 × 1.3 = 78 → × 1.6 = 124.8 → ceilTo5 = 125
    expect(result.bookedDurationMinutes).toBe(125);
  });

  it("uses residential variant for carpet cleaning", () => {
    // residential = 45 min, LOW volatility
    const result = getBookedDuration(CARPET_BASIC, "residential", 20);

    // 45 × 1.3 = 58.5 → × 1.2 (LOW) = 70.2 → ceilTo5 = 75
    expect(result.bookedDurationMinutes).toBe(75);
    expect(result.totalCostMinutes).toBe(95);
  });

  it("uses null property type → base duration", () => {
    const result = getBookedDuration(HVAC_NOT_COOLING, null, 10);

    // base = 60 × 1.3 = 78 → × 1.6 = 124.8 → ceilTo5 = 125
    expect(result.bookedDurationMinutes).toBe(125);
    expect(result.totalCostMinutes).toBe(135);
  });

  it("drive time included in total cost", () => {
    const withDrive = getBookedDuration(LOCKSMITH_LOCKOUT, null, 25);
    const noDrive = getBookedDuration(LOCKSMITH_LOCKOUT, null, 0);

    expect(withDrive.totalCostMinutes).toBe(noDrive.totalCostMinutes + 25);
  });
});

// ── getUnknownTierDuration ────────────────────────────────────────────────────

describe("getUnknownTierDuration", () => {
  it("picks longest duration across service types", () => {
    // Longest: HVAC not cooling = 60 min
    const result = getUnknownTierDuration(ALL_HVAC, 10);

    // 60 × 1.3 = 78 → × 1.6 (HIGH) = 124.8 → ceilTo5 = 125
    expect(result.bookedDurationMinutes).toBe(125);
  });

  it("picks highest volatility tier", () => {
    // Mix of LOW and HIGH — should use HIGH
    const result = getUnknownTierDuration([LOCKSMITH_LOCKOUT, HVAC_NOT_COOLING], 0);

    // 60 (longest) × 1.3 = 78 → × 1.6 (HIGH) = 124.8 → 125
    expect(result.bookedDurationMinutes).toBe(125);
  });

  it("returns conservative JobCost", () => {
    // With only LOW tier types
    const lowTypes = [LOCKSMITH_LOCKOUT, CARPET_BASIC];
    const result = getUnknownTierDuration(lowTypes, 15);

    // Longest = 45 (carpet), LOW tier
    // 45 × 1.3 = 58.5 → × 1.2 = 70.2 → ceilTo5 = 75
    expect(result.bookedDurationMinutes).toBe(75);
    expect(result.totalCostMinutes).toBe(90);
  });

  it("handles empty service types array", () => {
    const result = getUnknownTierDuration([], 10);
    // 0 × 1.3 = 0 → under 30 → floor 45 → × 1.6 (HIGH) = 72 → ceilTo5 = 75
    expect(result.bookedDurationMinutes).toBe(75);
    expect(result.totalCostMinutes).toBe(85);
  });
});

// ── processOnSiteEstimate ─────────────────────────────────────────────────────

describe("processOnSiteEstimate", () => {
  it("does NOT apply 1.3x owner floor", () => {
    // Tech says 60 min, HIGH volatility
    // If owner floor applied: 60 × 1.3 = 78 → × 1.6 = 124.8 → 125
    // Without owner floor: 60 × 1.6 = 96 → ceilTo5 = 100
    const result = processOnSiteEstimate(
      { bookedDurationMinutes: 125, driveTimeMinutes: 10, volatilityTier: "HIGH" },
      60,
      10,
    );

    expect(result.newCost.bookedDurationMinutes).toBe(100); // NOT 125
  });

  it("DOES apply volatility buffer and rounding", () => {
    // Tech says 40 min, MEDIUM volatility
    // 40 × 1.4 = 56 → ceilTo5 = 60
    const result = processOnSiteEstimate(
      { bookedDurationMinutes: 85, driveTimeMinutes: 15, volatilityTier: "MEDIUM" },
      40,
      15,
    );

    expect(result.newCost.bookedDurationMinutes).toBe(60);
    expect(result.newCost.totalCostMinutes).toBe(75);
  });

  it("returns correct delta between old and new cost", () => {
    const result = processOnSiteEstimate(
      { bookedDurationMinutes: 95, driveTimeMinutes: 10, volatilityTier: "HIGH" },
      60,
      10,
    );

    // old total = 95 + 10 = 105
    // new: 60 × 1.6 = 96 → ceilTo5 = 100, total = 110
    expect(result.oldCost.totalCostMinutes).toBe(105);
    expect(result.newCost.totalCostMinutes).toBe(110);
    expect(result.deltaMinutes).toBe(5);
  });

  it("shorter estimate gives negative delta", () => {
    const result = processOnSiteEstimate(
      { bookedDurationMinutes: 125, driveTimeMinutes: 15, volatilityTier: "HIGH" },
      30,
      15,
    );

    // old total = 125 + 15 = 140
    // new: 30 × 1.6 = 48 → ceilTo5 = 50, total = 65
    expect(result.deltaMinutes).toBe(65 - 140);
    expect(result.deltaMinutes).toBeLessThan(0);
  });

  it("longer estimate gives positive delta", () => {
    const result = processOnSiteEstimate(
      { bookedDurationMinutes: 55, driveTimeMinutes: 10, volatilityTier: "LOW" },
      90,
      10,
    );

    // old total = 55 + 10 = 65
    // new: 90 × 1.2 = 108 → ceilTo5 = 110, total = 120
    expect(result.deltaMinutes).toBe(120 - 65);
    expect(result.deltaMinutes).toBeGreaterThan(0);
  });
});

// ── handleEstimateTimeout ─────────────────────────────────────────────────────

describe("handleEstimateTimeout", () => {
  it("returns timedOut true", () => {
    const result = handleEstimateTimeout();
    expect(result.timedOut).toBe(true);
  });

  it("returns usingBookedDuration true", () => {
    const result = handleEstimateTimeout();
    expect(result.usingBookedDuration).toBe(true);
  });

  it("does not calculate a replacement cost (marker function only)", () => {
    const result = handleEstimateTimeout();
    // Only has two fields — no cost/duration fields
    expect(Object.keys(result)).toEqual(["timedOut", "usingBookedDuration"]);
  });
});

// ── logClassificationResult ───────────────────────────────────────────────────

describe("logClassificationResult", () => {
  it("matched true when AI and tech agree", () => {
    const result = logClassificationResult("HVAC — Not Cooling", "HVAC — Not Cooling");
    expect(result.matched).toBe(true);
    expect(result.aiType).toBe("HVAC — Not Cooling");
    expect(result.techType).toBe("HVAC — Not Cooling");
  });

  it("matched false when they differ", () => {
    const result = logClassificationResult("HVAC — Not Cooling", "HVAC — No Power");
    expect(result.matched).toBe(false);
    expect(result.aiType).toBe("HVAC — Not Cooling");
    expect(result.techType).toBe("HVAC — No Power");
  });
});
