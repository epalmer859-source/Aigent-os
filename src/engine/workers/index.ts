// ============================================================
// src/engine/workers/index.ts
//
// BACKGROUND WORKERS — IMPLEMENTATION
//
// All DB access would go through Prisma in production.
// This module maintains in-memory stores so the test suite
// runs without a real DB.
//
// Production Prisma query pattern (examples):
//   const convs = await db.conversations.findMany({
//     where: { auto_close_at: { lte: new Date() } }
//   });
//   await db.$transaction([
//     db.conversations.update({ where: { id }, data: { primary_state: "closed_lost" } }),
//     db.outbound_queue.updateMany({ where: { conversation_id: id, status: "pending" }, data: { status: "canceled" } }),
//   ]);
// ============================================================

import {
  ARCHIVE_AFTER_DAYS,
  PROMPT_LOG_RETENTION_DAYS,
  WEB_CHAT_SESSION_RETENTION_HOURS,
  NOTIFICATION_RETENTION_DAYS,
  type WorkerResult,
} from "./contract";

import { FALLBACK_RESPONSE } from "../ai-response/contract";

import { CLOSED_STATES } from "../state-machine/contract";

// ── In-memory record types ────────────────────────────────────

interface ConversationRecord {
  id: string;
  primaryState: string;
  priorState: string | null;
  autoCloseAt: Date | null;
  closedAt: Date | null;
  isArchived: boolean;
  humanTakeoverExpiresAt: Date | null;
}

interface QueueRowRecord {
  id: string;
  conversationId: string;
  messagePurpose: string;
  status: string;
  dedupeKey: string | null;
}

interface QuoteRecord {
  id: string;
  conversationId: string;
  status: string;
  createdAt: Date;
  quoteExpiryDays: number;
}

interface PromptLogRecord {
  id: string;
  conversationId: string;
  createdAt: Date;
}

interface WebChatSessionRecord {
  id: string;
  createdAt: Date;
}

interface NotificationRecord {
  id: string;
  isRead: boolean;
  createdAt: Date;
}

interface EventLogRecord {
  id: string;
  conversationId: string;
  eventType: string;
  createdAt: Date;
}

// ── In-memory stores ──────────────────────────────────────────

const _conversations = new Map<string, ConversationRecord>();
const _queueRows = new Map<string, QueueRowRecord>();
const _quotes = new Map<string, QuoteRecord>();
const _promptLogs = new Map<string, PromptLogRecord>();
const _webChatSessions = new Map<string, WebChatSessionRecord>();
const _notifications = new Map<string, NotificationRecord>();
const _eventLogs: EventLogRecord[] = [];

// ── Helpers ───────────────────────────────────────────────────

const CLOSED_STATE_SET = new Set<string>(CLOSED_STATES);

function _genId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function _logEvent(conversationId: string, eventType: string): void {
  // Production: db.conversation_events.create({ data: { conversation_id, event_type, created_at } })
  _eventLogs.push({
    id: _genId("evt"),
    conversationId,
    eventType,
    createdAt: new Date(),
  });
}

function _cancelPendingQueueRows(conversationId: string): void {
  // Production: db.outbound_queue.updateMany({
  //   where: { conversation_id: conversationId, status: { in: ["pending", "deferred"] } },
  //   data: { status: "canceled" },
  // })
  for (const row of _queueRows.values()) {
    if (
      row.conversationId === conversationId &&
      (row.status === "pending" || row.status === "deferred")
    ) {
      row.status = "canceled";
    }
  }
}

// ── 1. autoCloseWorker ────────────────────────────────────────

