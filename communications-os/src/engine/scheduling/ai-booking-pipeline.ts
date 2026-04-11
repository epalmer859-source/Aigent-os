// ============================================================
// src/engine/scheduling/ai-booking-pipeline.ts
//
// AI BOOKING PIPELINE — TWO-STEP SLOT PRESENTATION & BOOKING
//
// Step 1: generateAvailableSlots()
//   Customer confirms all 5 fields → system enumerates ALL valid
//   insertion positions across techs × days → returns slot list
//   with projected time windows for the customer to choose from.
//
// Step 2: bookSelectedSlot()
//   Customer picks a slot → system books that exact tech/date/position
//   via bookJob (atomic capacity + job creation).
//
// V1 address strategy: uses first tech's home_base as
// approximate coordinates (same metro area). Real geocoding
// via Google Maps Geocoding API can be added later.
// ============================================================

import { classifyServiceType, getBookedDuration, getUnknownTierDuration, type ServiceTypeRecord } from "./duration-intelligence";
import type { QueuedJob } from "./queue-insertion";
import { bookJob, type BookingRequest, type BookingOutcome } from "./booking-orchestrator";
import { checkCapacity, parseHHMM, calculateAvailableMinutes, type CapacityDb, type TimePreference, type TechProfile } from "./capacity-math";
import type { BookingOrchestratorDb } from "./booking-orchestrator";
import type { Coordinates } from "./osrm-service";
import type { TechCandidate } from "./tech-assignment";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SlotGenerationInput {
  businessId: string;
  serviceDescription: string;
  availabilityPreference: string | null;
  availabilityCutoffTime?: string | null;
}

export interface SlotGenerationDeps {
  getTechCandidates: (businessId: string) => Promise<TechCandidate[]>;
  getServiceTypes: (businessId: string) => Promise<ServiceTypeRecord[]>;
  getBusinessIndustry: (businessId: string) => Promise<string>;
  getQueueForTechDate: (technicianId: string, date: Date) => Promise<QueuedJob[]>;
  capacityDb: CapacityDb;
}

export interface AvailableSlot {
  index: number;
  technicianId: string;
  techName: string;
  date: string;         // ISO date "YYYY-MM-DD"
  queuePosition: number;
  windowStart: string;  // "HH:MM" (24h)
  windowEnd: string;    // "HH:MM" (24h)
  label: string;        // Human-readable, e.g. "Monday 2:30 – 4:30 PM with Mike"
  totalCostMinutes: number;
  serviceTypeId: string;
  serviceTypeName: string;
  timePreference: TimePreference;
}

export type SlotGenerationResult =
  | { success: true; slots: AvailableSlot[]; serviceTypeId: string; serviceTypeName: string; totalCostMinutes: number }
  | { success: false; reason: string };

export interface BookSlotInput {
  businessId: string;
  customerId: string;
  customerName: string;
  addressText: string;
  slot: AvailableSlot;
}

export interface BookSlotDeps {
  bookingDb: BookingOrchestratorDb;
  generateId: () => string;
}

export type BookSlotResult =
  | { booked: true; jobId: string; techName: string; scheduledDate: Date; queuePosition: number }
  | { booked: false; reason: string };

// ── Helpers ─────────────────────────────────────────────────────────────────

export function parseTimePreference(pref: string | null): TimePreference {
  if (!pref) return "SOONEST";
  const lower = pref.toLowerCase();
  if (lower.includes("morning")) return "MORNING";
  if (lower.includes("afternoon") || lower.includes("evening")) return "AFTERNOON";
  if (lower.includes("soonest") || lower.includes("asap") || lower.includes("earliest")) return "SOONEST";
  return "NO_PREFERENCE";
}

/**
 * Parse a cutoff time string (e.g. "13:00", "1:00 PM", "noon") into minutes from midnight.
 * Returns null if unparseable — caller should fall back to default (720 = noon).
 */
export function parseCutoffTime(cutoff: string | null | undefined): number | null {
  if (!cutoff) return null;
  const trimmed = cutoff.trim().toLowerCase();

  // "noon" / "12" → 720
  if (trimmed === "noon") return 720;

  // HH:MM 24-hour format (e.g. "13:00", "09:30")
  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const h = parseInt(match24[1]!, 10);
    const m = parseInt(match24[2]!, 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return h * 60 + m;
  }

  // Just a bare number like "1", "13"
  const matchBare = trimmed.match(/^(\d{1,2})$/);
  if (matchBare) {
    let h = parseInt(matchBare[1]!, 10);
    // Assume PM for numbers 1-6 (business hours), AM for 7-12
    if (h >= 1 && h <= 6) h += 12;
    if (h >= 7 && h <= 23) return h * 60;
  }

  return null;
}

/** Round minutes to nearest 15. */
function roundTo15(minutes: number): number {
  return Math.round(minutes / 15) * 15;
}

/** Format minutes-from-midnight as "H:MM AM/PM". */
function formatTime(minutes: number): string {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
}

