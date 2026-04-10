// ============================================================
// src/engine/suppression/index.ts
//
// SUPPRESSION ENGINE — IMPLEMENTATION
//
// All DB access would go through Prisma in production.
// This module maintains in-memory stores identical to the pattern
// used in state-machine/index.ts and customer-resolver/index.ts.
//
// Check order inside shouldSendMessage:
//   1. G1  — business paused         → suppress
//   2. G2  — customer opted_out      → suppress
//   3. G3  — conversation no_show    → suppress
//   4. G4  — do_not_contact          → suppress  (customer flag + tag; internal exempt)
//   5. Per-purpose rules             → suppress  (checked before QH so blocked messages
//                                                  don't return "defer" when they can
//                                                  never send regardless of time)
//   6. G6  — rolling 24 h cap        → suppress  (non-urgent; checked before QH for same reason)
//   7. Dedupe                        → suppress
//   8. G5  — quiet hours             → defer     (only defers messages that would otherwise send)
//      → send
// ============================================================

import {
  URGENT_PURPOSES,
  QUIET_HOURS_EXEMPT_PURPOSES,
  PAUSE_MESSAGE_PURPOSE,
  NON_TERMINAL_QUEUE_STATUSES,
  ALLOWED_STATES_BY_PURPOSE,
  INTERNAL_PURPOSES,
  type MessageContext,
  type SuppressionResult,
} from "./contract";

import { OVERRIDE_STATES, CLOSED_STATES } from "../state-machine/contract";

// ── In-memory record types ────────────────────────────────────

interface BusinessRecord {
  id: string;
  isPaused: boolean;
  quietHoursStart: string; // "HH:MM"
  quietHoursEnd: string;   // "HH:MM"
  timezone: string;
}

interface CustomerRecord {
  id: string;
  businessId: string;
  consentStatus: string;
  doNotContact: boolean;
}

interface ConversationRecord {
  id: string;
  businessId: string;
  customerId: string;
  primaryState: string;
  isNoShow: boolean;
}

interface TagRecord {
  conversationId: string;
  businessId: string;
  tagCode: string;
  isActive: boolean;
}

interface MessageLogRecord {
  conversationId: string;
  businessId: string;
  direction: string;
  senderType: string;
  createdAt: Date;
}

interface OutboundQueueRecord {
  id: string;
  conversationId: string;
  businessId: string;
  messagePurpose: string;
  dedupeKey: string;
  status: string;
}

interface RecurringServiceRecord {
  id: string;
  businessId: string;
  status: string;
}

// ── In-memory stores ──────────────────────────────────────────
// Production equivalent: each Map<> is a Prisma table.

const _businesses = new Map<string, BusinessRecord>();
const _customers = new Map<string, CustomerRecord>();
const _conversations = new Map<string, ConversationRecord>();
const _tags = new Map<string, TagRecord>();
const _messageLog = new Map<string, MessageLogRecord>();
const _outboundQueue = new Map<string, OutboundQueueRecord>();
const _recurringServices = new Map<string, RecurringServiceRecord>();

// ── Classification sets (imported from state-machine contract) ─

const OVERRIDE_STATES_SET = new Set<string>(OVERRIDE_STATES);
const CLOSED_STATES_SET = new Set<string>(CLOSED_STATES);
const INTERNAL_PURPOSES_SET = new Set<string>(INTERNAL_PURPOSES);

// ── Quiet hours helpers ───────────────────────────────────────

function _parseHHMM(time: string): { h: number; m: number } {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return { h, m };
}

/**
 * Get current hour and minute in the given IANA timezone.
 */
function _localHHMM(now: Date, timezone: string): { h: number; m: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  let h = parseInt(parts.find((p) => p.type === "hour")!.value, 10);
  const m = parseInt(parts.find((p) => p.type === "minute")!.value, 10);
  // Some environments emit "24" for midnight — normalise.
  if (h === 24) h = 0;
  return { h, m };
}

/**
 * Compute the UTC offset in milliseconds for `utcDate` in `timezone`.
 * offset > 0 means local is ahead of UTC.
 */
function _tzOffsetMs(utcDate: Date, timezone: string): number {
  // en-CA formats as "YYYY-MM-DD, HH:mm:ss" which is parseable after cleanup.
  const local = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(utcDate);
  const asUtc = new Date(local.replace(", ", "T") + "Z");
  return asUtc.getTime() - utcDate.getTime();
}