export async function autoCloseWorker(): Promise<WorkerResult> {
  if (process.env.NODE_ENV !== "test") return _autoCloseWorkerFromDb();
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const now = new Date();

  // Production: db.conversations.findMany({ where: { auto_close_at: { not: null } } })
  for (const conv of _conversations.values()) {
    if (conv.autoCloseAt === null || conv.autoCloseAt > now) {
      skipped++;
      continue;
    }

    // autoCloseAt <= now
    if (CLOSED_STATE_SET.has(conv.primaryState)) {
      // Already closed — skip
      skipped++;
      continue;
    }

    try {
      // Production: db.$transaction([
      //   db.conversations.update({ where: { id: conv.id }, data: { primary_state: "closed_lost", closed_at: now } }),
      //   db.outbound_queue.updateMany({ where: { conversation_id: conv.id, status: { in: ["pending","deferred"] } }, data: { status: "canceled" } }),
      //   db.conversation_events.create({ data: { conversation_id: conv.id, event_type: "conversation_auto_closed" } }),
      // ])
      conv.primaryState = "closed_lost";
      conv.closedAt = now;
      _cancelPendingQueueRows(conv.id);
      _logEvent(conv.id, "conversation_auto_closed");
      succeeded++;
    } catch {
      failed++;
    }
  }

  return { processed: succeeded + failed + skipped, succeeded, failed, skipped };
}

// ── 2. takeoverExpiryWorker ───────────────────────────────────

export async function takeoverExpiryWorker(): Promise<WorkerResult> {
  if (process.env.NODE_ENV !== "test") return _takeoverExpiryWorkerFromDb();
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const now = new Date();

  // Production: db.conversations.findMany({
  //   where: { primary_state: "human_takeover_active", human_takeover_expires_at: { not: null } }
  // })
  for (const conv of _conversations.values()) {
    if (conv.primaryState !== "human_takeover_active") {
      skipped++;
      continue;
    }

    if (conv.humanTakeoverExpiresAt === null) {
      // Permanent takeover — skip
      skipped++;
      continue;
    }

    if (conv.humanTakeoverExpiresAt > now) {
      // Timer not yet expired
      skipped++;
      continue;
    }

    try {
      // Restore state: use priorState if it exists and is not closed, else new_lead
      let restoredState = "new_lead";
      if (conv.priorState && !CLOSED_STATE_SET.has(conv.priorState)) {
        restoredState = conv.priorState;
      }

      // Production: db.$transaction([
      //   db.conversations.update({ where: { id: conv.id }, data: { primary_state: restoredState, human_takeover_expires_at: null } }),
      //   db.conversation_events.create({ data: { conversation_id: conv.id, event_type: "human_takeover_timer_expired" } }),
      // ])
      conv.primaryState = restoredState;
      conv.humanTakeoverExpiresAt = null;
      _logEvent(conv.id, "human_takeover_timer_expired");
      succeeded++;
    } catch {
      failed++;
    }
  }

  return { processed: succeeded + failed + skipped, succeeded, failed, skipped };
}

// ── 3. quoteExpiryWorker ──────────────────────────────────────

export async function quoteExpiryWorker(): Promise<WorkerResult> {
  if (process.env.NODE_ENV !== "test") return _quoteExpiryWorkerFromDb();
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const now = new Date();

  // Production: db.quotes.findMany({ where: { status: "sent" } })
  for (const quote of _quotes.values()) {
    if (quote.status !== "sent") {
      skipped++;
      continue;
    }

    const expiresAt = new Date(
      quote.createdAt.getTime() + quote.quoteExpiryDays * 24 * 60 * 60 * 1000,
    );

    if (expiresAt > now) {
      skipped++;
      continue;
    }

    try {
      // Production: db.$transaction([
      //   db.quotes.update({ where: { id: quote.id }, data: { status: "expired" } }),
      //   db.conversation_events.create({ data: { conversation_id: quote.conversationId, event_type: "quote_expired" } }),
      // ])
      quote.status = "expired";
      _logEvent(quote.conversationId, "quote_expired");
      succeeded++;
    } catch {
      failed++;
    }
  }

  return { processed: succeeded + failed + skipped, succeeded, failed, skipped };
}

// ── 4. conversationArchivalWorker ─────────────────────────────

