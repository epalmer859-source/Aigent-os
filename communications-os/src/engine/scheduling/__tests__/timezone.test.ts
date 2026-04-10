// ============================================================
// Tests for src/engine/scheduling/timezone.ts
// ============================================================

import { describe, it, expect } from "vitest";
import {
  toBusinessMinutes,
  toUtcDate,
  businessToday,
  isInQuietHoursLocal,
  computeQuietHoursEndLocal,
} from "../timezone";

// ── toBusinessMinutes ────────────────────────────────────────────────────────

describe("toBusinessMinutes", () => {
  it("converts UTC to Eastern minutes (EDT, UTC-4)", () => {
    // 2026-04-09T17:00:00Z = 13:00 EDT
    const utc = new Date("2026-04-09T17:00:00Z");
    const minutes = toBusinessMinutes(utc, "America/New_York");
    expect(minutes).toBe(780); // 13 * 60
  });

  it("converts UTC to Pacific minutes (PDT, UTC-7)", () => {
    // 2026-04-09T20:00:00Z = 13:00 PDT
    const utc = new Date("2026-04-09T20:00:00Z");
    const minutes = toBusinessMinutes(utc, "America/Los_Angeles");
    expect(minutes).toBe(780);
  });

  it("handles midnight boundary (UTC date rolls back in local)", () => {
    // 2026-04-10T03:00:00Z = 2026-04-09 23:00 EDT
    const utc = new Date("2026-04-10T03:00:00Z");
    const minutes = toBusinessMinutes(utc, "America/New_York");
    expect(minutes).toBe(23 * 60); // 1380
  });

  it("returns 0 for local midnight", () => {
    // 2026-04-09T04:00:00Z = 2026-04-09 00:00 EDT
    const utc = new Date("2026-04-09T04:00:00Z");
    const minutes = toBusinessMinutes(utc, "America/New_York");
    expect(minutes).toBe(0);
  });

  it("handles UTC timezone (no offset)", () => {
    const utc = new Date("2026-04-09T14:30:00Z");
    const minutes = toBusinessMinutes(utc, "UTC");
    expect(minutes).toBe(14 * 60 + 30);
  });
});

// ── toUtcDate ────────────────────────────────────────────────────────────────

describe("toUtcDate", () => {
  it("converts business-local minutes to UTC (EDT)", () => {
    // 13:00 local on 2026-04-09 in America/New_York (EDT, UTC-4)
    // = 2026-04-09T17:00:00Z
    const ref = new Date("2026-04-09T12:00:00Z"); // reference date
    const utc = toUtcDate(780, ref, "America/New_York");
    expect(utc.toISOString()).toBe("2026-04-09T17:00:00.000Z");
  });

  it("converts business-local minutes to UTC (PDT)", () => {
    // 13:00 local on 2026-04-09 in America/Los_Angeles (PDT, UTC-7)
    // = 2026-04-09T20:00:00Z
    const ref = new Date("2026-04-09T12:00:00Z");
    const utc = toUtcDate(780, ref, "America/Los_Angeles");
    expect(utc.toISOString()).toBe("2026-04-09T20:00:00.000Z");
  });

  it("round-trips with toBusinessMinutes", () => {
    const tz = "America/Chicago"; // CDT, UTC-5
    const ref = new Date("2026-04-09T15:00:00Z");
    const localMinutes = 600; // 10:00 AM
    const utcDate = toUtcDate(localMinutes, ref, tz);
    const backToMinutes = toBusinessMinutes(utcDate, tz);
    expect(backToMinutes).toBe(localMinutes);
  });

  it("handles UTC timezone", () => {
    const ref = new Date("2026-04-09T12:00:00Z");
    const utc = toUtcDate(780, ref, "UTC");
    expect(utc.toISOString()).toBe("2026-04-09T13:00:00.000Z");
  });
});

// ── businessToday ────────────────────────────────────────────────────────────

