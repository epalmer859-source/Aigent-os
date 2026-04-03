// ============================================================
// src/engine/dev-init.ts
//
// DEVELOPMENT WIRING
//
// Same as production-init.ts but swaps the real Twilio client
// for the fake instrumentation layer from fake-twilio.ts.
//
// Use this in development or integration tests when you don't
// want to hit real Twilio.  The fake records every outbound
// send and accepts every inbound signature as valid.
//
// Usage in Next.js instrumentation hook (instrumentation.ts):
//
//   if (process.env.NODE_ENV !== "production") {
//     const { initDevEngine } = await import("~/engine/dev-init");
//     initDevEngine();
//   } else {
//     const { initProductionEngine } = await import("~/engine/production-init");
//     initProductionEngine();
//   }
// ============================================================

import {
  fakeTwilioSend,
  fakeTwilioValidator,
  fakeNotificationSmsSender,
} from "./fake-twilio";
import { _setInboundHandlerForTest } from "./web-chat/index";
import { handleInboundMessage } from "./inbound/index";
import type { WebChatInboundParams, WebChatInboundResult } from "./web-chat/contract";

import { productionClaudeCall } from "./claude-client";
import { productionEmailSender, productionNotificationEmailSender } from "./email-client";

import { _setClaudeCallForTest } from "./ai-response/index";
import { _setTwilioSendForTest } from "./queue-worker/index";
import { _setTwilioValidatorForTest } from "./webhooks/index";
import { _setEmailSenderForTest } from "./email/index";
import {
  _setSmsSenderForTest,
  _setEmailSenderForTest as _setNotifEmailSenderForTest,
} from "./notifications/index";
import { _setGoogleCalendarClientForTest } from "./calendar-sync/index";

import type { GoogleCalendarClient } from "./calendar-sync/contract";

// ── Google Calendar stub (same as production-init) ────────────

const googleCalendarStub: GoogleCalendarClient = {
  createEvent: async (calendarId, event) => {
    console.log("[dev-init] createEvent (stub):", { calendarId, summary: event.summary });
    return { id: `stub_event_${Date.now()}` };
  },
  updateEvent: async (calendarId, eventId, event) => {
    console.log("[dev-init] updateEvent (stub):", { calendarId, eventId, summary: event.summary });
    return { id: eventId };
  },
  deleteEvent: async (calendarId, eventId) => {
    console.log("[dev-init] deleteEvent (stub):", { calendarId, eventId });
  },
};

// ── Wire everything ───────────────────────────────────────────

export function initDevEngine(): void {
  // 1. AI response → real Claude (needs ANTHROPIC_API_KEY in .env.local)
  _setClaudeCallForTest(productionClaudeCall);

  // 2. Queue worker → FAKE Twilio send (records to in-memory log)
  _setTwilioSendForTest(fakeTwilioSend);

  // 3. Webhook handler → FAKE validator (always returns true)
  _setTwilioValidatorForTest(fakeTwilioValidator);

  // 4. Email integration → stub sender
  _setEmailSenderForTest(productionEmailSender);

  // 5. Notification engine → FAKE SMS sender + stub email
  _setSmsSenderForTest(fakeNotificationSmsSender);
  _setNotifEmailSenderForTest(productionNotificationEmailSender);

  // 6. Calendar sync → stub
  _setGoogleCalendarClientForTest(googleCalendarStub);

  // 7. Web-chat endpoint → real inbound message handler (uses fake Twilio)
  const webChatAdapter = async (params: WebChatInboundParams): Promise<WebChatInboundResult> => {
    try {
      const result = await handleInboundMessage({
        businessId: params.businessId,
        fromContact: params.fromContact,
        contactType: params.contactType as "phone" | "email" | "web_chat",
        channel: params.channel as "sms" | "voice" | "email" | "web_chat",
        content: params.content,
      });
      return {
        success: true,
        customerId: result.customerId,
        conversationId: result.conversationId,
        messageId: result.messageId,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "inbound_handler_error",
      };
    }
  };
  _setInboundHandlerForTest(webChatAdapter);

  console.log("[dev-init] Engine wired with FAKE Twilio. Outbound SMS will be recorded, not sent.");
  console.log("[dev-init] Import getFakeSentMessages() from ~/engine/fake-twilio to inspect sends.");
}
