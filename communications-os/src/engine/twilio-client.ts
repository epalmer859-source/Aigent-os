// ============================================================
// src/engine/twilio-client.ts
//
// PRODUCTION TWILIO CLIENT
//
// Creates a singleton Twilio client and exports production
// implementations of the send function and validator.
// This file is imported by production-init.ts and NEVER by tests.
// ============================================================

import twilio from "twilio";
import type { QueueRow, SendResult } from "./queue-worker/contract";
import type { TwilioValidatorFn } from "./webhooks/contract";

// ── Singleton client ──────────────────────────────────────────

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN,
);

// ── Production send function ──────────────────────────────────

/**
 * Production implementation for the queue worker's send function.
 * Sends an SMS via Twilio Messages API.
 */
export async function productionTwilioSend(
  row: QueueRow,
): Promise<SendResult> {
  try {
    const message = await client.messages.create({
      to: row.customerId, // In production, resolved to E.164 phone from customer record
      from: process.env.TWILIO_PHONE_NUMBER ?? "",
      body: row.messageBody,
    });

    return {
      success: message.errorCode === null,
      providerMessageId: message.sid,
      ...(message.errorCode !== null && {
        errorCode: String(message.errorCode),
        errorMessage: message.errorMessage ?? undefined,
      }),
    };
  } catch (err) {
    const error = err as { code?: number; message?: string };
    return {
      success: false,
      errorCode: error.code ? String(error.code) : "unknown",
      errorMessage: error.message ?? "Twilio send failed",
    };
  }
}

// ── Production validator function ─────────────────────────────

/**
 * Production implementation of TwilioValidatorFn.
 * Validates inbound webhook signatures using the Twilio auth token.
 */
export const productionTwilioValidator: TwilioValidatorFn = (
  signature,
  url,
  params,
) => {
  const authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
  return twilio.validateRequest(authToken, signature, url, params);
};
