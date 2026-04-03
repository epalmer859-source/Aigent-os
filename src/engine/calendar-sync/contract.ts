// ============================================================
// src/engine/calendar-sync/contract.ts
//
// GOOGLE CALENDAR SYNC — CONTRACT
//
// Exports ONLY types and constants. Zero logic.
//
// Part 1: Outbound sync (app → Google Calendar) and OAuth setup.
// Part 2 (inbound) handles Google Calendar webhook → app.
//
// Blueprint source: Doc 12 Part 5, Doc 14 §2.7, §2.8
// ============================================================

// ── Core records ──────────────────────────────────────────────

export interface CalendarConnection {
  id: string;
  businessId: string;
  googleCalendarId: string;
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: Date;
  isActive: boolean;
  createdAt: Date;
}

export interface CalendarSyncResult {
  success: boolean;
  googleEventId?: string;
  action: "created" | "updated" | "deleted";
  error?: string;
}

export interface CalendarSyncLogEntry {
  id: string;
  businessId: string;
  appointmentId: string;
  direction: "outbound" | "inbound";
  action: "created" | "updated" | "deleted";
  googleEventId: string | null;
  success: boolean;
  errorMessage: string | null;
  createdAt: Date;
}

// ── Appointment record (minimal fields needed for sync) ───────

export interface CalendarAppointmentRecord {
  id: string;
  businessId: string;
  customerName: string;
  serviceType: string;
  appointmentDate: string; // ISO date string e.g. "2025-06-15"
  appointmentTime: string; // "HH:MM" 24-hour
  durationMinutes: number;
  notes: string | null;
  address: string | null;
  googleCalendarEventId: string | null;
  isCanceled?: boolean;
}

// ── Google Calendar API client (injectable) ───────────────────

export interface GoogleCalendarEvent {
  summary: string;
  description?: string;
  location?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

export interface GoogleCalendarClient {
  createEvent(
    calendarId: string,
    event: GoogleCalendarEvent,
  ): Promise<{ id: string }>;
  updateEvent(
    calendarId: string,
    eventId: string,
    event: GoogleCalendarEvent,
  ): Promise<{ id: string }>;
  deleteEvent(calendarId: string, eventId: string): Promise<void>;
}

export type GoogleCalendarClientFactory = () => GoogleCalendarClient;

// ── Function signatures ───────────────────────────────────────

export type SyncAppointmentToCalendarFn = (
  appointmentId: string,
) => Promise<CalendarSyncResult>;

export type DeleteCalendarEventFn = (
  appointmentId: string,
) => Promise<CalendarSyncResult>;

export type GetCalendarConnectionFn = (
  businessId: string,
) => Promise<CalendarConnection | null>;

export type SaveCalendarConnectionFn = (
  connection: Omit<CalendarConnection, "id" | "createdAt">,
) => Promise<CalendarConnection>;

// ── Constants ─────────────────────────────────────────────────

/** Default calendar timezone — overridable per business in production. */
export const DEFAULT_CALENDAR_TIMEZONE = "America/New_York";

/** Default appointment duration in minutes when not specified. */
export const DEFAULT_APPOINTMENT_DURATION_MINUTES = 60;

/** Grace period before a pending deletion is executed (minutes). */
export const PENDING_DELETION_GRACE_PERIOD_MINUTES = 5;

/** Direction label for outbound sync log entries. */
export const SYNC_DIRECTION_OUTBOUND = "outbound" as const;

/** Direction label for inbound sync log entries. */
export const SYNC_DIRECTION_INBOUND = "inbound" as const;

// ── Inbound sync types (Part 2) ───────────────────────────────

export interface GoogleCalendarWebhookPayload {
  calendarId: string;
  eventId: string;
  changeType: "updated" | "deleted";
}

export interface PendingChange {
  id: string;
  appointmentId: string;
  businessId: string;
  changeType: "updated" | "deleted";
  /** For time-change pending updates */
  newDate?: string;
  newTime?: string;
  newLocation?: string;
  /** createdAt + GRACE_PERIOD_MINUTES */
  pendingUntil: Date;
  isUndone: boolean;
  createdAt: Date;
}

export interface GracePeriodResult {
  success: boolean;
  pendingChangeId?: string;
  /** true if the change was applied immediately (no grace period needed) */
  appliedImmediately: boolean;
  error?: string;
}

/**
 * Injectable for fetching the current state of a Google Calendar event.
 * Production: calls the Google Calendar API with the stored access token.
 */
export type GoogleEventFetchFn = (
  calendarId: string,
  eventId: string,
) => Promise<GoogleCalendarEvent>;

// ── New function signatures (Part 2) ──────────────────────────

export type HandleCalendarWebhookFn = (
  payload: GoogleCalendarWebhookPayload,
) => Promise<GracePeriodResult>;

export type ProcessGracePeriodChangesFn = () => Promise<{
  processed: number;
  applied: number;
  undone: number;
}>;

export type UndoPendingChangeFn = (
  pendingChangeId: string,
) => Promise<boolean>;

/** Grace period before a pending inbound change is applied (minutes). */
export const GRACE_PERIOD_MINUTES = 5;
