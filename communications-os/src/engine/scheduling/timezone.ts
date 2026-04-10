// ============================================================
// src/engine/scheduling/timezone.ts
//
// BUSINESS TIMEZONE UTILITIES
//
// All scheduling decisions must be made in business-local time.
// Timestamps are stored in UTC in the database. This module
// converts between UTC and business-local time for scheduling
// math (capacity, quiet hours, morning/afternoon cutoffs, etc.).
//
// No external dependencies — uses Intl.DateTimeFormat for
// timezone conversion (built into Node.js ≥ 12).
// ============================================================

/**
 * Convert a UTC Date to the number of minutes past midnight
 * in the given IANA timezone (e.g. "America/New_York").
 *
 * Example: 2026-04-09T17:00:00Z in "America/New_York" (UTC-4 during EDT)
 *          → 13:00 local → returns 780
 */
export function toBusinessMinutes(utcDate: Date, timezone: string): number {
  const parts = getLocalParts(utcDate, timezone);
  return parts.hour * 60 + parts.minute;
}

/**
 * Build a UTC Date from a business-local "minutes from midnight" value
 * on a given reference date in the given timezone.
 *
 * Example: 780 minutes (13:00) on 2026-04-09 in "America/New_York"
 *          → 2026-04-09T17:00:00Z
 */
export function toUtcDate(
  businessLocalMinutes: number,
  referenceDate: Date,
  timezone: string,
): Date {
  const hours = Math.floor(businessLocalMinutes / 60);
  const minutes = businessLocalMinutes % 60;

  // Get the local date components from the reference date
  const parts = getLocalParts(referenceDate, timezone);

  // Build an ISO string in the target local time, then let the
  // timezone offset resolve it to UTC.
  // We use Intl to figure out the UTC offset for that local time.
  const localDateStr = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(hours)}:${pad2(minutes)}:00`;

  // Compute offset by comparing a known local time to UTC
  const offsetMs = getTimezoneOffsetMs(referenceDate, timezone);

  // localTime = UTC + offset  →  UTC = localTime - offset
  const localMs = new Date(localDateStr + "Z").getTime();
  return new Date(localMs - offsetMs);
}

/**
 * Get today's date (YYYY-MM-DD) in the business timezone.
 * Returns a Date object set to midnight UTC of that local date.
 *
 * Example: At 2026-04-10T02:00:00Z, "America/New_York" (UTC-4)
 *          → local is 2026-04-09 22:00 → returns Date for 2026-04-09T00:00:00Z
 */
export function businessToday(timezone: string, now?: Date): Date {
  const ref = now ?? new Date();
  const parts = getLocalParts(ref, timezone);
  return new Date(`${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T00:00:00Z`);
}

/**
 * Check whether a UTC timestamp falls within quiet hours
 * defined in business-local time.
 *
 * quietStart/quietEnd are "HH:MM" strings in business-local time.
 * Handles wrapping (e.g., 22:00 → 06:00).
 */
export function isInQuietHoursLocal(
  utcNow: Date,
  quietStart: string,
  quietEnd: string,
  timezone: string,
): boolean {
  const currentMinutes = toBusinessMinutes(utcNow, timezone);
  const start = parseHHMMSimple(quietStart);
  const end = parseHHMMSimple(quietEnd);

  if (start <= end) {
    // Non-wrapping window (e.g., 08:00 – 17:00)
    return currentMinutes >= start && currentMinutes < end;
  }
  // Wrapping window (e.g., 22:00 – 06:00)
  return currentMinutes >= start || currentMinutes < end;
}

/**
 * Compute the next quiet-hours-end as a UTC Date.
 *
 * Given a service date and quiet-hours-end in business-local time,
 * returns the UTC timestamp of the next quiet-hours-end.
 */
export function computeQuietHoursEndLocal(
  serviceDate: Date,
  quietEnd: string,
  timezone: string,
): Date {
  const endMinutes = parseHHMMSimple(quietEnd);
  return toUtcDate(endMinutes, serviceDate, timezone);
}

// ── Internal helpers ─────────────────────────────────────────────────────────

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function getLocalParts(utcDate: Date, timezone: string): LocalParts {
  // Use Intl.DateTimeFormat to extract local date/time components.
  // formatToParts gives us the individual components in the target timezone.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(utcDate);
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Missing ${type} in formatted date for timezone ${timezone}`);
    // Handle "24" hour which Intl may return as "24" for midnight in some locales
    const val = parseInt(part.value, 10);
    return type === "hour" && val === 24 ? 0 : val;
  };

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

function getTimezoneOffsetMs(referenceDate: Date, timezone: string): number {
  // Compute the offset by comparing the local representation to UTC.
  const parts = getLocalParts(referenceDate, timezone);
  const localStr = `${parts.year}-${pad2(parts.month)}-${pad2(parts.day)}T${pad2(parts.hour)}:${pad2(parts.minute)}:00Z`;
  const localAsUtcMs = new Date(localStr).getTime();
  const actualUtcMs = referenceDate.getTime();
  // offset = local - utc  (positive means ahead of UTC)
  return localAsUtcMs - actualUtcMs;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function parseHHMMSimple(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h! * 60 + m!;
}
