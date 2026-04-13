// ============================================================
// Tests for window-calculator.ts and window-recalculator.ts
// ============================================================

import { describe, it, expect, vi } from "vitest";
import {
  roundUpTo15,
  roundUpMinutesTo15,
  calculateDiagnosticWindow,
  calculateKnownJobWindow,
} from "../window-calculator";
import {
  recalculateDownstreamWindows,
  type RecalcJob,
  type WindowRecalculatorDb,
} from "../window-recalculator";

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Create a Date at a specific hour:minute on 2026-04-13. */
function makeTime(hour: number, minute: number): Date {
  return new Date(2026, 3, 13, hour, minute, 0, 0); // month is 0-indexed
}

/** Get hours:minutes from a Date for readable assertions. */
function hhmm(date: Date): string {
  return `${date.getHours()}:${date.getMinutes().toString().padStart(2, "0")}`;
}

/** Duration between two dates in minutes. */
function diffMinutes(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / (60 * 1000);
}

// ============================================================
// ROUNDING
// ============================================================

describe("roundUpTo15", () => {
  it("rounds 9:08 up to 9:15", () => {
    expect(hhmm(roundUpTo15(makeTime(9, 8)))).toBe("9:15");
  });

  it("rounds 9:55 up to 10:00", () => {
    expect(hhmm(roundUpTo15(makeTime(9, 55)))).toBe("10:00");
  });

  it("leaves 9:00 unchanged", () => {
    expect(hhmm(roundUpTo15(makeTime(9, 0)))).toBe("9:00");
  });

  it("rounds 9:01 up to 9:15", () => {
    expect(hhmm(roundUpTo15(makeTime(9, 1)))).toBe("9:15");
  });

  it("leaves 9:30 unchanged (already aligned)", () => {
    expect(hhmm(roundUpTo15(makeTime(9, 30)))).toBe("9:30");
  });

  it("rounds 9:46 up to 10:00", () => {
    expect(hhmm(roundUpTo15(makeTime(9, 46)))).toBe("10:00");
  });
});

describe("roundUpMinutesTo15", () => {
  it("rounds 22 up to 30", () => {
    expect(roundUpMinutesTo15(22)).toBe(30);
  });

  it("leaves 60 unchanged", () => {
    expect(roundUpMinutesTo15(60)).toBe(60);
  });

  it("rounds 61 up to 75", () => {
    expect(roundUpMinutesTo15(61)).toBe(75);
  });
});

// ============================================================
// RULE 1 — Diagnostic
// ============================================================

describe("Rule 1 — Diagnostic window", () => {
  it("window starts 1 hour after arrival", () => {
    const arrival = makeTime(9, 0);
    const { windowStart } = calculateDiagnosticWindow(arrival);
    expect(hhmm(windowStart)).toBe("10:00");
  });

  it("window ends 3 hours after start", () => {
    const arrival = makeTime(9, 0);
    const { windowStart, windowEnd } = calculateDiagnosticWindow(arrival);
    expect(diffMinutes(windowStart, windowEnd)).toBe(180);
  });

  it("window is 10:00–13:00 for a 9:00 arrival", () => {
    const arrival = makeTime(9, 0);
    const { windowStart, windowEnd } = calculateDiagnosticWindow(arrival);
    expect(hhmm(windowStart)).toBe("10:00");
    expect(hhmm(windowEnd)).toBe("13:00");
  });

  it("rounds start up to nearest 15 when arrival is not aligned", () => {
    // Arrival at 9:08 → raw start 10:08 → rounded to 10:15
    const arrival = makeTime(9, 8);
    const { windowStart } = calculateDiagnosticWindow(arrival);
    expect(hhmm(windowStart)).toBe("10:15");
  });

  it("end is 3 hours after the rounded start", () => {
    const arrival = makeTime(9, 8);
    const { windowStart, windowEnd } = calculateDiagnosticWindow(arrival);
    expect(diffMinutes(windowStart, windowEnd)).toBe(180);
    expect(hhmm(windowEnd)).toBe("13:15");
  });
});

// ============================================================
// RULE 2A — Known job, high <= 120 min
// ============================================================

