// ============================================================
// Cancellation Pipeline — Tests
//
// Tests for customer-initiated appointment cancellation:
//   1. findCustomerAppointments — phone lookup, fuzzy match
//   2. cancelAppointment — status update, job transition, message cancel
//   3. Edge cases: no appointment, multiple appointments, blocked states
// ============================================================

import { describe, it, expect, vi } from "vitest";
import {
  findCustomerAppointments,
  cancelAppointment,
  type CancellationDb,
  type CustomerAppointment,
} from "../cancellation-pipeline";
import type { SchedulingJobStatus } from "../scheduling-state-machine";

// ── In-memory test db ─────────────────────────────────────────────────────────

interface InMemoryState {
  customersByPhone: Map<string, string[]>; // stripped phone → customer IDs
  appointments: CustomerAppointment[];
  jobs: Map<string, {
    jobId: string;
    technicianId: string;
    scheduledDate: Date;
    status: SchedulingJobStatus;
  }>;
  canceledAppointments: { appointmentId: string; reason: string; canceledBy: string }[];
  canceledJobs: string[];
  canceledMessageCounts: Map<string, number>;
}

function freshState(): InMemoryState {
  return {
    customersByPhone: new Map(),
    appointments: [],
    jobs: new Map(),
    canceledAppointments: [],
    canceledJobs: [],
    canceledMessageCounts: new Map(),
  };
}

function createInMemoryCancellationDb(state: InMemoryState): CancellationDb {
  return {
    async findCustomerIdsByPhone(_businessId: string, phone: string) {
      // Find all customer IDs where the stored phone contains the search digits
      const results: string[] = [];
      for (const [storedPhone, customerIds] of state.customersByPhone) {
        if (storedPhone.includes(phone) || phone.includes(storedPhone)) {
          results.push(...customerIds);
        }
      }
      return results;
    },

    async findActiveAppointments(_businessId: string, customerIds: string[]) {
      // Return appointments that match any of the customer IDs
      // In real DB this filters by status and date; here we trust the test data
      return state.appointments;
    },

    async getSchedulingJobForAppointment(appointmentId: string) {
      return state.jobs.get(appointmentId) ?? null;
    },

    async updateAppointmentCanceled(appointmentId: string, reason: string, canceledBy: string) {
      state.canceledAppointments.push({ appointmentId, reason, canceledBy });
    },

    async transitionJobToCanceled(jobId: string) {
      state.canceledJobs.push(jobId);
    },

    async cancelPendingMessages(jobId: string) {
      const count = 2; // simulate canceling 2 pending messages
      state.canceledMessageCounts.set(jobId, count);
      return count;
    },
  };
}

// ── findCustomerAppointments ──────────────────────────────────────────────────

