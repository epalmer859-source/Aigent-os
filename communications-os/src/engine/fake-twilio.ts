// ============================================================
// src/engine/fake-twilio.ts
//
// FAKE TWILIO — INSTRUMENTATION / MIDDLEWARE
//
// Drop-in replacement for all real Twilio calls during local
// development and integration testing.  Wire it up via
// dev-init.ts instead of production-init.ts.
//
// What it does:
//   • Records every outbound SMS (customer + notification channels)
//   • Validates every inbound signature as valid (no real auth token needed)
//   • Lets you simulate send failures to test retry / terminal-failure paths
//   • Lets you fire synthetic inbound webhooks at your local server
//
// Inspection API (use in tests or dev scripts):
//   getFakeSentMessages()     → all recorded outbound sends
//   getLastFakeSentMessage()  → most-recent send (or undefined)
//   clearFakeSentMessages()   → wipe the log
//   setFakeFailure(opts)      → make the next N sends return an error
//   clearFakeFailure()        → cancel a pending failure
// ============================================================

import type { QueueRow, SendResult } from "./queue-worker/contract";
import type { TwilioValidatorFn } from "./webhooks/contract";
import type { SmsSendParams } from "./notifications/contract";

// ── Recorded message shape ────────────────────────────────────

export interface FakeSentMessage {
  /** "customer" for queue-worker sends, "notification" for staff alerts */
  channel: "customer" | "notification";
  to: string;
  body: string;
  /** Fake SID assigned at record time, e.g. "FAKE_SM_001" */
  sid: string;
  sentAt: Date;
  /** Full QueueRow, present only for customer-channel sends */
  queueRow?: QueueRow;
}

// ── Internal state ─────────────────────────────────────────────

const _sent: FakeSentMessage[] = [];
let _sidCounter = 0;

interface FailureOpts {
  /** How many consecutive sends should fail.  Default: 1 */
  count: number;
  errorCode: string;
  errorMessage: string;
}

let _failure: (FailureOpts & { remaining: number }) | null = null;

// ── Helpers ───────────────────────────────────────────────────

function _nextSid(): string {
  _sidCounter += 1;
  return `FAKE_SM_${String(_sidCounter).padStart(3, "0")}`;
}

function _consumeFailure(): SendResult | null {
  if (!_failure || _failure.remaining <= 0) return null;
  _failure.remaining -= 1;
  if (_failure.remaining === 0) _failure = null;
  return {
    success: false,
    errorCode: (_failure ?? { errorCode: "FAKE_ERR" }).errorCode ?? "FAKE_ERR",
    errorMessage:
      (_failure ?? { errorMessage: "Simulated Twilio failure" }).errorMessage ??
      "Simulated Twilio failure",
  };
}

// ── fakeTwilioSend ────────────────────────────────────────────
// Compatible with (row: QueueRow) => Promise<SendResult>
// Pass to _setTwilioSendForTest() in queue-worker.

export async function fakeTwilioSend(row: QueueRow): Promise<SendResult> {
  const failure = _consumeFailure();
  if (failure) {
    console.log(
      `[fake-twilio] SEND FAILED (simulated) to=${row.customerId} err=${failure.errorCode}`,
    );
    return failure;
  }

  const sid = _nextSid();
  _sent.push({
    channel: "customer",
    to: row.customerId,
    body: row.messageBody,
    sid,
    sentAt: new Date(),
    queueRow: row,
  });

  console.log(
    `[fake-twilio] SMS SENT sid=${sid} to=${row.customerId} body="${row.messageBody.slice(0, 60)}"`,
  );

  return { success: true, providerMessageId: sid };
}

// ── fakeNotificationSmsSender ─────────────────────────────────
// Compatible with NotificationSmsSenderFn
// Pass to _setSmsSenderForTest() in notifications.

