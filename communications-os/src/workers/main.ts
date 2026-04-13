// ============================================================
// src/workers/main.ts
//
// RAILWAY WORKER ENTRYPOINT
//
// Starts all background workers on their configured schedules.
// Run with: npx tsx src/workers/main.ts
//
// Environment variables required:
//   DATABASE_URL, ANTHROPIC_API_KEY, TWILIO_ACCOUNT_SID,
//   TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER
// ============================================================

// Wire production engine first — before any engine imports run
import { initProductionEngine } from "../engine/production-init";
initProductionEngine();

import cron from "node-cron";

import {
  autoCloseWorker,
  takeoverExpiryWorker,
  quoteExpiryWorker,
  conversationArchivalWorker,
  promptLogCleanupWorker,
  webChatCleanupWorker,
  notificationCleanupWorker,
  aiFailureReprocessorWorker,
} from "../engine/workers/index";

import { AI_REPROCESS_INTERVAL_SECONDS } from "../engine/workers/contract";

import {
  processQueue,
  processDeferredMessages,
} from "../engine/queue-worker/index";

import { processGracePeriodChanges } from "../engine/calendar-sync/index";

import {
  morningReminderWorker,
  endOfDaySweepWorker,
  pullForwardExpiryWorker,
  skillTagValidationWorker,
  manualPositionExpiryWorker,
  estimateTimeoutWorker,
  morningBriefingWorker,
  timerCheckInWorker,
  projectScopePromptWorker,
  workerHeartbeatWorker,
} from "../engine/scheduling/scheduling-workers";
import { sendEstimatePrompt, sendEstimateReminder } from "../engine/scheduling/communication-wiring";
import { onMorningReminderDue } from "../engine/scheduling/communication-wiring";
import type { AiTextGenerator } from "../engine/scheduling/communication-wiring";
import { schedulingAdapters } from "../engine/production-init";
import { db } from "../server/db";

// ── Utility ───────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeRun(name: string, fn: () => Promise<unknown>): void {
  fn().catch((err: unknown) => {
    console.error(`[worker:${name}] error:`, err);
  });
}

// ── Interval handles (for SIGTERM cleanup) ────────────────────

const intervals: ReturnType<typeof setInterval>[] = [];

// ── 60-second interval workers ────────────────────────────────

intervals.push(
  setInterval(() => safeRun("autoClose", autoCloseWorker), 60_000),
  setInterval(() => safeRun("takeoverExpiry", takeoverExpiryWorker), 60_000),
  setInterval(() => safeRun("deferredMessages", processDeferredMessages), 60_000),
  setInterval(() => safeRun("gracePeriod", processGracePeriodChanges), 60_000),
  setInterval(
    () => safeRun("aiFailureReprocessor", aiFailureReprocessorWorker),
    AI_REPROCESS_INTERVAL_SECONDS * 1_000,
  ),
);

// ── Continuous queue processor ────────────────────────────────

let queueRunning = true;

async function queueLoop(): Promise<void> {
  while (queueRunning) {
    await safeRunAsync("processQueue", processQueue);
    await sleep(1_000);
  }
}

