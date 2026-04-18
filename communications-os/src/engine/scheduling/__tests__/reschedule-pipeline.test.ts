// ============================================================
// src/engine/scheduling/__tests__/reschedule-pipeline.test.ts
//
// RESCHEDULE PIPELINE — IN-PLACE UPDATE TESTS
//
// R01  Full success — same UUID, new window, rebook_count+1,
//      appointment updated, scheduling_event logged
// R02  Transaction succeeds but state write fails (tested at
//      integration level — this file tests the pipeline itself)
// R03  Transaction write throws — full rollback, no partial data
// R04  Slot unavailable at re-verification — no writes, slot-taken msg
// ============================================================

import { describe, it, expect } from "vitest";
import { rescheduleInPlace, type RescheduleDb, type RescheduleInput } from "../reschedule-pipeline";
import type { AvailableSlot } from "../ai-booking-pipeline";
import type { QueuedJob } from "../queue-insertion";
import type { TechCandidate } from "../tech-assignment";

// ── Constants ────────────────────────────────────────────────────

const ORIGINAL_JOB_ID = "job-original-001";
const ORIGINAL_APPT_ID = "appt-original-001";
const TECH_ID = "tech-jake-001";

// ── Helpers ──────────────────────────────────────────────────────

function makeTech(overrides: Partial<TechCandidate> = {}): TechCandidate {
  return {
    id: TECH_ID,
    businessId: "biz-001",
    name: "Jake Rodriguez",
    homeBaseLat: 36.16,
    homeBaseLng: -86.78,
    skillTags: [],
    workingHoursStart: "08:00",
    workingHoursEnd: "17:00",
    lunchStart: "12:00",
    lunchEnd: "13:00",
    overtimeCapMinutes: 0,
    isActive: true,
    ...overrides,
  };
}

function makeSlot(overrides: Partial<AvailableSlot> = {}): AvailableSlot {
  return {
    index: 5,
    technicianId: TECH_ID,
    techName: "Jake Rodriguez",
    date: "2026-04-21",
    queuePosition: 0,
    windowStart: "09:00",
    windowEnd: "12:00",
    label: "Monday Apr 21 9:00 AM – 12:00 PM with Jake Rodriguez",
    totalCostMinutes: 75,
    serviceTypeId: "svc-001",
    serviceTypeName: "Diagnostic",
    timePreference: "SOONEST",
    arrivalMinutes: 480,
    variantType: "rule_1",
    ...overrides,
  };
}

function makeInput(overrides: Partial<RescheduleInput> = {}): RescheduleInput {
  return {
    originalJobId: ORIGINAL_JOB_ID,
    originalAppointmentId: ORIGINAL_APPT_ID,
    slot: makeSlot(),
    techName: "Jake Rodriguez",
    ...overrides,
  };
}

interface MockDbState {
  updatedJobs: Array<{ jobId: string; data: Record<string, unknown> }>;
  updatedAppointments: Array<{ appointmentId: string; data: Record<string, unknown> }>;
  createdEvents: Array<Record<string, unknown>>;
  rebookCount: number;
  queue: QueuedJob[];
  tech: TechCandidate | null;
  throwOnUpdateJob?: boolean;
  throwOnUpdateAppointment?: boolean;
  throwOnCreateEvent?: boolean;
}

function makeMockDb(state: Partial<MockDbState> = {}): { db: RescheduleDb; state: MockDbState } {
  const s: MockDbState = {
    updatedJobs: [],
    updatedAppointments: [],
    createdEvents: [],
    rebookCount: state.rebookCount ?? 0,
    queue: state.queue ?? [],
    tech: state.tech !== undefined ? state.tech : makeTech(),
    throwOnUpdateJob: state.throwOnUpdateJob ?? false,
    throwOnUpdateAppointment: state.throwOnUpdateAppointment ?? false,
    throwOnCreateEvent: state.throwOnCreateEvent ?? false,
  };

  const dbImpl: RescheduleDb = {
    async getQueueForTechDate(_techId: string, _date: Date, excludeJobId?: string) {
      const q = [...s.queue];
      if (excludeJobId) return q.filter((j) => j.id !== excludeJobId);
      return q;
    },
    async getTechCandidate() {
      return s.tech;
    },
    async updateSchedulingJob(jobId, data) {
      if (s.throwOnUpdateJob) throw new Error("DB write failed: updateSchedulingJob");
      s.updatedJobs.push({ jobId, data: { ...data } });
    },
    async updateAppointment(appointmentId, data) {
      if (s.throwOnUpdateAppointment) throw new Error("DB write failed: updateAppointment");
      s.updatedAppointments.push({ appointmentId, data: { ...data } });
    },
    async createSchedulingEvent(event) {
      if (s.throwOnCreateEvent) throw new Error("DB write failed: createSchedulingEvent");
      s.createdEvents.push({ ...event });
    },
    async getCurrentRebookCount() {
      return s.rebookCount;
    },
    async transaction<T>(fn: (tx: RescheduleDb) => Promise<T>): Promise<T> {
      // In-memory mock: snapshot state, run fn, rollback on error
      const jobsBefore = [...s.updatedJobs];
      const apptsBefore = [...s.updatedAppointments];
      const eventsBefore = [...s.createdEvents];
      try {
        return await fn(dbImpl);
      } catch (err) {
        // Rollback: restore pre-transaction state
        s.updatedJobs.length = 0;
        s.updatedJobs.push(...jobsBefore);
        s.updatedAppointments.length = 0;
        s.updatedAppointments.push(...apptsBefore);
        s.createdEvents.length = 0;
        s.createdEvents.push(...eventsBefore);
        throw err;
      }
    },
  };

  return { db: dbImpl, state: s };
}