describe("Rule 2A — Known job, high <= 120 min", () => {
  it("window starts 1 hour after arrival", () => {
    const arrival = makeTime(9, 0);
    const { windowStart } = calculateKnownJobWindow(arrival, 30, 60, 15);
    expect(hhmm(windowStart)).toBe("10:00");
  });

  it("window duration is exactly 2 hours", () => {
    const arrival = makeTime(9, 0);
    const { windowStart, windowEnd } = calculateKnownJobWindow(arrival, 30, 60, 15);
    expect(diffMinutes(windowStart, windowEnd)).toBe(120);
  });

  it("works with high estimate of 60 minutes", () => {
    const arrival = makeTime(8, 0);
    const { windowStart, windowEnd } = calculateKnownJobWindow(arrival, 30, 60, 15);
    expect(hhmm(windowStart)).toBe("9:00");
    expect(hhmm(windowEnd)).toBe("11:00");
  });

  it("works with high estimate of 90 minutes", () => {
    const arrival = makeTime(8, 0);
    const { windowStart, windowEnd } = calculateKnownJobWindow(arrival, 60, 90, 15);
    expect(hhmm(windowStart)).toBe("9:00");
    expect(hhmm(windowEnd)).toBe("11:00");
  });

  it("works with high estimate of exactly 120 minutes (boundary)", () => {
    const arrival = makeTime(8, 0);
    const { windowStart, windowEnd } = calculateKnownJobWindow(arrival, 60, 120, 15);
    expect(hhmm(windowStart)).toBe("9:00");
    expect(hhmm(windowEnd)).toBe("11:00");
  });

  it("rounds start when arrival is not aligned", () => {
    const arrival = makeTime(8, 10);
    const { windowStart } = calculateKnownJobWindow(arrival, 30, 90, 15);
    // raw start = 9:10 → rounded to 9:15
    expect(hhmm(windowStart)).toBe("9:15");
  });
});

// ============================================================
// RULE 2B — Known job, high 121–240 min
// ============================================================

describe("Rule 2B — Known job, high 121–240 min", () => {
  it("boundary: high=121 enters Rule 2B (not 2A)", () => {
    const arrival = makeTime(8, 0);
    // low=60, high=121 → spread=61 → uses spread formula
    const { windowStart } = calculateKnownJobWindow(arrival, 60, 121, 15);
    // Rule 2B starts at low estimate after arrival: 8:00 + 60min = 9:00
    expect(hhmm(windowStart)).toBe("9:00");
  });

  it("boundary: high=240 stays in Rule 2B (not Rule 3)", () => {
    const arrival = makeTime(8, 0);
    const { windowStart } = calculateKnownJobWindow(arrival, 120, 240, 15);
    // start = arrival + low = 8:00 + 120min = 10:00
    expect(hhmm(windowStart)).toBe("10:00");
  });

  it("window starts at LOW estimate after arrival", () => {
    const arrival = makeTime(8, 0);
    // low=90, high=180 → start = 8:00 + 90min = 9:30
    const { windowStart } = calculateKnownJobWindow(arrival, 90, 180, 15);
    expect(hhmm(windowStart)).toBe("9:30");
  });

  it("spread <= 60 min: window is exactly 2 hours, no drive, no buffer", () => {
    const arrival = makeTime(8, 0);
    // low=90, high=150 → spread=60 → exactly 2 hours
    const { windowStart, windowEnd } = calculateKnownJobWindow(arrival, 90, 150, 20);
    expect(diffMinutes(windowStart, windowEnd)).toBe(120);
  });

  it("spread <= 60 min: drive time does NOT affect window duration", () => {
    const arrival = makeTime(8, 0);
    // low=90, high=150, drive=30 → spread=60 → exactly 2 hours regardless of drive
    const { windowStart, windowEnd } = calculateKnownJobWindow(arrival, 90, 150, 30);
    expect(diffMinutes(windowStart, windowEnd)).toBe(120);
  });

  it("spread 2 hours: window = spread + drive + 15min buffer", () => {
    const arrival = makeTime(8, 0);
    // low=60, high=180 → spread=120 → duration = 120 + 15 + 15 = 150
    const { windowStart, windowEnd } = calculateKnownJobWindow(arrival, 60, 180, 15);
    // start = 8:00 + 60 = 9:00; end = 9:00 + 150min = 11:30
    expect(hhmm(windowStart)).toBe("9:00");
    expect(diffMinutes(windowStart, windowEnd)).toBe(150);
  });

  it("spread 3 hours: window = spread + drive + 15min buffer", () => {
    const arrival = makeTime(8, 0);
    // low=60, high=240 → spread=180 → duration = 180 + 15 + 15 = 210
    const { windowStart, windowEnd } = calculateKnownJobWindow(arrival, 60, 240, 15);
    // start = 8:00 + 60 = 9:00; end = 9:00 + 210min = 12:30
    expect(hhmm(windowStart)).toBe("9:00");
    expect(diffMinutes(windowStart, windowEnd)).toBe(210);
  });

  it("rounds start when arrival + low is not aligned", () => {
    const arrival = makeTime(8, 0);
    // low=65 → raw start = 9:05 → rounded to 9:15
    const { windowStart } = calculateKnownJobWindow(arrival, 65, 180, 15);
    expect(hhmm(windowStart)).toBe("9:15");
  });
});

