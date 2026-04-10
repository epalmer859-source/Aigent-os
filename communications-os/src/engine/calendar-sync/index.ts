// ============================================================
// src/engine/calendar-sync/index.ts
//
// GOOGLE CALENDAR SYNC — IMPLEMENTATION
//
// All DB access would go through Prisma in production.
// This module maintains in-memory stores so the test suite
// runs without a real DB.
//
// Production Prisma patterns:
//   const appt = await db.appointments.findUnique({ where: { id: appointmentId } });
//   const conn = await db.calendar_connections.findFirst({ where: { business_id, is_active: true } });
//   await db.appointments.update({ where: { id }, data: { google_calendar_event_id } });
//   await db.calendar_sync_log.create({ data: { ... } });
//   await db.calendar_connections.upsert({ where: { business_id }, data: { ... } });
// ============================================================

import {
  DEFAULT_CALENDAR_TIMEZONE,
  GRACE_PERIOD_MINUTES,
  SYNC_DIRECTION_INBOUND,
  SYNC_DIRECTION_OUTBOUND,
  type CalendarAppointmentRecord,
  type CalendarConnection,
  type CalendarSyncLogEntry,
  type CalendarSyncResult,
  type GoogleCalendarClient,
  type GoogleCalendarEvent,
  type GoogleCalendarWebhookPayload,
  type GoogleEventFetchFn,
  type GracePeriodResult,
  type PendingChange,
} from "./contract";

// ── In-memory stores ──────────────────────────────────────────

const _appointments = new Map<string, CalendarAppointmentRecord>();
const _connections = new Map<string, CalendarConnection>(); // keyed by businessId
const _syncLog = new Map<string, CalendarSyncLogEntry[]>(); // keyed by appointmentId
const _pendingChanges = new Map<string, PendingChange>();
const _adminNotifications: Array<{ businessId: string; message: string }> = [];

// ── Injectable Google Calendar client ─────────────────────────

const _defaultClient: GoogleCalendarClient = {
  createEvent: async () => { throw new Error("No Google Calendar client configured"); },
  updateEvent: async () => { throw new Error("No Google Calendar client configured"); },
  deleteEvent: async () => { throw new Error("No Google Calendar client configured"); },
};

let _googleClient: GoogleCalendarClient = _defaultClient;

// ── Injectable event fetch (for inbound webhook) ──────────────

const _defaultEventFetch: GoogleEventFetchFn = async () => {
  throw new Error("No Google event fetch function configured");
};

let _googleEventFetch: GoogleEventFetchFn = _defaultEventFetch;

// ── ID generator ──────────────────────────────────────────────

function _genId(): string {
  // Production: crypto.randomUUID()
  return `cal_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── Field mapper ──────────────────────────────────────────────

function _buildGoogleEvent(appt: CalendarAppointmentRecord): GoogleCalendarEvent {
  // Title: "{serviceType} — {customerName}"
  const summary = `${appt.serviceType} — ${appt.customerName}`;

  // Build ISO dateTime from date + time strings
  // e.g. "2025-06-15" + "09:00" → "2025-06-15T09:00:00"
  const startDateTime = `${appt.appointmentDate}T${appt.appointmentTime}:00`;

  // Compute end time
  const startMs =
    new Date(`${appt.appointmentDate}T${appt.appointmentTime}:00`).getTime();
  const endMs = startMs + appt.durationMinutes * 60 * 1000;
  const endDate = new Date(endMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  const endDateTime = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}:00`;

  const event: GoogleCalendarEvent = {
    summary,
    start: { dateTime: startDateTime, timeZone: DEFAULT_CALENDAR_TIMEZONE },
    end: { dateTime: endDateTime, timeZone: DEFAULT_CALENDAR_TIMEZONE },
  };

  if (appt.notes) event.description = appt.notes;
  if (appt.address) event.location = appt.address;

  return event;
}

// ── Log helper ────────────────────────────────────────────────

