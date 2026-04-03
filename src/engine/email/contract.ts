// ============================================================
// src/engine/email/contract.ts
//
// EMAIL INTEGRATION — CONTRACT
//
// Exports ONLY types and constants. Zero logic.
//
// Inbound emails arrive via webhook (e.g. SendGrid Inbound Parse,
// Postmark, or similar). The payload is validated, deduplicated by
// messageId, then handed off to the shared inbound message handler
// with channel = 'email'.
//
// Outbound emails are sent via an injectable sender function that
// wraps the configured email provider.
//
// Blueprint source: Doc 14 §3.15
// ============================================================

// ── Inbound payload ───────────────────────────────────────────

export interface InboundEmailPayload {
  /** Sender email address */
  from: string;
  /** Recipient email address (the business's inbound address) */
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  /** Provider-assigned message ID — used for deduplication */
  messageId: string;
  /** The Message-ID this is replying to, if any */
  inReplyTo?: string;
}

// ── Outbound send ─────────────────────────────────────────────

export interface EmailSendParams {
  to: string;
  from: string;
  subject: string;
  body: string;
  /** Message-ID to set as In-Reply-To header */
  replyToMessageId?: string;
}

export interface EmailSendResult {
  success: boolean;
  providerMessageId?: string;
  error?: string;
}

// ── Inbound handler (injectable) ──────────────────────────────

export interface EmailInboundParams {
  businessId: string;
  fromContact: string;
  contactType: string;
  channel: string;
  content: string;
  externalId: string;
  subject: string;
  inReplyTo?: string;
}

export interface EmailInboundResult {
  success: boolean;
  customerId?: string;
  conversationId?: string;
  messageId?: string;
  error?: string;
}

/**
 * Injectable for testing — replaces the real handleInboundMessage call.
 * Production: calls handleInboundMessage() from engine/inbound/index.ts.
 */
export type EmailInboundHandlerFn = (
  params: EmailInboundParams,
) => Promise<EmailInboundResult>;

/**
 * Injectable for testing — replaces the real email provider SDK call.
 * Production: calls the configured provider (SendGrid, Postmark, etc.).
 */
export type EmailSenderFn = (
  params: EmailSendParams,
) => Promise<EmailSendResult>;

// ── Function signatures ───────────────────────────────────────

export type HandleInboundEmailFn = (
  payload: InboundEmailPayload,
) => Promise<EmailHandleResult>;

export type SendOutboundEmailFn = (
  params: EmailSendParams,
) => Promise<EmailSendResult>;

export type LookupBusinessByEmailFn = (
  emailAddress: string,
) => Promise<EmailBusinessRecord | null>;

// ── Response shapes ───────────────────────────────────────────

export interface EmailHandleResult {
  success: boolean;
  skipped?: boolean;
  messageId?: string;
  error?: string;
}

// ── Business record ───────────────────────────────────────────

export interface EmailBusinessRecord {
  businessId: string;
  businessName: string;
  inboundEmailAddress: string;
  outboundEmailAddress: string;
}

// ── Constants ─────────────────────────────────────────────────

/** Channel identifier passed to the inbound message handler. */
export const EMAIL_CHANNEL = "email";

/** Contact type passed to the inbound message handler. */
export const EMAIL_CONTACT_TYPE = "email";