/**
 * Find the next UTC timestamp at which the clock reads endH:endM in `timezone`.
 */
function _nextQuietHoursEnd(
  now: Date,
  timezone: string,
  endH: number,
  endM: number,
): Date {
  const localParts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const year = Number(localParts.find((p) => p.type === "year")!.value);
  const month = Number(localParts.find((p) => p.type === "month")!.value);
  const day = Number(localParts.find((p) => p.type === "day")!.value);
  let localH = Number(localParts.find((p) => p.type === "hour")!.value);
  if (localH === 24) localH = 0;
  const localM = Number(localParts.find((p) => p.type === "minute")!.value);

  const endTotalMin = endH * 60 + endM;
  const curTotalMin = localH * 60 + localM;
  // If we are already at or past endH:endM today in local time, push to tomorrow.
  const dayOffset = curTotalMin >= endTotalMin ? 1 : 0;

  // Approximate UTC at endH:endM on day+dayOffset, then correct for tz offset.
  const approxUtc = new Date(Date.UTC(year, month - 1, day + dayOffset, endH, endM));
  const offset = _tzOffsetMs(approxUtc, timezone);
  const candidate = new Date(approxUtc.getTime() - offset);

  // Guarantee the result is strictly in the future.
  if (candidate <= now) {
    return new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
  }
  return candidate;
}

/**
 * Determine whether `now` falls within the business's quiet hours.
 * Handles windows that cross midnight (e.g. 22:00–06:00).
 */
function _inQuietHours(
  now: Date,
  timezone: string,
  quietHoursStart: string,
  quietHoursEnd: string,
): { inside: boolean; deferUntil?: Date } {
  const { h: curH, m: curM } = _localHHMM(now, timezone);
  const curMin = curH * 60 + curM;

  const start = _parseHHMM(quietHoursStart);
  const end = _parseHHMM(quietHoursEnd);
  const startMin = start.h * 60 + start.m;
  const endMin = end.h * 60 + end.m;

  let inside: boolean;
  if (startMin > endMin) {
    // Crosses midnight (e.g. 22:00–06:00).
    inside = curMin >= startMin || curMin < endMin;
  } else {
    inside = curMin >= startMin && curMin < endMin;
  }

  if (!inside) return { inside: false };

  const deferUntil = _nextQuietHoursEnd(now, timezone, end.h, end.m);
  return { inside: true, deferUntil };
}

// ── Per-purpose helpers ───────────────────────────────────────

function _getActiveTag(conversationId: string, tagCode: string): boolean {
  for (const tag of _tags.values()) {
    if (tag.conversationId === conversationId && tag.tagCode === tagCode && tag.isActive) {
      return true;
    }
  }
  return false;
}

/**
 * Per-purpose suppression rules.
 * Returns a SuppressionResult if the message should be blocked, null otherwise.
 *
 * Production: each inner query is a Prisma call; results cached per request.
 */