/** Format minutes-from-midnight as "HH:MM" (24h). */
function formatTime24(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/** Format a date relative to today for slot labels. */
function formatDateLabel(date: Date, today: Date): string {
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dateMid = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((dateMid.getTime() - todayMid.getTime()) / (86400000));
  if (dayDiff === 0) return "Today";
  if (dayDiff === 1) return "Tomorrow";
  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

/** Check if a date is a weekend (Sat/Sun). */
function isWeekend(date: Date): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Compute all available time windows for a tech on a given day.
 *
 * Walks the working day, accounts for existing queued jobs and lunch,
 * and finds every gap where a job of `jobDurationMinutes` could fit.
 * Returns multiple windows per day (morning, afternoon, etc.) rather
 * than one-per-queue-position.
 */
function computeAvailableWindows(
  queue: QueuedJob[],
  tech: TechCandidate,
  jobDurationMinutes: number,
): { startMinutes: number; queuePosition: number }[] {
  const workStart = parseHHMM(tech.workingHoursStart);
  const lunchStart = parseHHMM(tech.lunchStart);
  const lunchEnd = parseHHMM(tech.lunchEnd);
  const workEnd = parseHHMM(tech.workingHoursEnd);
  const overtime = tech.overtimeCapMinutes ?? 0;
  const dayEnd = workEnd + overtime;

  // Build a list of occupied intervals from the existing queue
  const occupied: { start: number; end: number }[] = [];
  let cursor = workStart;
  for (const job of queue) {
    // Skip lunch
    if (cursor >= lunchStart && cursor < lunchEnd) {
      cursor = lunchEnd;
    }
    const jobDuration = job.estimatedDurationMinutes + job.driveTimeMinutes;
    occupied.push({ start: cursor, end: cursor + jobDuration });
    cursor += jobDuration;
    // Skip lunch if job pushed us into it
    if (cursor > lunchStart && cursor < lunchEnd) {
      cursor = lunchEnd;
    }
  }

  // Find all gaps in the day where the new job could fit
  const windows: { startMinutes: number; queuePosition: number }[] = [];
  let searchStart = workStart;

  for (let i = 0; i <= occupied.length; i++) {
    const gapEnd = i < occupied.length ? occupied[i]!.start : dayEnd;
    let gapStart = searchStart;

    // Skip lunch if gap starts in lunch
    if (gapStart >= lunchStart && gapStart < lunchEnd) {
      gapStart = lunchEnd;
    }

    // Within this gap, enumerate all non-overlapping windows
    let windowStart = gapStart;
    while (windowStart + jobDurationMinutes <= gapEnd) {
      // Skip lunch: if window would span lunch, jump to after lunch
      if (windowStart < lunchStart && windowStart + jobDurationMinutes > lunchStart) {
        windowStart = lunchEnd;
        continue;
      }
      // Skip if we're in lunch
      if (windowStart >= lunchStart && windowStart < lunchEnd) {
        windowStart = lunchEnd;
        continue;
      }

      // Must fit within day end
      if (windowStart + jobDurationMinutes > dayEnd) break;

      windows.push({ startMinutes: windowStart, queuePosition: i });

      // Advance by the job duration + 15 min buffer to find next window
      windowStart += jobDurationMinutes + 15;
    }

    // Advance search past this occupied interval
    if (i < occupied.length) {
      searchStart = occupied[i]!.end;
    }
  }

  return windows;
}

// ── Step 1: Generate Available Slots ──────────────────────────────────────────

export async function generateAvailableSlots(
  input: SlotGenerationInput,
  deps: SlotGenerationDeps,
): Promise<SlotGenerationResult> {
  const { businessId, serviceDescription, availabilityPreference, availabilityCutoffTime } = input;

  // 1. Load techs, service types, industry
  const [techs, serviceTypes, industry] = await Promise.all([
    deps.getTechCandidates(businessId),
    deps.getServiceTypes(businessId),
    deps.getBusinessIndustry(businessId),
  ]);

  if (techs.length === 0) {
    return { success: false, reason: "No technicians configured for this business." };
  }

  // 2. Classify service type + compute duration
  const classification = classifyServiceType(serviceDescription, industry, serviceTypes);
  const driveTimeEstimate = 15; // V1 default

  let totalCostMinutes: number;
  let serviceTypeId: string;
  let serviceTypeName: string;

  if (classification) {
    const cost = getBookedDuration(classification.serviceType, null, driveTimeEstimate);
    totalCostMinutes = cost.totalCostMinutes;
    serviceTypeId = classification.serviceType.id;
    serviceTypeName = classification.serviceType.name;
  } else {
    const cost = getUnknownTierDuration(serviceTypes, driveTimeEstimate);
    totalCostMinutes = cost.totalCostMinutes;
    if (serviceTypes.length === 0) {
      return { success: false, reason: "No service types configured for this business." };
    }
    serviceTypeId = serviceTypes[0]!.id;
    serviceTypeName = serviceTypes[0]!.name;
  }

  // 3. Parse time preference + cutoff
  const timePreference = parseTimePreference(availabilityPreference);
  const cutoffMinutes = parseCutoffTime(availabilityCutoffTime) ?? 720; // default noon

  // 4. Enumerate slots: 5 business days × all qualified techs × all valid positions
  const today = new Date();
  const now = today;
  const slots: AvailableSlot[] = [];
  let slotIndex = 1;

  // Collect next 5 business days
  const businessDays: Date[] = [];
  let dayOffset = 0;
  while (businessDays.length < 5 && dayOffset < 14) {
    const candidate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    candidate.setDate(candidate.getDate() + dayOffset);
    if (!isWeekend(candidate)) {
      businessDays.push(candidate);
    }
    dayOffset++;
  }

  for (const date of businessDays) {
    for (const tech of techs) {
      if (!tech.isActive) continue;

      // Check if this tech has the skill for the service type
      if (!tech.skillTags.includes(serviceTypeId)) continue;

      // Check capacity for this tech on this date
      const cap = await checkCapacity(
        tech.id,
        date,
        totalCostMinutes,
        timePreference,
        deps.capacityDb,
      );
      if (!cap.fits) continue;

      // Get current queue for this tech on this date
      const queue = await deps.getQueueForTechDate(tech.id, date);

      // Compute all available time windows (morning, afternoon, etc.)
      const windows = computeAvailableWindows(queue, tech, totalCostMinutes);
      if (windows.length === 0) continue;

      const lunchStart = parseHHMM(tech.lunchStart);

      for (const window of windows) {
        const rawStart = window.startMinutes;
        const rawEnd = rawStart + totalCostMinutes;

        // Round to nearest 15 minutes for display
        const windowStart = roundTo15(rawStart);
        const windowEnd = roundTo15(rawEnd);
        const windowWidth = windowEnd - windowStart;

        // Filter: window must be at least 60 min and at most 240 min
        if (windowWidth < 60) continue;
        if (windowWidth > 240) continue;

        // Filter by time-of-day preference using customer's cutoff time
        // Morning: entire window must end before cutoff (customer unavailable after cutoff)
        // Afternoon: slot must start at or after cutoff (customer unavailable before cutoff)
        if (timePreference === "MORNING" && windowEnd > cutoffMinutes) continue;
        if (timePreference === "AFTERNOON" && windowStart < cutoffMinutes) continue;

        // Build label
        const dateLabel = formatDateLabel(date, now);
        const hoursFromNow = ((date.getTime() + rawStart * 60000) - now.getTime()) / 3600000;

        let label: string;
        if (hoursFromNow < 3 && hoursFromNow >= 0) {
          // Too close — use broad label
          const period = rawStart < lunchStart ? "this morning" : "this afternoon";
          label = `${dateLabel}, ${period} with ${tech.name}`;
        } else {
          label = `${dateLabel} ${formatTime(windowStart)} – ${formatTime(windowEnd)} with ${tech.name}`;
        }

        slots.push({
          index: slotIndex++,
          technicianId: tech.id,
          techName: tech.name,
          date: date.toISOString().split("T")[0]!,
          queuePosition: window.queuePosition,
          windowStart: formatTime24(windowStart),
          windowEnd: formatTime24(windowEnd),
          label,
          totalCostMinutes,
          serviceTypeId,
          serviceTypeName,
          timePreference,
        });
      }
    }
  }

  // Sort: windowStart ascending across all dates (Monday 1PM before Tuesday 8AM)
  slots.sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return a.windowStart.localeCompare(b.windowStart);
  });

  // Cap at 10 slots to avoid overwhelming the customer
  const MAX_SLOTS = 10;
  if (slots.length > MAX_SLOTS) {
    slots.length = MAX_SLOTS;
  }

  // Re-index after sort and cap
  slots.forEach((s, i) => { s.index = i + 1; });

  if (slots.length === 0) {
    return { success: false, reason: "No available time slots found in the next 5 business days." };
  }

  return { success: true, slots, serviceTypeId, serviceTypeName, totalCostMinutes };
}

