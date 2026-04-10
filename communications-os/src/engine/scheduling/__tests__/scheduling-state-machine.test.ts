// ============================================================
// Scheduling State Machine — Tests
//
// Every test traces to a rule in unified-scheduling-spec.md.
// Uses in-memory stores — no real DB.
// ============================================================

import { describe, it, expect, vi } from "vitest";
import {
  isValidTransition,
  isLockedState,
  isTerminalState,
  transitionJobState,
  endOfDaySweep,
  createInMemorySchedulingDb,
  SCHEDULING_TO_CONVERSATION_MAP,
  type SchedulingJobStatus,
  type SchedulingJobRecord,
  type ConversationTransitionFn,
} from "../scheduling-state-machine";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TODAY = new Date("2026-04-08");

function makeJob(overrides: Partial<SchedulingJobRecord> = {}): SchedulingJobRecord {
  return {
    id: "job-1",
    businessId: "biz-1",
    technicianId: "tech-1",
    customerId: "cust-1",
    status: "NOT_STARTED",
    scheduledDate: TODAY,
    arrivedAt: null,
    completedAt: null,
    customerName: "Test Customer",
    ...overrides,
  };
}

/** Returns a Date that is `minutes` after the reference date. */
function minutesAfter(ref: Date, minutes: number): Date {
  return new Date(ref.getTime() + minutes * 60_000);
}

// ── isValidTransition ─────────────────────────────────────────────────────────

describe("isValidTransition", () => {
  describe("valid transitions", () => {
    it("NOT_STARTED -> EN_ROUTE", () => {
      expect(isValidTransition("NOT_STARTED", "EN_ROUTE")).toBe(true);
    });

    it("NOT_STARTED -> CANCELED", () => {
      expect(isValidTransition("NOT_STARTED", "CANCELED")).toBe(true);
    });

    it("NOT_STARTED -> NEEDS_REBOOK", () => {
      expect(isValidTransition("NOT_STARTED", "NEEDS_REBOOK")).toBe(true);
    });

    it("EN_ROUTE -> ARRIVED", () => {
      expect(isValidTransition("EN_ROUTE", "ARRIVED")).toBe(true);
    });

    it("EN_ROUTE -> NOT_STARTED (tech turned back)", () => {
      expect(isValidTransition("EN_ROUTE", "NOT_STARTED")).toBe(true);
    });

    it("ARRIVED -> IN_PROGRESS", () => {
      expect(isValidTransition("ARRIVED", "IN_PROGRESS")).toBe(true);
    });

    it("IN_PROGRESS -> COMPLETED", () => {
      expect(isValidTransition("IN_PROGRESS", "COMPLETED")).toBe(true);
    });

    it("IN_PROGRESS -> INCOMPLETE", () => {
      expect(isValidTransition("IN_PROGRESS", "INCOMPLETE")).toBe(true);
    });

    it("IN_PROGRESS -> BEYOND_SAME_DAY", () => {
      expect(isValidTransition("IN_PROGRESS", "BEYOND_SAME_DAY")).toBe(true);
    });

    it("NEEDS_REBOOK -> NOT_STARTED", () => {
      expect(isValidTransition("NEEDS_REBOOK", "NOT_STARTED")).toBe(true);
    });

    it("NEEDS_REBOOK -> CANCELED", () => {
      expect(isValidTransition("NEEDS_REBOOK", "CANCELED")).toBe(true);
    });
  });

  describe("invalid transitions", () => {
    it("NOT_STARTED -> COMPLETED", () => {
      expect(isValidTransition("NOT_STARTED", "COMPLETED")).toBe(false);
    });

    it("NOT_STARTED -> IN_PROGRESS", () => {
      expect(isValidTransition("NOT_STARTED", "IN_PROGRESS")).toBe(false);
    });

    it("EN_ROUTE -> COMPLETED", () => {
      expect(isValidTransition("EN_ROUTE", "COMPLETED")).toBe(false);
    });

    it("ARRIVED -> COMPLETED (must go through IN_PROGRESS)", () => {
      expect(isValidTransition("ARRIVED", "COMPLETED")).toBe(false);
    });

    it("COMPLETED -> anything rejected", () => {
      const ALL: SchedulingJobStatus[] = [
        "NOT_STARTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS",
        "COMPLETED", "INCOMPLETE", "CANCELED", "NEEDS_REBOOK", "BEYOND_SAME_DAY",
      ];
      for (const target of ALL) {
        expect(isValidTransition("COMPLETED", target)).toBe(false);
      }
    });

    it("CANCELED -> anything rejected", () => {
      const ALL: SchedulingJobStatus[] = [
        "NOT_STARTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS",
        "COMPLETED", "INCOMPLETE", "CANCELED", "NEEDS_REBOOK", "BEYOND_SAME_DAY",
      ];
      for (const target of ALL) {
        expect(isValidTransition("CANCELED", target)).toBe(false);
      }
    });
  });
});