async function safeRunAsync(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[worker:${name}] error:`, err);
  }
}

void queueLoop();

// ── Daily cron workers ────────────────────────────────────────

// quoteExpiryWorker — daily midnight UTC
cron.schedule("0 0 * * *", () => safeRun("quoteExpiry", quoteExpiryWorker), {
  timezone: "UTC",
});

// conversationArchivalWorker — daily 4 AM UTC
cron.schedule("0 4 * * *", () => safeRun("archival", conversationArchivalWorker), {
  timezone: "UTC",
});

// promptLogCleanupWorker — daily 3 AM UTC
cron.schedule("0 3 * * *", () => safeRun("promptLogCleanup", promptLogCleanupWorker), {
  timezone: "UTC",
});

// webChatCleanupWorker — daily 2 AM UTC
cron.schedule("0 2 * * *", () => safeRun("webChatCleanup", webChatCleanupWorker), {
  timezone: "UTC",
});

// notificationCleanupWorker — daily 5 AM UTC
cron.schedule("0 5 * * *", () => safeRun("notificationCleanup", notificationCleanupWorker), {
  timezone: "UTC",
});

// ── Scheduling engine cron workers ───────────────────────────

const schedulingClock = { now: () => new Date() };

const schedulingCommClock = {
  now: () => new Date(),
  today: () => {
    const d = new Date();
    return new Date(d.toISOString().split("T")[0]!);
  },
};

const workerAiGenerator: AiTextGenerator = {
  async generateText() {
    return { outcome: "ai_unavailable" as const, content: "", usedFallback: true as const };
  },
};

/**
 * Runs a scheduling worker for every active business.
 * Each business gets its own timezone-aware config.
 */
async function forEachActiveBusiness(
  workerName: string,
  fn: (config: { businessId: string; timezone: string }) => Promise<unknown>,
): Promise<void> {
  const businesses = await db.businesses.findMany({
    where: { deleted_at: null },
    select: { id: true, timezone: true },
  });
  for (const biz of businesses) {
    try {
      await fn({ businessId: biz.id, timezone: biz.timezone });
    } catch (err) {
      console.error(`[worker:${workerName}] error for business ${biz.id}:`, err);
    }
  }
}

// morningReminderWorker — every 15 minutes 6-10 AM UTC (covers US morning hours)
cron.schedule("*/15 6-13 * * *", () => safeRun("morningReminder", async () => {
  await forEachActiveBusiness("morningReminder", async (config) => {
    const reminderDb = schedulingAdapters.morningReminderWorker;
    await morningReminderWorker(
      config,
      schedulingClock,
      reminderDb,
      async (jobId) => {
        const commDb = schedulingAdapters.communicationWiring;
        await onMorningReminderDue(jobId, commDb, schedulingCommClock, workerAiGenerator);
      },
    );
  });
}), { timezone: "UTC" });

// endOfDaySweepWorker — every 30 minutes 20-06 UTC (covers US evening hours)
cron.schedule("*/30 20-23,0-6 * * *", () => safeRun("endOfDaySweep", async () => {
  await forEachActiveBusiness("endOfDaySweep", async (config) => {
    const sweepDb = schedulingAdapters.endOfDaySweepWorker;
    const result = await endOfDaySweepWorker(config, schedulingClock, sweepDb);
    if (result.stuckJobs.length > 0) {
      console.log(
        `[endOfDaySweep] Business ${config.businessId}: ${result.stuckJobs.length} stuck jobs detected`,
        result.stuckJobs.map((j) => j.jobId),
      );
    }
  });
}), { timezone: "UTC" });

// pullForwardExpiryWorker — every 5 minutes (offers expire after 20 min)
cron.schedule("*/5 * * * *", () => safeRun("pullForwardExpiry", async () => {
  const expiryDb = schedulingAdapters.pullForwardExpiryWorker;
  const result = await pullForwardExpiryWorker(schedulingClock, expiryDb);
  if (result.expiredCount > 0) {
    console.log(`[pullForwardExpiry] Expired ${result.expiredCount} offers`);
  }
}), { timezone: "UTC" });

// skillTagValidationWorker — daily at 6 AM UTC
cron.schedule("0 6 * * *", () => safeRun("skillTagValidation", async () => {
  await forEachActiveBusiness("skillTagValidation", async (config) => {
    const validationDb = schedulingAdapters.skillTagValidationWorker;
    const result = await skillTagValidationWorker(config, schedulingClock, validationDb);
    if (result.mismatches.length > 0) {
      console.log(
        `[skillTagValidation] Business ${config.businessId}: ${result.mismatches.length} skill tag mismatches`,
        result.mismatches.map((m) => m.jobId),
      );
    }
  });
}), { timezone: "UTC" });

// manualPositionExpiryWorker — every hour (clears 24h-old manual flags)
cron.schedule("0 * * * *", () => safeRun("manualPositionExpiry", async () => {
  await forEachActiveBusiness("manualPositionExpiry", async (config) => {
    const expiryDb = schedulingAdapters.manualPositionExpiryWorker;
    const result = await manualPositionExpiryWorker(config, schedulingClock, expiryDb);
    if (result.expiredCount > 0) {
      console.log(`[manualPositionExpiry] Business ${config.businessId}: cleared ${result.expiredCount} expired manual positions`);
    }
  });
}), { timezone: "UTC" });

// estimateTimeoutWorker — every 5 minutes during work hours
cron.schedule("*/5 6-22 * * *", () => safeRun("estimateTimeout", async () => {
  await forEachActiveBusiness("estimateTimeout", async (config) => {
    const timeoutDb = schedulingAdapters.estimateTimeoutWorker;
    const commDb = schedulingAdapters.communicationWiring;
    const result = await estimateTimeoutWorker(config, schedulingClock, timeoutDb,
      async (jobId) => {
        await sendEstimatePrompt(jobId, commDb, schedulingCommClock, workerAiGenerator);
      },
      async (jobId) => {
        await sendEstimateReminder(jobId, commDb, schedulingCommClock, workerAiGenerator);
      },
    );
    if (result.promptsSent > 0 || result.remindersSent > 0) {
      console.log(`[estimateTimeout] Business ${config.businessId}: sent ${result.promptsSent} prompts, ${result.remindersSent} reminders`);
    }
  });
}), { timezone: "UTC" });

// morningBriefingWorker — every 15 minutes 5-12 UTC (30 min before open, covers US timezones)
cron.schedule("*/15 5-12 * * *", () => safeRun("morningBriefing", async () => {
  await forEachActiveBusiness("morningBriefing", async (config) => {
    const briefingDb = schedulingAdapters.morningBriefingWorker;
    const result = await morningBriefingWorker(config, schedulingClock, briefingDb, async (techId, techName, jobCount, totalMinutes) => {
      console.log(`[morningBriefing] Briefing queued for ${techName}: ${jobCount} jobs, ${totalMinutes} min`);
    });
    if (result.briefingsQueued > 0) {
      console.log(`[morningBriefing] Business ${config.businessId}: queued ${result.briefingsQueued} briefings`);
    }
  });
}), { timezone: "UTC" });

// timerCheckInWorker — every minute during work hours
cron.schedule("* 6-22 * * *", () => safeRun("timerCheckIn", async () => {
  await forEachActiveBusiness("timerCheckIn", async (config) => {
    const checkInDb = schedulingAdapters.timerCheckInWorker;
    const result = await timerCheckInWorker(config, schedulingClock, checkInDb, async (jobId) => {
      console.log(`[timerCheckIn] Check-in queued for job ${jobId}`);
    });
    if (result.checkInsQueued > 0) {
      console.log(`[timerCheckIn] Business ${config.businessId}: queued ${result.checkInsQueued} check-ins`);
    }
  });
}), { timezone: "UTC" });

// projectScopePromptWorker — every minute during work hours
cron.schedule("* 6-22 * * *", () => safeRun("projectScope", async () => {
  await forEachActiveBusiness("projectScope", async (config) => {
    const scopeDb = schedulingAdapters.projectScopePromptWorker;
    const result = await projectScopePromptWorker(config, schedulingClock, scopeDb, async (jobId) => {
      console.log(`[projectScope] Scope prompt queued for job ${jobId}`);
    });
    if (result.promptsQueued > 0) {
      console.log(`[projectScope] Business ${config.businessId}: queued ${result.promptsQueued} scope prompts`);
    }
  });
}), { timezone: "UTC" });

// workerHeartbeatWorker — every minute
intervals.push(
  setInterval(() => safeRun("heartbeat", async () => {
    const heartbeatDb = schedulingAdapters.heartbeatDb;
    const result = await workerHeartbeatWorker("scheduling-workers", schedulingClock, heartbeatDb);
    if (result.stale) {
      console.warn(`[heartbeat] STALE: ${result.workerName} gap=${Math.round((result.gapMs ?? 0) / 1000)}s (threshold=300s)`);
    }
  }), 60_000),
);

// ── Startup log ───────────────────────────────────────────────

const WORKER_COUNT = 21; // 5 interval + 1 queue loop + 5 cron + gracePeriod + 9 scheduling cron = 21

console.log(`[workers] Started ${WORKER_COUNT} background workers.`);
console.log(`[workers] Interval: autoClose, takeoverExpiry, deferredMessages, gracePeriod (60s), heartbeat (60s)`);
console.log(`[workers] Continuous: processQueue (1s loop)`);
console.log(`[workers] Cron: quoteExpiry (00:00), archival (04:00), promptLogCleanup (03:00), webChatCleanup (02:00), notificationCleanup (05:00) UTC`);
console.log(`[workers] Scheduling: morningReminder (*/15 6-13), morningBriefing (*/15 5-12), endOfDaySweep (*/30 20-06), pullForwardExpiry (*/5), skillTagValidation (06:00), manualPositionExpiry (hourly), estimateTimeout (*/5 6-22), timerCheckIn (*/1 6-22), projectScope (*/1 6-22)`);

// ── Graceful shutdown ─────────────────────────────────────────

process.on("SIGTERM", () => {
  console.log("[workers] SIGTERM received — shutting down gracefully...");
  queueRunning = false;
  intervals.forEach((id) => clearInterval(id));
  // Give the queue loop one final cycle to finish
  setTimeout(() => {
    console.log("[workers] Shutdown complete.");
    process.exit(0);
  }, 2_000);
});

process.on("SIGINT", () => {
  console.log("[workers] SIGINT received — shutting down gracefully...");
  queueRunning = false;
  intervals.forEach((id) => clearInterval(id));
  setTimeout(() => {
    console.log("[workers] Shutdown complete.");
    process.exit(0);
  }, 2_000);
});
