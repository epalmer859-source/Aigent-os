// ============================================================
// OSRM Service Wrapper — Tests
//
// All tests use a mock fetchFn. No real OSRM calls.
// Each test traces to a rule in unified-scheduling-spec.md.
// ============================================================

import { describe, it, expect, vi } from "vitest";
import {
  getDriveTime,
  getDriveTimeMatrix,
  getFirstJobDriveTime,
  getStartingMyDayDriveTime,
  getHaversineDriveTime,
  isOsrmHealthy,
  validateCoordinates,
  type Coordinates,
  type OsrmServiceDeps,
} from "../osrm-service";

// ── Helpers ───────────────────────────────────────────────────────────────────

const ATL: Coordinates = { lat: 33.749, lng: -84.388 };
const MARIETTA: Coordinates = { lat: 33.9526, lng: -84.5499 };
const DECATUR: Coordinates = { lat: 33.7748, lng: -84.2963 };

/** Build a mock fetch that returns a successful OSRM route response. */
function mockRouteFetch(durationSec: number, distanceM: number) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      code: "Ok",
      routes: [{ duration: durationSec, distance: distanceM }],
    }),
  });
}

/** Build a mock fetch that returns a successful OSRM table response. */
function mockTableFetch(durations: number[][]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ code: "Ok", durations }),
  });
}

/** Build a mock fetch that rejects (simulates OSRM down). */
function mockFailFetch() {
  return vi.fn().mockRejectedValue(new Error("Connection refused"));
}

/** Suppress console.warn in fallback tests. */
const silentLogger = { warn: vi.fn() };

function deps(fetchFn: ReturnType<typeof vi.fn>): OsrmServiceDeps {
  return { baseUrl: "http://test:5000", fetchFn, logger: silentLogger };
}

// ── getDriveTime ──────────────────────────────────────────────────────────────

describe("getDriveTime", () => {
  it("returns duration in minutes (ceiled) from OSRM", async () => {
    // 1500 seconds = 25.0 minutes → ceil = 25
    const fetchFn = mockRouteFetch(1500, 30_000);
    const result = await getDriveTime(ATL, MARIETTA, deps(fetchFn));

    expect(result.source).toBe("osrm");
    expect(result.durationMinutes).toBe(25);
    expect(result.distanceMeters).toBe(30_000);
  });

  it("ceils fractional minutes up", async () => {
    // 1510 seconds = 25.167 min → ceil = 26
    const fetchFn = mockRouteFetch(1510, 30_000);
    const result = await getDriveTime(ATL, MARIETTA, deps(fetchFn));

    expect(result.durationMinutes).toBe(26);
  });

  it("calls OSRM with correct URL format (lng,lat order)", async () => {
    const fetchFn = mockRouteFetch(600, 10_000);
    await getDriveTime(ATL, MARIETTA, deps(fetchFn));

    const url = fetchFn.mock.calls[0]![0] as string;
    expect(url).toContain(`${ATL.lng},${ATL.lat};${MARIETTA.lng},${MARIETTA.lat}`);
    expect(url).toContain("route/v1/driving");
  });
});

// ── getDriveTimeMatrix ────────────────────────────────────────────────────────

describe("getDriveTimeMatrix", () => {
  it("returns NxN matrix of durations in minutes", async () => {
    const rawDurations = [
      [0, 1200, 900],   // seconds
      [1200, 0, 600],
      [900, 600, 0],
    ];
    const fetchFn = mockTableFetch(rawDurations);
    const result = await getDriveTimeMatrix([ATL, MARIETTA, DECATUR], deps(fetchFn));

    expect(result.source).toBe("osrm");
    expect(result.durations).toHaveLength(3);
    expect(result.durations[0]).toHaveLength(3);
    // 1200s = 20 min, 900s = 15 min, 600s = 10 min
    expect(result.durations[0]![0]).toBe(0);
    expect(result.durations[0]![1]).toBe(20);
    expect(result.durations[0]![2]).toBe(15);
    expect(result.durations[1]![2]).toBe(10);
  });

  it("calls OSRM Table API with correct URL", async () => {
    const fetchFn = mockTableFetch([[0, 600], [600, 0]]);
    await getDriveTimeMatrix([ATL, MARIETTA], deps(fetchFn));

    const url = fetchFn.mock.calls[0]![0] as string;
    expect(url).toContain("table/v1/driving");
    expect(url).toContain(`${ATL.lng},${ATL.lat};${MARIETTA.lng},${MARIETTA.lat}`);
  });

  it("falls back to haversine NxN on OSRM failure", async () => {
    const fetchFn = mockFailFetch();
    const result = await getDriveTimeMatrix([ATL, MARIETTA], deps(fetchFn));

    expect(result.source).toBe("haversine");
    expect(result.durations).toHaveLength(2);
    expect(result.durations[0]![0]).toBe(0); // self → self
    expect(result.durations[0]![1]).toBeGreaterThan(0);
    expect(result.durations[1]![0]).toBeGreaterThan(0);
    expect(result.durations[1]![1]).toBe(0);
  });
});

