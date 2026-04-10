// ============================================================
// src/engine/workers/__tests__/workers.test.ts
//
// BACKGROUND WORKERS — UNIT TESTS
//
// All tests import from "../index" which does NOT exist yet,
// so the entire suite fails to load (all tests are "failing").
//
// Test categories:
//   AC01-AC04  Auto-close worker
//   TE01-TE04  Takeover expiry worker
//   QE01-QE03  Quote expiry worker
//   AR01-AR03  Conversation archival worker
//   CL01-CL04  Cleanup workers
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";

// ── Module under test (does not exist yet — all tests will fail) ──
import {
  autoCloseWorker,
  takeoverExpiryWorker,
  quoteExpiryWorker,
  conversationArchivalWorker,
  promptLogCleanupWorker,
  webChatCleanupWorker,
  notificationCleanupWorker,
  _resetWorkersStoreForTest,
  _seedConversationForTest,
  _seedQueueRowForTest,
  _seedQuoteForTest,
  _seedPromptLogEntryForTest,
  _seedWebChatSessionForTest,
  _seedNotificationForTest,
  _getConversationForTest,
  _getQueueRowForTest,
  _getQuoteForTest,
  _getEventLogsForTest,
  _getPromptLogCountForTest,
  _getWebChatSessionCountForTest,
  _getNotificationCountForTest,
} from "../index";

// ── Constants from contract ───────────────────────────────────
import {
  ARCHIVE_AFTER_DAYS,
  PROMPT_LOG_RETENTION_DAYS,
  WEB_CHAT_SESSION_RETENTION_HOURS,
  NOTIFICATION_RETENTION_DAYS,
} from "../contract";

// ── Time helpers ──────────────────────────────────────────────

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 60 * 1000);
}

function hoursFromNow(n: number): Date {
  return new Date(Date.now() + n * 60 * 60 * 1000);
}

function minutesAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 1000);
}

// ── AC: Auto-close worker ─────────────────────────────────────

describe("AC: Auto-close worker", () => {
  beforeEach(() => {
    _resetWorkersStoreForTest();
  });

  it("AC01: conversation past auto_close_at in non-closed state → transitions to closed_lost", async () => {
    _seedConversationForTest({
      id: "conv_ac01",
      primaryState: "new_lead",
      autoCloseAt: daysAgo(1),
      closedAt: null,
      isArchived: false,
      humanTakeoverExpiresAt: null,
    });

    const result = await autoCloseWorker();

    expect(result.succeeded).toBe(1);
    expect(result.skipped).toBe(0);

    const conv = _getConversationForTest("conv_ac01");
    expect(conv?.primaryState).toBe("closed_lost");
  });

  it("AC02: conversation past auto_close_at already in closed state → skipped", async () => {
    _seedConversationForTest({
      id: "conv_ac02",
      primaryState: "closed_lost",
      autoCloseAt: daysAgo(1),
      closedAt: daysAgo(2),
      isArchived: false,
      humanTakeoverExpiresAt: null,
    });

    const result = await autoCloseWorker();

    expect(result.skipped).toBe(1);
    expect(result.succeeded).toBe(0);

    const conv = _getConversationForTest("conv_ac02");
    expect(conv?.primaryState).toBe("closed_lost");
  });

  it("AC03: conversation not past auto_close_at → skipped", async () => {
    _seedConversationForTest({
      id: "conv_ac03",
      primaryState: "lead_qualified",
      autoCloseAt: daysFromNow(3),
      closedAt: null,
      isArchived: false,
      humanTakeoverExpiresAt: null,
    });

    const result = await autoCloseWorker();

    expect(result.skipped).toBe(1);
    expect(result.succeeded).toBe(0);

    const conv = _getConversationForTest("conv_ac03");
    expect(conv?.primaryState).toBe("lead_qualified");
  });

  it("AC04: auto-close cancels all pending outbound_queue rows for the conversation", async () => {
    _seedConversationForTest({
      id: "conv_ac04",
      primaryState: "booking_in_progress",
      autoCloseAt: hoursAgo(1),
      closedAt: null,
      isArchived: false,
      humanTakeoverExpiresAt: null,
    });
    _seedQueueRowForTest({
      id: "queue_ac04_a",
      conversationId: "conv_ac04",
      messagePurpose: "routine_followup_1",
      status: "pending",
      dedupeKey: "conv_ac04:followup1",
    });
    _seedQueueRowForTest({
      id: "queue_ac04_b",
      conversationId: "conv_ac04",
      messagePurpose: "appointment_reminder_24h",
      status: "pending",
      dedupeKey: null,
    });

    await autoCloseWorker();

    expect(_getQueueRowForTest("queue_ac04_a")?.status).toBe("canceled");
    expect(_getQueueRowForTest("queue_ac04_b")?.status).toBe("canceled");
  });
});

