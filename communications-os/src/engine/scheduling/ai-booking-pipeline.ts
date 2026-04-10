// ============================================================
// src/engine/scheduling/ai-booking-pipeline.ts
//
// AI BOOKING PIPELINE — AUTOMATED DISPATCH FROM CONVERSATION
//
// Called when the AI sets bookingConfirmed: true.
// Orchestrates: classify service type → compute duration →
// find earliest date → assign tech → book job.
//
// V1 address strategy: uses first tech's home_base as
// approximate coordinates (same metro area). Real geocoding
// via Google Maps Geocoding API can be added later.
// ============================================================

import { classifyServiceType, getBookedDuration, getUnknownTierDuration, type ServiceTypeRecord } from "./duration-intelligence";
import { assignTech, type TechCandidate, type AssignmentInput } from "./tech-assignment";
import { bookJob, type BookingRequest, type BookingOutcome } from "./booking-orchestrator";
import { checkCapacity, type CapacityDb, type TimePreference } from "./capacity-math";
import type { BookingOrchestratorDb } from "./booking-orchestrator";
import type { Coordinates } from "./osrm-service";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AIBookingInput {
  businessId: string;
  conversationId: string;
  customerId: string;
  customerName: string;
  /** Free-text service description from the conversation. */
  serviceDescription: string;
  /** Customer's service address as text. */
  addressText: string;
  /** Customer's scheduling preference, e.g. "Soonest available", "Mornings only". */
  availabilityPreference: string | null;
}

export interface AIBookingDeps {
  /** All active technicians for the business, with skill tags loaded. */
  getTechCandidates: (businessId: string) => Promise<TechCandidate[]>;
  /** All service types for the business. */
  getServiceTypes: (businessId: string) => Promise<ServiceTypeRecord[]>;
  /** Business industry. */
  getBusinessIndustry: (businessId: string) => Promise<string>;
  /** Capacity DB for tech assignment and date finding. */
  capacityDb: CapacityDb;
  /** Booking orchestrator DB for atomic job creation. */
  bookingDb: BookingOrchestratorDb;
  /** ID generator. */
  generateId: () => string;
}

export type AIBookingResult =
  | { booked: true; jobId: string; techName: string; scheduledDate: Date; queuePosition: number; serviceTypeName: string }
  | { booked: false; reason: string };

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseTimePreference(pref: string | null): TimePreference {
  if (!pref) return "SOONEST";
  const lower = pref.toLowerCase();
  if (lower.includes("morning")) return "MORNING";
  if (lower.includes("afternoon") || lower.includes("evening")) return "AFTERNOON";
  if (lower.includes("soonest") || lower.includes("asap") || lower.includes("earliest")) return "SOONEST";
  return "NO_PREFERENCE";
}

/**
 * Find the earliest date (starting from today) where at least one tech
 * has capacity for the given duration + time preference.
 * Scans up to 14 days ahead.
 */
async function findEarliestAvailableDate(
  techs: TechCandidate[],
  totalCostMinutes: number,
  timePreference: TimePreference,
  capacityDb: CapacityDb,
): Promise<Date | null> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const candidate = new Date(today);
    candidate.setDate(candidate.getDate() + dayOffset);

    for (const tech of techs) {
      if (!tech.isActive) continue;
      const cap = await checkCapacity(
        tech.id,
        candidate,
        totalCostMinutes,
        timePreference,
        capacityDb,
      );
      if (cap.fits) return candidate;
    }
  }

  return null;
}

// ── Main Pipeline ─────────────────────────────────────────────────────────────

export async function runAIBookingPipeline(
  input: AIBookingInput,
  deps: AIBookingDeps,
): Promise<AIBookingResult> {
  const { businessId, customerId, customerName, serviceDescription, addressText, availabilityPreference } = input;

  // 1. Load techs and service types
  const [techs, serviceTypes, industry] = await Promise.all([
    deps.getTechCandidates(businessId),
    deps.getServiceTypes(businessId),
    deps.getBusinessIndustry(businessId),
  ]);

  if (techs.length === 0) {
    return { booked: false, reason: "No technicians configured for this business." };
  }

  // 2. Classify service type + compute duration
  const classification = classifyServiceType(serviceDescription, industry, serviceTypes);

  // V1 address fallback: use first active tech's home base as approximate coordinates
  const firstTech = techs.find((t) => t.isActive) ?? techs[0]!;
  const approxCoords: Coordinates = { lat: firstTech.homeBaseLat, lng: firstTech.homeBaseLng };
  const driveTimeEstimate = 15; // V1 default: 15 min in same metro area

  let totalCostMinutes: number;
  let serviceTypeId: string;
  let serviceTypeName: string;

  if (classification) {
    const cost = getBookedDuration(classification.serviceType, null, driveTimeEstimate);
    totalCostMinutes = cost.totalCostMinutes;
    serviceTypeId = classification.serviceType.id;
    serviceTypeName = classification.serviceType.name;
  } else {
    // Unknown service — use worst-case duration
    const cost = getUnknownTierDuration(serviceTypes, driveTimeEstimate);
    totalCostMinutes = cost.totalCostMinutes;
    // Use first service type as fallback, or fail
    if (serviceTypes.length === 0) {
      return { booked: false, reason: "No service types configured for this business." };
    }
    serviceTypeId = serviceTypes[0]!.id;
    serviceTypeName = serviceTypes[0]!.name + " (auto-classified)";
  }

  // 3. Parse time preference
  const timePreference = parseTimePreference(availabilityPreference);

  // 4. Find earliest available date
  const scheduledDate = await findEarliestAvailableDate(techs, totalCostMinutes, timePreference, deps.capacityDb);
  if (!scheduledDate) {
    return { booked: false, reason: "No availability found in the next 14 days." };
  }

  // 5. Assign best tech
  const assignmentInput: AssignmentInput = {
    serviceTypeId,
    addressLat: approxCoords.lat,
    addressLng: approxCoords.lng,
    date: scheduledDate,
    timePreference,
    totalCostMinutes,
  };

  const assignment = await assignTech(techs, assignmentInput, deps.capacityDb);
  if (!assignment.assigned) {
    return { booked: false, reason: `No technician available: ${assignment.reason}` };
  }

  // 6. Book the job
  const jobId = deps.generateId();
  const techHomeBase: Coordinates = {
    lat: techs.find((t) => t.id === assignment.tech.techId)?.homeBaseLat ?? approxCoords.lat,
    lng: techs.find((t) => t.id === assignment.tech.techId)?.homeBaseLng ?? approxCoords.lng,
  };

  const bookingRequest: BookingRequest = {
    jobId,
    businessId,
    technicianId: assignment.tech.techId,
    customerId,
    customerName,
    scheduledDate,
    timePreference,
    totalCostMinutes,
    addressLat: approxCoords.lat,
    addressLng: approxCoords.lng,
    serviceType: serviceTypeId,
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
    techName: assignment.tech.techName,
    scheduledDate,
    queuePosition: outcome.queuePosition,
    serviceTypeName,
  };
}