function _checkPerPurpose(
  context: MessageContext,
  state: string,
): SuppressionResult | null {
  const p = context.messagePurpose;
  const convId = context.conversationId;

  // ── Followup purposes: block in override or closed states ──────────────
  // Production: SELECT primary_state FROM conversations WHERE id = conversationId
  if (
    p === "routine_followup_1" ||
    p === "routine_followup_final" ||
    p === "quote_followup_1" ||
    p === "quote_followup_final"
  ) {
    if (OVERRIDE_STATES_SET.has(state) || CLOSED_STATES_SET.has(state)) {
      return { decision: "suppress", reason: "wrong_state" };
    }
  }

  // ── ALLOWED_STATES_BY_PURPOSE gate ─────────────────────────────────────
  if (p in ALLOWED_STATES_BY_PURPOSE) {
    const allowed = ALLOWED_STATES_BY_PURPOSE[p]!;
    if (!(allowed as readonly string[]).includes(state)) {
      return { decision: "suppress", reason: "wrong_state" };
    }

    // Closeout: block on blocking tags.
    // Production: SELECT tag_code FROM conversation_tags
    //   WHERE conversation_id = ? AND is_active = true AND tag_code IN (...)
    if (p === "closeout") {
      if (_getActiveTag(convId, "negative_service_signal")) {
        return { decision: "suppress", reason: "negative_service_signal" };
      }
      if (_getActiveTag(convId, "closeout_blocked")) {
        return { decision: "suppress", reason: "closeout_blocked" };
      }
    }
  }

  // ── Stale-waiting purposes: block in override states ───────────────────
  if (p === "stale_waiting_customer_update" || p === "stale_waiting_customer_update_parts") {
    if (OVERRIDE_STATES_SET.has(state)) {
      return { decision: "suppress", reason: "wrong_state" };
    }
  }

  // ── Recurring reminder: check service status ───────────────────────────
  // Production: SELECT status FROM recurring_services WHERE id = recurringServiceId
  if (p === "recurring_reminder") {
    const svcId = context.recurringServiceId;
    if (svcId) {
      const svc = _recurringServices.get(svcId);
      if (svc?.status === "paused") {
        return { decision: "suppress", reason: "recurring_service_paused" };
      }
    }
    if (state === "human_takeover_active") {
      return { decision: "suppress", reason: "human_takeover_active" };
    }
  }

  // ── Purposes blocked when human takeover is active ─────────────────────
  if (
    p === "missed_call_fallback" ||
    p === "reschedule_confirmation" ||
    p === "cancellation_confirmation" ||
    p === "dispatch_notice" ||
    p === "delay_notice" ||
    p === "schedule_change_notice" ||
    p === "quote_delivery" ||
    p === "admin_response_relay" ||
    p === "handoff_response"
  ) {
    if (state === "human_takeover_active") {
      return { decision: "suppress", reason: "human_takeover_active" };
    }
  }

  return null;
}

// ── Weird-hours helpers ───────────────────────────────────────

/** Follow-up purposes subject to the weird-hours deferral rule. */
const _WEIRD_HOURS_FOLLOWUP_PURPOSES = new Set([
  "routine_followup_1",
  "routine_followup_final",
  "quote_followup_1",
  "quote_followup_final",
]);

/**
 * Return true if `checkTime` falls in the 6-hour window immediately
 * before quiet_hours_start in the given timezone.
 * E.g. for quiet start 22:00 → window is [16:00, 22:00).
 */
function _inWeirdHoursWindow(
  checkTime: Date,
  timezone: string,
  quietHoursStart: string,
): boolean {
  const { h: curH, m: curM } = _localHHMM(checkTime, timezone);
  const curMin = curH * 60 + curM;
  const start = _parseHHMM(quietHoursStart);
  const startMin = start.h * 60 + start.m;
  // 6-hour window start, wrapped on 24-hour clock
  const windowStartMin = (startMin - 6 * 60 + 24 * 60) % (24 * 60);

  if (windowStartMin < startMin) {
    // Normal (no midnight crossing): e.g. [16:00, 22:00)
    return curMin >= windowStartMin && curMin < startMin;
  } else {
    // Crosses midnight: e.g. quiet start = 03:00 → window [21:00, 03:00)
    return curMin >= windowStartMin || curMin < startMin;
  }
}

/**
 * Return the createdAt of the most recent outbound AI message for a conversation.
 * Production: SELECT created_at FROM message_log
 *   WHERE conversation_id = ? AND direction = 'outbound' AND sender_type = 'ai'
 *   ORDER BY created_at DESC LIMIT 1
 */
function _getLastAIOutboundTime(conversationId: string): Date | null {
  let latest: Date | null = null;
  for (const msg of _messageLog.values()) {
    if (
      msg.conversationId === conversationId &&
      msg.direction === "outbound" &&
      msg.senderType === "ai" &&
      (latest === null || msg.createdAt > latest)
    ) {
      latest = msg.createdAt;
    }
  }
  return latest;
}

// ── Public API ────────────────────────────────────────────────

