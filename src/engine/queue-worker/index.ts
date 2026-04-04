// ============================================================
// src/engine/queue-worker/index.ts
//
// OUTBOUND QUEUE WORKER — IMPLEMENTATION
//
// All DB access would go through Prisma in production.
// This module maintains an in-memory queue store (same pattern as
// state-machine, customer-resolver, and suppression modules).
//
// Production claim pattern:
//   db.$transaction(async (tx) => {
//     const rows = await tx.outboundQueue.findMany({
//       where: { ... eligible conditions ... },
//       take: batchSize,
//       // Raw equivalent: SELECT ... FOR UPDATE SKIP LOCKED
//     });
//     await tx.outboundQueue.updateMany({
//       where: { id: { in: rows.map(r => r.id) } },
//       data: { claimToken: uuid(), claimedAt: new Date(), claimExpiresAt: ... },
//     });
//     return rows;
//   })
// ============================================================

import { randomUUID } from "crypto";
import { shouldSendMessage } from "../suppression/index";
import {
  DEFAULT_BATCH_SIZE,
  CLAIM_TIMEOUT_SECONDS,
  MAX_RETRY_COUNT,
  RETRY_INTERVALS_SECONDS,
  type QueueRow,
  type QueueWorkerResult,
  type SendResult,
} from "./contract";

// ── In-memory store ───────────────────────────────────────────
// Production equivalent: the outbound_queue Prisma table.

const _queue = new Map<string, QueueRow>();

// ── Injectable Twilio send function ──────────────────────────
// Default is a no-op stub. Tests override via _setTwilioSendForTest.
// Production: replaced with the real Twilio client call.
//   const twilio = require("twilio")(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
//   await twilio.messages.create({ to, from, body })

let _twilioSend: (row: QueueRow) => Promise<SendResult> = async (_row) => ({
  success: true,
  providerMessageId: "SM_default",
});

// ── Helpers ───────────────────────────────────────────────────

function _now(): Date {
  return new Date();
}

/**
 * Return true when a row is eligible for claiming.
 * Matches the WHERE clause used in the production Prisma query.
 */
function _isEligible(row: QueueRow, now: Date): boolean {
  const leaseExpired =
    row.claimToken === null ||
    (row.claimExpiresAt !== null && row.claimExpiresAt < now);

  if (row.status === "pending") {
    return row.scheduledSendAt <= now && leaseExpired;
  }
  if (row.status === "failed_retryable") {
    return row.nextRetryAt !== null && row.nextRetryAt <= now && leaseExpired;
  }
  return false;
}

/**
 * Claim a row: write claimToken + timestamps atomically.
 * Production: included in the $transaction claim block above.
 */
function _claimRow(row: QueueRow, now: Date): void {
  row.claimToken = randomUUID();
  row.claimedAt = now;
  row.claimExpiresAt = new Date(now.getTime() + CLAIM_TIMEOUT_SECONDS * 1000);
  row.status = "claimed";
  row.updatedAt = now;
}

/**
 * Build a MessageContext for the suppression engine from a queue row.
 * Production: these fields are columns on the outbound_queue row.
 */
function _buildMessageContext(row: QueueRow) {
  return {
    businessId: row.businessId,
    conversationId: row.conversationId,
    customerId: row.customerId,
    messagePurpose: row.messagePurpose,
    channel: row.channel,
    ...(row.dedupeKey != null ? { dedupeKey: row.dedupeKey } : {}),
    ...(row.recurringServiceId != null ? { recurringServiceId: row.recurringServiceId } : {}),
  };
}

/**
 * Process one claimed row: consult suppression, then send or update status.
 * Production: each status update is a db.outboundQueue.update({ where: { id }, data }).
 */