// ── TE: Takeover expiry worker ────────────────────────────────

describe("TE: Takeover expiry worker", () => {
  beforeEach(() => {
    _resetWorkersStoreForTest();
  });

  it("TE01: takeover with expired timer → restoreFromOverride called, state restored", async () => {
    _seedConversationForTest({
      id: "conv_te01",
      primaryState: "human_takeover_active",
      priorState: "lead_qualified",
      autoCloseAt: null,
      closedAt: null,
      isArchived: false,
      humanTakeoverExpiresAt: minutesAgo(5),
    });

    const result = await takeoverExpiryWorker();

    expect(result.succeeded).toBe(1);
    expect(result.skipped).toBe(0);

    const conv = _getConversationForTest("conv_te01");
    expect(conv?.primaryState).not.toBe("human_takeover_active");
  });

  it("TE02: takeover with future timer → skipped", async () => {
    _seedConversationForTest({
      id: "conv_te02",
      primaryState: "human_takeover_active",
      priorState: "new_lead",
      autoCloseAt: null,
      closedAt: null,
      isArchived: false,
      humanTakeoverExpiresAt: hoursFromNow(2),
    });

    const result = await takeoverExpiryWorker();

    expect(result.skipped).toBe(1);
    expect(result.succeeded).toBe(0);

    const conv = _getConversationForTest("conv_te02");
    expect(conv?.primaryState).toBe("human_takeover_active");
  });

  it("TE03: takeover with null expires_at (permanent) → skipped", async () => {
    _seedConversationForTest({
      id: "conv_te03",
      primaryState: "human_takeover_active",
      priorState: "new_lead",
      autoCloseAt: null,
      closedAt: null,
      isArchived: false,
      humanTakeoverExpiresAt: null,
    });

    const result = await takeoverExpiryWorker();

    expect(result.skipped).toBe(1);
    expect(result.succeeded).toBe(0);
  });

  it("TE04: expired takeover logs human_takeover_timer_expired event", async () => {
    _seedConversationForTest({
      id: "conv_te04",
      primaryState: "human_takeover_active",
      priorState: "lead_qualified",
      autoCloseAt: null,
      closedAt: null,
      isArchived: false,
      humanTakeoverExpiresAt: minutesAgo(10),
    });

    await takeoverExpiryWorker();

    const logs = _getEventLogsForTest("conv_te04");
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.eventType === "human_takeover_timer_expired")).toBe(true);
  });
});

// ── QE: Quote expiry worker ───────────────────────────────────

describe("QE: Quote expiry worker", () => {
  beforeEach(() => {
    _resetWorkersStoreForTest();
  });

  it("QE01: sent quote past expiry → status set to expired", async () => {
    _seedQuoteForTest({
      id: "quote_qe01",
      conversationId: "conv_qe01",
      status: "sent",
      createdAt: daysAgo(10),
      quoteExpiryDays: 7,
    });

    const result = await quoteExpiryWorker();

    expect(result.succeeded).toBe(1);

    const quote = _getQuoteForTest("quote_qe01");
    expect(quote?.status).toBe("expired");
  });

  it("QE02: sent quote not past expiry → skipped", async () => {
    _seedQuoteForTest({
      id: "quote_qe02",
      conversationId: "conv_qe02",
      status: "sent",
      createdAt: daysAgo(3),
      quoteExpiryDays: 7,
    });

    const result = await quoteExpiryWorker();

    expect(result.skipped).toBe(1);
    expect(result.succeeded).toBe(0);

    const quote = _getQuoteForTest("quote_qe02");
    expect(quote?.status).toBe("sent");
  });

  it("QE03: already-expired quote → skipped", async () => {
    _seedQuoteForTest({
      id: "quote_qe03",
      conversationId: "conv_qe03",
      status: "expired",
      createdAt: daysAgo(20),
      quoteExpiryDays: 7,
    });

    const result = await quoteExpiryWorker();

    expect(result.skipped).toBe(1);
    expect(result.succeeded).toBe(0);
  });
});