// ── isLockedState ─────────────────────────────────────────────────────────────

describe("isLockedState", () => {
  it("returns true for all locked states", () => {
    expect(isLockedState("EN_ROUTE")).toBe(true);
    expect(isLockedState("ARRIVED")).toBe(true);
    expect(isLockedState("IN_PROGRESS")).toBe(true);
    expect(isLockedState("COMPLETED")).toBe(true);
    expect(isLockedState("INCOMPLETE")).toBe(true);
    expect(isLockedState("CANCELED")).toBe(true);
    expect(isLockedState("BEYOND_SAME_DAY")).toBe(true);
  });

  it("returns false for reorderable states", () => {
    expect(isLockedState("NOT_STARTED")).toBe(false);
    expect(isLockedState("NEEDS_REBOOK")).toBe(false);
  });
});

// ── isTerminalState ───────────────────────────────────────────────────────────

describe("isTerminalState", () => {
  it("returns true for terminal states", () => {
    expect(isTerminalState("COMPLETED")).toBe(true);
    expect(isTerminalState("INCOMPLETE")).toBe(true);
    expect(isTerminalState("CANCELED")).toBe(true);
    expect(isTerminalState("BEYOND_SAME_DAY")).toBe(true);
  });

  it("returns false for non-terminal states", () => {
    expect(isTerminalState("NOT_STARTED")).toBe(false);
    expect(isTerminalState("EN_ROUTE")).toBe(false);
    expect(isTerminalState("ARRIVED")).toBe(false);
    expect(isTerminalState("IN_PROGRESS")).toBe(false);
    expect(isTerminalState("NEEDS_REBOOK")).toBe(false);
  });
});

// ── One active job per tech ───────────────────────────────────────────────────

describe("one active job per tech", () => {
  it("blocks EN_ROUTE when another job is already EN_ROUTE", async () => {
    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-active", status: "EN_ROUTE" }),
      makeJob({ id: "job-2", status: "NOT_STARTED" }),
    ]);

    const result = await transitionJobState("job-2", "EN_ROUTE", "tech-1", "SYSTEM", db);
    expect(result.success).toBe(false);
    expect(result.reason).toBe("tech_has_active_job");
  });

  it("blocks ARRIVED when another job is IN_PROGRESS", async () => {
    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-active", status: "IN_PROGRESS" }),
      makeJob({ id: "job-2", status: "EN_ROUTE" }),
    ]);

    const result = await transitionJobState("job-2", "ARRIVED", "tech-1", "SYSTEM", db);
    expect(result.success).toBe(false);
    expect(result.reason).toBe("tech_has_active_job");
  });

  it("allows same job EN_ROUTE -> ARRIVED (not blocked by itself)", async () => {
    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-1", status: "EN_ROUTE" }),
    ]);

    const result = await transitionJobState("job-1", "ARRIVED", "tech-1", "TECH", db);
    expect(result.success).toBe(true);
  });

  it("allows transition when no other active jobs exist", async () => {
    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-1", status: "NOT_STARTED" }),
      makeJob({ id: "job-done", status: "COMPLETED", technicianId: "tech-1" }),
    ]);

    const result = await transitionJobState("job-1", "EN_ROUTE", "tech-1", "SYSTEM", db);
    expect(result.success).toBe(true);
  });
});

// ── 5-minute minimum duration ─────────────────────────────────────────────────