// ── R01: Full success path ──────────────────────────────────────

describe("R01: Full reschedule success — in-place update", () => {
  it("returns success with same job UUID, not a new one", async () => {
    const { db } = makeMockDb();
    const result = await rescheduleInPlace(makeInput(), db);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.jobId).toBe(ORIGINAL_JOB_ID);
  });

  it("updates scheduling_jobs with new window times", async () => {
    const { db, state } = makeMockDb();
    await rescheduleInPlace(makeInput(), db);

    expect(state.updatedJobs).toHaveLength(1);
    const update = state.updatedJobs[0]!;
    expect(update.jobId).toBe(ORIGINAL_JOB_ID);
    expect(update.data.technicianId).toBe(TECH_ID);
    const ws = update.data.windowStart as Date;
    const we = update.data.windowEnd as Date;
    expect(ws.getHours()).toBe(9);
    expect(ws.getMinutes()).toBe(0);
    expect(we.getHours()).toBe(12);
    expect(we.getMinutes()).toBe(0);
  });

  it("increments rebook_count from 0 to 1", async () => {
    const { db, state } = makeMockDb({ rebookCount: 0 });
    const result = await rescheduleInPlace(makeInput(), db);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.rebookCount).toBe(1);
    expect(state.updatedJobs[0]!.data.rebookCount).toBe(1);
  });

  it("increments rebook_count from existing value (e.g. 2 → 3)", async () => {
    const { db, state } = makeMockDb({ rebookCount: 2 });
    const result = await rescheduleInPlace(makeInput(), db);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.rebookCount).toBe(3);
    expect(state.updatedJobs[0]!.data.rebookCount).toBe(3);
  });

  it("updates appointment row with new date/time/tech", async () => {
    const { db, state } = makeMockDb();
    await rescheduleInPlace(makeInput(), db);

    expect(state.updatedAppointments).toHaveLength(1);
    const update = state.updatedAppointments[0]!;
    expect(update.appointmentId).toBe(ORIGINAL_APPT_ID);
    expect(update.data.technicianName).toBe("Jake Rodriguez");
  });

  it("creates scheduling_events entry with event_type=rescheduled", async () => {
    const { db, state } = makeMockDb();
    await rescheduleInPlace(makeInput(), db);

    expect(state.createdEvents).toHaveLength(1);
    const event = state.createdEvents[0]!;
    expect(event.schedulingJobId).toBe(ORIGINAL_JOB_ID);
    expect(event.eventType).toBe("rescheduled");
    expect(event.triggeredBy).toBe("SYSTEM");
    expect(event.newValue).toContain("2026-04-21");
    expect(event.newValue).toContain("Jake Rodriguez");
  });
});

// ── R03: Transaction write throws — full rollback ──────────────

describe("R03: Transaction write failure — full rollback", () => {
  it("rolls back all writes when updateSchedulingJob throws", async () => {
    const { db, state } = makeMockDb({ throwOnUpdateJob: true });

    await expect(rescheduleInPlace(makeInput(), db)).rejects.toThrow("DB write failed");
    expect(state.updatedJobs).toHaveLength(0);
    expect(state.updatedAppointments).toHaveLength(0);
    expect(state.createdEvents).toHaveLength(0);
  });

  it("rolls back all writes when updateAppointment throws", async () => {
    const { db, state } = makeMockDb({ throwOnUpdateAppointment: true });

    await expect(rescheduleInPlace(makeInput(), db)).rejects.toThrow("DB write failed");
    expect(state.updatedJobs).toHaveLength(0);
    expect(state.updatedAppointments).toHaveLength(0);
    expect(state.createdEvents).toHaveLength(0);
  });

  it("rolls back all writes when createSchedulingEvent throws", async () => {
    const { db, state } = makeMockDb({ throwOnCreateEvent: true });

    await expect(rescheduleInPlace(makeInput(), db)).rejects.toThrow("DB write failed");
    expect(state.updatedJobs).toHaveLength(0);
    expect(state.updatedAppointments).toHaveLength(0);
    expect(state.createdEvents).toHaveLength(0);
  });
});

