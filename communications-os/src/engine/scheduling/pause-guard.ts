// ============================================================
// src/engine/scheduling/pause-guard.ts
//
// H8: PAUSE MODE ENFORCEMENT
//
// Shared guard that automated scheduling modifiers must call
// before making any changes. When the business is paused or
// resync_pending, automated operations are blocked.
//
// Manual operations (arrangeJobManually, owner actions) bypass
// this guard — they are explicitly allowed during pause.
//
// Deterministic. No AI.
// ============================================================

import type { SchedulingMode } from "./pause-manual-controls";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PauseGuardDb {
  getSchedulingMode(businessId: string): Promise<{ mode: SchedulingMode }>;
}

export type PauseGuardResult =
  | { allowed: true }
  | { allowed: false; reason: "scheduling_paused" | "resync_pending"; mode: SchedulingMode };

// ── Guard function ──────────────────────────────────────────────────────────

/**
 * Check if automated scheduling operations are allowed for a business.
 *
 * Returns { allowed: false } when mode is "paused" or "resync_pending".
 * Only "active" mode permits automated changes.
 *
 * Call sites:
 *   - rebook-cascade.redistributeSickTechJobs
 *   - gap-fill.createPullForwardOffer / acceptPullForward
 *   - inter-tech-transfer.evaluateTransfer / executeTransfer
 *   - booking-orchestrator.bookJob
 *   - scheduling-workers (morning reminder, end-of-day sweep)
 */
export async function checkPauseGuard(
  businessId: string,
  db: PauseGuardDb,
): Promise<PauseGuardResult> {
  const state = await db.getSchedulingMode(businessId);

  if (state.mode === "active") {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: state.mode === "paused" ? "scheduling_paused" : "resync_pending",
    mode: state.mode,
  };
}