describe("5-minute minimum duration", () => {
  it("COMPLETED rejected under 5 minutes", async () => {
    const arrivedAt = new Date("2026-04-08T10:00:00Z");
    const now = minutesAfter(arrivedAt, 4); // 4 min after arrival

    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-1", status: "IN_PROGRESS", arrivedAt }),
    ]);

    const result = await transitionJobState("job-1", "COMPLETED", "tech-1", "TECH", db, now);
    expect(result.success).toBe(false);
    expect(result.reason).toBe("minimum_duration_not_met");
  });

  it("COMPLETED allowed at exactly 5 minutes", async () => {
    const arrivedAt = new Date("2026-04-08T10:00:00Z");
    const now = minutesAfter(arrivedAt, 5);

    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-1", status: "IN_PROGRESS", arrivedAt }),
    ]);

    const result = await transitionJobState("job-1", "COMPLETED", "tech-1", "TECH", db, now);
    expect(result.success).toBe(true);
  });

  it("COMPLETED allowed well after 5 minutes", async () => {
    const arrivedAt = new Date("2026-04-08T10:00:00Z");
    const now = minutesAfter(arrivedAt, 60);

    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-1", status: "IN_PROGRESS", arrivedAt }),
    ]);

    const result = await transitionJobState("job-1", "COMPLETED", "tech-1", "TECH", db, now);
    expect(result.success).toBe(true);
  });

  it("INCOMPLETE rejected under 5 minutes", async () => {
    const arrivedAt = new Date("2026-04-08T10:00:00Z");
    const now = minutesAfter(arrivedAt, 2);

    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-1", status: "IN_PROGRESS", arrivedAt }),
    ]);

    const result = await transitionJobState("job-1", "INCOMPLETE", "tech-1", "TECH", db, now);
    expect(result.success).toBe(false);
    expect(result.reason).toBe("minimum_duration_not_met");
  });

  it("INCOMPLETE allowed at 5 minutes", async () => {
    const arrivedAt = new Date("2026-04-08T10:00:00Z");
    const now = minutesAfter(arrivedAt, 5);

    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-1", status: "IN_PROGRESS", arrivedAt }),
    ]);

    const result = await transitionJobState("job-1", "INCOMPLETE", "tech-1", "TECH", db, now);
    expect(result.success).toBe(true);
  });

  it("rejects COMPLETED when arrivedAt is null", async () => {
    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-1", status: "IN_PROGRESS", arrivedAt: null }),
    ]);

    const result = await transitionJobState(
      "job-1", "COMPLETED", "tech-1", "TECH", db,
      new Date("2026-04-08T15:00:00Z"),
    );
    expect(result.success).toBe(false);
    expect(result.reason).toBe("minimum_duration_not_met");
  });
});

// ── Timestamp and event side effects ──────────────────────────────────────────

describe("timestamp and event side effects", () => {
  it("ARRIVED sets arrivedAt", async () => {
    const now = new Date("2026-04-08T09:30:00Z");
    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-1", status: "EN_ROUTE" }),
    ]);

    const result = await transitionJobState("job-1", "ARRIVED", "tech-1", "TECH", db, now);
    expect(result.success).toBe(true);
    expect(result.job!.arrivedAt).toEqual(now);
  });

  it("COMPLETED sets completedAt", async () => {
    const arrivedAt = new Date("2026-04-08T09:30:00Z");
    const now = minutesAfter(arrivedAt, 30);
    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-1", status: "IN_PROGRESS", arrivedAt }),
    ]);

    const result = await transitionJobState("job-1", "COMPLETED", "tech-1", "TECH", db, now);
    expect(result.success).toBe(true);
    expect(result.job!.completedAt).toEqual(now);
  });

  it("INCOMPLETE sets completedAt", async () => {
    const arrivedAt = new Date("2026-04-08T09:30:00Z");
    const now = minutesAfter(arrivedAt, 10);
    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-1", status: "IN_PROGRESS", arrivedAt }),
    ]);

    const result = await transitionJobState("job-1", "INCOMPLETE", "tech-1", "TECH", db, now);
    expect(result.success).toBe(true);
    expect(result.job!.completedAt).toEqual(now);
  });

  it("BEYOND_SAME_DAY does NOT set completedAt", async () => {
    const arrivedAt = new Date("2026-04-08T09:30:00Z");
    const now = minutesAfter(arrivedAt, 60);
    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-1", status: "IN_PROGRESS", arrivedAt }),
    ]);

    const result = await transitionJobState("job-1", "BEYOND_SAME_DAY", "tech-1", "TECH", db, now);
    expect(result.success).toBe(true);
    expect(result.job!.completedAt).toBeNull();
  });

  it("invalid transition does not mutate timestamps", async () => {
    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-1", status: "NOT_STARTED" }),
    ]);

    const result = await transitionJobState("job-1", "COMPLETED", "tech-1", "TECH", db);
    expect(result.success).toBe(false);

    // Job should be unchanged
    const job = await db.getJob("job-1");
    expect(job!.status).toBe("NOT_STARTED");
    expect(job!.arrivedAt).toBeNull();
    expect(job!.completedAt).toBeNull();
  });

  it("successful transition writes SchedulingEvent with correct old/new/triggeredBy", async () => {
    const now = new Date("2026-04-08T08:00:00Z");
    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-1", status: "NOT_STARTED" }),
    ]);

    await transitionJobState("job-1", "EN_ROUTE", "tech-1", "SYSTEM", db, now);

    expect(db._events).toHaveLength(1);
    const event = db._events[0]!;
    expect(event.schedulingJobId).toBe("job-1");
    expect(event.eventType).toBe("status_change");
    expect(event.oldValue).toBe("NOT_STARTED");
    expect(event.newValue).toBe("EN_ROUTE");
    expect(event.triggeredBy).toBe("SYSTEM");
    expect(event.timestamp).toEqual(now);
  });

  it("failed transition does not write an event", async () => {
    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-1", status: "COMPLETED" }),
    ]);

    await transitionJobState("job-1", "NOT_STARTED", "tech-1", "TECH", db);
    expect(db._events).toHaveLength(0);
  });
});

