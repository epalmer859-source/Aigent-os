// ============================================================
// src/engine/scheduling/tech-assignment.ts
//
// TECH ASSIGNMENT SCORING — DETERMINISTIC DISPATCH
//
// Filter pipeline: active → skill tags → capacity
// Scoring: (proximity × 0.6) + (availability × 0.4)
// Tie-breaks: fewer jobs today → closer to home → input order
//
// AI recommends. Code validates skill + capacity.
// ============================================================

import { getDriveTime, type Coordinates, type OsrmServiceDeps } from "./osrm-service";
import { checkCapacity, type CapacityDb, type TimePreference } from "./capacity-math";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TechCandidate {
  id: string;
  businessId: string;
  name: string;
  homeBaseLat: number;
  homeBaseLng: number;
  skillTags: string[];
  workingHoursStart: string;
  workingHoursEnd: string;
  lunchStart: string;
  lunchEnd: string;
  overtimeCapMinutes: number;
  isActive: boolean;
  existingJobsToday?: number;
}

export interface AssignmentInput {
  serviceTypeId: string;
  addressLat: number;
  addressLng: number;
  date: Date;
  timePreference: TimePreference;
  totalCostMinutes: number;
}

export interface QualifiedTech {
  tech: TechCandidate;
  remainingCapacityMinutes: number;
}

export interface ScoredTechInput {
  techId: string;
  techName: string;
  driveTimeMinutes: number;
  remainingCapacityMinutes: number;
  existingJobsToday: number;
}

export interface TechScore {
  techId: string;
  techName: string;
  score: number;
  proximityScore: number;
  availabilityScore: number;
  driveTimeMinutes: number;
  remainingCapacityMinutes: number;
  existingJobsToday: number;
}

export type AssignmentResult =
  | { assigned: true; tech: TechScore }
  | { assigned: false; reason: "no_qualified_techs" | "no_capacity" | "no_techs_available" };

export interface ServiceTypeCoverageInput {
  id: string;
  name: string;
}

