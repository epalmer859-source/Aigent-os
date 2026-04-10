// ============================================================
// src/engine/scheduling/duration-intelligence.ts
//
// DURATION INTELLIGENCE — SERVICE TYPE CLASSIFICATION & DURATION MATH
//
// Handles:
//   - Symptom-based service type classification (deterministic)
//   - Two-tier duration fallback (classified vs unknown)
//   - Property type variant duration selection
//   - Tech on-site estimate recalculation
//   - Estimate timeout handling (soft gate)
//   - Classification logging for V1 analytics
//
// AI classifies. Code calculates. Tech confirms.
// ============================================================

import {
  calculateJobCost,
  applyVolatilityAndRound,
  type VolatilityTier,
  type JobCost,
} from "./capacity-math";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PropertyType = "residential" | "commercial" | "multi_unit";

export interface ServiceTypeRecord {
  id: string;
  name: string;
  industry: string;
  baseDurationMinutes: number;
  volatilityTier: VolatilityTier;
  symptomPhrases: string[];
  propertyTypeVariants?: Partial<Record<PropertyType, number>>;
}

export interface ClassificationResult {
  serviceType: ServiceTypeRecord;
  matchedPhrases: string[];
}

export interface OnSiteEstimateResult {
  oldCost: JobCost;
  newCost: JobCost;
  deltaMinutes: number;
}

export interface EstimateTimeoutResult {
  timedOut: true;
  usingBookedDuration: true;
}

export interface ClassificationLogEntry {
  matched: boolean;
  aiType: string;
  techType: string;
}

export interface CurrentJobForEstimate {
  bookedDurationMinutes: number;
  driveTimeMinutes: number;
  volatilityTier: VolatilityTier;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const VOLATILITY_RANK: Record<VolatilityTier, number> = {
  LOW: 0,
  MEDIUM: 1,
  HIGH: 2,
};

// ── 1. classifyServiceType ────────────────────────────────────────────────────

export function classifyServiceType(
  description: string,
  industry: string,
  serviceTypes: ServiceTypeRecord[],
): ClassificationResult | null {
  if (!description || !description.trim()) return null;

  const descLower = description.toLowerCase();
  const candidates = serviceTypes.filter((st) => st.industry === industry);

  let bestResult: ClassificationResult | null = null;
  let bestMatchCount = 0;
  let bestLongestPhrase = 0;

  for (const st of candidates) {
    const matched: string[] = [];
    let longestLen = 0;

    for (const phrase of st.symptomPhrases) {
      if (descLower.includes(phrase.toLowerCase())) {
        matched.push(phrase);
        if (phrase.length > longestLen) longestLen = phrase.length;
      }
    }

    if (matched.length === 0) continue;

    // Tie-break: most matched phrases → longest phrase → first in input order
    if (
      matched.length > bestMatchCount ||
      (matched.length === bestMatchCount && longestLen > bestLongestPhrase)
    ) {
      bestResult = { serviceType: st, matchedPhrases: matched };
      bestMatchCount = matched.length;
      bestLongestPhrase = longestLen;
    }
  }

  return bestResult;
}

// ── 2. getBookedDuration ──────────────────────────────────────────────────────

export function getBookedDuration(
  serviceType: ServiceTypeRecord,
  propertyType: PropertyType | null,
  driveTimeMinutes: number,
): JobCost {
  let baseDuration = serviceType.baseDurationMinutes;

  if (propertyType && serviceType.propertyTypeVariants?.[propertyType] != null) {
    baseDuration = serviceType.propertyTypeVariants[propertyType]!;
  }

  return calculateJobCost(baseDuration, serviceType.volatilityTier, driveTimeMinutes);
}

// ── 3. getUnknownTierDuration ─────────────────────────────────────────────────

export function getUnknownTierDuration(
  serviceTypes: ServiceTypeRecord[],
  driveTimeMinutes: number,
): JobCost {
  if (serviceTypes.length === 0) {
    return calculateJobCost(0, "HIGH", driveTimeMinutes);
  }

  let longestDuration = 0;
  let highestTier: VolatilityTier = "LOW";

  for (const st of serviceTypes) {
    if (st.baseDurationMinutes > longestDuration) {
      longestDuration = st.baseDurationMinutes;
    }
    if (VOLATILITY_RANK[st.volatilityTier] > VOLATILITY_RANK[highestTier]) {
      highestTier = st.volatilityTier;
    }
  }

  return calculateJobCost(longestDuration, highestTier, driveTimeMinutes);
}

// ── 4. processOnSiteEstimate ──────────────────────────────────────────────────

export function processOnSiteEstimate(
  currentJob: CurrentJobForEstimate,
  techEstimateMinutes: number,
  driveTimeMinutes: number,
): OnSiteEstimateResult {
  // Old cost: what was previously booked (already has owner floor + volatility applied)
  const oldCost: JobCost = {
    bookedDurationMinutes: currentJob.bookedDurationMinutes,
    driveTimeMinutes: currentJob.driveTimeMinutes,
    totalCostMinutes: currentJob.bookedDurationMinutes + currentJob.driveTimeMinutes,
  };

  // New cost: tech estimate — NO 1.3x owner floor, but volatility buffer + round to 5
  const newCost = applyVolatilityAndRound(
    techEstimateMinutes,
    currentJob.volatilityTier,
    driveTimeMinutes,
  );

  return {
    oldCost,
    newCost,
    deltaMinutes: newCost.totalCostMinutes - oldCost.totalCostMinutes,
  };
}

// ── 5. handleEstimateTimeout ──────────────────────────────────────────────────

export function handleEstimateTimeout(): EstimateTimeoutResult {
  return { timedOut: true, usingBookedDuration: true };
}

// ── 6. logClassificationResult ────────────────────────────────────────────────

export function logClassificationResult(
  aiClassifiedType: string,
  techConfirmedType: string,
): ClassificationLogEntry {
  return {
    matched: aiClassifiedType === techConfirmedType,
    aiType: aiClassifiedType,
    techType: techConfirmedType,
  };
}