export async function shouldSendMessage(context: MessageContext): Promise<SuppressionResult> {
  if (process.env.NODE_ENV !== "test") {
    return _shouldSendMessageFromDb(context);
  }

  const isInternal = INTERNAL_PURPOSES_SET.has(context.messagePurpose);
  const isUrgent = (URGENT_PURPOSES as readonly string[]).includes(context.messagePurpose);
  const isQhExempt = (QUIET_HOURS_EXEMPT_PURPOSES as readonly string[]).includes(
    context.messagePurpose,
  );
  const isPause = context.messagePurpose === PAUSE_MESSAGE_PURPOSE;

  // Production: db.businesses.findUniqueOrThrow({ where: { id: context.businessId } })
  const biz = _businesses.get(context.businessId);

  // Production: db.customers.findUniqueOrThrow({ where: { id: context.customerId } })
  const customer = _customers.get(context.customerId);

  // Production: db.conversations.findUniqueOrThrow({ where: { id: context.conversationId } })
  const conv = _conversations.get(context.conversationId);

  // ── G1: Business paused ──────────────────────────────────────────────────
  // pause_message is the only customer-facing outbound allowed while paused.
  // Internal messages are also allowed (operational necessity).
  // Production: checked via biz.is_paused from the business lookup above.
  if (biz?.isPaused && !isPause && !isInternal) {
    return { decision: "suppress", reason: "business_paused" };
  }

  // ── G2: Customer opted out ───────────────────────────────────────────────
  // Production: customer.consent_status from the customer lookup above.
  if (!isInternal && customer?.consentStatus === "opted_out") {
    return { decision: "suppress", reason: "opted_out" };
  }

  // ── G3: Conversation marked no-show ─────────────────────────────────────
  // Production: conv.is_no_show from the conversation lookup above.
  if (conv?.isNoShow) {
    return { decision: "suppress", reason: "no_show" };
  }

  // ── G4: Do-not-contact — customer flag ──────────────────────────────────
  // Internal purposes are exempt (operational messages must always route).
  // Production: customer.do_not_contact from the customer lookup above.
  if (!isInternal && customer?.doNotContact) {
    return { decision: "suppress", reason: "do_not_contact" };
  }

  // ── G4: Do-not-contact — conversation tag ───────────────────────────────
  // Production: SELECT 1 FROM conversation_tags
  //   WHERE conversation_id = ? AND tag_code = 'do_not_contact' AND is_active = true
  //   LIMIT 1
  if (!isInternal && _getActiveTag(context.conversationId, "do_not_contact")) {
    return { decision: "suppress", reason: "do_not_contact" };
  }

  // ── Per-purpose rules ────────────────────────────────────────────────────
  // Checked before quiet hours so a message that can never send (due to
  // conversation state, blocking tags, etc.) returns "suppress" rather than
  // "defer". This keeps the decision semantically correct regardless of time.
  if (!isInternal && conv) {
    const purposeResult = _checkPerPurpose(context, conv.primaryState);
    if (purposeResult) return purposeResult;
  }

  // ── G6: Rolling 24 h cap ─────────────────────────────────────────────────
  // Checked before quiet hours for the same reason as per-purpose: a message
  // that is hard-suppressed by the cap should not appear as "defer".
  // Urgent purposes are exempt from the cap (they must always deliver).
  // Production: SELECT COUNT(*) FROM message_log
  //   WHERE conversation_id = ? AND direction = 'outbound'
  //     AND sender_type != 'system' AND created_at > NOW() - INTERVAL '24 hours'
  if (!isUrgent) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let count = 0;
    for (const entry of _messageLog.values()) {
      if (
        entry.conversationId === context.conversationId &&
        entry.direction === "outbound" &&
        entry.senderType !== "system" &&
        entry.createdAt > cutoff
      ) {
        count++;
      }
    }
    if (count >= 2) {
      return { decision: "suppress", reason: "24h_cap" };
    }
  }

  // ── G7: Hourly hard rate limit ───────────────────────────────────────────
  // Safety net applied to ALL purposes (including urgent).
  // Prevents runaway loops or bugs from flooding a single conversation.
  // Production: SELECT COUNT(*) FROM message_log
  //   WHERE conversation_id = ? AND direction = 'outbound'
  //     AND sender_type != 'system' AND created_at > NOW() - INTERVAL '60 minutes'
  {
    const cutoff60 = new Date(Date.now() - 60 * 60 * 1000);
    let hourlyCount = 0;
    for (const entry of _messageLog.values()) {
      if (
        entry.conversationId === context.conversationId &&
        entry.direction === "outbound" &&
        entry.senderType !== "system" &&
        entry.createdAt > cutoff60
      ) {
        hourlyCount++;
      }
    }
    if (hourlyCount >= 10) {
      return { decision: "suppress", reason: "hourly_hard_limit" };
    }
  }

  // ── Dedupe key collision ─────────────────────────────────────────────────
  // Checked before quiet hours: a duplicate should suppress, not defer.
  // Production: SELECT id FROM outbound_queue
  //   WHERE dedupe_key = ? AND status IN ('pending','deferred','claimed')
  //   LIMIT 1
  if (context.dedupeKey) {
    for (const row of _outboundQueue.values()) {
      if (
        row.dedupeKey === context.dedupeKey &&
        (NON_TERMINAL_QUEUE_STATUSES as readonly string[]).includes(row.status)
      ) {
        return { decision: "suppress", reason: "duplicate_dedupe_key" };
      }
    }
  }

  // ── G5: Quiet hours ──────────────────────────────────────────────────────
  // Applied last — only defers messages that would otherwise send.
  // Exempt: urgent purposes (bypass QH entirely), QUIET_HOURS_EXEMPT_PURPOSES
  // (missed_call_fallback, handoff_response), pause_message, and internal purposes.
  // Production: compare DateTime.now().setZone(biz.timezone) against
  //   biz.quiet_hours_start and biz.quiet_hours_end.
  if (!isInternal && !isUrgent && !isQhExempt && !isPause && biz) {
    const { inside, deferUntil } = _inQuietHours(
      new Date(),
      biz.timezone,
      biz.quietHoursStart,
      biz.quietHoursEnd,
    );
    if (inside) {
      return { decision: "defer", reason: "quiet_hours", deferUntil };
    }
  }

  // ── Weird-hours deferral ─────────────────────────────────────────────────
  // Doc 02 §5: follow-up messages scheduled within the 6-hour pre-quiet window
  // are deferred when the last AI outbound was also in that window.
  // Applies only to follow-up purposes; all other purposes send normally.
  // Production: same timezone helpers above + message_log AI-sender lookup.
  if (
    !isInternal &&
    !isUrgent &&
    !isQhExempt &&
    !isPause &&
    biz &&
    _WEIRD_HOURS_FOLLOWUP_PURPOSES.has(context.messagePurpose)
  ) {
    const now = new Date();
    if (_inWeirdHoursWindow(now, biz.timezone, biz.quietHoursStart)) {
      const lastAITime = _getLastAIOutboundTime(context.conversationId);
      if (
        lastAITime !== null &&
        _inWeirdHoursWindow(lastAITime, biz.timezone, biz.quietHoursStart)
      ) {
        const { h: endH, m: endM } = _parseHHMM(biz.quietHoursEnd);
        const qhEnd = _nextQuietHoursEnd(now, biz.timezone, endH, endM);
        const deferUntil = new Date(qhEnd.getTime() + 60 * 60 * 1000);
        return { decision: "defer", reason: "weird_hours", deferUntil };
      }
    }
  }

  return { decision: "send", reason: "ok" };
}