describe("businessToday", () => {
  it("returns the local date as midnight UTC", () => {
    // 2026-04-10T02:00:00Z in America/New_York (UTC-4) = 2026-04-09 22:00
    const now = new Date("2026-04-10T02:00:00Z");
    const today = businessToday("America/New_York", now);
    expect(today.toISOString()).toBe("2026-04-09T00:00:00.000Z");
  });

  it("returns same date when UTC time is daytime", () => {
    const now = new Date("2026-04-09T15:00:00Z");
    const today = businessToday("America/New_York", now);
    expect(today.toISOString()).toBe("2026-04-09T00:00:00.000Z");
  });

  it("handles timezone ahead of UTC", () => {
    // 2026-04-09T23:00:00Z in Asia/Tokyo (UTC+9) = 2026-04-10 08:00
    const now = new Date("2026-04-09T23:00:00Z");
    const today = businessToday("Asia/Tokyo", now);
    expect(today.toISOString()).toBe("2026-04-10T00:00:00.000Z");
  });
});

// ── isInQuietHoursLocal ──────────────────────────────────────────────────────

describe("isInQuietHoursLocal", () => {
  it("detects quiet hours (non-wrapping, e.g. 22:00–06:00 wrapping)", () => {
    // 23:00 EDT = 2026-04-10T03:00:00Z
    const utcNow = new Date("2026-04-10T03:00:00Z");
    const result = isInQuietHoursLocal(utcNow, "22:00", "06:00", "America/New_York");
    expect(result).toBe(true);
  });

  it("returns false outside quiet hours (wrapping window)", () => {
    // 12:00 EDT = 2026-04-09T16:00:00Z
    const utcNow = new Date("2026-04-09T16:00:00Z");
    const result = isInQuietHoursLocal(utcNow, "22:00", "06:00", "America/New_York");
    expect(result).toBe(false);
  });

  it("handles non-wrapping window (daytime quiet hours)", () => {
    // 09:00 EDT = 2026-04-09T13:00:00Z — inside 08:00–17:00
    const utcNow = new Date("2026-04-09T13:00:00Z");
    const result = isInQuietHoursLocal(utcNow, "08:00", "17:00", "America/New_York");
    expect(result).toBe(true);
  });

  it("returns false at exact end boundary", () => {
    // 06:00 EDT = 2026-04-09T10:00:00Z — at the end of 22:00–06:00
    const utcNow = new Date("2026-04-09T10:00:00Z");
    const result = isInQuietHoursLocal(utcNow, "22:00", "06:00", "America/New_York");
    expect(result).toBe(false);
  });

  it("returns true at exact start boundary", () => {
    // 22:00 EDT = 2026-04-10T02:00:00Z
    const utcNow = new Date("2026-04-10T02:00:00Z");
    const result = isInQuietHoursLocal(utcNow, "22:00", "06:00", "America/New_York");
    expect(result).toBe(true);
  });
});

// ── computeQuietHoursEndLocal ────────────────────────────────────────────────

describe("computeQuietHoursEndLocal", () => {
  it("returns UTC time for quiet-hours end in business timezone", () => {
    // 06:00 EDT on 2026-04-09 = 2026-04-09T10:00:00Z
    const serviceDate = new Date("2026-04-09T12:00:00Z");
    const result = computeQuietHoursEndLocal(serviceDate, "06:00", "America/New_York");
    expect(result.toISOString()).toBe("2026-04-09T10:00:00.000Z");
  });

  it("handles Pacific timezone", () => {
    // 07:00 PDT on 2026-04-09 = 2026-04-09T14:00:00Z
    const serviceDate = new Date("2026-04-09T12:00:00Z");
    const result = computeQuietHoursEndLocal(serviceDate, "07:00", "America/Los_Angeles");
    expect(result.toISOString()).toBe("2026-04-09T14:00:00.000Z");
  });
});