// ============================================================
// RULE 3 — Known job, high > 240 min
// ============================================================

describe("Rule 3 — Known job, high > 240 min", () => {
  it("window starts at midpoint after arrival", () => {
    const arrival = makeTime(8, 0);
    // low=240, high=360 → midpoint=300min=5hr → start = 8:00 + 5hr = 13:00
    const { windowStart } = calculateKnownJobWindow(arrival, 240, 360, 15);
    expect(hhmm(windowStart)).toBe("13:00");
  });

  it("window ends 3 hours after start", () => {
    const arrival = makeTime(8, 0);
    const { windowStart, windowEnd } = calculateKnownJobWindow(arrival, 240, 360, 15);
    expect(diffMinutes(windowStart, windowEnd)).toBe(180);
  });

  it("4-6 hour estimate (low=240, high=360)", () => {
    const arrival = makeTime(8, 0);
    // midpoint = 300 = 5hr → start = 13:00, end = 16:00
    const { windowStart, windowEnd } = calculateKnownJobWindow(arrival, 240, 360, 15);
    expect(hhmm(windowStart)).toBe("13:00");
    expect(hhmm(windowEnd)).toBe("16:00");
  });

  it("6-8 hour estimate (low=360, high=480)", () => {
    const arrival = makeTime(7, 0);
    // midpoint = 420 = 7hr → start = 7:00 + 7hr = 14:00, end = 17:00
    const { windowStart, windowEnd } = calculateKnownJobWindow(arrival, 360, 480, 15);
    expect(hhmm(windowStart)).toBe("14:00");
    expect(hhmm(windowEnd)).toBe("17:00");
  });

  it("rounds start when midpoint doesn't align to 15 min", () => {
    const arrival = makeTime(8, 0);
    // low=241, high=360 → midpoint = 300.5 → rounded to 301 min = 5hr 1min
    // raw start = 13:01 → rounded to 13:15
    const { windowStart } = calculateKnownJobWindow(arrival, 241, 360, 15);
    expect(hhmm(windowStart)).toBe("13:15");
  });

  it("boundary: high=241 enters Rule 3 (not 2B)", () => {
    const arrival = makeTime(8, 0);
    // low=120, high=241 → midpoint=180.5 → rounded to 181 min = 3hr 1min
    // Rule 3: start = arrival + midpoint, duration = 3hr
    const { windowStart, windowEnd } = calculateKnownJobWindow(arrival, 120, 241, 15);
    // raw start = 8:00 + 181min = 11:01 → rounded to 11:15
    expect(hhmm(windowStart)).toBe("11:15");
    expect(diffMinutes(windowStart, windowEnd)).toBe(180);
  });
});

// ============================================================
// RECALCULATION — recalculateDownstreamWindows
// ============================================================

