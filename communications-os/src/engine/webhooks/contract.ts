// ============================================================
// src/engine/webhooks/contract.ts
//
// TWILIO WEBHOOKS — CONTRACT
//
// Exports ONLY types and constants. Zero logic.
//
// Pipeline (not implemented here):
//   1. Validate Twilio signature (injectable for tests).
//   2. Parse and validate webhook payload via Zod.
//   3. Look up business by To phone number.
//   4. Hand off to inbound message handler (Component 5).
//   5. Return TwiML response.
//
// Routes (Next.js API routes, NOT tRPC — per Rule 11):
//   POST /api/webhooks/sms   → handleInboundSms()
//   POST /api/webhooks/voice → handleInboundVoice()
// ============================================================

// ── Twilio payload shapes ─────────────────────────────────────

/** Raw form-encoded body Twilio sends for inbound SMS. */
export interface TwilioSmsPayload {
  /** Sender phone number in E.164 format, e.g. "+15559876543". */
  From: string;
  /** Business Twilio number that received the message. */
  To: string;
  /** Message text body. May be empty when NumMedia > 0. */
  Body: string;
  /** Unique Twilio message SID used for deduplication. */
  MessageSid: string;
  /** Number of media attachments as a string, e.g. "0", "1", "2". */
  NumMedia: string;
  MediaUrl0?: string;
  MediaUrl1?: string;
  MediaUrl2?: string;
  MediaContentType0?: string;
  MediaContentType1?: string;
  MediaContentType2?: string;
}

/** Raw form-encoded body Twilio sends for inbound voice calls. */
export interface TwilioVoicePayload {
  /** Caller phone number in E.164 format. */
  From: string;
  /** Business Twilio number that received the call. */
  To: string;
  /** Unique Twilio call SID. */
  CallSid: string;
  /** Current call status: "ringing", "in-progress", "completed", etc. */
  CallStatus: string;
  /** Call direction, typically "inbound". */
  Direction: string;
}

// ── Result shapes ─────────────────────────────────────────────

/** Returned by handleInboundSms and handleInboundVoice. */
export interface WebhookResult {
  success: boolean;
  /** TwiML XML string to return as the HTTP response body. */
  twiml: string;
  /** Resolved business ID, present when business lookup succeeded. */
  businessId?: string;
  /** Human-readable error description on failure. */
  error?: string;
}

/** Returned by lookupBusinessByPhone when a match is found. */
export interface BusinessLookupResult {
  businessId: string;
  businessName: string;
  /** Whether the business has AI voice answering turned on. */
  aiCallAnsweringEnabled: boolean;
  signoffName: string;
  /** Business phone number to forward calls to when AI answering is disabled. */
  businessPhone: string;
}

// ── Inbound handler integration ───────────────────────────────

/**
 * Parameters passed to the inbound message handler (Component 5)
 * by the webhook layer after business resolution.
 */
export interface InboundHandlerParams {
  businessId: string;
  channel: "sms" | "voice";
  from: string;
  to: string;
  content: string;
  /** MessageSid or CallSid — used for deduplication. */
  externalId: string;
  /** Extracted media URLs, empty array when NumMedia = "0". */
  mediaUrls: string[];
}

// ── Injectable function types ─────────────────────────────────

/**
 * Validates the Twilio request signature.
 * Production: uses twilio.validateRequest() from the Twilio SDK.
 * Returns true when the signature is valid.
 */
export type TwilioValidatorFn = (
  signature: string,
  url: string,
  params: Record<string, string>,
) => boolean;

/**
 * Calls the inbound message handler (Component 5).
 * Production: calls handleInboundMessage() from engine/inbound/index.ts.
 * Injectable for testing so webhook tests do not depend on the inbound module.
 */
export type InboundHandlerFn = (
  params: InboundHandlerParams,
) => Promise<{ success: boolean; error?: string }>;

// ── Function signatures ───────────────────────────────────────

/**
 * Handle an inbound SMS webhook from Twilio.
 *
 * 1. Validates the X-Twilio-Signature header.
 * 2. Parses and validates the SMS payload.
 * 3. Looks up the business by To number.
 * 4. Extracts media URLs from NumMedia + MediaUrl0/1/2.
 * 5. Calls the inbound handler with the resolved params.
 * 6. Returns EMPTY_TWIML on success, or an error TwiML on failure.
 */
export type HandleInboundSmsFn = (
  payload: TwilioSmsPayload,
  signature: string,
  url: string,
) => Promise<WebhookResult>;

/**
 * Handle an inbound voice webhook from Twilio.
 *
 * 1. Validates the X-Twilio-Signature header.
 * 2. Parses and validates the voice payload.
 * 3. Looks up the business by To number.
 * 4. If aiCallAnsweringEnabled → returns TwiML with <Gather> for speech.
 * 5. If disabled → returns TwiML with <Dial> forwarding to business phone.
 */
export type HandleInboundVoiceFn = (
  payload: TwilioVoicePayload,
  signature: string,
  url: string,
) => Promise<WebhookResult>;

/**
 * Look up a business record by its Twilio phone number.
 * Normalises the input to E.164 before matching.
 * Returns null when no business is registered for that number.
 *
 * Production: db.businesses.findFirst({ where: { twilio_number: normalised } })
 */
export type LookupBusinessByPhoneFn = (
  phoneNumber: string,
) => Promise<BusinessLookupResult | null>;

// ── Constants ─────────────────────────────────────────────────

/**
 * TwiML response returned when no TwiML content is needed
 * (e.g. successful SMS receipt — Twilio requires a valid XML response).
 */
export const EMPTY_TWIML =
  '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

/** Seconds to wait for speech input in a Gather verb before timing out. */
export const VOICE_GATHER_TIMEOUT = 5;

/** Maximum call duration in seconds (15 minutes). */
export const VOICE_MAX_DURATION = 900;

/** Seconds at which the call wrap-up should begin (14 minutes). */
export const VOICE_WRAPUP_AT = 840;