// ── transitionJobState — additional cases ─────────────────────────────────────

describe("transitionJobState", () => {
  it("throws when job not found", async () => {
    const db = createInMemorySchedulingDb([]);

    await expect(
      transitionJobState("nonexistent", "EN_ROUTE", "tech-1", "SYSTEM", db),
    ).rejects.toThrow("Scheduling job not found");
  });

  it("full happy path: NOT_STARTED -> EN_ROUTE -> ARRIVED -> IN_PROGRESS -> COMPLETED", async () => {
    const db = createInMemorySchedulingDb([makeJob()]);
    const t0 = new Date("2026-04-08T08:00:00Z");

    const r1 = await transitionJobState("job-1", "EN_ROUTE", "tech-1", "SYSTEM", db, t0);
    expect(r1.success).toBe(true);
    expect(r1.job!.status).toBe("EN_ROUTE");

    const r2 = await transitionJobState("job-1", "ARRIVED", "tech-1", "TECH", db, minutesAfter(t0, 20));
    expect(r2.success).toBe(true);
    expect(r2.job!.status).toBe("ARRIVED");
    expect(r2.job!.arrivedAt).toEqual(minutesAfter(t0, 20));

    const r3 = await transitionJobState("job-1", "IN_PROGRESS", "tech-1", "TECH", db, minutesAfter(t0, 21));
    expect(r3.success).toBe(true);
    expect(r3.job!.status).toBe("IN_PROGRESS");

    const r4 = await transitionJobState("job-1", "COMPLETED", "tech-1", "TECH", db, minutesAfter(t0, 80));
    expect(r4.success).toBe(true);
    expect(r4.job!.status).toBe("COMPLETED");
    expect(r4.job!.completedAt).toEqual(minutesAfter(t0, 80));

    // 4 events total
    expect(db._events).toHaveLength(4);
  });
});

// ── endOfDaySweep ─────────────────────────────────────────────────────────────