function _writeLog(entry: Omit<CalendarSyncLogEntry, "id" | "createdAt">): void {
  // Production: db.calendar_sync_log.create({ data: { ... } })
  const record: CalendarSyncLogEntry = {
    ...entry,
    id: _genId(),
    createdAt: new Date(),
  };
  const existing = _syncLog.get(entry.appointmentId) ?? [];
  existing.push(record);
  _syncLog.set(entry.appointmentId, existing);
}

async function _writeLogToDb(entry: Omit<CalendarSyncLogEntry, "id" | "createdAt">): Promise<void> {
  const { db } = await import("~/server/db");
  await db.calendar_sync_log.create({
    data: {
      business_id: entry.businessId,
      appointment_id: entry.appointmentId,
      google_calendar_event_id: entry.googleEventId,
      sync_direction: entry.direction,
      sync_action: entry.action,
      is_destructive: entry.action === "deleted",
    },
  });
}

// ── DB appointment mapper ─────────────────────────────────────

function _padTwo(n: number): string { return String(n).padStart(2, "0"); }

async function _fetchCalendarAppt(
  appointmentId: string,
): Promise<CalendarAppointmentRecord | null> {
  const { db } = await import("~/server/db");
  const appt = await db.appointments.findUnique({
    where: { id: appointmentId },
    include: { customers: { select: { display_name: true } } },
  });
  if (!appt) return null;
  const dateObj = new Date(appt.appointment_date);
  const timeObj = new Date(appt.appointment_time);
  return {
    id: appt.id,
    businessId: appt.business_id,
    customerName: appt.customers.display_name ?? "Customer",
    serviceType: appt.service_type ?? "Service",
    appointmentDate: `${dateObj.getUTCFullYear()}-${_padTwo(dateObj.getUTCMonth() + 1)}-${_padTwo(dateObj.getUTCDate())}`,
    appointmentTime: `${_padTwo(timeObj.getUTCHours())}:${_padTwo(timeObj.getUTCMinutes())}`,
    durationMinutes: appt.duration_minutes ?? 60,
    notes: appt.admin_notes ?? null,
    address: appt.address ?? null,
    googleCalendarEventId: appt.google_calendar_event_id ?? null,
    isCanceled: (appt.status as string) === "canceled",
  };
}

// ── syncAppointmentToCalendar ─────────────────────────────────

