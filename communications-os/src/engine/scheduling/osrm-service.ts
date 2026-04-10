// ============================================================
// src/engine/scheduling/osrm-service.ts
//
// OSRM SERVICE WRAPPER — ROUTING ENGINE
//
// All drive time calculations for the scheduling engine.
// Primary: OSRM (self-hosted). Fallback: Haversine (pure math).
//
// Every OSRM call has a 3-second timeout. On failure, falls
// back to haversine and logs the fallback.
//
// Injectable dependencies: baseUrl, fetchFn, logger.
// ============================================================

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface DriveTimeResult {
  durationMinutes: number;
  distanceMeters: number;
  source: "osrm" | "haversine";
}

export interface OsrmServiceDeps {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  logger?: { warn: (msg: string, meta?: Record<string, unknown>) => void };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = "http://localhost:5000";
const OSRM_TIMEOUT_MS = 3_000;
const FIRST_JOB_MULTIPLIER = 1.25;
const HAVERSINE_ROAD_FACTOR = 1.4;
const HAVERSINE_SPEED_MPH = 30;
const HAVERSINE_MIN_FLOOR_MINUTES = 10;
const EARTH_RADIUS_MILES = 3_958.8;

// ── Coordinate validation ─────────────────────────────────────────────────────

export function validateCoordinates(coords: Coordinates): void {
  if (coords.lat < -90 || coords.lat > 90) {
    throw new Error(`Invalid latitude: ${coords.lat}. Must be between -90 and 90.`);
  }
  if (coords.lng < -180 || coords.lng > 180) {
    throw new Error(`Invalid longitude: ${coords.lng}. Must be between -180 and 180.`);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Round up to the nearest whole minute. */
function ceilMinutes(minutes: number): number {
  return Math.ceil(minutes);
}

/** Round up to the nearest 5 minutes. */
function ceilTo5(minutes: number): number {
  return Math.ceil(minutes / 5) * 5;
}

/** Haversine distance between two points in miles. */
function haversineDistanceMiles(from: Coordinates, to: Coordinates): number {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) *
      Math.cos(toRadians(to.lat)) *
      Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_MILES * c;
}

const defaultLogger = {
  warn: (msg: string, meta?: Record<string, unknown>) => {
    console.warn(`[osrm-service] ${msg}`, meta ?? "");
  },
};

// ── OSRM fetch helper ─────────────────────────────────────────────────────────

async function osrmFetch(
  url: string,
  fetchFn: typeof fetch,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);
  try {
    const res = await fetchFn(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Pure-math haversine fallback. No network call.
 * distance × 1.4 / 30 mph → round up to nearest 5 min, 10-min floor.
 */
export function getHaversineDriveTime(
  from: Coordinates,
  to: Coordinates,
): DriveTimeResult {
  validateCoordinates(from);
  validateCoordinates(to);
  const miles = haversineDistanceMiles(from, to);
  const roadMiles = miles * HAVERSINE_ROAD_FACTOR;
  const hours = roadMiles / HAVERSINE_SPEED_MPH;
  const rawMinutes = hours * 60;
  const rounded = ceilTo5(rawMinutes);
  const durationMinutes = Math.max(rounded, HAVERSINE_MIN_FLOOR_MINUTES);
  // Approximate meters from road-adjusted miles
  const distanceMeters = Math.round(roadMiles * 1_609.344);
  return { durationMinutes, distanceMeters, source: "haversine" };
}

/**
 * Single point-to-point drive time via OSRM Route API.
 * Falls back to haversine on failure.
 */
export async function getDriveTime(
  from: Coordinates,
  to: Coordinates,
  deps: OsrmServiceDeps = {},
): Promise<DriveTimeResult> {
  validateCoordinates(from);
  validateCoordinates(to);

  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  const fetchFn = deps.fetchFn ?? fetch;
  const logger = deps.logger ?? defaultLogger;

  const url = `${baseUrl}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;

  try {
    const data = await osrmFetch(url, fetchFn) as {
      code: string;
      routes: Array<{ duration: number; distance: number }>;
    };
    if (data.code !== "Ok" || !data.routes?.[0]) {
      throw new Error(`OSRM response code: ${data.code}`);
    }
    const route = data.routes[0];
    return {
      durationMinutes: ceilMinutes(route.duration / 60),
      distanceMeters: Math.round(route.distance),
      source: "osrm",
    };
  } catch (err) {
    logger.warn("OSRM getDriveTime failed, falling back to haversine", {
      error: err instanceof Error ? err.message : String(err),
      from,
      to,
    });
    return getHaversineDriveTime(from, to);
  }
}

/**
 * NxN drive time matrix via OSRM Table API.
 * Returns durations in minutes (ceiled). Falls back to haversine pairwise.
 */
export async function getDriveTimeMatrix(
  coordinates: Coordinates[],
  deps: OsrmServiceDeps = {},
): Promise<{ durations: number[][]; source: "osrm" | "haversine" }> {
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  const fetchFn = deps.fetchFn ?? fetch;
  const logger = deps.logger ?? defaultLogger;

  coordinates.forEach(validateCoordinates);

  const coordStr = coordinates.map((c) => `${c.lng},${c.lat}`).join(";");
  const url = `${baseUrl}/table/v1/driving/${coordStr}?annotations=duration`;

  try {
    const data = await osrmFetch(url, fetchFn) as {
      code: string;
      durations: number[][];
    };
    if (data.code !== "Ok" || !data.durations) {
      throw new Error(`OSRM Table response code: ${data.code}`);
    }
    const durations = data.durations.map((row) =>
      row.map((sec) => ceilMinutes(sec / 60)),
    );
    return { durations, source: "osrm" };
  } catch (err) {
    logger.warn("OSRM getDriveTimeMatrix failed, falling back to haversine", {
      error: err instanceof Error ? err.message : String(err),
      coordinateCount: coordinates.length,
    });
    // Build NxN from pairwise haversine
    const n = coordinates.length;
    const durations: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row: number[] = [];
      for (let j = 0; j < n; j++) {
        if (i === j) {
          row.push(0);
        } else {
          row.push(getHaversineDriveTime(coordinates[i]!, coordinates[j]!).durationMinutes);
        }
      }
      durations.push(row);
    }
    return { durations, source: "haversine" };
  }
}

/**
 * First job of the day: OSRM(home → job) × 1.25, rounded up to nearest 5 min.
 * Per spec: hard-coded multiplier, not configurable.
 */
export async function getFirstJobDriveTime(
  techHomeBase: Coordinates,
  jobAddress: Coordinates,
  deps: OsrmServiceDeps = {},
): Promise<DriveTimeResult> {
  const result = await getDriveTime(techHomeBase, jobAddress, deps);
  const adjusted = result.durationMinutes * FIRST_JOB_MULTIPLIER;
  return {
    durationMinutes: ceilTo5(adjusted),
    distanceMeters: result.distanceMeters,
    source: result.source,
  };
}

/**
 * "Starting My Day" button: real GPS → job #1. Raw OSRM, no multiplier.
 * Replaces the 1.25x estimate with actual drive time.
 */
export async function getStartingMyDayDriveTime(
  gpsLocation: Coordinates,
  jobAddress: Coordinates,
  deps: OsrmServiceDeps = {},
): Promise<DriveTimeResult> {
  return getDriveTime(gpsLocation, jobAddress, deps);
}

/**
 * Health check. Fires a lightweight OSRM request.
 * Returns true if OSRM responds within timeout, false otherwise.
 */
export async function isOsrmHealthy(
  deps: OsrmServiceDeps = {},
): Promise<boolean> {
  const baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  const fetchFn = deps.fetchFn ?? fetch;

  // Use a trivial route request as health check (0,0 → 0,0)
  const url = `${baseUrl}/route/v1/driving/0,0;0,0?overview=false`;
  try {
    const data = await osrmFetch(url, fetchFn) as { code: string };
    return data.code === "Ok";
  } catch {
    return false;
  }
}
