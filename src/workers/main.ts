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

// ── Startup log ───────────────────────────────────────────────

const WORKER_COUNT = 11; // 4 interval + 1 queue loop + 5 cron + gracePeriod = 11

console.log(`[workers] Started ${WORKER_COUNT} background workers.`);
console.log(`[workers] Interval: autoClose, takeoverExpiry, deferredMessages, gracePeriod (60s)`);
console.log(`[workers] Continuous: processQueue (1s loop)`);
console.log(`[workers] Cron: quoteExpiry (00:00), archival (04:00), promptLogCleanup (03:00), webChatCleanup (02:00), notificationCleanup (05:00) UTC`);

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