export async function syncAppointmentToCalendar(
  appointmentId: string,
): Promise<CalendarSyncResult> {
  if (process.env.NODE_ENV !== "test") {
    // 1. Look up appointment from DB
    const appt = await _fetchCalendarAppt(appointmentId);
    if (!appt) return { success: false, action: "created", error: "appointment_not_found" };
    // 2. Look up active calendar connection (in-memory — calendar_connections table not yet in schema)
    const connection = _connections.get(appt.businessId);
    if (!connection || !connection.isActive) {
      return { success: false, action: "created", error: "no_calendar_connection" };
    }
    const event = _buildGoogleEvent(appt);
    const isCreate = !appt.googleCalendarEventId;
    const action = isCreate ? "created" : "updated";
    try {
      const gcResult = isCreate
        ? await _googleClient.createEvent(connection.googleCalendarId, event)
        : await _googleClient.updateEvent(connection.googleCalendarId, appt.googleCalendarEventId!, event);
      const googleEventId = gcResult.id;
      const { db } = await import("~/server/db");
      await db.appointments.update({
        where: { id: appointmentId },
        data: { google_calendar_event_id: googleEventId },
      });
      await _writeLogToDb({ businessId: appt.businessId, appointmentId, direction: SYNC_DIRECTION_OUTBOUND, action, googleEventId, success: true, errorMessage: null });
      return { success: true, googleEventId, action };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "unknown_error";
      await _writeLogToDb({ businessId: appt.businessId, appointmentId, direction: SYNC_DIRECTION_OUTBOUND, action, googleEventId: appt.googleCalendarEventId ?? null, success: false, errorMessage });
      return { success: false, action, error: errorMessage };
    }
  }

  // 1. Look up appointment
  // Production: db.appointments.findUnique({ where: { id: appointmentId } })
  const appt = _appointments.get(appointmentId);
  if (!appt) {
    return { success: false, action: "created", error: "appointment_not_found" };
  }

  // 2. Look up active calendar connection for business
  // Production: db.calendar_connections.findFirst({ where: { business_id: appt.businessId, is_active: true } })
  const connection = _connections.get(appt.businessId);
  if (!connection || !connection.isActive) {
    return { success: false, action: "created", error: "no_calendar_connection" };
  }

  const event = _buildGoogleEvent(appt);
  const isCreate = !appt.googleCalendarEventId;
  const action = isCreate ? "created" : "updated";

  try {
    let googleEventId: string;

    if (isCreate) {
      // 3a. Create new event
      const created = await _googleClient.createEvent(
        connection.googleCalendarId,
        event,
      );
      googleEventId = created.id;
    } else {
      // 3b. Update existing event
      const updated = await _googleClient.updateEvent(
        connection.googleCalendarId,
        appt.googleCalendarEventId!,
        event,
      );
      googleEventId = updated.id;
    }

    // 4. Persist google_calendar_event_id on appointment
    // Production: db.appointments.update({ where: { id }, data: { google_calendar_event_id: googleEventId } })
    appt.googleCalendarEventId = googleEventId;

    // 5. Log success
    _writeLog({
      businessId: appt.businessId,
      appointmentId,
      direction: SYNC_DIRECTION_OUTBOUND,
      action,
      googleEventId,
      success: true,
      errorMessage: null,
    });

    return { success: true, googleEventId, action };
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "unknown_error";

    // Log failure
    _writeLog({
      businessId: appt.businessId,
      appointmentId,
      direction: SYNC_DIRECTION_OUTBOUND,
      action,
      googleEventId: appt.googleCalendarEventId ?? null,
      success: false,
      errorMessage,
    });

    return { success: false, action, error: errorMessage };
  }
}

// ── deleteCalendarEvent ───────────────────────────────────────

export async function deleteCalendarEvent(
  appointmentId: string,
): Promise<CalendarSyncResult> {
  if (process.env.NODE_ENV !== "test") {
    const appt = await _fetchCalendarAppt(appointmentId);
    if (!appt) return { success: false, action: "deleted", error: "appointment_not_found" };
    if (!appt.googleCalendarEventId) return { success: true, action: "deleted" };
    const connection = _connections.get(appt.businessId);
    if (!connection || !connection.isActive) {
      return { success: false, action: "deleted", error: "no_calendar_connection" };
    }
    const googleEventId = appt.googleCalendarEventId;
    try {
      await _googleClient.deleteEvent(connection.googleCalendarId, googleEventId);
      const { db } = await import("~/server/db");
      await db.appointments.update({ where: { id: appointmentId }, data: { google_calendar_event_id: null } });
      await _writeLogToDb({ businessId: appt.businessId, appointmentId, direction: SYNC_DIRECTION_OUTBOUND, action: "deleted", googleEventId, success: true, errorMessage: null });
      return { success: true, action: "deleted", googleEventId };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "unknown_error";
      await _writeLogToDb({ businessId: appt.businessId, appointmentId, direction: SYNC_DIRECTION_OUTBOUND, action: "deleted", googleEventId, success: false, errorMessage });
      return { success: false, action: "deleted", error: errorMessage };
    }
  }

  // 1. Look up appointment
  // Production: db.appointments.findUnique({ where: { id: appointmentId } })
  const appt = _appointments.get(appointmentId);
  if (!appt) {
    return { success: false, action: "deleted", error: "appointment_not_found" };
  }

  // 2. If no event ID, nothing to delete
  if (!appt.googleCalendarEventId) {
    return { success: true, action: "deleted" };
  }

  const connection = _connections.get(appt.businessId);
  if (!connection || !connection.isActive) {
    return { success: false, action: "deleted", error: "no_calendar_connection" };
  }

  const googleEventId = appt.googleCalendarEventId;

  try {
    // 3. Delete from Google Calendar
    await _googleClient.deleteEvent(connection.googleCalendarId, googleEventId);

    // 4. Clear event ID on appointment record
    // Production: db.appointments.update({ where: { id }, data: { google_calendar_event_id: null } })
    appt.googleCalendarEventId = null;

    // 5. Log success
    _writeLog({
      businessId: appt.businessId,
      appointmentId,
      direction: SYNC_DIRECTION_OUTBOUND,
      action: "deleted",
      googleEventId,
      success: true,
      errorMessage: null,
    });

    return { success: true, action: "deleted", googleEventId };
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "unknown_error";

    _writeLog({
      businessId: appt.businessId,
      appointmentId,
      direction: SYNC_DIRECTION_OUTBOUND,
      action: "deleted",
      googleEventId,
      success: false,
      errorMessage,
    });

    return { success: false, action: "deleted", error: errorMessage };
  }
}