export async function cancelQuoteFollowups(conversationId: string): Promise<number> {
  if (process.env.NODE_ENV !== "test") {
    const { db } = await import("~/server/db");
    const result = await db.outbound_queue.updateMany({
      where: {
        conversation_id: conversationId,
        message_purpose: { in: ["quote_followup_1", "quote_followup_final"] },
        status: { in: ["pending", "deferred", "claimed"] },
      },
      data: { status: "canceled" as any },
    });
    return result.count;
  }
  // Production: UPDATE outbound_queue
  //   SET status = 'canceled'
  //   WHERE conversation_id = ?
  //     AND message_purpose IN ('quote_followup_1','quote_followup_final')
  //     AND status IN ('pending','deferred','claimed')
  let count = 0;
  for (const row of _outboundQueue.values()) {
    if (
      row.conversationId === conversationId &&
      (row.messagePurpose === "quote_followup_1" || row.messagePurpose === "quote_followup_final") &&
      (NON_TERMINAL_QUEUE_STATUSES as readonly string[]).includes(row.status)
    ) {
      row.status = "canceled";
      count++;
    }
  }
  return count;
}

export async function cancelByDependency(
  dependencyType: string,
  dependencyId: string,
): Promise<number> {
  if (process.env.NODE_ENV !== "test") {
    const { db } = await import("~/server/db");
    const needle = `${dependencyType}:${dependencyId}`;
    const result = await db.outbound_queue.updateMany({
      where: {
        dedupe_key: { contains: needle },
        status: { in: ["pending", "deferred", "claimed"] },
      },
      data: { status: "canceled" as any },
    });
    return result.count;
  }
  // dedupeKey format: `{purpose}:{dependencyType}:{dependencyId}:{timing}`
  // We match any row whose dedupeKey contains "{dependencyType}:{dependencyId}".
  // Production: UPDATE outbound_queue
  //   SET status = 'canceled', updated_at = NOW()
  //   WHERE dedupe_key LIKE '%{dependencyType}:{dependencyId}%'
  //     AND status IN ('pending','deferred','claimed')
  const needle = `${dependencyType}:${dependencyId}`;
  let count = 0;
  for (const row of _outboundQueue.values()) {
    if (
      row.dedupeKey.includes(needle) &&
      (NON_TERMINAL_QUEUE_STATUSES as readonly string[]).includes(row.status)
    ) {
      row.status = "canceled";
      count++;
    }
  }
  return count;
}