// ── R04: Slot unavailable at re-verification ───────────────────

describe("R04: Replacement slot no longer available at commit time", () => {
  it("returns slot_no_longer_available when queue is full", async () => {
    // Fill the queue so the slot can't fit
    const fullQueue: QueuedJob[] = Array.from({ length: 8 }, (_, i) => ({
      id: `existing-job-${i}`,
      queuePosition: i,
      status: "NOT_STARTED" as const,
      timePreference: "NO_PREFERENCE" as const,
      addressLat: 36.16,
      addressLng: -86.78,
      manualPosition: false,
      manualPositionSetDate: null,
      estimatedDurationMinutes: 75,
      driveTimeMinutes: 15,
      queueVersion: 0,
    }));

    const { db, state } = makeMockDb({ queue: fullQueue });
    const result = await rescheduleInPlace(makeInput(), db);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("slot_no_longer_available");
    expect(state.updatedJobs).toHaveLength(0);
    expect(state.updatedAppointments).toHaveLength(0);
    expect(state.createdEvents).toHaveLength(0);
  });

  it("does not modify original job when slot is taken", async () => {
    // Another job occupies the exact slot
    const blockingQueue: QueuedJob[] = [{
      id: "blocking-job",
      queuePosition: 0,
      status: "NOT_STARTED" as const,
      timePreference: "SOONEST" as const,
      addressLat: 36.16,
      addressLng: -86.78,
      manualPosition: false,
      manualPositionSetDate: null,
      estimatedDurationMinutes: 480, // blocks entire day
      driveTimeMinutes: 15,
      queueVersion: 0,
    }];

    const { db, state } = makeMockDb({ queue: blockingQueue });
    const result = await rescheduleInPlace(makeInput(), db);

    expect(result.success).toBe(false);
    expect(state.updatedJobs).toHaveLength(0);
    expect(state.updatedAppointments).toHaveLength(0);
    expect(state.createdEvents).toHaveLength(0);
  });

  it("returns technician_not_found when tech is missing", async () => {
    const { db } = makeMockDb({ tech: null });
    const result = await rescheduleInPlace(makeInput(), db);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("technician_not_found");
  });

  it("excludes original job from queue during re-verification", async () => {
    // The original job is in the queue (customer competing with themselves).
    // It should be excluded so it doesn't block the reschedule.
    const queueWithOriginal: QueuedJob[] = [{
      id: ORIGINAL_JOB_ID,
      queuePosition: 0,
      status: "NOT_STARTED" as const,
      timePreference: "SOONEST" as const,
      addressLat: 36.16,
      addressLng: -86.78,
      manualPosition: false,
      manualPositionSetDate: null,
      estimatedDurationMinutes: 75,
      driveTimeMinutes: 15,
      queueVersion: 0,
    }];

    const { db } = makeMockDb({ queue: queueWithOriginal });
    const result = await rescheduleInPlace(makeInput(), db);

    // Should succeed because the original job is filtered out
    expect(result.success).toBe(true);
  });
});

// ── R05: Queue exclusion consistency between generation and re-verification ──