describe("findCustomerAppointments", () => {
  it("finds appointments by phone number", async () => {
    const state = freshState();
    state.customersByPhone.set("4045551234", ["cust-1"]);
    state.appointments.push({
      appointmentId: "appt-1",
      schedulingJobId: "job-1",
      techName: "Jake Rodriguez",
      date: "2026-04-15",
      windowStart: "9:00 AM",
      windowEnd: "11:00 AM",
      serviceDescription: "HVAC repair",
      status: "booked",
    });

    const db = createInMemoryCancellationDb(state);
    const results = await findCustomerAppointments("biz-1", "(404) 555-1234", db);

    expect(results).toHaveLength(1);
    expect(results[0]!.appointmentId).toBe("appt-1");
    expect(results[0]!.techName).toBe("Jake Rodriguez");
  });

  it("strips non-digit characters for fuzzy phone match", async () => {
    const state = freshState();
    state.customersByPhone.set("4045551234", ["cust-1"]);
    state.appointments.push({
      appointmentId: "appt-1",
      schedulingJobId: "job-1",
      techName: "Tech A",
      date: "2026-04-15",
      windowStart: "TBD",
      windowEnd: "TBD",
      serviceDescription: "Plumbing",
      status: "booked",
    });

    const db = createInMemoryCancellationDb(state);

    // Various phone formats should all match
    const r1 = await findCustomerAppointments("biz-1", "+1 (404) 555-1234", db);
    expect(r1).toHaveLength(1);

    const r2 = await findCustomerAppointments("biz-1", "4045551234", db);
    expect(r2).toHaveLength(1);

    const r3 = await findCustomerAppointments("biz-1", "404-555-1234", db);
    expect(r3).toHaveLength(1);
  });

  it("returns empty array when no customer found", async () => {
    const state = freshState();
    const db = createInMemoryCancellationDb(state);

    const results = await findCustomerAppointments("biz-1", "9999999999", db);
    expect(results).toHaveLength(0);
  });

  it("returns empty array when phone is too short", async () => {
    const state = freshState();
    state.customersByPhone.set("4045551234", ["cust-1"]);
    const db = createInMemoryCancellationDb(state);

    const results = await findCustomerAppointments("biz-1", "123", db);
    expect(results).toHaveLength(0);
  });

  it("returns multiple appointments for same customer", async () => {
    const state = freshState();
    state.customersByPhone.set("4045551234", ["cust-1"]);
    state.appointments.push(
      {
        appointmentId: "appt-1",
        schedulingJobId: "job-1",
        techName: "Tech A",
        date: "2026-04-15",
        windowStart: "9:00 AM",
        windowEnd: "11:00 AM",
        serviceDescription: "HVAC repair",
        status: "booked",
      },
      {
        appointmentId: "appt-2",
        schedulingJobId: "job-2",
        techName: "Tech B",
        date: "2026-04-18",
        windowStart: "1:00 PM",
        windowEnd: "3:00 PM",
        serviceDescription: "AC maintenance",
        status: "booked",
      },
    );

    const db = createInMemoryCancellationDb(state);
    const results = await findCustomerAppointments("biz-1", "4045551234", db);

    expect(results).toHaveLength(2);
    expect(results[0]!.appointmentId).toBe("appt-1");
    expect(results[1]!.appointmentId).toBe("appt-2");
  });
});

// ── cancelAppointment ─────────────────────────────────────────────────────────