export async function conversationArchivalWorker(): Promise<WorkerResult> {
  if (process.env.NODE_ENV !== "test") return _conversationArchivalWorkerFromDb();
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  const now = new Date();

  // Production: db.conversations.findMany({
  //   where: { primary_state: { in: CLOSED_STATES }, is_archived: false, closed_at: { not: null } }
  // })
  for (const conv of _conversations.values()) {
    if (
      !CLOSED_STATE_SET.has(conv.primaryState) ||
      conv.isArchived ||
      conv.closedAt === null
    ) {
      skipped++;
      continue;
    }

    const archiveAt = new Date(
      conv.closedAt.getTime() + ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000,
    );

    if (archiveAt > now) {
      skipped++;
      continue;
    }

    try {
      // Production: db.conversations.update({ where: { id: conv.id }, data: { is_archived: true } })
      conv.isArchived = true;
      succeeded++;
    } catch {
      failed++;
    }
  }

  return { processed: succeeded + failed + skipped, succeeded, failed, skipped };
}

// ── 5. promptLogCleanupWorker ─────────────────────────────────

export async function promptLogCleanupWorker(): Promise<WorkerResult> {
  if (process.env.NODE_ENV !== "test") return _promptLogCleanupWorkerFromDb();
  let succeeded = 0;
  let skipped = 0;
  const now = new Date();
  const cutoff = new Date(now.getTime() - PROMPT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  // Production: db.prompt_logs.deleteMany({ where: { created_at: { lte: cutoff } } })
  for (const [id, log] of _promptLogs.entries()) {
    if (log.createdAt <= cutoff) {
      _promptLogs.delete(id);
      succeeded++;
    } else {
      skipped++;
    }
  }

  return { processed: succeeded + skipped, succeeded, failed: 0, skipped };
}

// ── 6. webChatCleanupWorker ───────────────────────────────────

export async function webChatCleanupWorker(): Promise<WorkerResult> {
  if (process.env.NODE_ENV !== "test") return _webChatCleanupWorkerFromDb();
  let succeeded = 0;
  let skipped = 0;
  const now = new Date();
  const cutoff = new Date(
    now.getTime() - WEB_CHAT_SESSION_RETENTION_HOURS * 60 * 60 * 1000,
  );

  // Production: db.web_chat_sessions.deleteMany({ where: { created_at: { lte: cutoff } } })
  for (const [id, session] of _webChatSessions.entries()) {
    if (session.createdAt <= cutoff) {
      _webChatSessions.delete(id);
      succeeded++;
    } else {
      skipped++;
    }
  }

  return { processed: succeeded + skipped, succeeded, failed: 0, skipped };
}

// ── 7. notificationCleanupWorker ──────────────────────────────

export async function notificationCleanupWorker(): Promise<WorkerResult> {
  if (process.env.NODE_ENV !== "test") return _notificationCleanupWorkerFromDb();
  let succeeded = 0;
  let skipped = 0;
  const now = new Date();
  const cutoff = new Date(
    now.getTime() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  // Production: db.notifications.deleteMany({ where: { is_read: true, created_at: { lte: cutoff } } })
  for (const [id, notif] of _notifications.entries()) {
    if (notif.isRead && notif.createdAt <= cutoff) {
      _notifications.delete(id);
      succeeded++;
    } else {
      skipped++;
    }
  }

  return { processed: succeeded + skipped, succeeded, failed: 0, skipped };
}

// ── 8. aiFailureReprocessorWorker ─────────────────────────────

/** Message log entry with content, used by the AI failure reprocessor. */
interface WorkerMessageLogEntry {
  id: string;
  conversationId: string;
  businessId: string;
  direction: string;
  senderType: string;
  content: string;
  /** The inbound message that triggered this outbound response. */
  inboundMessageId?: string;
  createdAt: Date;
}

const _workerMessageLog = new Map<string, WorkerMessageLogEntry>();

/** Tracks conversationIds that were reprocessed — for test inspection. */
const _reprocessedConversations: string[] = [];

type AIReprocessFn = (params: {
  businessId: string;
  conversationId: string;
  inboundMessageId: string;
}) => Promise<{ success: boolean }>;

// Default: no-op stub. Override via _setAIReprocessFnForTest or production-init.
const _defaultAIReprocessFn: AIReprocessFn = async () => ({ success: false });
let _aiReprocessFn: AIReprocessFn = _defaultAIReprocessFn;

export async function aiFailureReprocessorWorker(): Promise<WorkerResult> {
  if (process.env.NODE_ENV !== "test") return _aiFailureReprocessorWorkerFromDb();
  const now = new Date();
  const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  // Production: SELECT id, conversation_id, business_id, content, inbound_message_id,
  //   created_at FROM message_log
  //   WHERE direction = 'outbound' AND content = $FALLBACK AND created_at > NOW() - '24h'
  for (const entry of _workerMessageLog.values()) {
    if (
      entry.direction !== "outbound" ||
      entry.content !== FALLBACK_RESPONSE ||
      entry.createdAt <= cutoff24h
    ) {
      continue;
    }

    processed++;

    // Check if a successful (non-fallback) AI response was generated after this fallback.
    // Production: SELECT 1 FROM message_log
    //   WHERE conversation_id = $1 AND direction = 'outbound' AND sender_type = 'ai'
    //     AND content != $FALLBACK AND created_at > $fallback_created_at LIMIT 1
    const hasSuccessfulFollowup = [..._workerMessageLog.values()].some(
      (m) =>
        m.conversationId === entry.conversationId &&
        m.direction === "outbound" &&
        m.senderType === "ai" &&
        m.content !== FALLBACK_RESPONSE &&
        m.createdAt > entry.createdAt,
    );

    if (hasSuccessfulFollowup) {
      skipped++;
      continue;
    }

    if (!entry.inboundMessageId) {
      skipped++;
      continue;
    }

    try {
      const result = await _aiReprocessFn({
        businessId: entry.businessId,
        conversationId: entry.conversationId,
        inboundMessageId: entry.inboundMessageId,
      });

      _reprocessedConversations.push(entry.conversationId);

      if (result.success) {
        succeeded++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { processed, succeeded, failed, skipped };
}

// ── Production Prisma implementations ────────────────────────

async function _autoCloseWorkerFromDb(): Promise<WorkerResult> {
  const { db } = await import("~/server/db");
  const now = new Date();
  let succeeded = 0; let failed = 0; let skipped = 0;
  const convs = await db.conversations.findMany({
    where: { auto_close_at: { not: null, lte: now }, primary_state: { notIn: CLOSED_STATES as any } },
    select: { id: true, business_id: true },
  });
  for (const conv of convs) {
    try {
      await db.$transaction([
        db.conversations.update({ where: { id: conv.id }, data: { primary_state: "closed_lost", closed_at: now } }),
        db.outbound_queue.updateMany({ where: { conversation_id: conv.id, status: { in: ["pending", "deferred"] } }, data: { status: "canceled" } }),
        db.event_log.create({ data: { business_id: conv.business_id, conversation_id: conv.id, event_code: "conversation_auto_closed", event_family: "state_machine", source_actor: "worker" } }),
      ]);
      succeeded++;
    } catch { failed++; }
  }
  skipped = convs.length === 0 ? 0 : 0;
  return { processed: succeeded + failed, succeeded, failed, skipped };
}

async function _takeoverExpiryWorkerFromDb(): Promise<WorkerResult> {
  const { db } = await import("~/server/db");
  const now = new Date();
  let succeeded = 0; let failed = 0; let skipped = 0;
  const convs = await db.conversations.findMany({
    where: { primary_state: "human_takeover_active", human_takeover_expires_at: { not: null, lte: now } },
    select: { id: true, business_id: true, prior_state: true },
  });
  for (const conv of convs) {
    try {
      const priorState = conv.prior_state;
      const restoredState = priorState && !(CLOSED_STATES as string[]).includes(priorState) ? priorState : "new_lead";
      await db.$transaction([
        db.conversations.update({ where: { id: conv.id }, data: { primary_state: restoredState as any, human_takeover_expires_at: null } }),
        db.event_log.create({ data: { business_id: conv.business_id, conversation_id: conv.id, event_code: "human_takeover_timer_expired", event_family: "state_machine", source_actor: "worker" } }),
      ]);
      succeeded++;
    } catch { failed++; }
  }
  skipped = 0;
  return { processed: succeeded + failed, succeeded, failed, skipped };
}

async function _quoteExpiryWorkerFromDb(): Promise<WorkerResult> {
  const { db } = await import("~/server/db");
  const now = new Date();
  let succeeded = 0; let failed = 0; let skipped = 0;
  const quotes = await db.quotes.findMany({
    where: { status: "sent", expires_at: { not: null, lte: now } },
    select: { id: true, business_id: true, conversation_id: true },
  });
  for (const quote of quotes) {
    try {
      await db.$transaction([
        db.quotes.update({ where: { id: quote.id }, data: { status: "expired" } }),
        db.event_log.create({ data: { business_id: quote.business_id, conversation_id: quote.conversation_id, event_code: "quote_expired", event_family: "state_machine", source_actor: "worker" } }),
      ]);
      succeeded++;
    } catch { failed++; }
  }
  return { processed: succeeded + failed, succeeded, failed, skipped };
}

async function _conversationArchivalWorkerFromDb(): Promise<WorkerResult> {
  const { db } = await import("~/server/db");
  const now = new Date();
  const cutoff = new Date(now.getTime() - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  let succeeded = 0; let failed = 0; let skipped = 0;
  const result = await db.conversations.updateMany({
    where: { primary_state: { in: CLOSED_STATES as any }, is_archived: false, closed_at: { not: null, lte: cutoff } },
    data: { is_archived: true },
  });
  succeeded = result.count;
  return { processed: succeeded + failed, succeeded, failed, skipped };
}

async function _promptLogCleanupWorkerFromDb(): Promise<WorkerResult> {
  const { db } = await import("~/server/db");
  const cutoff = new Date(Date.now() - PROMPT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await db.prompt_log.deleteMany({ where: { created_at: { lte: cutoff } } });
  return { processed: result.count, succeeded: result.count, failed: 0, skipped: 0 };
}

async function _webChatCleanupWorkerFromDb(): Promise<WorkerResult> {
  const { db } = await import("~/server/db");
  const cutoff = new Date(Date.now() - WEB_CHAT_SESSION_RETENTION_HOURS * 60 * 60 * 1000);
  const result = await db.web_chat_sessions.deleteMany({ where: { created_at: { lte: cutoff } } });
  return { processed: result.count, succeeded: result.count, failed: 0, skipped: 0 };
}

async function _notificationCleanupWorkerFromDb(): Promise<WorkerResult> {
  const { db } = await import("~/server/db");
  const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const result = await db.notifications.deleteMany({ where: { is_read: true, created_at: { lte: cutoff } } });
  return { processed: result.count, succeeded: result.count, failed: 0, skipped: 0 };
}

async function _aiFailureReprocessorWorkerFromDb(): Promise<WorkerResult> {
  const { db } = await import("~/server/db");
  const now = new Date();
  const cutoff24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  let processed = 0; let succeeded = 0; let failed = 0; let skipped = 0;

  // Find outbound fallback messages in the last 24h.
  const fallbacks = await db.message_log.findMany({
    where: { direction: "outbound", content: FALLBACK_RESPONSE, created_at: { gt: cutoff24h } },
    select: { id: true, conversation_id: true, business_id: true, created_at: true },
  });

  for (const entry of fallbacks) {
    processed++;
    // Check if a successful AI response was generated after this fallback.
    const hasSuccessful = await db.message_log.findFirst({
      where: { conversation_id: entry.conversation_id, direction: "outbound", sender_type: "ai", content: { not: FALLBACK_RESPONSE }, created_at: { gt: entry.created_at } },
      select: { id: true },
    });
    if (hasSuccessful) { skipped++; continue; }

    // Find the inbound message that triggered this fallback.
    const inboundMsg = await db.message_log.findFirst({
      where: { conversation_id: entry.conversation_id, direction: "inbound", created_at: { lte: entry.created_at } },
      orderBy: { created_at: "desc" },
      select: { id: true },
    });
    if (!inboundMsg) { skipped++; continue; }

    try {
      const result = await _aiReprocessFn({ businessId: entry.business_id, conversationId: entry.conversation_id, inboundMessageId: inboundMsg.id });
      _reprocessedConversations.push(entry.conversation_id);
      if (result.success) succeeded++; else failed++;
    } catch { failed++; }
  }

  return { processed, succeeded, failed, skipped };
}

// ── Test helpers ──────────────────────────────────────────────

export function _resetWorkersStoreForTest(): void {
  _conversations.clear();
  _queueRows.clear();
  _quotes.clear();
  _promptLogs.clear();
  _webChatSessions.clear();
  _notifications.clear();
  _eventLogs.length = 0;
  _workerMessageLog.clear();
  _reprocessedConversations.length = 0;
  _aiReprocessFn = _defaultAIReprocessFn;
}

export function _seedConversationForTest(data: Record<string, unknown>): void {
  // Production: db.conversations.upsert({ ... })
  _conversations.set(data["id"] as string, data as unknown as ConversationRecord);
}

export function _seedQueueRowForTest(data: Record<string, unknown>): void {
  // Production: db.outbound_queue.upsert({ ... })
  _queueRows.set(data["id"] as string, data as unknown as QueueRowRecord);
}

export function _seedQuoteForTest(data: Record<string, unknown>): void {
  // Production: db.quotes.upsert({ ... })
  _quotes.set(data["id"] as string, data as unknown as QuoteRecord);
}

export function _seedPromptLogEntryForTest(data: Record<string, unknown>): void {
  // Production: db.prompt_logs.upsert({ ... })
  _promptLogs.set(data["id"] as string, data as unknown as PromptLogRecord);
}

export function _seedWebChatSessionForTest(data: Record<string, unknown>): void {
  // Production: db.web_chat_sessions.upsert({ ... })
  _webChatSessions.set(data["id"] as string, data as unknown as WebChatSessionRecord);
}

export function _seedNotificationForTest(data: Record<string, unknown>): void {
  // Production: db.notifications.upsert({ ... })
  _notifications.set(data["id"] as string, data as unknown as NotificationRecord);
}

export function _getConversationForTest(
  id: string,
): ConversationRecord | undefined {
  return _conversations.get(id);
}

export function _getQueueRowForTest(id: string): QueueRowRecord | undefined {
  return _queueRows.get(id);
}

export function _getQuoteForTest(id: string): QuoteRecord | undefined {
  return _quotes.get(id);
}

export function _getEventLogsForTest(
  conversationId: string,
): EventLogRecord[] {
  return _eventLogs.filter((e) => e.conversationId === conversationId);
}

export function _getPromptLogCountForTest(): number {
  return _promptLogs.size;
}

export function _getWebChatSessionCountForTest(): number {
  return _webChatSessions.size;
}

export function _getNotificationCountForTest(): number {
  return _notifications.size;
}

// ── AI failure reprocessor test helpers (Finding 2) ──────────

export function _seedWorkerMessageLogForTest(
  data: Omit<WorkerMessageLogEntry, never>,
): void {
  _workerMessageLog.set(data.id, { ...data });
}

export function _setAIReprocessFnForTest(fn: AIReprocessFn): void {
  _aiReprocessFn = fn;
}

export function _getReprocessedConversationsForTest(): readonly string[] {
  return _reprocessedConversations;
}