describe("R05: Original job excluded consistently in generation and re-verification", () => {
  it("reschedule succeeds when original is at queue position 0 and slot was computed without it", async () => {
    // Simulates the live bug: original job sits at position 0 in the queue.
    // Slot generation excluded it → produced a slot with arrivalMinutes=480 (workStart).
    // Re-verification must also exclude it → same arrivalMinutes available.
    const queueWithOriginalFirst: QueuedJob[] = [
      {
        id: ORIGINAL_JOB_ID,
        queuePosition: 0,
        status: "NOT_STARTED" as const,
        timePreference: "SOONEST" as const,
        addressLat: 36.16,
        addressLng: -86.78,
        manualPosition: false,
        manualPositionSetDate: null,
        estimatedDurationMinutes: 75,
        driveTimeMinutes: 15,
        queueVersion: 0,
      },
    ];

    // Slot was generated with original excluded → arrivalMinutes=480 (8:00 AM), queuePosition=0
    const slotComputedWithoutOriginal = makeSlot({
      arrivalMinutes: 480,
      queuePosition: 0,
      windowStart: "09:00",
      windowEnd: "12:00",
      variantType: "rule_1",
    });

    const { db, state } = makeMockDb({ queue: queueWithOriginalFirst });
    const result = await rescheduleInPlace(
      makeInput({ slot: slotComputedWithoutOriginal }),
      db,
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.jobId).toBe(ORIGINAL_JOB_ID);
    expect(state.updatedJobs).toHaveLength(1);
  });

  it("reschedule succeeds when original is mid-queue and other jobs surround it", async () => {
    const queueWithOriginalMiddle: QueuedJob[] = [
      {
        id: "other-job-before",
        queuePosition: 0,
        status: "NOT_STARTED" as const,
        timePreference: "SOONEST" as const,
        addressLat: 36.16,
        addressLng: -86.78,
        manualPosition: false,
        manualPositionSetDate: null,
        estimatedDurationMinutes: 75,
        driveTimeMinutes: 15,
        queueVersion: 0,
      },
      {
        id: ORIGINAL_JOB_ID,
        queuePosition: 1,
        status: "NOT_STARTED" as const,
        timePreference: "SOONEST" as const,
        addressLat: 36.16,
        addressLng: -86.78,
        manualPosition: false,
        manualPositionSetDate: null,
        estimatedDurationMinutes: 75,
        driveTimeMinutes: 15,
        queueVersion: 0,
      },
    ];

    // After excluding original, only "other-job-before" remains at pos 0.
    // First job: serviceDuration=75-15=60, occupied 480-540. searchStart=540.
    // Gap after first job: gapStart=540, first window at 540, queuePosition=1.
    // Rule 1 variant: roundTo15(540+60)=600 → windowStart=10:00, windowEnd=13:00.
    const slotAfterFirstJob = makeSlot({
      arrivalMinutes: 540,
      queuePosition: 1,
      windowStart: "10:00",
      windowEnd: "13:00",
      variantType: "rule_1",
    });

    const { db, state } = makeMockDb({ queue: queueWithOriginalMiddle });
    const result = await rescheduleInPlace(
      makeInput({ slot: slotAfterFirstJob }),
      db,
    );

    expect(result.success).toBe(true);
    expect(state.updatedJobs).toHaveLength(1);
  });
});

// ── R06: Queue function without excludeJobId returns full queue ──

describe("R06: getQueueForTechDate without excludeJobId returns full unfiltered queue", () => {
  it("returns all jobs when excludeJobId is undefined", async () => {
    const fullQueue: QueuedJob[] = [
      {
        id: "job-a",
        queuePosition: 0,
        status: "NOT_STARTED" as const,
        timePreference: "SOONEST" as const,
        addressLat: 36.16,
        addressLng: -86.78,
        manualPosition: false,
        manualPositionSetDate: null,
        estimatedDurationMinutes: 75,
        driveTimeMinutes: 15,
        queueVersion: 0,
      },
      {
        id: "job-b",
        queuePosition: 1,
        status: "NOT_STARTED" as const,
        timePreference: "SOONEST" as const,
        addressLat: 36.16,
        addressLng: -86.78,
        manualPosition: false,
        manualPositionSetDate: null,
        estimatedDurationMinutes: 75,
        driveTimeMinutes: 15,
        queueVersion: 0,
      },
    ];

    const { db } = makeMockDb({ queue: fullQueue });
    // Call getQueueForTechDate without excludeJobId — simulates new booking path
    const result = await db.getQueueForTechDate("any-tech", new Date());
    expect(result).toHaveLength(2);
    expect(result.map((j) => j.id)).toEqual(["job-a", "job-b"]);
  });

  it("filters only the specified job when excludeJobId is provided", async () => {
    const fullQueue: QueuedJob[] = [
      {
        id: "job-a",
        queuePosition: 0,
        status: "NOT_STARTED" as const,
        timePreference: "SOONEST" as const,
        addressLat: 36.16,
        addressLng: -86.78,
        manualPosition: false,
        manualPositionSetDate: null,
        estimatedDurationMinutes: 75,
        driveTimeMinutes: 15,
        queueVersion: 0,
      },
      {
        id: "job-b",
        queuePosition: 1,
        status: "NOT_STARTED" as const,
        timePreference: "SOONEST" as const,
        addressLat: 36.16,
        addressLng: -86.78,
        manualPosition: false,
        manualPositionSetDate: null,
        estimatedDurationMinutes: 75,
        driveTimeMinutes: 15,
        queueVersion: 0,
      },
    ];

    const { db } = makeMockDb({ queue: fullQueue });
    const result = await db.getQueueForTechDate("any-tech", new Date(), "job-a");
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("job-b");
  });
});