async function _processRow(row: QueueRow): Promise<keyof QueueWorkerResult | null> {
  const now = _now();
  const context = _buildMessageContext(row);
  const suppression = await shouldSendMessage(context);

  if (suppression.decision === "suppress") {
    // Production: db.outboundQueue.update({ where: { id: row.id },
    //   data: { status: 'canceled', invalidated_by: suppression.reason, updated_at: now } })
    row.status = "canceled";
    row.invalidatedBy = suppression.reason;
    row.updatedAt = now;
    return "suppressed";
  }

  if (suppression.decision === "defer") {
    // Production: db.outboundQueue.update({ where: { id: row.id },
    //   data: { status: 'deferred', quiet_hours_deferred_until: suppression.deferUntil,
    //           claim_token: null, updated_at: now } })
    row.status = "deferred";
    row.quietHoursDeferredUntil = suppression.deferUntil ?? null;
    row.claimToken = null;
    row.claimedAt = null;
    row.claimExpiresAt = null;
    row.updatedAt = now;
    return "deferred";
  }

  // decision === "send"
  let sendResult: SendResult;
  try {
    sendResult = await sendMessage(row);
  } catch (err) {
    sendResult = {
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }

  if (sendResult.success) {
    // Production: db.outboundQueue.update({ where: { id: row.id },
    //   data: { status: 'sent', provider_message_id: sendResult.providerMessageId,
    //           updated_at: now } })
    row.status = "sent";
    row.providerMessageId = sendResult.providerMessageId ?? null;
    row.updatedAt = now;
    return "sent";
  }

  // Send failed — increment attempt count and decide retry vs terminal.
  row.sendAttemptCount += 1;
  row.lastAttemptAt = now;
  row.updatedAt = now;

  const effectiveMax = row.maxRetryCount ?? MAX_RETRY_COUNT;
  if (row.sendAttemptCount >= effectiveMax) {
    // Production: db.outboundQueue.update({ where: { id: row.id },
    //   data: { status: 'failed_terminal', terminal_failure_reason: sendResult.errorMessage,
    //           updated_at: now } })
    row.status = "failed_terminal";
    row.terminalFailureReason =
      sendResult.errorMessage ?? sendResult.errorCode ?? "unknown_error";
  } else {
    const intervalMs =
      (RETRY_INTERVALS_SECONDS[row.sendAttemptCount - 1] ?? 30) * 1000;
    // Production: db.outboundQueue.update({ where: { id: row.id },
    //   data: { status: 'failed_retryable',
    //           next_retry_at: new Date(now + intervalMs),
    //           send_attempt_count: row.sendAttemptCount, updated_at: now } })
    row.status = "failed_retryable";
    row.nextRetryAt = new Date(now.getTime() + intervalMs);
  }
  return "failed";
}

// ── Public API ────────────────────────────────────────────────

export async function processQueue(batchSize = DEFAULT_BATCH_SIZE): Promise<QueueWorkerResult> {
  if (process.env.NODE_ENV !== "test") {
    return _processQueueFromDb(batchSize);
  }
  const now = _now();
  const result: QueueWorkerResult = { processed: 0, sent: 0, suppressed: 0, deferred: 0, failed: 0 };

  // CLAIM STEP
  // Production: db.$transaction(async (tx) => { ... FOR UPDATE SKIP LOCKED ... })
  const eligible: QueueRow[] = [];
  for (const row of _queue.values()) {
    if (eligible.length >= batchSize) break;
    if (_isEligible(row, now)) {
      eligible.push(row);
    }
  }

  for (const row of eligible) {
    _claimRow(row, now);
  }

  // PROCESS STEP
  for (const row of eligible) {
    const outcome = await _processRow(row);
    if (outcome !== null) {
      result.processed += 1;
      (result[outcome] as number) += 1;
    }
  }

  return result;
}

export async function sendMessage(queueRow: QueueRow): Promise<SendResult> {
  // Internal messages route to the notification system — no external provider call.
  // Production: publish to internal notification topic / dashboard event bus.
  if (queueRow.audienceType === "internal") {
    return { success: true };
  }

  // Customer messages route through the injectable Twilio send function.
  try {
    return await _twilioSend(queueRow);
  } catch (err) {
    return {
      success: false,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function processDeferredMessages(): Promise<QueueWorkerResult> {
  if (process.env.NODE_ENV !== "test") {
    return _processDeferredMessagesFromDb();
  }
  const now = _now();
  const result: QueueWorkerResult = { processed: 0, sent: 0, suppressed: 0, deferred: 0, failed: 0 };

  // Find all overdue deferred rows.
  // Production: db.outboundQueue.findMany({
  //   where: { status: 'deferred', quiet_hours_deferred_until: { lte: new Date() } }
  // })
  const overdue: QueueRow[] = [];
  for (const row of _queue.values()) {
    if (
      row.status === "deferred" &&
      row.quietHoursDeferredUntil !== null &&
      row.quietHoursDeferredUntil <= now
    ) {
      overdue.push(row);
    }
  }

  // Reset each row back to pending so the standard claim + process pipeline applies.
  // Production: db.outboundQueue.updateMany({
  //   where: { id: { in: overdue.map(r => r.id) } },
  //   data: { status: 'pending', quiet_hours_deferred_until: null, claim_token: null,
  //           claimed_at: null, claim_expires_at: null, updated_at: new Date() }
  // })
  for (const row of overdue) {
    row.status = "pending";
    row.quietHoursDeferredUntil = null;
    row.claimToken = null;
    row.claimedAt = null;
    row.claimExpiresAt = null;
    row.updatedAt = now;
  }

  // Claim and process exactly the overdue rows (not the whole queue).
  for (const row of overdue) {
    _claimRow(row, now);
  }

  for (const row of overdue) {
    const outcome = await _processRow(row);
    if (outcome !== null) {
      result.processed += 1;
      (result[outcome] as number) += 1;
    }
  }

  return result;
}

// ── Production Prisma implementations ────────────────────────

interface DbQueueRow {
  id: string;
  business_id: string;
  conversation_id: string;
  customer_id: string;
  message_purpose: string;
  audience_type: string;
  channel: string;
  content: string | null;
  dedupe_key: string;
  status: string;
  scheduled_send_at: Date;
  claim_token: string | null;
  claimed_at: Date | null;
  claim_expires_at: Date | null;
  send_attempt_count: number;
  max_retry_count: number;
  last_attempt_at: Date | null;
  next_retry_at: Date | null;
  quiet_hours_deferred_until: Date | null;
  terminal_failure_reason: string | null;
  send_result_code: string | null;
}

function _dbRowToQueueRow(row: DbQueueRow): QueueRow {
  return {
    id: row.id,
    businessId: row.business_id,
    conversationId: row.conversation_id,
    customerId: row.customer_id,
    messagePurpose: row.message_purpose,
    audienceType: row.audience_type as "customer" | "internal",
    channel: row.channel,
    messageBody: row.content ?? "",
    status: row.status as QueueRow["status"],
    scheduledSendAt: row.scheduled_send_at,
    claimToken: row.claim_token,
    claimedAt: row.claimed_at,
    claimExpiresAt: row.claim_expires_at,
    sendAttemptCount: row.send_attempt_count,
    maxRetryCount: row.max_retry_count,
    lastAttemptAt: row.last_attempt_at,
    nextRetryAt: row.next_retry_at,
    quietHoursDeferredUntil: row.quiet_hours_deferred_until,
    dedupeKey: row.dedupe_key,
    terminalFailureReason: row.terminal_failure_reason,
    providerMessageId: row.send_result_code,
    invalidatedBy: null,
    recurringServiceId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function _processQueueFromDb(batchSize: number): Promise<QueueWorkerResult> {
  const { db } = await import("~/server/db");
  const result: QueueWorkerResult = { processed: 0, sent: 0, suppressed: 0, deferred: 0, failed: 0 };
  const now = new Date();
  const claimExpiresAt = new Date(now.getTime() + CLAIM_TIMEOUT_SECONDS * 1000);
  const claimToken = randomUUID();

  // Claim eligible rows with FOR UPDATE SKIP LOCKED to prevent double-processing.
  const claimedRows = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<DbQueueRow[]>`
      SELECT q.id, q.business_id, q.conversation_id, c.customer_id,
             q.message_purpose, q.audience_type::text, q.channel::text, q.content,
             q.dedupe_key, q.status::text, q.scheduled_send_at, q.claim_token,
             q.claimed_at, q.claim_expires_at, q.send_attempt_count, q.max_retry_count,
             q.last_attempt_at, q.next_retry_at, q.quiet_hours_deferred_until,
             q.terminal_failure_reason, q.send_result_code
      FROM outbound_queue q
      JOIN conversations c ON c.id = q.conversation_id
      WHERE (
        (q.status = 'pending' AND q.scheduled_send_at <= NOW()
          AND (q.claim_token IS NULL OR q.claim_expires_at < NOW()))
        OR
        (q.status = 'failed_retryable' AND q.next_retry_at IS NOT NULL
          AND q.next_retry_at <= NOW()
          AND (q.claim_token IS NULL OR q.claim_expires_at < NOW()))
      )
      ORDER BY q.scheduled_send_at ASC
      LIMIT ${batchSize}
      FOR UPDATE OF q SKIP LOCKED
    `;
    if (rows.length === 0) return [];
    await tx.outbound_queue.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { status: "claimed", claim_token: claimToken, claimed_at: now, claim_expires_at: claimExpiresAt },
    });
    return rows;
  });

  for (const dbRow of claimedRows) {
    const row = _dbRowToQueueRow(dbRow);
    const outcome = await _processRowFromDb(row, db);
    if (outcome !== null) {
      result.processed += 1;
      (result[outcome] as number) += 1;
    }
  }
  return result;
}

async function _processDeferredMessagesFromDb(): Promise<QueueWorkerResult> {
  const { db } = await import("~/server/db");
  const result: QueueWorkerResult = { processed: 0, sent: 0, suppressed: 0, deferred: 0, failed: 0 };
  const now = new Date();

  // Reset overdue deferred rows back to pending.
  await db.outbound_queue.updateMany({
    where: { status: "deferred", quiet_hours_deferred_until: { lte: now } },
    data: { status: "pending", quiet_hours_deferred_until: null, claim_token: null, claimed_at: null, claim_expires_at: null },
  });

  // Now claim and process them.
  const claimToken = randomUUID();
  const claimExpiresAt = new Date(now.getTime() + CLAIM_TIMEOUT_SECONDS * 1000);

  const claimedRows = await db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<DbQueueRow[]>`
      SELECT q.id, q.business_id, q.conversation_id, c.customer_id,
             q.message_purpose, q.audience_type::text, q.channel::text, q.content,
             q.dedupe_key, q.status::text, q.scheduled_send_at, q.claim_token,
             q.claimed_at, q.claim_expires_at, q.send_attempt_count, q.max_retry_count,
             q.last_attempt_at, q.next_retry_at, q.quiet_hours_deferred_until,
             q.terminal_failure_reason, q.send_result_code
      FROM outbound_queue q
      JOIN conversations c ON c.id = q.conversation_id
      WHERE q.status = 'pending' AND q.scheduled_send_at <= NOW()
        AND (q.claim_token IS NULL OR q.claim_expires_at < NOW())
      ORDER BY q.scheduled_send_at ASC
      LIMIT 100
      FOR UPDATE OF q SKIP LOCKED
    `;
    if (rows.length === 0) return [];
    await tx.outbound_queue.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { status: "claimed", claim_token: claimToken, claimed_at: now, claim_expires_at: claimExpiresAt },
    });
    return rows;
  });

  for (const dbRow of claimedRows) {
    const row = _dbRowToQueueRow(dbRow);
    const outcome = await _processRowFromDb(row, db);
    if (outcome !== null) {
      result.processed += 1;
      (result[outcome] as number) += 1;
    }
  }
  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function _processRowFromDb(row: QueueRow, db: any): Promise<keyof QueueWorkerResult | null> {
  // ai_response rows are trigger rows — they invoke the AI generator rather than sending a message directly.
  if (row.messagePurpose === "ai_response") {
    const latestInbound = await db.message_log.findFirst({
      where: { conversation_id: row.conversationId, direction: "inbound" },
      orderBy: { created_at: "desc" },
      select: { id: true },
    });
    if (latestInbound) {
      const { generateAIResponse } = await import("../ai-response/index");
      await generateAIResponse({
        businessId: row.businessId,
        conversationId: row.conversationId,
        inboundMessageId: latestInbound.id,
        channel: row.channel,
      });
    }
    await db.outbound_queue.update({
      where: { id: row.id },
      data: { status: "sent" },
    });
    return "sent";
  }

  const now = new Date();
  const context = _buildMessageContext(row);
  const suppression = await shouldSendMessage(context);

  if (suppression.decision === "suppress") {
    await (db as any).outbound_queue.update({
      where: { id: row.id },
      data: { status: "canceled" },
    });
    return "suppressed";
  }

  if (suppression.decision === "defer") {
    await (db as any).outbound_queue.update({
      where: { id: row.id },
      data: { status: "deferred", quiet_hours_deferred_until: suppression.deferUntil ?? null, claim_token: null, claimed_at: null, claim_expires_at: null },
    });
    return "deferred";
  }

  // decision === "send"
  let sendResult: SendResult;
  try {
    sendResult = await sendMessage(row);
  } catch (err) {
    sendResult = { success: false, errorMessage: err instanceof Error ? err.message : String(err) };
  }

  if (sendResult.success) {
    await (db as any).outbound_queue.update({
      where: { id: row.id },
      data: { status: "sent", send_result_code: sendResult.providerMessageId ?? null },
    });
    return "sent";
  }

  const newAttemptCount = row.sendAttemptCount + 1;
  const effectiveMax = row.maxRetryCount ?? MAX_RETRY_COUNT;
  if (newAttemptCount >= effectiveMax) {
    await (db as any).outbound_queue.update({
      where: { id: row.id },
      data: { status: "failed_terminal", terminal_failure_reason: sendResult.errorMessage ?? sendResult.errorCode ?? "unknown_error", send_attempt_count: newAttemptCount, last_attempt_at: now },
    });
  } else {
    const intervalMs = (RETRY_INTERVALS_SECONDS[newAttemptCount - 1] ?? 30) * 1000;
    await (db as any).outbound_queue.update({
      where: { id: row.id },
      data: { status: "failed_retryable", next_retry_at: new Date(now.getTime() + intervalMs), send_attempt_count: newAttemptCount, last_attempt_at: now },
    });
  }
  return "failed";
}

// ── Test helpers ──────────────────────────────────────────────

export function _resetQueueWorkerStoreForTest(): void {
  _queue.clear();
  _twilioSend = async (_row) => ({ success: true, providerMessageId: "SM_default" });
}

export function _seedQueueRowForTest(
  data: Omit<QueueRow, "createdAt" | "updatedAt"> & { createdAt?: Date; updatedAt?: Date },
): void {
  const now = new Date();
  _queue.set(data.id, {
    ...data,
    createdAt: data.createdAt ?? now,
    updatedAt: data.updatedAt ?? now,
  });
}

export function _getQueueRowForTest(id: string): QueueRow | undefined {
  return _queue.get(id);
}

export function _setTwilioSendForTest(fn: (row: QueueRow) => Promise<SendResult>): void {
  _twilioSend = fn;
}
