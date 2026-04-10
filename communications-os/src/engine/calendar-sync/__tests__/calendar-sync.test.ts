// ============================================================
// src/engine/calendar-sync/__tests__/calendar-sync.test.ts
//
// GOOGLE CALENDAR SYNC — UNIT TESTS
//
// Test categories:
//   GC01  New appointment → create event, store event ID
//   GC02  Existing appointment (has eventId) → update event
//   GC03  No calendar connection → error
//   GC04  Inactive connection → error
//   GC05  Fields mapped correctly (title, time, location, description)
//   GC06  Delete appointment event → cleared on record
//   GC07  Delete with no event ID → success no-op
//   GC08  Google API failure → logs error, returns success = false
//   GC09  calendar_sync_log entry created on successful sync
//   GC10  saveCalendarConnection / getCalendarConnection round-trip
// ============================================================

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  syncAppointmentToCalendar,
  deleteCalendarEvent,
  getCalendarConnection,
  saveCalendarConnection,
  handleCalendarWebhook,
  processGracePeriodChanges,
  undoPendingChange,
  _resetCalendarSyncStoreForTest,
  _seedAppointmentForTest,
  _seedCalendarConnectionForTest,
  _seedPendingChangeForTest,
  _setGoogleCalendarClientForTest,
  _setGoogleEventFetchForTest,
  _getAppointmentForTest,
  _getSyncLogForTest,
  _getPendingChangeForTest,
  _getAdminNotificationsForTest,
} from "../index";

import type { GoogleCalendarClient, GoogleCalendarEvent } from "../contract";

// ── Constants ─────────────────────────────────────────────────

const BIZ_ID = "biz_gc_001";
const APPT_ID = "appt_gc_001";
const CAL_ID = "cal_gc_primary@group.calendar.google.com";
const GOOGLE_EVENT_ID = "google_evt_001";

// ── Helpers ───────────────────────────────────────────────────

function seedConnection(overrides: Partial<{ isActive: boolean }> = {}): void {
  _seedCalendarConnectionForTest({
    id: "conn_gc_001",
    businessId: BIZ_ID,
    googleCalendarId: CAL_ID,
    accessToken: "access_token_001",
    refreshToken: "refresh_token_001",
    tokenExpiresAt: new Date(Date.now() + 3600 * 1000),
    isActive: overrides.isActive ?? true,
    createdAt: new Date(),
  });
}

function seedAppointment(
  overrides: Partial<{
    googleCalendarEventId: string | null;
    notes: string | null;
    address: string | null;
  }> = {},
): void {
  _seedAppointmentForTest({
    id: APPT_ID,
    businessId: BIZ_ID,
    customerName: "Jane Smith",
    serviceType: "Drain Cleaning",
    appointmentDate: "2025-06-15",
    appointmentTime: "09:00",
    durationMinutes: 60,
    notes: overrides.notes ?? "Customer reports slow drain",
    address: overrides.address ?? "123 Main St, Springfield, IL",
    googleCalendarEventId: overrides.googleCalendarEventId ?? null,
  });
}