// ── getFirstJobDriveTime ──────────────────────────────────────────────────────

describe("getFirstJobDriveTime", () => {
  it("applies 1.25x multiplier and rounds to nearest 5 minutes", async () => {
    // 1200 seconds = 20 min from OSRM → ceil = 20 → × 1.25 = 25 → ceilTo5 = 25
    const fetchFn = mockRouteFetch(1200, 20_000);
    const result = await getFirstJobDriveTime(ATL, MARIETTA, deps(fetchFn));

    expect(result.source).toBe("osrm");
    expect(result.durationMinutes).toBe(25);
  });

  it("rounds up to next 5 when multiplied result is not on a 5-boundary", async () => {
    // 900 seconds = 15 min → ceil = 15 → × 1.25 = 18.75 → ceilTo5 = 20
    const fetchFn = mockRouteFetch(900, 15_000);
    const result = await getFirstJobDriveTime(ATL, MARIETTA, deps(fetchFn));

    expect(result.durationMinutes).toBe(20);
  });

  it("uses haversine fallback with 1.25x when OSRM fails", async () => {
    const fetchFn = mockFailFetch();
    const result = await getFirstJobDriveTime(ATL, MARIETTA, deps(fetchFn));

    expect(result.source).toBe("haversine");
    // Still rounds to 5
    expect(result.durationMinutes % 5).toBe(0);
  });
});

// ── getStartingMyDayDriveTime ─────────────────────────────────────────────────

describe("getStartingMyDayDriveTime", () => {
  it("returns raw OSRM drive time with no multiplier", async () => {
    // 1200 seconds = 20 min
    const fetchFn = mockRouteFetch(1200, 20_000);
    const result = await getStartingMyDayDriveTime(ATL, MARIETTA, deps(fetchFn));

    expect(result.source).toBe("osrm");
    expect(result.durationMinutes).toBe(20);
  });

  it("does not apply 1.25x multiplier", async () => {
    // 900 seconds = 15 min → should be exactly 15, not 18.75 or 20
    const fetchFn = mockRouteFetch(900, 15_000);
    const result = await getStartingMyDayDriveTime(ATL, MARIETTA, deps(fetchFn));

    expect(result.durationMinutes).toBe(15);
  });
});

// ── OSRM fallback to haversine ────────────────────────────────────────────────

describe("OSRM failure → haversine fallback", () => {
  it("falls back to haversine when OSRM rejects", async () => {
    const fetchFn = mockFailFetch();
    const result = await getDriveTime(ATL, MARIETTA, deps(fetchFn));

    expect(result.source).toBe("haversine");
    expect(result.durationMinutes).toBeGreaterThan(0);
  });

  it("falls back when OSRM returns non-Ok code", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: "NoRoute", routes: [] }),
    });
    const result = await getDriveTime(ATL, MARIETTA, deps(fetchFn));

    expect(result.source).toBe("haversine");
  });

  it("falls back when OSRM returns HTTP error", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    });
    const result = await getDriveTime(ATL, MARIETTA, deps(fetchFn));

    expect(result.source).toBe("haversine");
  });

  it("falls back when fetch hangs and gets aborted at 3s timeout", async () => {
    // Simulate a fetch that never resolves until aborted
    const fetchFn = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (signal) {
          signal.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }
        // Never resolves on its own — relies on abort
      });
    });
    const logger = { warn: vi.fn() };
    const result = await getDriveTime(ATL, MARIETTA, {
      baseUrl: "http://test:5000",
      fetchFn,
      logger,
    });

    expect(result.source).toBe("haversine");
    expect(result.durationMinutes).toBeGreaterThan(0);
    expect(logger.warn).toHaveBeenCalledOnce();
  }, 10_000); // generous outer timeout so the 3s abort has room

  it("logs the fallback", async () => {
    const fetchFn = mockFailFetch();
    const logger = { warn: vi.fn() };
    await getDriveTime(ATL, MARIETTA, {
      baseUrl: "http://test:5000",
      fetchFn,
      logger,
    });

    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.warn.mock.calls[0]![0]).toContain("falling back to haversine");
  });
});