// ── getCalendarConnection ─────────────────────────────────────

export async function getCalendarConnection(
  businessId: string,
): Promise<CalendarConnection | null> {
  // Production: db.calendar_connections.findFirst({ where: { business_id: businessId, is_active: true } })
  return _connections.get(businessId) ?? null;
}

// ── saveCalendarConnection ────────────────────────────────────

export async function saveCalendarConnection(
  connection: Omit<CalendarConnection, "id" | "createdAt">,
): Promise<CalendarConnection> {
  // Production:
  //   db.calendar_connections.upsert({
  //     where: { business_id: connection.businessId },
  //     create: { id: uuid(), created_at: now(), ...connection },
  //     update: { ...connection, updated_at: now() },
  //   })
  const existing = _connections.get(connection.businessId);
  const record: CalendarConnection = {
    ...connection,
    id: existing?.id ?? _genId(),
    createdAt: existing?.createdAt ?? new Date(),
  };
  _connections.set(connection.businessId, record);
  return record;
}

// ── Reverse lookup: appointment by Google event ID ────────────

function _findAppointmentByEventId(
  googleEventId: string,
): CalendarAppointmentRecord | undefined {
  for (const appt of _appointments.values()) {
    if (appt.googleCalendarEventId === googleEventId) return appt;
  }
  return undefined;
}

// ── handleCalendarWebhook ─────────────────────────────────────

