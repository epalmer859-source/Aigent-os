// ============================================================
// src/engine/scheduling/drift-tracker.ts
//
// DRIFT TRACKER — DISRUPTION THRESHOLDS & CUMULATIVE DRIFT
//
// Pure functions. No DB. No side effects.
//
// Per-job thresholds:
//   < 15 min  → silent
//   15–45 min → internal_update
//   > 45 min  → communicate_customer
//
// Cumulative threshold:

//   ≥ 30 min absolute → full_recalculation
//
// Window boundary crossing:
//   Lunch start = morning/afternoon divider.
//   If a job's projected start crosses that line vs its
//   original window, flag it.
// ============================================================

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DriftRecord {
  jobId: string;
  estimatedDurationMinutes: number;
  actualDurationMinutes: number;
  driftMinutes: number;
}

export interface CumulativeDrift {
  totalDriftMinutes: number;
  jobDrifts: DriftRecord[];
}

export type DriftAction =
  | { action: "silent" }
  | { action: "internal_update" }
  | { action: "communicate_customer"; reason: string }
  | { action: "full_recalculation"; reason: string };

export interface WindowBoundary {
  crossed: boolean;
  fromWindow: "morning" | "afternoon";
  toWindow: "morning" | "afternoon";
}

export interface RecalculationTrigger {
  triggered: boolean;
  reason?: "cumulative_drift_exceeded";
  cumulativeDriftMinutes: number;
}

export interface DriftEvaluation {
  jobId: string;
  action: "silent" | "internal_update" | "communicate_customer" | "full_recalculation";
  reason?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export interface OriginalWindow {
  windowStart: number; // minutes from midnight
  windowEnd: number;   // minutes from midnight
}

// ── 1. recordJobDrift ─────────────────────────────────────────────────────────

export function recordJobDrift(
  jobId: string,
  estimatedMinutes: number,
  actualMinutes: number,
): DriftRecord {
  return {
    jobId,
    estimatedDurationMinutes: estimatedMinutes,
    actualDurationMinutes: actualMinutes,
    driftMinutes: actualMinutes - estimatedMinutes,
  };
}

// ── 2. getCumulativeDrift ─────────────────────────────────────────────────────

export function getCumulativeDrift(driftRecords: DriftRecord[]): CumulativeDrift {
  const totalDriftMinutes = driftRecords.reduce(
    (sum, r) => sum + r.driftMinutes,
    0,
  );

  return {
    totalDriftMinutes,
    jobDrifts: driftRecords,
  };
}

// ── 3. evaluatePerJobDrift ────────────────────────────────────────────────────

export function evaluatePerJobDrift(driftMinutes: number): DriftAction {
  const abs = Math.abs(driftMinutes);

  if (abs < 15) {
    return { action: "silent" };
  }
  if (abs <= 45) {
    return { action: "internal_update" };
  }
  return { action: "communicate_customer", reason: "variance_exceeded_45min" };
}

// ── 4. evaluateCumulativeDrift ────────────────────────────────────────────────

export function evaluateCumulativeDrift(
  cumulativeDriftMinutes: number,
): RecalculationTrigger {
  const abs = Math.abs(cumulativeDriftMinutes);

  if (abs >= 30) {
    return {
      triggered: true,
      reason: "cumulative_drift_exceeded",
      cumulativeDriftMinutes,
    };
  }

  return {
    triggered: false,
    cumulativeDriftMinutes,
  };
}

// ── 5. checkWindowBoundaryCrossing ────────────────────────────────────────────

export function checkWindowBoundaryCrossing(
  originalWindowStart: number,
  originalWindowEnd: number,
  projectedStartMinutes: number,
  lunchStartMinutes: number,
): WindowBoundary {
  // Morning job pushed into afternoon
  if (originalWindowEnd <= lunchStartMinutes && projectedStartMinutes >= lunchStartMinutes) {
    return { crossed: true, fromWindow: "morning", toWindow: "afternoon" };
  }

  // Afternoon job pulled into morning
  if (originalWindowStart >= lunchStartMinutes && projectedStartMinutes < lunchStartMinutes) {
    return { crossed: true, fromWindow: "afternoon", toWindow: "morning" };
  }

  return { crossed: false, fromWindow: "morning", toWindow: "morning" };
}

// ── 6. evaluateFullDrift ──────────────────────────────────────────────────────

export function evaluateFullDrift(
  driftRecords: DriftRecord[],
  projectedStarts: number[],
  originalWindows: OriginalWindow[],
  lunchStartMinutes: number,
): DriftEvaluation[] {
  const cumulative = getCumulativeDrift(driftRecords);
  const cumulativeTrigger = evaluateCumulativeDrift(cumulative.totalDriftMinutes);

  const evaluations: DriftEvaluation[] = [];

  for (let i = 0; i < driftRecords.length; i++) {
    const record = driftRecords[i]!;
    const projectedStart = projectedStarts[i]!;
    const window = originalWindows[i]!;

    // Per-job drift
    const perJobAction = evaluatePerJobDrift(record.driftMinutes);

    // Window boundary
    const boundary = checkWindowBoundaryCrossing(
      window.windowStart,
      window.windowEnd,
      projectedStart,
      lunchStartMinutes,
    );

    // Severity order: full_recalculation > communicate_customer > internal_update > silent
    // Cumulative drift overrides everything
    if (cumulativeTrigger.triggered) {
      evaluations.push({
        jobId: record.jobId,
        action: "full_recalculation",
        reason: "cumulative_drift_exceeded",
      });
      continue;
    }

    // Window boundary crossing → communicate_customer (if higher severity)
    if (boundary.crossed) {
      const boundaryReason = `window_crossed_${boundary.fromWindow}_to_${boundary.toWindow}`;
      // communicate_customer beats internal_update and silent
      if (perJobAction.action === "full_recalculation") {
        // Per-job can't be full_recalculation (only cumulative triggers that),
        // but handle defensively
        evaluations.push({
          jobId: record.jobId,
          action: "full_recalculation",
          reason: "reason" in perJobAction ? perJobAction.reason : undefined,
        });
      } else if (perJobAction.action === "communicate_customer") {
        // Both want communicate — keep the per-job reason
        evaluations.push({
          jobId: record.jobId,
          action: "communicate_customer",
          reason: "reason" in perJobAction ? perJobAction.reason : boundaryReason,
        });
      } else {
        // Window crossing upgrades to communicate_customer
        evaluations.push({
          jobId: record.jobId,
          action: "communicate_customer",
          reason: boundaryReason,
        });
      }
      continue;
    }

    // Default to per-job drift evaluation
    evaluations.push({
      jobId: record.jobId,
      action: perJobAction.action,
      reason: "reason" in perJobAction ? perJobAction.reason : undefined,
    });
  }

  return evaluations;
}
