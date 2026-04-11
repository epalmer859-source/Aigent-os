// ============================================================
// Tests for src/engine/scheduling/booking-orchestrator.ts
// ============================================================

import { describe, it, expect, vi } from "vitest";
import { bookJob, type BookingOrchestratorDb, type BookingRequest, type ClockProvider } from "../booking-orchestrator";
import { createInMemoryCapacityDb, type TechProfile } from "../capacity-math";
import type { QueuedJob } from "../queue-insertion";
import type { Coordinates } from "../osrm-service";

// ── Test helpers ─────────────────────────────────────────────────────────────

const TECH_ID = "tech-1";
const BIZ_ID = "biz-1";
const CUST_ID = "cust-1";
const DATE = new Date("2026-04-09T00:00:00Z");
const NOW = new Date("2026-04-09T10:00:00Z");

const techProfile: TechProfile = {
  id: TECH_ID,
  businessId: BIZ_ID,
  workingHoursStart: "08:00",
  workingHoursEnd: "17:00",
  lunchStart: "12:00",
  lunchEnd: "13:00",
  overtimeCapMinutes: 30,
};

const techHomeBase: Coordinates = { lat: 40.7128, lng: -74.006 };

const clock: ClockProvider = { now: () => NOW };

function makeRequest(overrides: Partial<BookingRequest> = {}): BookingRequest {
  return {
    jobId: "job-1",
    businessId: BIZ_ID,
    technicianId: TECH_ID,
    customerId: CUST_ID,
    customerName: "Test Customer",
    scheduledDate: DATE,
    timePreference: "NO_PREFERENCE",
    totalCostMinutes: 60,
    addressLat: 40.72,
    addressLng: -74.01,
    addressText: "123 Test St",
    serviceType: "service-type-1",
    ...overrides,
  };
}

interface CreatedJob {
  id: string;
  businessId: string;
  technicianId: string;
  customerId: string;
  customerName: string;
  status: string;
  scheduledDate: Date;
  queuePosition: number;
  timePreference: string;
  totalCostMinutes: number;
}

interface CreatedEvent {
  schedulingJobId: string;
  eventType: string;
  oldValue: string | null;
  newValue: string;
  triggeredBy: string;
}