// ── Step 2: Book Selected Slot ────────────────────────────────────────────────

export async function bookSelectedSlot(
  input: BookSlotInput,
  deps: BookSlotDeps,
): Promise<BookSlotResult> {
  const { businessId, customerId, customerName, slot } = input;

  const jobId = deps.generateId();
  const scheduledDate = new Date(slot.date + "T00:00:00");

  const techHomeBase: Coordinates = {
    lat: 0, // Not critical for booking — position is already determined
    lng: 0,
  };

  const bookingRequest: BookingRequest = {
    jobId,
    businessId,
    technicianId: slot.technicianId,
    customerId,
    customerName,
    scheduledDate,
    timePreference: slot.timePreference,
    totalCostMinutes: slot.totalCostMinutes,
    addressLat: 0, // V1: approximate — will be updated when geocoding is added
    addressLng: 0,
    serviceType: slot.serviceTypeId,
  };

  const outcome: BookingOutcome = await bookJob(
    bookingRequest,
    techHomeBase,
    deps.bookingDb,
    { now: () => new Date() },
  );

  if (!outcome.success) {
    return { booked: false, reason: `Booking failed: ${outcome.reason}` };
  }

  return {
    booked: true,
    jobId: outcome.jobId,
    techName: slot.techName,
    scheduledDate,
    queuePosition: outcome.queuePosition,
  };
}