function makePassthroughClient(): GoogleCalendarClient {
  return {
    createEvent: async (_calId, _event) => ({ id: GOOGLE_EVENT_ID }),
    updateEvent: async (_calId, eventId, _event) => ({ id: eventId }),
    deleteEvent: async (_calId, _eventId) => {},
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe("GC: Google Calendar sync", () => {
  beforeEach(() => {
    _resetCalendarSyncStoreForTest();
    seedConnection();
    seedAppointment();
    _setGoogleCalendarClientForTest(makePassthroughClient());
  });

  it("GC01: sync new appointment (no event ID) → creates event, stores event ID", async () => {
    const result = await syncAppointmentToCalendar(APPT_ID);

    expect(result.success).toBe(true);
    expect(result.action).toBe("created");
    expect(result.googleEventId).toBeTruthy();

    const appt = _getAppointmentForTest(APPT_ID);
    expect(appt?.googleCalendarEventId).toBe(result.googleEventId);
  });

  it("GC02: sync existing appointment (has event ID) → updates event", async () => {
    seedAppointment({ googleCalendarEventId: GOOGLE_EVENT_ID });

    const result = await syncAppointmentToCalendar(APPT_ID);

    expect(result.success).toBe(true);
    expect(result.action).toBe("updated");
    expect(result.googleEventId).toBe(GOOGLE_EVENT_ID);
  });

  it("GC03: sync with no calendar connection → returns error no_calendar_connection", async () => {
    _resetCalendarSyncStoreForTest();
    seedAppointment();
    _setGoogleCalendarClientForTest(makePassthroughClient());
    // No connection seeded

    const result = await syncAppointmentToCalendar(APPT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toBe("no_calendar_connection");
  });

  it("GC04: sync with inactive connection → returns error no_calendar_connection", async () => {
    _resetCalendarSyncStoreForTest();
    seedConnection({ isActive: false });
    seedAppointment();
    _setGoogleCalendarClientForTest(makePassthroughClient());

    const result = await syncAppointmentToCalendar(APPT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toBe("no_calendar_connection");
  });

  it("GC05: sync maps title, time, location, and description correctly", async () => {
    let capturedEvent: Parameters<GoogleCalendarClient["createEvent"]>[1] | undefined;
    _setGoogleCalendarClientForTest({
      createEvent: async (_calId, event) => {
        capturedEvent = event;
        return { id: "evt_capture_001" };
      },
      updateEvent: async (_calId, eventId, _event) => ({ id: eventId }),
      deleteEvent: async () => {},
    });

    await syncAppointmentToCalendar(APPT_ID);

    expect(capturedEvent).toBeTruthy();
    expect(capturedEvent?.summary).toBe("Drain Cleaning — Jane Smith");
    expect(capturedEvent?.location).toBe("123 Main St, Springfield, IL");
    expect(capturedEvent?.description).toBe("Customer reports slow drain");
    // Start time should contain the date
    expect(capturedEvent?.start.dateTime).toContain("2025-06-15");
    expect(capturedEvent?.start.dateTime).toContain("09:00");
  });

  it("GC06: deleteCalendarEvent → event deleted, event ID cleared on appointment", async () => {
    seedAppointment({ googleCalendarEventId: GOOGLE_EVENT_ID });

    const result = await deleteCalendarEvent(APPT_ID);

    expect(result.success).toBe(true);
    expect(result.action).toBe("deleted");

    const appt = _getAppointmentForTest(APPT_ID);
    expect(appt?.googleCalendarEventId).toBeNull();
  });

  it("GC07: deleteCalendarEvent with no event ID → returns success (no-op)", async () => {
    // No google_calendar_event_id on appointment
    let deleteCalled = false;
    _setGoogleCalendarClientForTest({
      createEvent: async () => ({ id: "" }),
      updateEvent: async (_calId, eventId) => ({ id: eventId }),
      deleteEvent: async () => { deleteCalled = true; },
    });

    const result = await deleteCalendarEvent(APPT_ID);

    expect(result.success).toBe(true);
    expect(result.action).toBe("deleted");
    expect(deleteCalled).toBe(false);
  });

  it("GC08: Google API failure → logs error in sync log, returns success = false", async () => {
    _setGoogleCalendarClientForTest({
      createEvent: async () => { throw new Error("google_api_error"); },
      updateEvent: async (_calId, eventId) => ({ id: eventId }),
      deleteEvent: async () => {},
    });

    const result = await syncAppointmentToCalendar(APPT_ID);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();

    // Verify a failed log entry was written
    const logEntries = _getSyncLogForTest(APPT_ID);
    expect(logEntries.length).toBeGreaterThan(0);
    expect(logEntries[0]?.success).toBe(false);
    expect(logEntries[0]?.errorMessage).toBeTruthy();
  });

  it("GC09: calendar_sync_log entry created on successful sync", async () => {
    await syncAppointmentToCalendar(APPT_ID);

    const logEntries = _getSyncLogForTest(APPT_ID);
    expect(logEntries.length).toBe(1);
    expect(logEntries[0]?.success).toBe(true);
    expect(logEntries[0]?.direction).toBe("outbound");
    expect(logEntries[0]?.action).toBe("created");
    expect(logEntries[0]?.businessId).toBe(BIZ_ID);
  });

  it("GC10: saveCalendarConnection stores and getCalendarConnection retrieves it", async () => {
    _resetCalendarSyncStoreForTest();

    const saved = await saveCalendarConnection({
      businessId: BIZ_ID,
      googleCalendarId: CAL_ID,
      accessToken: "new_access_token",
      refreshToken: "new_refresh_token",
      tokenExpiresAt: new Date(Date.now() + 7200 * 1000),
      isActive: true,
    });

    expect(saved.id).toBeTruthy();
    expect(saved.businessId).toBe(BIZ_ID);

    const retrieved = await getCalendarConnection(BIZ_ID);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.googleCalendarId).toBe(CAL_ID);
    expect(retrieved?.isActive).toBe(true);
  });

  // ── Part 2: Inbound sync + grace period (GC11–GC20) ──────────

  describe("GC inbound webhook + grace period", () => {
    // A Google event matching our seeded appointment
    function makeSameTimeEvent(): GoogleCalendarEvent {
      return {
        summary: "Drain Cleaning — Jane Smith",
        start: { dateTime: "2025-06-15T09:00:00", timeZone: "America/New_York" },
        end: { dateTime: "2025-06-15T10:00:00", timeZone: "America/New_York" },
        description: "Customer reports slow drain",
        location: "123 Main St, Springfield, IL",
      };
    }

    function makeDifferentTimeEvent(): GoogleCalendarEvent {
      return {
        summary: "Drain Cleaning — Jane Smith",
        start: { dateTime: "2025-06-15T10:00:00", timeZone: "America/New_York" },
        end: { dateTime: "2025-06-15T11:00:00", timeZone: "America/New_York" },
      };
    }

    beforeEach(() => {
      _resetCalendarSyncStoreForTest();
      seedConnection();
      seedAppointment({ googleCalendarEventId: GOOGLE_EVENT_ID });
      _setGoogleCalendarClientForTest(makePassthroughClient());
      _setGoogleEventFetchForTest(async () => makeSameTimeEvent());
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("GC11: calendar webhook delete → creates PendingChange, does NOT cancel appointment yet", async () => {
      const result = await handleCalendarWebhook({
        calendarId: CAL_ID,
        eventId: GOOGLE_EVENT_ID,
        changeType: "deleted",
      });

      expect(result.success).toBe(true);
      expect(result.pendingChangeId).toBeTruthy();
      expect(result.appliedImmediately).toBe(false);

      // Appointment must still exist and NOT be canceled
      const appt = _getAppointmentForTest(APPT_ID);
      expect(appt).toBeTruthy();
      expect(appt?.isCanceled).toBeFalsy();
    });

    it("GC12: calendar webhook delete → admin notification queued for the business", async () => {
      await handleCalendarWebhook({
        calendarId: CAL_ID,
        eventId: GOOGLE_EVENT_ID,
        changeType: "deleted",
      });

      const notifications = _getAdminNotificationsForTest();
      expect(notifications.length).toBeGreaterThan(0);
      expect(notifications[0]?.businessId).toBe(BIZ_ID);
      expect(notifications[0]?.message).toMatch(/Jane Smith/);
      expect(notifications[0]?.message).toMatch(/canceled/i);
    });

    it("GC13: processGracePeriodChanges after 5 min → appointment canceled", async () => {
      vi.useFakeTimers();

      const webhookResult = await handleCalendarWebhook({
        calendarId: CAL_ID,
        eventId: GOOGLE_EVENT_ID,
        changeType: "deleted",
      });
      expect(webhookResult.pendingChangeId).toBeTruthy();

      // Advance past grace period
      vi.advanceTimersByTime(6 * 60 * 1000);

      const result = await processGracePeriodChanges();

      expect(result.applied).toBeGreaterThan(0);

      const appt = _getAppointmentForTest(APPT_ID);
      expect(appt?.isCanceled).toBe(true);
    });

    it("GC14: undoPendingChange before 5 min → appointment preserved, isUndone = true", async () => {
      vi.useFakeTimers();

      const webhookResult = await handleCalendarWebhook({
        calendarId: CAL_ID,
        eventId: GOOGLE_EVENT_ID,
        changeType: "deleted",
      });
      const pendingId = webhookResult.pendingChangeId!;

      // Undo BEFORE grace period expires
      vi.advanceTimersByTime(2 * 60 * 1000); // 2 minutes

      const undone = await undoPendingChange(pendingId);
      expect(undone).toBe(true);

      const pending = _getPendingChangeForTest(pendingId);
      expect(pending?.isUndone).toBe(true);

      // Appointment must NOT be canceled
      const appt = _getAppointmentForTest(APPT_ID);
      expect(appt?.isCanceled).toBeFalsy();
    });

    it("GC15: undoPendingChange after grace period expired → returns false", async () => {
      vi.useFakeTimers();

      const now = new Date();
      // Seed a pending change that is already past its window
      _seedPendingChangeForTest({
        id: "pending_expired_001",
        appointmentId: APPT_ID,
        businessId: BIZ_ID,
        changeType: "deleted",
        pendingUntil: new Date(now.getTime() - 1000), // 1 second ago
        isUndone: false,
        createdAt: new Date(now.getTime() - 6 * 60 * 1000),
      });

      const result = await undoPendingChange("pending_expired_001");
      expect(result).toBe(false);
    });

    it("GC16: calendar webhook update with time change → creates PendingChange, appliedImmediately = false", async () => {
      _setGoogleEventFetchForTest(async () => makeDifferentTimeEvent());

      const result = await handleCalendarWebhook({
        calendarId: CAL_ID,
        eventId: GOOGLE_EVENT_ID,
        changeType: "updated",
      });

      expect(result.success).toBe(true);
      expect(result.appliedImmediately).toBe(false);
      expect(result.pendingChangeId).toBeTruthy();

      // Appointment time must NOT be changed yet
      const appt = _getAppointmentForTest(APPT_ID);
      expect(appt?.appointmentTime).toBe("09:00");
    });

    it("GC17: calendar webhook update with description-only change → applied immediately, no grace period", async () => {
      // Same time, different description
      _setGoogleEventFetchForTest(async () => ({
        ...makeSameTimeEvent(),
        description: "Updated: customer also has leaky faucet",
      }));

      const result = await handleCalendarWebhook({
        calendarId: CAL_ID,
        eventId: GOOGLE_EVENT_ID,
        changeType: "updated",
      });

      expect(result.success).toBe(true);
      expect(result.appliedImmediately).toBe(true);
      expect(result.pendingChangeId).toBeUndefined();

      // Notes should be updated immediately
      const appt = _getAppointmentForTest(APPT_ID);
      expect(appt?.notes).toBe("Updated: customer also has leaky faucet");
    });

    it("GC18: calendar webhook with unknown eventId → returns error", async () => {
      const result = await handleCalendarWebhook({
        calendarId: CAL_ID,
        eventId: "nonexistent_google_event",
        changeType: "deleted",
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("GC19: processGracePeriodChanges skips undone changes", async () => {
      vi.useFakeTimers();

      // Seed an undone pending change already past its grace period
      const now = new Date();
      _seedPendingChangeForTest({
        id: "pending_undone_001",
        appointmentId: APPT_ID,
        businessId: BIZ_ID,
        changeType: "deleted",
        pendingUntil: new Date(now.getTime() - 1000),
        isUndone: true,
        createdAt: new Date(now.getTime() - 6 * 60 * 1000),
      });

      const result = await processGracePeriodChanges();

      expect(result.undone).toBe(1);
      expect(result.applied).toBe(0);

      // Appointment must NOT be canceled
      const appt = _getAppointmentForTest(APPT_ID);
      expect(appt?.isCanceled).toBeFalsy();
    });

    it("GC20: processGracePeriodChanges writes sync log entry with direction = inbound", async () => {
      vi.useFakeTimers();

      await handleCalendarWebhook({
        calendarId: CAL_ID,
        eventId: GOOGLE_EVENT_ID,
        changeType: "deleted",
      });

      vi.advanceTimersByTime(6 * 60 * 1000);

      await processGracePeriodChanges();

      const log = _getSyncLogForTest(APPT_ID);
      const inboundEntry = log.find((e) => e.direction === "inbound");
      expect(inboundEntry).toBeTruthy();
      expect(inboundEntry?.action).toBe("deleted");
      expect(inboundEntry?.success).toBe(true);
    });
  });
});