describe("endOfDaySweep", () => {
  it("finds stuck IN_PROGRESS jobs more than 2 hours past end time", async () => {
    const db = createInMemorySchedulingDb([
      makeJob({
        id: "job-stuck",
        status: "IN_PROGRESS",
        technicianId: "tech-1",
        customerName: "Stuck Customer",
      }),
    ]);

    const techEndTimes = new Map([["tech-1", "17:00"]]);
    // 3 hours past 17:00
    const now = new Date("2026-04-08T20:00:00Z");

    const stuck = await endOfDaySweep(TODAY, techEndTimes, db, now);
    expect(stuck).toHaveLength(1);
    expect(stuck[0]!.jobId).toBe("job-stuck");
    expect(stuck[0]!.technicianId).toBe("tech-1");
    expect(stuck[0]!.customerName).toBe("Stuck Customer");
    expect(stuck[0]!.hoursOverdue).toBe(3);
  });

  it("ignores COMPLETED jobs", async () => {
    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-done", status: "COMPLETED", technicianId: "tech-1" }),
    ]);

    const techEndTimes = new Map([["tech-1", "17:00"]]);
    const now = new Date("2026-04-08T20:00:00Z");

    const stuck = await endOfDaySweep(TODAY, techEndTimes, db, now);
    expect(stuck).toHaveLength(0);
  });

  it("ignores IN_PROGRESS jobs still within 2-hour window", async () => {
    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-1", status: "IN_PROGRESS", technicianId: "tech-1" }),
    ]);

    const techEndTimes = new Map([["tech-1", "17:00"]]);
    // Only 1 hour past 17:00 — within the 2-hour grace
    const now = new Date("2026-04-08T18:00:00Z");

    const stuck = await endOfDaySweep(TODAY, techEndTimes, db, now);
    expect(stuck).toHaveLength(0);
  });

  it("returns empty when no stuck jobs", async () => {
    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-1", status: "NOT_STARTED", technicianId: "tech-1" }),
    ]);

    const techEndTimes = new Map([["tech-1", "17:00"]]);
    const now = new Date("2026-04-08T20:00:00Z");

    const stuck = await endOfDaySweep(TODAY, techEndTimes, db, now);
    expect(stuck).toHaveLength(0);
  });

  it("handles multiple stuck jobs from different techs", async () => {
    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-1", status: "IN_PROGRESS", technicianId: "tech-1" }),
      makeJob({ id: "job-2", status: "IN_PROGRESS", technicianId: "tech-2" }),
      makeJob({ id: "job-3", status: "COMPLETED", technicianId: "tech-1" }),
    ]);

    const techEndTimes = new Map([
      ["tech-1", "17:00"],
      ["tech-2", "16:00"],
    ]);
    // 19:30 — tech-1: 2.5h past (stuck), tech-2: 3.5h past (stuck)
    const now = new Date("2026-04-08T19:30:00Z");

    const stuck = await endOfDaySweep(TODAY, techEndTimes, db, now);
    expect(stuck).toHaveLength(2);
    expect(stuck.map((s) => s.jobId).sort()).toEqual(["job-1", "job-2"]);
  });

  it("uses business timezone to compute end-of-day correctly", async () => {
    const db = createInMemorySchedulingDb([
      makeJob({
        id: "job-tz",
        status: "IN_PROGRESS",
        technicianId: "tech-1",
        customerName: "TZ Customer",
      }),
    ]);

    // Tech end time is 17:00 business-local (America/New_York, EDT = UTC-4)
    // So 17:00 EDT = 21:00 UTC on April 8. Grace is 2 hours → stuck after 23:00 UTC.
    const techEndTimes = new Map([["tech-1", "17:00"]]);

    // Use a date reference that lands on April 8 in EDT.
    // 2026-04-08T12:00:00Z = April 8 08:00 EDT — clearly April 8 local.
    const apr8InEdt = new Date("2026-04-08T12:00:00Z");

    // At 22:00 UTC (18:00 EDT) — only 1 hour past 17:00 local → NOT stuck
    const notStuckYet = new Date("2026-04-08T22:00:00Z");
    const result1 = await endOfDaySweep(apr8InEdt, techEndTimes, db, notStuckYet, "America/New_York");
    expect(result1).toHaveLength(0);

    // At 23:30 UTC (19:30 EDT) — 2.5 hours past 17:00 local → STUCK
    const nowStuck = new Date("2026-04-08T23:30:00Z");
    const result2 = await endOfDaySweep(apr8InEdt, techEndTimes, db, nowStuck, "America/New_York");
    expect(result2).toHaveLength(1);
    expect(result2[0]!.jobId).toBe("job-tz");
    expect(result2[0]!.hoursOverdue).toBe(2);
  });
});

// ── C2: SCHEDULING_TO_CONVERSATION_MAP ──────────────────────────────────────

describe("SCHEDULING_TO_CONVERSATION_MAP", () => {
  it("maps EN_ROUTE to en_route", () => {
    expect(SCHEDULING_TO_CONVERSATION_MAP.EN_ROUTE).toBe("en_route");
  });

  it("maps IN_PROGRESS to job_in_progress", () => {
    expect(SCHEDULING_TO_CONVERSATION_MAP.IN_PROGRESS).toBe("job_in_progress");
  });

  it("maps COMPLETED to job_completed", () => {
    expect(SCHEDULING_TO_CONVERSATION_MAP.COMPLETED).toBe("job_completed");
  });

  it("maps CANCELED to resolved", () => {
    expect(SCHEDULING_TO_CONVERSATION_MAP.CANCELED).toBe("resolved");
  });

  it("returns null for ARRIVED (no conversation change)", () => {
    expect(SCHEDULING_TO_CONVERSATION_MAP.ARRIVED).toBeNull();
  });

  it("returns null for NEEDS_REBOOK", () => {
    expect(SCHEDULING_TO_CONVERSATION_MAP.NEEDS_REBOOK).toBeNull();
  });

  it("returns null for BEYOND_SAME_DAY", () => {
    expect(SCHEDULING_TO_CONVERSATION_MAP.BEYOND_SAME_DAY).toBeNull();
  });

  it("has an entry for every scheduling status", () => {
    const allStatuses: SchedulingJobStatus[] = [
      "NOT_STARTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS",
      "COMPLETED", "INCOMPLETE", "CANCELED", "NEEDS_REBOOK", "BEYOND_SAME_DAY",
    ];
    for (const status of allStatuses) {
      expect(status in SCHEDULING_TO_CONVERSATION_MAP).toBe(true);
    }
  });
});