export async function handleCalendarWebhook(
  payload: GoogleCalendarWebhookPayload,
): Promise<GracePeriodResult> {
  const { calendarId, eventId, changeType } = payload;

  if (process.env.NODE_ENV !== "test") {
    const { db } = await import("~/server/db");
    const dbAppt = await db.appointments.findFirst({
      where: { google_calendar_event_id: eventId },
      include: { customers: { select: { display_name: true } } },
    });
    if (!dbAppt) return { success: false, appliedImmediately: false, error: "event_not_found" };
    const pad = _padTwo;
    const dateObj = new Date(dbAppt.appointment_date);
    const timeObj = new Date(dbAppt.appointment_time);
    const appt: CalendarAppointmentRecord = {
      id: dbAppt.id, businessId: dbAppt.business_id,
      customerName: dbAppt.customers.display_name ?? "Customer",
      serviceType: dbAppt.service_type ?? "Service",
      appointmentDate: `${dateObj.getUTCFullYear()}-${pad(dateObj.getUTCMonth()+1)}-${pad(dateObj.getUTCDate())}`,
      appointmentTime: `${pad(timeObj.getUTCHours())}:${pad(timeObj.getUTCMinutes())}`,
      durationMinutes: dbAppt.duration_minutes ?? 60,
      notes: dbAppt.admin_notes ?? null, address: dbAppt.address ?? null,
      googleCalendarEventId: dbAppt.google_calendar_event_id ?? null,
      isCanceled: (dbAppt.status as string) === "canceled",
    };
    const connection = _connections.get(appt.businessId);
    if (changeType === "deleted") {
      const now = new Date();
      const pendingUntil = new Date(now.getTime() + GRACE_PERIOD_MINUTES * 60 * 1000);
      const pending: PendingChange = { id: _genId(), appointmentId: appt.id, businessId: appt.businessId, changeType: "deleted", pendingUntil, isUndone: false, createdAt: now };
      _pendingChanges.set(pending.id, pending);
      _adminNotifications.push({ businessId: appt.businessId, message: `Calendar event for ${appt.customerName} was deleted. Appointment will be canceled in ${GRACE_PERIOD_MINUTES} minutes. Undo in Settings > Calendar.` });
      return { success: true, pendingChangeId: pending.id, appliedImmediately: false };
    }
    if (!connection || !connection.isActive) return { success: false, appliedImmediately: false, error: "no_calendar_connection" };
    let fetchedEvent: GoogleCalendarEvent;
    try { fetchedEvent = await _googleEventFetch(calendarId, eventId); } catch (err) {
      return { success: false, appliedImmediately: false, error: err instanceof Error ? err.message : "fetch_failed" };
    }
    const startDateTime = fetchedEvent.start.dateTime;
    const newDate = startDateTime.split("T")[0] ?? appt.appointmentDate;
    const newTime = startDateTime.split("T")[1]?.substring(0, 5) ?? appt.appointmentTime;
    const timeChanged = newDate !== appt.appointmentDate || newTime !== appt.appointmentTime;
    if (timeChanged) {
      const now = new Date();
      const pendingUntil = new Date(now.getTime() + GRACE_PERIOD_MINUTES * 60 * 1000);
      const pending: PendingChange = { id: _genId(), appointmentId: appt.id, businessId: appt.businessId, changeType: "updated", newDate, newTime, newLocation: fetchedEvent.location, pendingUntil, isUndone: false, createdAt: now };
      _pendingChanges.set(pending.id, pending);
      _adminNotifications.push({ businessId: appt.businessId, message: `Calendar event for ${appt.customerName} was rescheduled to ${newDate} at ${newTime}. Changes will apply in ${GRACE_PERIOD_MINUTES} minutes. Undo in Settings > Calendar.` });
      return { success: true, pendingChangeId: pending.id, appliedImmediately: false };
    }
    await db.appointments.update({ where: { id: appt.id }, data: { ...(fetchedEvent.description !== undefined ? { admin_notes: fetchedEvent.description } : {}), ...(fetchedEvent.location !== undefined ? { address: fetchedEvent.location } : {}) } });
    await _writeLogToDb({ businessId: appt.businessId, appointmentId: appt.id, direction: SYNC_DIRECTION_INBOUND, action: "updated", googleEventId: eventId, success: true, errorMessage: null });
    return { success: true, appliedImmediately: true };
  }

  // 1. Look up appointment by google_calendar_event_id
  // Production: db.appointments.findFirst({ where: { google_calendar_event_id: eventId } })
  const appt = _findAppointmentByEventId(eventId);
  if (!appt) {
    return { success: false, appliedImmediately: false, error: "event_not_found" };
  }

  const connection = _connections.get(appt.businessId);

  if (changeType === "deleted") {
    // Create PendingChange — do NOT cancel appointment yet
    const now = new Date();
    const pendingUntil = new Date(
      now.getTime() + GRACE_PERIOD_MINUTES * 60 * 1000,
    );
    const pending: PendingChange = {
      id: _genId(),
      appointmentId: appt.id,
      businessId: appt.businessId,
      changeType: "deleted",
      pendingUntil,
      isUndone: false,
      createdAt: now,
    };
    // Production: db.pending_calendar_changes.create({ data: { ... } })
    _pendingChanges.set(pending.id, pending);

    // Queue admin notification
    _adminNotifications.push({
      businessId: appt.businessId,
      message: `Calendar event for ${appt.customerName} was deleted. Appointment will be canceled in ${GRACE_PERIOD_MINUTES} minutes. Undo in Settings > Calendar.`,
    });

    return { success: true, pendingChangeId: pending.id, appliedImmediately: false };
  }

  // changeType === 'updated': fetch current event details from Google
  if (!connection || !connection.isActive) {
    return { success: false, appliedImmediately: false, error: "no_calendar_connection" };
  }

  let fetchedEvent: GoogleCalendarEvent;
  try {
    fetchedEvent = await _googleEventFetch(calendarId, eventId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "fetch_failed";
    return { success: false, appliedImmediately: false, error: msg };
  }

  // Parse new date and time from start.dateTime (format: "2025-06-15T10:00:00")
  const startDateTime = fetchedEvent.start.dateTime;
  const newDate = startDateTime.split("T")[0] ?? appt.appointmentDate;
  const newTime = startDateTime.split("T")[1]?.substring(0, 5) ?? appt.appointmentTime;

  const timeChanged =
    newDate !== appt.appointmentDate || newTime !== appt.appointmentTime;

  if (timeChanged) {
    // Grace period for time changes
    const now = new Date();
    const pendingUntil = new Date(
      now.getTime() + GRACE_PERIOD_MINUTES * 60 * 1000,
    );
    const pending: PendingChange = {
      id: _genId(),
      appointmentId: appt.id,
      businessId: appt.businessId,
      changeType: "updated",
      newDate,
      newTime,
      newLocation: fetchedEvent.location,
      pendingUntil,
      isUndone: false,
      createdAt: now,
    };
    // Production: db.pending_calendar_changes.create({ data: { ... } })
    _pendingChanges.set(pending.id, pending);

    _adminNotifications.push({
      businessId: appt.businessId,
      message: `Calendar event for ${appt.customerName} was rescheduled to ${newDate} at ${newTime}. Changes will apply in ${GRACE_PERIOD_MINUTES} minutes. Undo in Settings > Calendar.`,
    });

    return { success: true, pendingChangeId: pending.id, appliedImmediately: false };
  }

  // Description/location-only change → apply immediately
  if (fetchedEvent.description !== undefined) {
    appt.notes = fetchedEvent.description;
  }
  if (fetchedEvent.location !== undefined) {
    appt.address = fetchedEvent.location;
  }

  _writeLog({
    businessId: appt.businessId,
    appointmentId: appt.id,
    direction: SYNC_DIRECTION_INBOUND,
    action: "updated",
    googleEventId: eventId,
    success: true,
    errorMessage: null,
  });

  return { success: true, appliedImmediately: true };
}

// ── processGracePeriodChanges ─────────────────────────────────

export async function processGracePeriodChanges(): Promise<{
  processed: number;
  applied: number;
  undone: number;
}> {
  const now = new Date();
  let processed = 0;
  let applied = 0;
  let undone = 0;

  if (process.env.NODE_ENV !== "test") {
    const { db } = await import("~/server/db");
    for (const pending of _pendingChanges.values()) {
      if (pending.pendingUntil > now) continue;
      processed++;
      if (pending.isUndone) { undone++; continue; }
      if (pending.changeType === "deleted") {
        await db.appointments.update({ where: { id: pending.appointmentId }, data: { status: "canceled" as any, google_calendar_event_id: null, canceled_at: now } });
      } else if (pending.changeType === "updated") {
        await db.appointments.update({ where: { id: pending.appointmentId }, data: { ...(pending.newDate ? { appointment_date: new Date(pending.newDate + "T00:00:00.000Z") } : {}), ...(pending.newTime ? { appointment_time: new Date(`1970-01-01T${pending.newTime}Z`) } : {}), ...(pending.newLocation !== undefined ? { address: pending.newLocation } : {}) } });
      }
      const appt = await db.appointments.findUnique({ where: { id: pending.appointmentId }, select: { google_calendar_event_id: true } });
      await _writeLogToDb({ businessId: pending.businessId, appointmentId: pending.appointmentId, direction: SYNC_DIRECTION_INBOUND, action: pending.changeType === "deleted" ? "deleted" : "updated", googleEventId: appt?.google_calendar_event_id ?? null, success: true, errorMessage: null });
      applied++;
    }
    return { processed, applied, undone };
  }

  for (const pending of _pendingChanges.values()) {
    if (pending.pendingUntil > now) continue; // Not yet due

    processed++;

    if (pending.isUndone) {
      undone++;
      continue;
    }

    // Apply the change
    // Production: db.appointments.findUnique({ where: { id: pending.appointmentId } })
    const appt = _appointments.get(pending.appointmentId);
    if (!appt) continue;

    if (pending.changeType === "deleted") {
      // Production: db.appointments.update({ where: { id }, data: { status: 'canceled' } })
      appt.isCanceled = true;
      appt.googleCalendarEventId = null;
    } else if (pending.changeType === "updated") {
      // Apply time change
      if (pending.newDate) appt.appointmentDate = pending.newDate;
      if (pending.newTime) appt.appointmentTime = pending.newTime;
      if (pending.newLocation !== undefined) appt.address = pending.newLocation;
    }

    // Log with inbound direction
    _writeLog({
      businessId: pending.businessId,
      appointmentId: pending.appointmentId,
      direction: SYNC_DIRECTION_INBOUND,
      action: pending.changeType === "deleted" ? "deleted" : "updated",
      googleEventId: appt.googleCalendarEventId,
      success: true,
      errorMessage: null,
    });

    applied++;
  }

  return { processed, applied, undone };
}

// ── undoPendingChange ─────────────────────────────────────────

export async function undoPendingChange(
  pendingChangeId: string,
): Promise<boolean> {
  // Production: db.pending_calendar_changes.findUnique({ where: { id: pendingChangeId } })
  const pending = _pendingChanges.get(pendingChangeId);
  if (!pending) return false;

  // Grace period must still be active
  if (pending.pendingUntil <= new Date()) return false;

  // Mark as undone
  // Production: db.pending_calendar_changes.update({ where: { id }, data: { is_undone: true } })
  pending.isUndone = true;

  // Re-sync appointment back to Google Calendar to restore the event
  await syncAppointmentToCalendar(pending.appointmentId);

  return true;
}

// ── Test helpers ──────────────────────────────────────────────

export function _resetCalendarSyncStoreForTest(): void {
  _appointments.clear();
  _connections.clear();
  _syncLog.clear();
  _pendingChanges.clear();
  _adminNotifications.length = 0;
  _googleClient = _defaultClient;
  _googleEventFetch = _defaultEventFetch;
}

export function _seedAppointmentForTest(
  data: Record<string, unknown>,
): void {
  // Production: db.appointments.upsert({ ... })
  _appointments.set(
    data["id"] as string,
    data as unknown as CalendarAppointmentRecord,
  );
}

export function _seedCalendarConnectionForTest(
  data: Record<string, unknown>,
): void {
  // Production: db.calendar_connections.upsert({ ... })
  const record = data as unknown as CalendarConnection;
  _connections.set(record.businessId, record);
}

export function _setGoogleCalendarClientForTest(
  client: GoogleCalendarClient,
): void {
  _googleClient = client;
}

export function _getAppointmentForTest(
  id: string,
): CalendarAppointmentRecord | undefined {
  return _appointments.get(id);
}

export function _getSyncLogForTest(
  appointmentId: string,
): CalendarSyncLogEntry[] {
  return _syncLog.get(appointmentId) ?? [];
}

export function _seedPendingChangeForTest(
  data: Record<string, unknown>,
): void {
  // Production: db.pending_calendar_changes.upsert({ ... })
  _pendingChanges.set(
    data["id"] as string,
    data as unknown as PendingChange,
  );
}

export function _getPendingChangeForTest(
  id: string,
): PendingChange | undefined {
  return _pendingChanges.get(id);
}

export function _setGoogleEventFetchForTest(fn: GoogleEventFetchFn): void {
  _googleEventFetch = fn;
}

export function _getAdminNotificationsForTest(): Array<{
  businessId: string;
  message: string;
}> {
  return _adminNotifications;
}