export async function fakeNotificationSmsSender(
  params: SmsSendParams,
): Promise<{ success: boolean }> {
  const failure = _consumeFailure();
  if (failure) {
    console.log(
      `[fake-twilio] NOTIF SMS FAILED (simulated) to=${params.to} err=${failure.errorCode}`,
    );
    return { success: false };
  }

  const sid = _nextSid();
  _sent.push({
    channel: "notification",
    to: params.to,
    body: params.body,
    sid,
    sentAt: new Date(),
  });

  console.log(
    `[fake-twilio] NOTIF SMS sid=${sid} to=${params.to} body="${params.body.slice(0, 60)}"`,
  );

  return { success: true };
}

// ── fakeTwilioValidator ───────────────────────────────────────
// Always returns true — no real auth token required in dev.
// Pass to _setTwilioValidatorForTest() in webhooks.

export const fakeTwilioValidator: TwilioValidatorFn = (
  _signature,
  _url,
  _params,
) => true;

// ── Inspection API ────────────────────────────────────────────

/** All outbound sends recorded since last clearFakeSentMessages(). */
export function getFakeSentMessages(): readonly FakeSentMessage[] {
  return _sent;
}

/** Most-recent outbound send, or undefined when the log is empty. */
export function getLastFakeSentMessage(): FakeSentMessage | undefined {
  return _sent[_sent.length - 1];
}

/** Reset the send log (call between tests or dev scenarios). */
export function clearFakeSentMessages(): void {
  _sent.length = 0;
  _sidCounter = 0;
}

// ── Failure injection ─────────────────────────────────────────

/**
 * Make the next `count` send attempts return an error.
 * Useful for testing retry logic and terminal-failure paths.
 *
 * @example
 * setFakeFailure({ count: 3, errorCode: "21211", errorMessage: "Invalid phone" });
 */
export function setFakeFailure(opts: Partial<FailureOpts> = {}): void {
  _failure = {
    count: opts.count ?? 1,
    remaining: opts.count ?? 1,
    errorCode: opts.errorCode ?? "FAKE_ERR",
    errorMessage: opts.errorMessage ?? "Simulated Twilio failure",
  };
}

/** Cancel any pending simulated failure. */
export function clearFakeFailure(): void {
  _failure = null;
}

// ── Inbound simulation ────────────────────────────────────────

/**
 * Fire a synthetic inbound SMS webhook at your local Next.js server.
 * The fake validator will accept it — no real Twilio signature needed.
 *
 * @param baseUrl  Your local server, e.g. "http://localhost:3000"
 * @param payload  Fields required by TwilioSmsPayload
 */
export async function triggerFakeInboundSms(
  baseUrl: string,
  payload: {
    From: string;
    To: string;
    Body: string;
    MessageSid?: string;
    NumMedia?: string;
  },
): Promise<Response> {
  const body = new URLSearchParams({
    From: payload.From,
    To: payload.To,
    Body: payload.Body,
    MessageSid: payload.MessageSid ?? `FAKE_IN_${Date.now()}`,
    NumMedia: payload.NumMedia ?? "0",
  });

  console.log(
    `[fake-twilio] INBOUND SMS From=${payload.From} To=${payload.To} Body="${payload.Body.slice(0, 60)}"`,
  );

  return fetch(`${baseUrl}/api/webhooks/twilio/sms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-twilio-signature": "fake_signature",
    },
    body: body.toString(),
  });
}

/**
 * Fire a synthetic inbound voice webhook at your local Next.js server.
 *
 * @param baseUrl  Your local server, e.g. "http://localhost:3000"
 * @param payload  Fields required by TwilioVoicePayload
 */
export async function triggerFakeInboundVoice(
  baseUrl: string,
  payload: {
    From: string;
    To: string;
    CallSid?: string;
    CallStatus?: string;
    Direction?: string;
  },
): Promise<Response> {
  const body = new URLSearchParams({
    From: payload.From,
    To: payload.To,
    CallSid: payload.CallSid ?? `FAKE_CA_${Date.now()}`,
    CallStatus: payload.CallStatus ?? "ringing",
    Direction: payload.Direction ?? "inbound",
  });

  console.log(
    `[fake-twilio] INBOUND VOICE From=${payload.From} To=${payload.To}`,
  );

  return fetch(`${baseUrl}/api/webhooks/twilio/voice`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "x-twilio-signature": "fake_signature",
    },
    body: body.toString(),
  });
}