export interface SkillWarning {
  type: "tech_has_no_tags" | "service_type_has_no_techs";
  entityId: string;
  entityName: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function techToProfile(tech: TechCandidate) {
  return {
    id: tech.id,
    businessId: tech.businessId,
    workingHoursStart: tech.workingHoursStart,
    workingHoursEnd: tech.workingHoursEnd,
    lunchStart: tech.lunchStart,
    lunchEnd: tech.lunchEnd,
    overtimeCapMinutes: tech.overtimeCapMinutes,
  };
}

// ── 1. filterQualifiedTechs ───────────────────────────────────────────────────

export async function filterQualifiedTechs(
  techs: TechCandidate[],
  assignment: AssignmentInput,
  capacityDb: CapacityDb,
): Promise<QualifiedTech[]> {
  const qualified: QualifiedTech[] = [];

  for (const tech of techs) {
    // (a) isActive must be true
    if (!tech.isActive) continue;

    // (b) skillTags must include serviceTypeId
    if (!tech.skillTags.includes(assignment.serviceTypeId)) continue;

    // (c) capacity must pass
    const cap = await checkCapacity(
      tech.id,
      assignment.date,
      assignment.totalCostMinutes,
      assignment.timePreference,
      capacityDb,
    );
    if (!cap.fits) continue;

    qualified.push({
      tech,
      remainingCapacityMinutes: cap.remainingTotal,
    });
  }

  return qualified;
}

// ── 2. scoreTech ──────────────────────────────────────────────────────────────

export async function scoreTech(
  qualifiedTech: QualifiedTech,
  assignment: AssignmentInput,
  osrmDeps?: OsrmServiceDeps,
): Promise<ScoredTechInput> {
  const { tech, remainingCapacityMinutes } = qualifiedTech;

  const homeBase: Coordinates = { lat: tech.homeBaseLat, lng: tech.homeBaseLng };
  const jobAddress: Coordinates = { lat: assignment.addressLat, lng: assignment.addressLng };

  const driveResult = await getDriveTime(homeBase, jobAddress, osrmDeps);

  return {
    techId: tech.id,
    techName: tech.name,
    driveTimeMinutes: driveResult.durationMinutes,
    remainingCapacityMinutes,
    existingJobsToday: tech.existingJobsToday ?? 0,
  };
}

// ── 3. rankTechs ──────────────────────────────────────────────────────────────

export function rankTechs(scoredTechs: ScoredTechInput[]): TechScore[] {
  if (scoredTechs.length === 0) return [];

  if (scoredTechs.length === 1) {
    const t = scoredTechs[0]!;
    return [{
      techId: t.techId,
      techName: t.techName,
      score: 1,
      proximityScore: 1,
      availabilityScore: 1,
      driveTimeMinutes: t.driveTimeMinutes,
      remainingCapacityMinutes: t.remainingCapacityMinutes,
      existingJobsToday: t.existingJobsToday,
    }];
  }

  const maxDrive = Math.max(...scoredTechs.map((t) => t.driveTimeMinutes));
  const maxCapacity = Math.max(...scoredTechs.map((t) => t.remainingCapacityMinutes));

  const scored: (TechScore & { _inputIndex: number })[] = scoredTechs.map((t, inputIndex) => {
    const proximityScore = maxDrive > 0
      ? 1 - (t.driveTimeMinutes / maxDrive)
      : 1;
    const availabilityScore = maxCapacity > 0
      ? t.remainingCapacityMinutes / maxCapacity
      : 1;
    const score = (proximityScore * 0.6) + (availabilityScore * 0.4);

    return {
      techId: t.techId,
      techName: t.techName,
      score,
      proximityScore,
      availabilityScore,
      driveTimeMinutes: t.driveTimeMinutes,
      remainingCapacityMinutes: t.remainingCapacityMinutes,
      existingJobsToday: t.existingJobsToday,
      _inputIndex: inputIndex, // for stable tie-break
    };
  });

  // Sort descending by score, then tie-breaks
  scored.sort((a, b) => {
    // Primary: highest score
    if (a.score !== b.score) return b.score - a.score;
    // Tie-break 1: fewer jobs today
    if (a.existingJobsToday !== b.existingJobsToday) return a.existingJobsToday - b.existingJobsToday;
    // Tie-break 2: lower drive time (closer to home base)
    if (a.driveTimeMinutes !== b.driveTimeMinutes) return a.driveTimeMinutes - b.driveTimeMinutes;
    // Tie-break 3: input order
    return (a as unknown as { _inputIndex: number })._inputIndex - (b as unknown as { _inputIndex: number })._inputIndex;
  });

  // Strip internal index
  return scored.map(({ _inputIndex, ...rest }) => rest) as TechScore[];
}

// ── 4. assignTech ─────────────────────────────────────────────────────────────

export async function assignTech(
  techs: TechCandidate[],
  assignment: AssignmentInput,
  capacityDb: CapacityDb,
  osrmDeps?: OsrmServiceDeps,
): Promise<AssignmentResult> {
  if (techs.length === 0) {
    return { assigned: false, reason: "no_techs_available" };
  }

  // Filter active + skill (without capacity check first for correct error reason)
  const activeSkilled = techs.filter(
    (t) => t.isActive && t.skillTags.includes(assignment.serviceTypeId),
  );
  if (activeSkilled.length === 0) {
    return { assigned: false, reason: "no_qualified_techs" };
  }

  // Filter by capacity
  const qualified = await filterQualifiedTechs(activeSkilled, assignment, capacityDb);
  if (qualified.length === 0) {
    return { assigned: false, reason: "no_capacity" };
  }

  // Score each
  const scored: ScoredTechInput[] = [];
  for (const qt of qualified) {
    scored.push(await scoreTech(qt, assignment, osrmDeps));
  }

  // Rank
  const ranked = rankTechs(scored);
  return { assigned: true, tech: ranked[0]! };
}

// ── 5. validateSkillCoverage ──────────────────────────────────────────────────

export function validateSkillCoverage(
  techs: TechCandidate[],
  serviceTypes: ServiceTypeCoverageInput[],
): SkillWarning[] {
  const warnings: SkillWarning[] = [];

  // Techs with zero skill tags
  for (const tech of techs) {
    if (tech.skillTags.length === 0) {
      warnings.push({
        type: "tech_has_no_tags",
        entityId: tech.id,
        entityName: tech.name,
      });
    }
  }

  // Service types with no active tech coverage
  const activeTechs = techs.filter((t) => t.isActive);
  for (const st of serviceTypes) {
    const hasCoverage = activeTechs.some((t) => t.skillTags.includes(st.id));
    if (!hasCoverage) {
      warnings.push({
        type: "service_type_has_no_techs",
        entityId: st.id,
        entityName: st.name,
      });
    }
  }

  return warnings;
}
