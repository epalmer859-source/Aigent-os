// ============================================================
// Tests for src/engine/scheduling/send-time-verify.ts (H1)
// ============================================================

import { describe, it, expect } from "vitest";
import {
  verifySendTimeState,
  VALID_STATES_FOR_PURPOSE,
  type SendTimeVerifyDb,
} from "../send-time-verify";
import type { SchedulingJobStatus } from "../scheduling-state-machine";
import type { SchedulingMessagePurpose } from "../communication-wiring";

// ── Test helper ──────────────────────────────────────────────────────────────

function makeDb(status: SchedulingJobStatus | null): SendTimeVerifyDb {
  return {
    async getJobStatus() {
      return status;
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("verifySendTimeState", () => {
  it("allows scheduling_confirmation when job is NOT_STARTED", async () => {
    const result = await verifySendTimeState("job-1", "scheduling_confirmation", makeDb("NOT_STARTED"));
    expect(result.shouldSend).toBe(true);
  });

  it("blocks scheduling_confirmation when job is COMPLETED", async () => {
    const result = await verifySendTimeState("job-1", "scheduling_confirmation", makeDb("COMPLETED"));
    expect(result.shouldSend).toBe(false);
    expect(result.reason).toBe("state_mismatch");
    expect(result.currentStatus).toBe("COMPLETED");
  });

  it("blocks scheduling_en_route when job is COMPLETED", async () => {
    const result = await verifySendTimeState("job-1", "scheduling_en_route", makeDb("COMPLETED"));
    expect(result.shouldSend).toBe(false);
    expect(result.reason).toBe("state_mismatch");
  });

  it("allows scheduling_en_route when job is EN_ROUTE", async () => {
    const result = await verifySendTimeState("job-1", "scheduling_en_route", makeDb("EN_ROUTE"));
    expect(result.shouldSend).toBe(true);
  });

  it("blocks scheduling_morning_reminder when job is CANCELED", async () => {
    const result = await verifySendTimeState("job-1", "scheduling_morning_reminder", makeDb("CANCELED"));
    expect(result.shouldSend).toBe(false);
    expect(result.reason).toBe("state_mismatch");
  });

  it("allows scheduling_morning_reminder when job is NOT_STARTED", async () => {
    const result = await verifySendTimeState("job-1", "scheduling_morning_reminder", makeDb("NOT_STARTED"));
    expect(result.shouldSend).toBe(true);
  });

  it("allows scheduling_completion when job is COMPLETED", async () => {
    const result = await verifySendTimeState("job-1", "scheduling_completion", makeDb("COMPLETED"));
    expect(result.shouldSend).toBe(true);
  });

  it("blocks scheduling_completion when job is NOT_STARTED", async () => {
    const result = await verifySendTimeState("job-1", "scheduling_completion", makeDb("NOT_STARTED"));
    expect(result.shouldSend).toBe(false);
    expect(result.reason).toBe("state_mismatch");
  });

  it("returns job_not_found when job doesn't exist", async () => {
    const result = await verifySendTimeState("missing-job", "scheduling_confirmation", makeDb(null));
    expect(result.shouldSend).toBe(false);
    expect(result.reason).toBe("job_not_found");
  });

  it("allows scheduling_delay_notice for NOT_STARTED and EN_ROUTE", async () => {
    const r1 = await verifySendTimeState("j", "scheduling_delay_notice", makeDb("NOT_STARTED"));
    expect(r1.shouldSend).toBe(true);

    const r2 = await verifySendTimeState("j", "scheduling_delay_notice", makeDb("EN_ROUTE"));
    expect(r2.shouldSend).toBe(true);
  });

  it("blocks scheduling_delay_notice for IN_PROGRESS", async () => {
    const result = await verifySendTimeState("j", "scheduling_delay_notice", makeDb("IN_PROGRESS"));
    expect(result.shouldSend).toBe(false);
  });

  it("allows scheduling_tech_estimate_prompt for active states", async () => {
    for (const status of ["EN_ROUTE", "ARRIVED", "IN_PROGRESS"] as SchedulingJobStatus[]) {
      const result = await verifySendTimeState("j", "scheduling_tech_estimate_prompt", makeDb(status));
      expect(result.shouldSend).toBe(true);
    }
  });

  it("allows scheduling_completion_note_prompt for COMPLETED and INCOMPLETE", async () => {
    for (const status of ["COMPLETED", "INCOMPLETE"] as SchedulingJobStatus[]) {
      const result = await verifySendTimeState("j", "scheduling_completion_note_prompt", makeDb(status));
      expect(result.shouldSend).toBe(true);
    }
  });
});

describe("VALID_STATES_FOR_PURPOSE", () => {
  it("has an entry for every scheduling message purpose", () => {
    const allPurposes: SchedulingMessagePurpose[] = [
      "scheduling_confirmation",
      "scheduling_morning_reminder",
      "scheduling_en_route",
      "scheduling_completion",
      "scheduling_delay_notice",
      "scheduling_window_change",
      "scheduling_rebook_notice",
      "scheduling_pull_forward_offer",
      "scheduling_pull_forward_accepted",
      "scheduling_tech_estimate_prompt",
      "scheduling_completion_note_prompt",
      "scheduling_sick_tech_notice",
    ];

    for (const purpose of allPurposes) {
      expect(VALID_STATES_FOR_PURPOSE[purpose]).toBeDefined();
      expect(VALID_STATES_FOR_PURPOSE[purpose].size).toBeGreaterThan(0);
    }
  });
});