// ── Test helpers ──────────────────────────────────────────────
// These exports are ONLY used by the test suite for in-memory store seeding
// and isolation. They have no production equivalent.

export function _resetSuppressionStoreForTest(): void {
  _businesses.clear();
  _customers.clear();
  _conversations.clear();
  _tags.clear();
  _messageLog.clear();
  _outboundQueue.clear();
  _recurringServices.clear();
}

export function _seedBusinessForTest(data: {
  id: string;
  isPaused: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string;
}): void {
  _businesses.set(data.id, { ...data });
}

export function _seedCustomerForTest(data: {
  id: string;
  businessId: string;
  consentStatus: string;
  doNotContact: boolean;
}): void {
  _customers.set(data.id, { ...data });
}

export function _seedConversationForTest(data: {
  id: string;
  businessId: string;
  customerId: string;
  primaryState: string;
  isNoShow: boolean;
}): void {
  _conversations.set(data.id, { ...data });
}

export function _seedConversationTagForTest(data: {
  conversationId: string;
  businessId: string;
  tagCode: string;
  isActive: boolean;
}): void {
  // Use a unique key so multiple distinct tags per conversation are stored separately.
  const key = `${data.conversationId}:${data.tagCode}:${Math.random()}`;
  _tags.set(key, { ...data });
}

export function _seedMessageLogForTest(data: {
  conversationId: string;
  businessId: string;
  direction: string;
  senderType: string;
  createdAt: Date;
}): void {
  const key = `${data.conversationId}:${Date.now()}:${Math.random()}`;
  _messageLog.set(key, { ...data });
}

export function _seedOutboundQueueForTest(data: {
  id: string;
  conversationId: string;
  businessId: string;
  messagePurpose: string;
  dedupeKey: string;
  status: string;
}): void {
  _outboundQueue.set(data.id, { ...data });
}

export function _seedRecurringServiceForTest(data: {
  id: string;
  businessId: string;
  status: string;
}): void {
  _recurringServices.set(data.id, { ...data });
}

export function _getQueueStatusForTest(id: string): string | undefined {
  return _outboundQueue.get(id)?.status;
}

// ── Production Prisma implementation for shouldSendMessage ────

