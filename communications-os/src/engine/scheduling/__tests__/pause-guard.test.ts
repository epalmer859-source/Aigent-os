// ============================================================
// Tests for src/engine/scheduling/pause-guard.ts (H8)
// ============================================================

import { describe, it, expect } from "vitest";
import { checkPauseGuard, type PauseGuardDb } from "../pause-guard";

function makeDb(mode: "active" | "paused" | "resync_pending"): PauseGuardDb {
  return {
    async getSchedulingMode() { return { mode }; },
  };
}

describe("checkPauseGuard", () => {
  it("allows when mode is active", async () => {
    const result = await checkPauseGuard("biz-1", makeDb("active"));
    expect(result.allowed).toBe(true);
  });

  it("blocks when mode is paused", async () => {
    const result = await checkPauseGuard("biz-1", makeDb("paused"));
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("scheduling_paused");
      expect(result.mode).toBe("paused");
    }
  });

  it("blocks when mode is resync_pending", async () => {
    const result = await checkPauseGuard("biz-1", makeDb("resync_pending"));
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toBe("resync_pending");
      expect(result.mode).toBe("resync_pending");
    }
  });
});