// ── getHaversineDriveTime ─────────────────────────────────────────────────────

describe("getHaversineDriveTime", () => {
  it("respects 10-minute minimum floor", () => {
    // Two points very close together
    const a: Coordinates = { lat: 33.749, lng: -84.388 };
    const b: Coordinates = { lat: 33.7491, lng: -84.3881 };
    const result = getHaversineDriveTime(a, b);

    expect(result.source).toBe("haversine");
    expect(result.durationMinutes).toBe(10);
  });

  it("rounds up to nearest 5 minutes", () => {
    const result = getHaversineDriveTime(ATL, MARIETTA);

    expect(result.source).toBe("haversine");
    expect(result.durationMinutes % 5).toBe(0);
  });

  it("returns distance in meters", () => {
    const result = getHaversineDriveTime(ATL, MARIETTA);

    expect(result.distanceMeters).toBeGreaterThan(0);
  });

  it("returns 0-distance as 10-min floor for same point", () => {
    const result = getHaversineDriveTime(ATL, ATL);

    expect(result.durationMinutes).toBe(10);
  });
});

// ── isOsrmHealthy ─────────────────────────────────────────────────────────────

describe("isOsrmHealthy", () => {
  it("returns true when OSRM responds with Ok", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: "Ok" }),
    });
    const result = await isOsrmHealthy(deps(fetchFn));

    expect(result).toBe(true);
  });

  it("returns false when OSRM is down", async () => {
    const fetchFn = mockFailFetch();
    const result = await isOsrmHealthy(deps(fetchFn));

    expect(result).toBe(false);
  });

  it("returns false when OSRM returns non-Ok code", async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ code: "InvalidQuery" }),
    });
    const result = await isOsrmHealthy(deps(fetchFn));

    expect(result).toBe(false);
  });
});

// ── validateCoordinates ───────────────────────────────────────────────────────

describe("validateCoordinates", () => {
  it("accepts valid coordinates", () => {
    expect(() => validateCoordinates(ATL)).not.toThrow();
    expect(() => validateCoordinates({ lat: 0, lng: 0 })).not.toThrow();
    expect(() => validateCoordinates({ lat: -90, lng: -180 })).not.toThrow();
    expect(() => validateCoordinates({ lat: 90, lng: 180 })).not.toThrow();
  });

  it("rejects latitude out of range", () => {
    expect(() => validateCoordinates({ lat: 91, lng: 0 })).toThrow("Invalid latitude");
    expect(() => validateCoordinates({ lat: -91, lng: 0 })).toThrow("Invalid latitude");
  });

  it("rejects longitude out of range", () => {
    expect(() => validateCoordinates({ lat: 0, lng: 181 })).toThrow("Invalid longitude");
    expect(() => validateCoordinates({ lat: 0, lng: -181 })).toThrow("Invalid longitude");
  });

  it("is enforced by getDriveTime", async () => {
    const fetchFn = mockRouteFetch(600, 10_000);
    await expect(
      getDriveTime({ lat: 999, lng: 0 }, ATL, deps(fetchFn)),
    ).rejects.toThrow("Invalid latitude");
  });

  it("is enforced by getHaversineDriveTime", () => {
    expect(() =>
      getHaversineDriveTime({ lat: 0, lng: 999 }, ATL),
    ).toThrow("Invalid longitude");
  });

  it("is enforced by getDriveTimeMatrix", async () => {
    const fetchFn = mockTableFetch([[0]]);
    await expect(
      getDriveTimeMatrix([{ lat: -100, lng: 0 }], deps(fetchFn)),
    ).rejects.toThrow("Invalid latitude");
  });
});