// ── AR: Archival worker ───────────────────────────────────────

describe("AR: Conversation archival worker", () => {
  beforeEach(() => {
    _resetWorkersStoreForTest();
  });

  it("AR01: closed conversation older than 90 days → is_archived = true", async () => {
    _seedConversationForTest({
      id: "conv_ar01",
      primaryState: "closed_completed",
      autoCloseAt: null,
      closedAt: daysAgo(ARCHIVE_AFTER_DAYS + 1),
      isArchived: false,
      humanTakeoverExpiresAt: null,
    });

    const result = await conversationArchivalWorker();

    expect(result.succeeded).toBe(1);

    const conv = _getConversationForTest("conv_ar01");
    expect(conv?.isArchived).toBe(true);
  });

  it("AR02: closed conversation younger than 90 days → skipped", async () => {
    _seedConversationForTest({
      id: "conv_ar02",
      primaryState: "closed_completed",
      autoCloseAt: null,
      closedAt: daysAgo(ARCHIVE_AFTER_DAYS - 1),
      isArchived: false,
      humanTakeoverExpiresAt: null,
    });

    const result = await conversationArchivalWorker();

    expect(result.skipped).toBe(1);
    expect(result.succeeded).toBe(0);

    const conv = _getConversationForTest("conv_ar02");
    expect(conv?.isArchived).toBe(false);
  });

  it("AR03: already archived → skipped", async () => {
    _seedConversationForTest({
      id: "conv_ar03",
      primaryState: "resolved",
      autoCloseAt: null,
      closedAt: daysAgo(120),
      isArchived: true,
      humanTakeoverExpiresAt: null,
    });

    const result = await conversationArchivalWorker();

    expect(result.skipped).toBe(1);
    expect(result.succeeded).toBe(0);
  });
});

// ── CL: Cleanup workers ───────────────────────────────────────

describe("CL: Cleanup workers", () => {
  beforeEach(() => {
    _resetWorkersStoreForTest();
  });

  it("CL01: prompt_log older than 30 days → deleted", async () => {
    _seedPromptLogEntryForTest({
      id: "log_cl01_old",
      conversationId: "conv_x",
      createdAt: daysAgo(PROMPT_LOG_RETENTION_DAYS + 1),
    });
    _seedPromptLogEntryForTest({
      id: "log_cl01_new",
      conversationId: "conv_x",
      createdAt: daysAgo(1),
    });

    expect(_getPromptLogCountForTest()).toBe(2);

    const result = await promptLogCleanupWorker();

    expect(result.succeeded).toBe(1);
    expect(_getPromptLogCountForTest()).toBe(1);
  });

  it("CL02: prompt_log younger than 30 days → retained", async () => {
    _seedPromptLogEntryForTest({
      id: "log_cl02",
      conversationId: "conv_x",
      createdAt: daysAgo(PROMPT_LOG_RETENTION_DAYS - 1),
    });

    await promptLogCleanupWorker();

    expect(_getPromptLogCountForTest()).toBe(1);
  });

  it("CL03: web_chat_session older than 24 hours → deleted", async () => {
    _seedWebChatSessionForTest({
      id: "session_cl03_old",
      createdAt: hoursAgo(WEB_CHAT_SESSION_RETENTION_HOURS + 1),
    });
    _seedWebChatSessionForTest({
      id: "session_cl03_new",
      createdAt: hoursAgo(1),
    });

    expect(_getWebChatSessionCountForTest()).toBe(2);

    const result = await webChatCleanupWorker();

    expect(result.succeeded).toBe(1);
    expect(_getWebChatSessionCountForTest()).toBe(1);
  });

  it("CL04: web_chat_session younger than 24 hours → retained", async () => {
    _seedWebChatSessionForTest({
      id: "session_cl04",
      createdAt: hoursAgo(WEB_CHAT_SESSION_RETENTION_HOURS - 1),
    });

    await webChatCleanupWorker();

    expect(_getWebChatSessionCountForTest()).toBe(1);
  });
});