async function _shouldSendMessageFromDb(context: MessageContext): Promise<SuppressionResult> {
  const { db } = await import("~/server/db");

  const isInternal = INTERNAL_PURPOSES_SET.has(context.messagePurpose);
  const isUrgent = (URGENT_PURPOSES as readonly string[]).includes(context.messagePurpose);
  const isQhExempt = (QUIET_HOURS_EXEMPT_PURPOSES as readonly string[]).includes(context.messagePurpose);
  const isPause = context.messagePurpose === PAUSE_MESSAGE_PURPOSE;

  const [bizRow, customerRow, convRow] = await Promise.all([
    db.businesses.findUnique({
      where: { id: context.businessId },
      select: { is_paused: true, quiet_hours_start: true, quiet_hours_end: true, timezone: true },
    }),
    db.customers.findUnique({
      where: { id: context.customerId },
      select: { consent_status: true, do_not_contact: true },
    }),
    db.conversations.findUnique({
      where: { id: context.conversationId },
      select: { primary_state: true, is_no_show: true },
    }),
  ]);

  // G1: Business paused
  if (bizRow?.is_paused && !isPause && !isInternal) {
    return { decision: "suppress", reason: "business_paused" };
  }

  // G2: Customer opted out
  if (!isInternal && customerRow?.consent_status === "opted_out") {
    return { decision: "suppress", reason: "opted_out" };
  }

  // G3: No-show
  if (convRow?.is_no_show) {
    return { decision: "suppress", reason: "no_show" };
  }

  // G4: do_not_contact flag
  if (!isInternal && customerRow?.do_not_contact) {
    return { decision: "suppress", reason: "do_not_contact" };
  }

  // G4: do_not_contact tag
  if (!isInternal) {
    const dncTag = await db.conversation_tags.findFirst({
      where: { conversation_id: context.conversationId, tag_code: "do_not_contact", is_active: true },
      select: { id: true },
    });
    if (dncTag) return { decision: "suppress", reason: "do_not_contact" };
  }

  // Per-purpose rules (all checks done via DB or constants — no in-memory stores)
  if (!isInternal && convRow) {
    const state = convRow.primary_state as string;
    const p = context.messagePurpose;

    // Followup purposes: suppress in override or closed states
    if (p === "routine_followup_1" || p === "routine_followup_final" || p === "quote_followup_1" || p === "quote_followup_final") {
      if (OVERRIDE_STATES_SET.has(state) || CLOSED_STATES_SET.has(state)) {
        return { decision: "suppress", reason: "wrong_state" };
      }
    }

    // ALLOWED_STATES_BY_PURPOSE gate
    if (p in ALLOWED_STATES_BY_PURPOSE) {
      const allowed = ALLOWED_STATES_BY_PURPOSE[p]!;
      if (!(allowed as readonly string[]).includes(state)) {
        return { decision: "suppress", reason: "wrong_state" };
      }
      // Closeout: check for blocking tags
      if (p === "closeout") {
        const blockingTags = await db.conversation_tags.findMany({
          where: { conversation_id: context.conversationId, tag_code: { in: ["negative_service_signal", "closeout_blocked"] }, is_active: true },
          select: { tag_code: true },
        });
        for (const t of blockingTags) {
          return { decision: "suppress", reason: t.tag_code };
        }
      }
    }

    // Stale-waiting purposes: suppress in override states
    if (p === "stale_waiting_customer_update" || p === "stale_waiting_customer_update_parts") {
      if (OVERRIDE_STATES_SET.has(state)) return { decision: "suppress", reason: "wrong_state" };
    }

    // Recurring reminder: check service status
    if (p === "recurring_reminder") {
      if (context.recurringServiceId) {
        const svc = await db.recurring_services.findUnique({
          where: { id: context.recurringServiceId },
          select: { status: true },
        });
        if (svc?.status === "paused") return { decision: "suppress", reason: "recurring_service_paused" };
      }
      if (state === "human_takeover_active") return { decision: "suppress", reason: "human_takeover_active" };
    }

    // Purposes blocked during human takeover
    const _humanTakeoverBlocked = new Set(["missed_call_fallback","reschedule_confirmation","cancellation_confirmation","dispatch_notice","delay_notice","schedule_change_notice","quote_delivery","admin_response_relay","handoff_response"]);
    if (_humanTakeoverBlocked.has(p) && state === "human_takeover_active") {
      return { decision: "suppress", reason: "human_takeover_active" };
    }
  }

  // G6: Rolling 24h cap
  if (!isUrgent) {
    const count = await db.message_log.count({
      where: {
        conversation_id: context.conversationId,
        direction: "outbound",
        sender_type: { not: "system" },
        created_at: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });
    if (count >= 2) return { decision: "suppress", reason: "24h_cap" };
  }

  // G7: Hourly hard rate limit
  {
    const count = await db.message_log.count({
      where: {
        conversation_id: context.conversationId,
        direction: "outbound",
        sender_type: { not: "system" },
        created_at: { gt: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });
    if (count >= 10) return { decision: "suppress", reason: "hourly_hard_limit" };
  }

  // Dedupe
  if (context.dedupeKey) {
    const dupe = await db.outbound_queue.findFirst({
      where: {
        dedupe_key: context.dedupeKey,
        status: { in: ["pending", "deferred", "claimed"] },
      },
      select: { id: true },
    });
    if (dupe) return { decision: "suppress", reason: "duplicate_dedupe_key" };
  }

  // G5: Quiet hours
  if (!isInternal && !isUrgent && !isQhExempt && !isPause && bizRow) {
    const qhStart = bizRow.quiet_hours_start;
    const qhEnd = bizRow.quiet_hours_end;
    const tz = bizRow.timezone;
    const startStr = `${String(qhStart.getUTCHours()).padStart(2, "0")}:${String(qhStart.getUTCMinutes()).padStart(2, "0")}`;
    const endStr = `${String(qhEnd.getUTCHours()).padStart(2, "0")}:${String(qhEnd.getUTCMinutes()).padStart(2, "0")}`;
    const { inside, deferUntil } = _inQuietHours(new Date(), tz, startStr, endStr);
    if (inside) return { decision: "defer", reason: "quiet_hours", deferUntil };
  }

  // Weird-hours deferral
  if (!isInternal && !isUrgent && !isQhExempt && !isPause && bizRow && _WEIRD_HOURS_FOLLOWUP_PURPOSES.has(context.messagePurpose)) {
    const now = new Date();
    const qhStart = bizRow.quiet_hours_start;
    const tz = bizRow.timezone;
    const startStr = `${String(qhStart.getUTCHours()).padStart(2, "0")}:${String(qhStart.getUTCMinutes()).padStart(2, "0")}`;
    if (_inWeirdHoursWindow(now, tz, startStr)) {
      const lastAI = await db.message_log.findFirst({
        where: { conversation_id: context.conversationId, direction: "outbound", sender_type: "ai" },
        orderBy: { created_at: "desc" },
        select: { created_at: true },
      });
      if (lastAI && _inWeirdHoursWindow(lastAI.created_at, tz, startStr)) {
        const qhEnd = bizRow.quiet_hours_end;
        const endStr = `${String(qhEnd.getUTCHours()).padStart(2, "0")}:${String(qhEnd.getUTCMinutes()).padStart(2, "0")}`;
        const { h: endH, m: endM } = _parseHHMM(endStr);
        const qhEndTime = _nextQuietHoursEnd(now, tz, endH, endM);
        const deferUntil = new Date(qhEndTime.getTime() + 60 * 60 * 1000);
        return { decision: "defer", reason: "weird_hours", deferUntil };
      }
    }
  }

  return { decision: "send", reason: "ok" };
}

// ── Cross-module accessors (used by inbound handler) ──────────
// Production equivalents are Prisma queries shown inline.

/**
 * Return whether a business is paused.
 * Production: db.businesses.findUnique({ where: { id }, select: { is_paused: true } })
 */
export function getBusinessIsPaused(businessId: string): boolean {
  return _businesses.get(businessId)?.isPaused ?? false;
}

/**
 * Return whether a conversation is flagged as no-show.
 * Production: db.conversations.findUnique({ where: { id }, select: { is_no_show: true } })
 */
export function getConversationIsNoShow(conversationId: string): boolean {
  return _conversations.get(conversationId)?.isNoShow ?? false;
}

/**
 * Cancel all pending/deferred queue rows for a conversation whose
 * messagePurpose is in the given list.
 * Production:
 *   UPDATE outbound_queue SET status = 'canceled'
 *   WHERE conversation_id = $1
 *     AND message_purpose = ANY($2)
 *     AND status IN ('pending','deferred')
 */
export function cancelQueueRowsByConversationAndPurposes(
  conversationId: string,
  purposes: readonly string[],
): void {
  for (const row of _outboundQueue.values()) {
    if (
      row.conversationId === conversationId &&
      (purposes as string[]).includes(row.messagePurpose) &&
      (row.status === "pending" || row.status === "deferred")
    ) {
      row.status = "canceled";
    }
  }
}

/**
 * Cancel all pending/deferred queue rows for a conversation (used on STOP keyword).
 * Production:
 *   UPDATE outbound_queue SET status = 'canceled'
 *   WHERE conversation_id = $1 AND status IN ('pending','deferred')
 */
export function cancelAllPendingQueueRowsForConversation(conversationId: string): void {
  for (const row of _outboundQueue.values()) {
    if (
      row.conversationId === conversationId &&
      (row.status === "pending" || row.status === "deferred")
    ) {
      row.status = "canceled";
    }
  }
}