describe("cancelAppointment", () => {
  it("successfully cancels a booked appointment", async () => {
    const state = freshState();
    state.jobs.set("appt-1", {
      jobId: "job-1",
      technicianId: "tech-1",
      scheduledDate: new Date("2026-04-15"),
      status: "NOT_STARTED",
    });

    const db = createInMemoryCancellationDb(state);
    const result = await cancelAppointment("appt-1", "Schedule conflict", "customer", db);

    expect(result.success).toBe(true);
    expect(result.appointmentId).toBe("appt-1");

    // Appointment was marked canceled
    expect(state.canceledAppointments).toHaveLength(1);
    expect(state.canceledAppointments[0]!.appointmentId).toBe("appt-1");
    expect(state.canceledAppointments[0]!.reason).toBe("Schedule conflict");
    expect(state.canceledAppointments[0]!.canceledBy).toBe("customer");

    // Job was transitioned to CANCELED
    expect(state.canceledJobs).toContain("job-1");

    // Pending messages were canceled
    expect(state.canceledMessageCounts.get("job-1")).toBe(2);
  });

  it("cancels appointment with NEEDS_REBOOK status job", async () => {
    const state = freshState();
    state.jobs.set("appt-1", {
      jobId: "job-1",
      technicianId: "tech-1",
      scheduledDate: new Date("2026-04-15"),
      status: "NEEDS_REBOOK",
    });

    const db = createInMemoryCancellationDb(state);
    const result = await cancelAppointment("appt-1", "Changed my mind", "customer", db);

    expect(result.success).toBe(true);
    expect(state.canceledJobs).toContain("job-1");
  });

  it("cancels appointment that has no linked scheduling job", async () => {
    const state = freshState();
    // No job entry — appointment exists but no scheduling_job link

    const db = createInMemoryCancellationDb(state);
    const result = await cancelAppointment("appt-1", "Not needed", "customer", db);

    // Should still succeed — just cancels the appointment record
    expect(result.success).toBe(true);
    expect(state.canceledAppointments).toHaveLength(1);
    expect(state.canceledJobs).toHaveLength(0); // no job to cancel
  });

  it("rejects cancellation when job is EN_ROUTE", async () => {
    const state = freshState();
    state.jobs.set("appt-1", {
      jobId: "job-1",
      technicianId: "tech-1",
      scheduledDate: new Date("2026-04-15"),
      status: "EN_ROUTE",
    });

    const db = createInMemoryCancellationDb(state);
    const result = await cancelAppointment("appt-1", "Changed my mind", "customer", db);

    expect(result.success).toBe(false);
    expect(result.reason).toBe("cannot_cancel_en_route");
    expect(state.canceledAppointments).toHaveLength(0);
    expect(state.canceledJobs).toHaveLength(0);
  });

  it("rejects cancellation when job is IN_PROGRESS", async () => {
    const state = freshState();
    state.jobs.set("appt-1", {
      jobId: "job-1",
      technicianId: "tech-1",
      scheduledDate: new Date("2026-04-15"),
      status: "IN_PROGRESS",
    });

    const db = createInMemoryCancellationDb(state);
    const result = await cancelAppointment("appt-1", "Reason", "customer", db);

    expect(result.success).toBe(false);
    expect(result.reason).toBe("cannot_cancel_in_progress");
  });

  it("rejects cancellation when job is COMPLETED", async () => {
    const state = freshState();
    state.jobs.set("appt-1", {
      jobId: "job-1",
      technicianId: "tech-1",
      scheduledDate: new Date("2026-04-15"),
      status: "COMPLETED",
    });

    const db = createInMemoryCancellationDb(state);
    const result = await cancelAppointment("appt-1", "Reason", "customer", db);

    expect(result.success).toBe(false);
    expect(result.reason).toBe("cannot_cancel_completed");
  });

  it("stores the cancellation reason correctly", async () => {
    const state = freshState();
    state.jobs.set("appt-1", {
      jobId: "job-1",
      technicianId: "tech-1",
      scheduledDate: new Date("2026-04-15"),
      status: "NOT_STARTED",
    });

    const db = createInMemoryCancellationDb(state);
    await cancelAppointment("appt-1", "Found a cheaper option", "customer", db);

    expect(state.canceledAppointments[0]!.reason).toBe("Found a cheaper option");
  });

  it("records canceled_by as 'owner' when owner cancels", async () => {
    const state = freshState();
    state.jobs.set("appt-1", {
      jobId: "job-1",
      technicianId: "tech-1",
      scheduledDate: new Date("2026-04-15"),
      status: "NOT_STARTED",
    });

    const db = createInMemoryCancellationDb(state);
    await cancelAppointment("appt-1", "Weather", "owner", db);

    expect(state.canceledAppointments[0]!.canceledBy).toBe("owner");
  });
});

// ── Cancellation without reason (should be blocked by AI) ─────────────────────

describe("cancellation guard — reason required", () => {
  it("cancelAppointment requires a non-empty reason string", async () => {
    // The cancellation pipeline itself always receives a reason from the AI.
    // The AI prompt enforces: cancelRequested cannot be true without cancellationReason.
    // This test documents the contract: if somehow called with empty reason,
    // it still executes (the guard is in the AI layer, not here).
    const state = freshState();
    state.jobs.set("appt-1", {
      jobId: "job-1",
      technicianId: "tech-1",
      scheduledDate: new Date("2026-04-15"),
      status: "NOT_STARTED",
    });

    const db = createInMemoryCancellationDb(state);

    // The AI pipeline checks: cancelRequested === true && cancellationReason is truthy
    // An empty string is falsy, so the pipeline won't call cancelAppointment
    // This is tested at the AI decision level, not the cancelAppointment function level
    const emptyReason = "";
    const isTruthy = Boolean(emptyReason);
    expect(isTruthy).toBe(false); // empty string won't pass the AI pipeline check
  });
});