// ── C2: Conversation bridge in transitionJobState ───────────────────────────

describe("transitionJobState conversation bridge", () => {
  it("calls conversationTransitionFn when mapping exists", async () => {
    const db = createInMemorySchedulingDb([makeJob({ id: "job-1", status: "NOT_STARTED" })]);
    const transitionFn = vi.fn().mockResolvedValue(undefined);

    await transitionJobState(
      "job-1", "EN_ROUTE", "tech-1", "SYSTEM", db,
      undefined,
      { conversationId: "conv-1", transitionFn },
    );

    expect(transitionFn).toHaveBeenCalledWith("conv-1", "en_route");
  });

  it("does NOT call conversationTransitionFn when mapping is null (ARRIVED)", async () => {
    const db = createInMemorySchedulingDb([makeJob({ id: "job-1", status: "EN_ROUTE" })]);
    const transitionFn = vi.fn().mockResolvedValue(undefined);

    await transitionJobState(
      "job-1", "ARRIVED", "tech-1", "SYSTEM", db,
      undefined,
      { conversationId: "conv-1", transitionFn },
    );

    expect(transitionFn).not.toHaveBeenCalled();
  });

  it("does NOT call conversationTransitionFn when bridge is not provided", async () => {
    const db = createInMemorySchedulingDb([makeJob({ id: "job-1", status: "NOT_STARTED" })]);

    // No bridge — should succeed without error
    const result = await transitionJobState("job-1", "EN_ROUTE", "tech-1", "SYSTEM", db);
    expect(result.success).toBe(true);
  });

  it("calls correct conversation state for COMPLETED", async () => {
    const arrived = new Date("2026-04-08T10:00:00Z");
    const completedAt = minutesAfter(arrived, 30);
    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-1", status: "IN_PROGRESS", arrivedAt: arrived }),
    ]);
    const transitionFn = vi.fn().mockResolvedValue(undefined);

    await transitionJobState(
      "job-1", "COMPLETED", "tech-1", "SYSTEM", db,
      completedAt,
      { conversationId: "conv-1", transitionFn },
    );

    expect(transitionFn).toHaveBeenCalledWith("conv-1", "job_completed");
  });
});

// ── H6: countActiveJobsForUpdate ────────────────────────────────────────────

describe("hasActiveJob with countActiveJobsForUpdate (H6)", () => {
  it("prefers countActiveJobsForUpdate when available", async () => {
    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-active", status: "EN_ROUTE", technicianId: "tech-1" }),
      makeJob({ id: "job-new", status: "NOT_STARTED", technicianId: "tech-1" }),
    ]);

    // Add countActiveJobsForUpdate that wraps countActiveJobs
    const forUpdateFn = vi.fn().mockImplementation(
      async (techId: string, excludeJobId: string) => {
        return db.countActiveJobs(techId, excludeJobId);
      },
    );
    (db as any).countActiveJobsForUpdate = forUpdateFn;

    // Transition job-new to EN_ROUTE — should be blocked by job-active
    const result = await transitionJobState("job-new", "EN_ROUTE", "tech-1", "SYSTEM", db);

    expect(result.success).toBe(false);
    expect(result.reason).toBe("tech_has_active_job");
    expect(forUpdateFn).toHaveBeenCalledWith("tech-1", "job-new");
  });

  it("falls back to countActiveJobs when countActiveJobsForUpdate is not defined", async () => {
    const db = createInMemorySchedulingDb([
      makeJob({ id: "job-active", status: "EN_ROUTE", technicianId: "tech-1" }),
      makeJob({ id: "job-new", status: "NOT_STARTED", technicianId: "tech-1" }),
    ]);

    // No countActiveJobsForUpdate defined — should still work
    const result = await transitionJobState("job-new", "EN_ROUTE", "tech-1", "SYSTEM", db);

    expect(result.success).toBe(false);
    expect(result.reason).toBe("tech_has_active_job");
  });
});