describe("recalculateDownstreamWindows", () => {
  const scheduledDate = new Date(2026, 3, 13);

  function makeJob(overrides: Partial<RecalcJob> & { id: string; queuePosition: number }): RecalcJob {
    return {
      customerId: `cust-${overrides.id}`,
      customerName: `Customer ${overrides.id}`,
      estimatedDurationMinutes: 90,
      driveTimeMinutes: 15,
      windowStart: null,
      windowEnd: null,
      status: "NOT_STARTED",
      ...overrides,
    };
  }

  function makeDb(jobs: RecalcJob[], followUps: Record<string, { estimatedLowMinutes: number; estimatedHighMinutes: number } | null> = {}): WindowRecalculatorDb {
    return {
      getJobsForTechOnDate: vi.fn().mockResolvedValue(jobs),
      getFollowUpEstimates: vi.fn().mockImplementation(async (jobId: string) => followUps[jobId] ?? null),
      updateJobWindow: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("updates downstream windows when tech arrives at a job", async () => {
    const jobs = [
      makeJob({ id: "job-1", queuePosition: 1 }),
      makeJob({ id: "job-2", queuePosition: 2 }),
      makeJob({ id: "job-3", queuePosition: 3 }),
    ];
    const db = makeDb(jobs);
    const techArrival = makeTime(9, 0);

    const result = await recalculateDownstreamWindows("tech-1", "job-1", techArrival, scheduledDate, db);

    expect(result.updatedJobs).toBe(2);
    expect(db.updateJobWindow).toHaveBeenCalledTimes(2);
  });

  it("updates downstream windows when tech completes a job", async () => {
    const jobs = [
      makeJob({ id: "job-1", queuePosition: 1, status: "COMPLETED" }),
      makeJob({ id: "job-2", queuePosition: 2 }),
      makeJob({ id: "job-3", queuePosition: 3 }),
    ];
    const db = makeDb(jobs);
    // Completion trigger: baseline is now + drive to next
    const completionBaseline = makeTime(10, 30);

    const result = await recalculateDownstreamWindows("tech-1", "job-1", completionBaseline, scheduledDate, db);

    expect(result.updatedJobs).toBe(2);
    expect(db.updateJobWindow).toHaveBeenCalledTimes(2);
  });

  it("flags customer at N+2 for 'two_jobs_away' notification on tech arrival at N", async () => {
    const jobs = [
      makeJob({ id: "job-1", queuePosition: 1 }),
      makeJob({ id: "job-2", queuePosition: 2 }),
      makeJob({ id: "job-3", queuePosition: 3 }), // N+2
      makeJob({ id: "job-4", queuePosition: 4 }),
    ];
    const db = makeDb(jobs);

    const result = await recalculateDownstreamWindows("tech-1", "job-1", makeTime(9, 0), scheduledDate, db);

    const twoAwayNotif = result.notifications.find((n) => n.reason === "two_jobs_away");
    expect(twoAwayNotif).toBeDefined();
    expect(twoAwayNotif!.jobId).toBe("job-3");
    expect(twoAwayNotif!.customerId).toBe("cust-job-3");
  });

  it("flags window shift of 30+ minutes for notification", async () => {
    const oldStart = makeTime(12, 0);
    const oldEnd = makeTime(15, 0);
    const jobs = [
      makeJob({ id: "job-1", queuePosition: 1 }),
      makeJob({ id: "job-2", queuePosition: 2, windowStart: oldStart, windowEnd: oldEnd }),
    ];
    const db = makeDb(jobs);

    // Tech arrives much later than expected — 10:00 instead of 8:00
    // job-2 is at downstream index 0 (N+1), not N+2, so it won't get two_jobs_away
    // Its window will shift significantly → should get window_shifted
    const result = await recalculateDownstreamWindows("tech-1", "job-1", makeTime(10, 0), scheduledDate, db);

    // job-2 is a diagnostic: window start = arrival(10:00) + job-2 duration(90min) + drive(15min) = 11:45
    // then calculateDiagnosticWindow from 11:45: start = 12:45 → rounded to 13:00
    // Old start was 12:00 → shift = 60min ≥ 30min → notification
    const shiftedNotif = result.notifications.find((n) => n.reason === "window_shifted");
    expect(shiftedNotif).toBeDefined();
    expect(shiftedNotif!.jobId).toBe("job-2");
  });

  it("does NOT flag window shift under 30 minutes", async () => {
    // baseline arrival = 9:00, job-2 is first downstream
    // recalculator calls calculateDiagnosticWindow(9:00) → windowStart = 10:00
    // Set old window to 10:15 — shift = 15min < 30min threshold
    const jobs = [
      makeJob({ id: "job-1", queuePosition: 1 }),
      makeJob({
        id: "job-2",
        queuePosition: 2,
        windowStart: makeTime(10, 15),
        windowEnd: makeTime(13, 15),
      }),
    ];
    const db = makeDb(jobs);

    const result = await recalculateDownstreamWindows("tech-1", "job-1", makeTime(9, 0), scheduledDate, db);

    const shiftedNotifs = result.notifications.filter((n) => n.reason === "window_shifted");
    expect(shiftedNotifs).toHaveLength(0);
  });

  it("'two_jobs_away' takes priority over 30-minute shift (no double notify)", async () => {
    // job-3 is at N+2 AND has a shifted window — should only get two_jobs_away
    const jobs = [
      makeJob({ id: "job-1", queuePosition: 1 }),
      makeJob({ id: "job-2", queuePosition: 2 }),
      makeJob({
        id: "job-3",
        queuePosition: 3,
        // Set old window far from expected new one to trigger shift
        windowStart: makeTime(8, 0),
        windowEnd: makeTime(11, 0),
      }),
    ];
    const db = makeDb(jobs);

    const result = await recalculateDownstreamWindows("tech-1", "job-1", makeTime(9, 0), scheduledDate, db);

    // job-3 should get exactly one notification, and it should be two_jobs_away
    const job3Notifs = result.notifications.filter((n) => n.jobId === "job-3");
    expect(job3Notifs).toHaveLength(1);
    expect(job3Notifs[0]!.reason).toBe("two_jobs_away");
  });

  it("skips completed/canceled jobs in downstream queue", async () => {
    const jobs = [
      makeJob({ id: "job-1", queuePosition: 1 }),
      makeJob({ id: "job-2", queuePosition: 2, status: "COMPLETED" }),
      makeJob({ id: "job-3", queuePosition: 3 }),
    ];
    const db = makeDb(jobs);

    const result = await recalculateDownstreamWindows("tech-1", "job-1", makeTime(9, 0), scheduledDate, db);

    // Only job-3 should be updated (job-2 is skipped)
    expect(result.updatedJobs).toBe(1);
    expect(db.updateJobWindow).toHaveBeenCalledTimes(1);
    expect(db.updateJobWindow).toHaveBeenCalledWith("job-3", expect.any(Date), expect.any(Date));
  });

  it("uses follow-up estimates for known jobs (not diagnostic window)", async () => {
    const jobs = [
      makeJob({ id: "job-1", queuePosition: 1 }),
      makeJob({ id: "job-2", queuePosition: 2, driveTimeMinutes: 15 }),
    ];
    const followUps = {
      "job-2": { estimatedLowMinutes: 60, estimatedHighMinutes: 90 },
    };
    const db = makeDb(jobs, followUps);

    const result = await recalculateDownstreamWindows("tech-1", "job-1", makeTime(9, 0), scheduledDate, db);

    expect(result.updatedJobs).toBe(1);
    // baseline arrival = 9:00; job-2 is first downstream so nextArrivalTime = 9:00
    // Known job high=90 ≤ 120 → Rule 2A: start = 9:00 + 1hr = 10:00
    const call = (db.updateJobWindow as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(hhmm(call[1] as Date)).toBe("10:00"); // windowStart
    expect(hhmm(call[2] as Date)).toBe("12:00"); // windowEnd (2hr later)
  });

  it("returns empty result when trigger job is not found", async () => {
    const jobs = [
      makeJob({ id: "job-1", queuePosition: 1 }),
    ];
    const db = makeDb(jobs);

    const result = await recalculateDownstreamWindows("tech-1", "job-999", makeTime(9, 0), scheduledDate, db);

    expect(result.updatedJobs).toBe(0);
    expect(result.notifications).toHaveLength(0);
  });

  it("returns empty result when trigger job is last in queue", async () => {
    const jobs = [
      makeJob({ id: "job-1", queuePosition: 1 }),
    ];
    const db = makeDb(jobs);

    const result = await recalculateDownstreamWindows("tech-1", "job-1", makeTime(9, 0), scheduledDate, db);

    expect(result.updatedJobs).toBe(0);
    expect(result.notifications).toHaveLength(0);
  });
});
