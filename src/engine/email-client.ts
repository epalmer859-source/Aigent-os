// ============================================================
// src/engine/email-client.ts
//
// PRODUCTION EMAIL CLIENT — STUB
//
// Email provider setup is a separate step. This stub logs
// outbound emails to the console and returns success so the
// rest of the pipeline continues to function.
//
// To wire in a real provider:
//   1. npm install @sendgrid/mail   (or nodemailer / postmark / resend)
//   2. Replace the console.log body with the provider SDK call:
//
//   SendGrid example:
//     import sgMail from '@sendgrid/mail';
//     sgMail.setApiKey(process.env.SENDGRID_API_KEY!);
//     const [response] = await sgMail.send({ to, from, subject, text: body });
//     return { success: true, providerMessageId: response.headers['x-message-id'] };
//
//   Resend example:
//     import { Resend } from 'resend';
//     const resend = new Resend(process.env.RESEND_API_KEY);
//     const { id } = await resend.emails.send({ from, to, subject, text: body });
//     return { success: true, providerMessageId: id };
//
// This file is imported by production-init.ts and NEVER by tests.
// ============================================================

import type { EmailSendParams, EmailSendResult } from "./email/contract";
import type {
  NotificationEmailParams,
  NotificationEmailResult,
} from "./notifications/contract";

// ── Production email sender (stub) ───────────────────────────

/**
 * Stub production implementation of EmailSenderFn.
 * Logs the outbound email and returns success.
 * Replace with a real provider SDK call before going live.
 */
export async function productionEmailSender(
  params: EmailSendParams,
): Promise<EmailSendResult> {
  // TODO: replace with real email provider SDK call
  console.log("[email-client] STUB — outbound email would be sent:", {
    to: params.to,
    from: params.from,
    subject: params.subject,
    bodyLength: params.body.length,
    replyToMessageId: params.replyToMessageId,
  });

  return {
    success: true,
    providerMessageId: `stub_${Date.now()}`,
  };
}

// ── Production notification email sender (stub) ───────────────

/**
 * Stub production implementation for notification email forwarding.
 * Replace with a real provider SDK call before going live.
 */
export async function productionNotificationEmailSender(
  params: NotificationEmailParams,
): Promise<NotificationEmailResult> {
  // TODO: replace with real email provider SDK call
  console.log("[email-client] STUB — notification email would be sent:", {
    to: params.to,
    subject: params.subject,
    bodyLength: params.body.length,
  });

  return { success: true };
}
