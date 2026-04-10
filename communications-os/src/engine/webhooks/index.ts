// ============================================================
// src/engine/webhooks/index.ts
//
// TWILIO WEBHOOKS — IMPLEMENTATION
//
// All DB access would go through Prisma in production.
// This module maintains an in-memory store so the test suite
// runs without a real DB.
//
// Production Prisma query pattern:
//   const biz = await db.businesses.findFirst({
//     where: { twilio_number: normalizedPhone },
//     select: { id, name, ai_call_answering_enabled, signoff_name, phone },
//   });
// ============================================================

import { z } from "zod";
import {
  EMPTY_TWIML,
  VOICE_GATHER_TIMEOUT,
  type BusinessLookupResult,
  type InboundHandlerFn,
  type InboundHandlerParams,
  type TwilioValidatorFn,
  type TwilioSmsPayload,
  type TwilioVoicePayload,
  type WebhookResult,
} from "./contract";

// ── Zod schemas ───────────────────────────────────────────────

const SmsPayloadSchema = z.object({
  From: z.string().min(1),
  To: z.string().min(1),
  Body: z.string(),
  MessageSid: z.string().min(1),
  NumMedia: z.string(),
});

const VoicePayloadSchema = z.object({
  From: z.string().min(1),
  To: z.string().min(1),
  CallSid: z.string().min(1),
  CallStatus: z.string().min(1),
  Direction: z.string().min(1),
});

// ── In-memory store ───────────────────────────────────────────

interface BusinessPhoneRecord extends BusinessLookupResult {
  twilioNumber: string;
}

const _businessPhones = new Map<string, BusinessPhoneRecord>();

// ── Injectables ───────────────────────────────────────────────

let _twilioValidator: TwilioValidatorFn = () => true;

let _inboundHandler: InboundHandlerFn = async () => ({ success: true });

// ── Phone normalisation ───────────────────────────────────────

function _normalise(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) return trimmed;
  return `+${trimmed}`;
}

// ── lookupBusinessByPhone ─────────────────────────────────────

export async function lookupBusinessByPhone(
  phoneNumber: string,
): Promise<BusinessLookupResult | null> {
  const normalised = _normalise(phoneNumber);

  if (process.env.NODE_ENV !== "test") {
    const { db } = await import("~/server/db");
    const config = await db.twilio_config.findFirst({
      where: { twilio_phone_number: normalised },
      include: { businesses: true },
    });
    if (!config) return null;
    return {
      businessId: config.business_id,
      businessName: config.businesses.business_name,
      aiCallAnsweringEnabled: config.businesses.ai_call_answering_enabled,
      signoffName: config.businesses.ai_signoff_name ?? config.businesses.business_name,
      businessPhone: config.businesses.preferred_phone_number ?? "",
    };
  }

  const record = _businessPhones.get(normalised);
  if (!record) return null;
  const { twilioNumber: _unused, ...result } = record;
  void _unused;
  return result;
}

// ── handleInboundSms ──────────────────────────────────────────

export async function handleInboundSms(
  payload: TwilioSmsPayload,
  signature: string,
  url: string,
): Promise<WebhookResult> {
  // a. Validate signature
  const params = payload as unknown as Record<string, string>;
  if (!_twilioValidator(signature, url, params)) {
    return {
      success: false,
      twiml: EMPTY_TWIML,
      error: "403 Forbidden: invalid signature",
    };
  }

  // b. Validate payload
  const parsed = SmsPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      success: false,
      twiml: EMPTY_TWIML,
      error: "400 Bad Request: invalid payload",
    };
  }

  const { From, To, Body, MessageSid, NumMedia } = parsed.data;

  // d. Look up business
  const business = await lookupBusinessByPhone(To);
  if (!business) {
    return {
      success: false,
      twiml: EMPTY_TWIML,
      error: "404 Not Found: no business for number",
    };
  }

  // e. Extract media URLs
  const mediaCount = parseInt(NumMedia, 10) || 0;
  const mediaUrls: string[] = [];
  for (let i = 0; i < mediaCount; i++) {
    const key = `MediaUrl${i}` as keyof TwilioSmsPayload;
    const url = payload[key];
    if (url) mediaUrls.push(url);
  }

  // f–g. Build params and call handler
  const handlerParams: InboundHandlerParams = {
    businessId: business.businessId,
    channel: "sms",
    from: From,
    to: To,
    content: Body,
    externalId: MessageSid,
    mediaUrls,
  };

  // Production: calls handleInboundMessage() from engine/inbound/index.ts
  await _inboundHandler(handlerParams);

  // h. Return success
  return {
    success: true,
    twiml: EMPTY_TWIML,
    businessId: business.businessId,
  };
}

// ── handleInboundVoice ────────────────────────────────────────

export async function handleInboundVoice(
  payload: TwilioVoicePayload,
  signature: string,
  url: string,
): Promise<WebhookResult> {
  // a. Validate signature
  const params = payload as unknown as Record<string, string>;
  if (!_twilioValidator(signature, url, params)) {
    return {
      success: false,
      twiml: EMPTY_TWIML,
      error: "403 Forbidden: invalid signature",
    };
  }

  // b. Validate payload
  const parsed = VoicePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      success: false,
      twiml: EMPTY_TWIML,
      error: "400 Bad Request: invalid payload",
    };
  }

  const { To } = parsed.data;

  // d. Look up business
  const business = await lookupBusinessByPhone(To);
  if (!business) {
    return {
      success: false,
      twiml: EMPTY_TWIML,
      error: "404 Not Found: no business for number",
    };
  }

  // e/f. Build TwiML based on AI answering setting
  let twiml: string;

  if (business.aiCallAnsweringEnabled) {
    // AI answering on → Gather for speech
    twiml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<Response>",
      `  <Gather input="speech" timeout="${VOICE_GATHER_TIMEOUT}" speechTimeout="auto">`,
      `    <Say>Hi, thanks for calling ${business.businessName}. How can I help you today?</Say>`,
      "  </Gather>",
      "</Response>",
    ].join("\n");
  } else {
    // AI answering off → Dial to forward
    twiml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<Response>",
      `  <Dial>${business.businessPhone}</Dial>`,
      "</Response>",
    ].join("\n");
  }

  return { success: true, twiml, businessId: business.businessId };
}

// ── Test helpers ──────────────────────────────────────────────

export function _resetWebhooksStoreForTest(): void {
  _businessPhones.clear();
  _twilioValidator = () => true;
  _inboundHandler = async () => ({ success: true });
}

export function _seedBusinessPhoneForTest(data: Record<string, unknown>): void {
  // Production: db.businesses.upsert({ where: { twilio_number }, data: { ... } })
  const normalised = _normalise(data["twilioNumber"] as string);
  _businessPhones.set(normalised, {
    twilioNumber: normalised,
    businessId: data["businessId"] as string,
    businessName: data["businessName"] as string,
    aiCallAnsweringEnabled: data["aiCallAnsweringEnabled"] as boolean,
    signoffName: data["signoffName"] as string,
    businessPhone: data["businessPhone"] as string,
  });
}

export function _setTwilioValidatorForTest(fn: TwilioValidatorFn): void {
  _twilioValidator = fn;
}

export function _setInboundHandlerForTest(fn: InboundHandlerFn): void {
  _inboundHandler = fn;
}