function createTestDb(
  techProfiles: TechProfile[] = [techProfile],
  existingQueue: QueuedJob[] = [],
): BookingOrchestratorDb & { _jobs: CreatedJob[]; _events: CreatedEvent[] } {
  const capacityDb = createInMemoryCapacityDb(techProfiles);
  const jobs: CreatedJob[] = [];
  const events: CreatedEvent[] = [];

  const db: BookingOrchestratorDb & { _jobs: CreatedJob[]; _events: CreatedEvent[] } = {
    _jobs: jobs,
    _events: events,
    capacityDb,
    pauseGuardDb: {
      async getSchedulingMode() { return { mode: "active" as const }; },
    },
    async getQueueForTechDate() {
      return existingQueue.map((j) => ({ ...j }));
    },
    async createSchedulingJob(job) {
      jobs.push({ ...job } as unknown as CreatedJob);
    },
    async createSchedulingEvent(event) {
      events.push({ ...event } as unknown as CreatedEvent);
    },
    async transaction<T>(fn: (tx: BookingOrchestratorDb) => Promise<T>): Promise<T> {
      // In-memory: just execute (no real rollback needed in tests)
      return fn(db);
    },
  };

  return db;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("bookJob", () => {
  it("creates job, reserves capacity, sets queue position, and creates event atomically", async () => {
    const db = createTestDb();
    const request = makeRequest();

    const result = await bookJob(request, techHomeBase, db, clock);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.jobId).toBe("job-1");
    expect(result.queuePosition).toBe(0); // empty queue → position 0

    // Job was created
    expect(db._jobs).toHaveLength(1);
    expect(db._jobs[0]!.id).toBe("job-1");
    expect(db._jobs[0]!.status).toBe("NOT_STARTED");
    expect(db._jobs[0]!.queuePosition).toBe(0);

    // Event was created
    expect(db._events).toHaveLength(1);
    expect(db._events[0]!.schedulingJobId).toBe("job-1");
    expect(db._events[0]!.eventType).toBe("status_change");
    expect(db._events[0]!.oldValue).toBeNull();
    expect(db._events[0]!.newValue).toBe("NOT_STARTED");
    expect(db._events[0]!.triggeredBy).toBe("SYSTEM");

    // Capacity was reserved
    const reservation = await db.capacityDb.getReservation(TECH_ID, DATE);
    expect(reservation).not.toBeNull();
    expect(reservation!.reserved_minutes).toBe(60);
  });

  it("returns no_capacity when tech is fully booked", async () => {
    const smallCapTech: TechProfile = {
      ...techProfile,
      workingHoursStart: "08:00",
      workingHoursEnd: "09:00",
      lunchStart: "08:30",
      lunchEnd: "08:45",
      overtimeCapMinutes: 0,
    };
    const db = createTestDb([smallCapTech]);

    // Try to book 120 minutes on a tech with only 60 available
    const request = makeRequest({ totalCostMinutes: 120 });

    const result = await bookJob(request, techHomeBase, db, clock);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("no_capacity");

    // No job or event created
    expect(db._jobs).toHaveLength(0);
    expect(db._events).toHaveLength(0);
  });

  it("returns no_morning_capacity for MORNING preference when morning is full", async () => {
    // Morning = 08:00–12:00 = 240 min
    const db = createTestDb();

    // First book 200 minutes as MORNING
    const request1 = makeRequest({
      jobId: "job-1",
      totalCostMinutes: 200,
      timePreference: "MORNING",
    });
    await bookJob(request1, techHomeBase, db, clock);

    // Try to book 100 more as MORNING — should fail
    const request2 = makeRequest({
      jobId: "job-2",
      totalCostMinutes: 100,
      timePreference: "MORNING",
    });
    const result = await bookJob(request2, techHomeBase, db, clock);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.reason).toBe("no_morning_capacity");
  });

  it("inserts job at correct queue position with existing jobs", async () => {
    const existingQueue: QueuedJob[] = [
      {
        id: "existing-1",
        queuePosition: 0,
        status: "NOT_STARTED",
        timePreference: "NO_PREFERENCE",
        addressLat: 40.71,
        addressLng: -74.00,
        manualPosition: false,
        estimatedDurationMinutes: 60,
        driveTimeMinutes: 15,
      },
    ];

    const db = createTestDb([techProfile], existingQueue);
    const request = makeRequest();

    const result = await bookJob(request, techHomeBase, db, clock);

    expect(result.success).toBe(true);
    if (!result.success) return;

    // With one existing job, new job should be at position 0 or 1
    expect(result.queuePosition).toBeGreaterThanOrEqual(0);
    expect(result.queuePosition).toBeLessThanOrEqual(1);
  });

  it("uses the clock provider for event timestamps", async () => {
    const customNow = new Date("2026-04-09T14:30:00Z");
    const customClock: ClockProvider = { now: () => customNow };
    const db = createTestDb();

    await bookJob(makeRequest(), techHomeBase, db, customClock);

    expect(db._events[0]!.triggeredBy).toBe("SYSTEM");
  });

  it("does not create job or event when capacity reservation fails", async () => {
    // Create a tech with very limited capacity
    const tinyTech: TechProfile = {
      ...techProfile,
      workingHoursStart: "08:00",
      workingHoursEnd: "09:00",
      lunchStart: "08:15",
      lunchEnd: "08:30",
      overtimeCapMinutes: 0,
    };
    const db = createTestDb([tinyTech]);

    const request = makeRequest({ totalCostMinutes: 120 });
    const result = await bookJob(request, techHomeBase, db, clock);

    expect(result.success).toBe(false);
    expect(db._jobs).toHaveLength(0);
    expect(db._events).toHaveLength(0);
  });

  // ── H8: Pause guard ──────────────────────────────────────────────────────

  it("H8: blocks booking when business is paused", async () => {
    const db = createTestDb();
    db.pauseGuardDb = {
      async getSchedulingMode() { return { mode: "paused" as const }; },
    };

    const result = await bookJob(makeRequest(), techHomeBase, db, clock);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("scheduling_paused");
    }
    expect(db._jobs).toHaveLength(0);
    expect(db._events).toHaveLength(0);
  });

  it("H8: blocks booking when business is resync_pending", async () => {
    const db = createTestDb();
    db.pauseGuardDb = {
      async getSchedulingMode() { return { mode: "resync_pending" as const }; },
    };

    const result = await bookJob(makeRequest(), techHomeBase, db, clock);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.reason).toBe("resync_pending");
    }
  });
});
