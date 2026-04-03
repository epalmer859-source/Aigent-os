// ============================================================
// src/engine/email/index.ts
//
// EMAIL INTEGRATION — IMPLEMENTATION
//
// All DB access would go through Prisma in production.
// This module maintains in-memory stores so the test suite
// runs without a real DB.
//
// Production Prisma patterns:
//   const config = await db.email_config.findFirst({
//     where: { inbound_email_address: toAddress },
//     include: { businesses: true },
//   });
//   await db.email_messages.create({ data: { message_id: messageId, ... } });
//   const existing = await db.email_messages.findUnique({ where: { message_id } });
// ============================================================

import { z } from "zod";
import {
  EMAIL_CHANNEL,
  EMAIL_CONTACT_TYPE,
  type EmailBusinessRecord,
  type EmailHandleResult,
  type EmailInboundHandlerFn,
  type EmailSendParams,
  type EmailSendResult,
  type EmailSenderFn,
  type InboundEmailPayload,
} from "./contract";

// ── Zod schemas ───────────────────────────────────────────────

const InboundEmailSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  subject: z.string(),
  textBody: z.string(),
  htmlBody: z.string().optional(),
  messageId: z.string().min(1),
  inReplyTo: z.string().optional(),
});

const EmailSendSchema = z.object({
  to: z.string().min(1),
  from: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  replyToMessageId: z.string().optional(),
});

// ── In-memory stores ──────────────────────────────────────────

const _businessEmails = new Map<string, EmailBusinessRecord>();
const _seenMessageIds = new Set<string>();

// ── Injectables ───────────────────────────────────────────────

const _defaultInboundHandler: EmailInboundHandlerFn = async () => ({
  success: false,
  error: "No inbound handler configured",
});

const _defaultEmailSender: EmailSenderFn = async () => ({
  success: false,
  error: "No email sender configured",
});

let _inboundHandler: EmailInboundHandlerFn = _defaultInboundHandler;
let _emailSender: EmailSenderFn = _defaultEmailSender;

// ── lookupBusinessByEmail ─────────────────────────────────────

export async function lookupBusinessByEmail(
  emailAddress: string,
): Promise<EmailBusinessRecord | null> {
  // Production:
  //   const config = await db.email_config.findFirst({
  //     where: { inbound_email_address: emailAddress, is_active: true },
  //     include: { businesses: true },
  //   });
  //   if (!config) return null;
  //   return { businessId: config.business_id, ... };
  return _businessEmails.get(emailAddress.toLowerCase()) ?? null;
}

// ── handleInboundEmail ────────────────────────────────────────

export async function handleInboundEmail(
  payload: InboundEmailPayload,
): Promise<EmailHandleResult> {
  // 1. Validate payload
  const parsed = InboundEmailSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, error: "invalid_payload" };
  }

  const { from, to, subject, textBody, htmlBody, messageId, inReplyTo } =
    parsed.data;

  // 2. Look up business by destination address
  // Production: db.email_config.findFirst({ where: { inbound_email_address: to } })
  const business = await lookupBusinessByEmail(to);
  if (!business) {
    return { success: false, error: "business_not_found" };
  }

  // 3. Deduplicate by messageId
  // Production: db.email_messages.findUnique({ where: { provider_message_id: messageId } })
  if (_seenMessageIds.has(messageId)) {
    return { success: true, skipped: true };
  }
  // Production: db.email_messages.create({ data: { provider_message_id: messageId, ... } })
  _seenMessageIds.add(messageId);

  // 4. Resolve content — prefer textBody, fall back to stripping htmlBody
  const content = textBody || htmlBody || "";

  // 5. Hand off to inbound handler
  // Production: calls handleInboundMessage() from engine/inbound/index.ts
  const result = await _inboundHandler({
    businessId: business.businessId,
    fromContact: from,
    contactType: EMAIL_CONTACT_TYPE,
    channel: EMAIL_CHANNEL,
    content,
    externalId: messageId,
    subject,
    inReplyTo,
  });

  if (!result.success) {
    // Remove from seen set so retry is possible
    _seenMessageIds.delete(messageId);
    return { success: false, error: result.error ?? "handler_error" };
  }

  // 6. Return
  return {
    success: true,
    messageId: result.messageId,
  };
}

// ── sendOutboundEmail ─────────────────────────────────────────

export async function sendOutboundEmail(
  params: EmailSendParams,
): Promise<EmailSendResult> {
  // 1. Validate params
  const parsed = EmailSendSchema.safeParse(params);
  if (!parsed.success) {
    return { success: false, error: "invalid_params" };
  }

  // 2. Delegate to injectable sender
  // Production: calls the configured provider SDK (SendGrid, Postmark, etc.)
  return _emailSender(parsed.data);
}

// ── Test helpers ──────────────────────────────────────────────

export function _resetEmailStoreForTest(): void {
  _businessEmails.clear();
  _seenMessageIds.clear();
  _inboundHandler = _defaultInboundHandler;
  _emailSender = _defaultEmailSender;
}

export function _seedBusinessEmailForTest(data: Record<string, unknown>): void {
  // Production: db.email_config.upsert({ ... })
  const address = (data["inboundEmailAddress"] as string).toLowerCase();
  _businessEmails.set(address, {
    businessId: data["businessId"] as string,
    businessName: data["businessName"] as string,
    inboundEmailAddress: address,
    outboundEmailAddress: data["outboundEmailAddress"] as string,
  });
}

export function _setInboundHandlerForTest(fn: EmailInboundHandlerFn): void {
  _inboundHandler = fn;
}

export function _setEmailSenderForTest(fn: EmailSenderFn): void {
  _emailSender = fn;
}
