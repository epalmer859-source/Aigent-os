// ============================================================
// src/engine/production-init.ts
//
// PRODUCTION WIRING
//
// Replaces the default no-op stubs in every engine module with
// real production implementations. This file is imported ONCE
// at application startup (Next.js instrumentation hook or the
// Railway worker entry point) and NEVER imported by tests.
//
// Import order matters: clients must be created before wiring.
// ============================================================

import { productionClaudeCall } from "./claude-client";
import { productionTwilioSend, productionTwilioValidator } from "./twilio-client";
import { productionEmailSender, productionNotificationEmailSender } from "./email-client";

// ── Engine modules that accept injectable implementations ─────

import { _setClaudeCallForTest } from "./ai-response/index";
import { _setTwilioSendForTest } from "./queue-worker/index";
import { _setTwilioValidatorForTest } from "./webhooks/index";
import { _setEmailSenderForTest } from "./email/index";
import { _setSmsSenderForTest, _setEmailSenderForTest as _setNotifEmailSenderForTest } from "./notifications/index";
import { _setGoogleCalendarClientForTest } from "./calendar-sync/index";
import { _setInboundHandlerForTest } from "./web-chat/index";
import { handleInboundMessage } from "./inbound/index";
import type { WebChatInboundParams, WebChatInboundResult } from "./web-chat/contract";

import type { GoogleCalendarClient } from "./calendar-sync/contract";

// ── Google Calendar stub (real OAuth setup is a separate step) ─

/**
 * Stub Google Calendar client.
 * Replace with real googleapis SDK calls after completing OAuth setup:
 *   npm install googleapis
 *   const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
 *   auth.setCredentials({ access_token, refresh_token });
 *   const calendar = google.calendar({ version: 'v3', auth });
 */
const googleCalendarStub: GoogleCalendarClient = {
  createEvent: async (calendarId, event) => {
    console.log("[calendar-stub] createEvent (stub):", { calendarId, summary: event.summary });
    return { id: `stub_event_${Date.now()}` };
  },
  updateEvent: async (calendarId, eventId, event) => {
    console.log("[calendar-stub] updateEvent (stub):", { calendarId, eventId, summary: event.summary });
    return { id: eventId };
  },
  deleteEvent: async (calendarId, eventId) => {
    console.log("[calendar-stub] deleteEvent (stub):", { calendarId, eventId });
  },
};

// ── Web-chat → inbound adapter ────────────────────────────────

async function webChatInboundAdapter(
  params: WebChatInboundParams,
): Promise<WebChatInboundResult> {
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
}

// ── Notification SMS sender stub ──────────────────────────────

/**
 * Stub SMS sender for internal notifications.
 * Production: use productionTwilioSend adapted to SmsSendParams,
 * or a dedicated Twilio messaging service.
 */
async function notificationSmsSender(params: { to: string; body: string }) {
  console.log("[sms-stub] notification SMS (stub):", { to: params.to, body: params.body.slice(0, 60) });
  return { success: true };
}

// ── Scheduling engine adapters (lazy — created on first use) ──

import { db } from "~/server/db";
import {
  createBookingOrchestratorDb,
  createRebookCascadeDb,
  createGapFillDb,
  createTransferDb,
  createSchedulingStateMachineDb,
  createCapacityDb,
  createPauseGuardDb,
  createMorningReminderWorkerDb,
  createEndOfDaySweepWorkerDb,
  createCommunicationWiringDb,
  createSendTimeVerifyDb,
  createPauseManualDb,
  createEstimateTimeoutWorkerDb,
  createPullForwardExpiryWorkerDb,
  createSkillTagValidationWorkerDb,
  createManualPositionExpiryWorkerDb,
  createOsrmDeps,
  createMorningBriefingWorkerDb,
  createTimerCheckInWorkerDb,
  createProjectScopePromptWorkerDb,
  createHeartbeatDb,
} from "./scheduling/prisma-scheduling-adapter";

/** Pre-built scheduling adapter instances. Import from here at call sites. */
export const schedulingAdapters = {
  get bookingOrchestrator() { return createBookingOrchestratorDb(db); },
  get rebookCascade() { return createRebookCascadeDb(db); },
  get gapFill() { return createGapFillDb(db); },
  get transfer() { return createTransferDb(db); },
  get stateMachine() { return createSchedulingStateMachineDb(db); },
  get capacity() { return createCapacityDb(db); },
  get pauseGuard() { return createPauseGuardDb(db); },
  get morningReminderWorker() { return createMorningReminderWorkerDb(db); },
  get endOfDaySweepWorker() { return createEndOfDaySweepWorkerDb(db); },
  get communicationWiring() { return createCommunicationWiringDb(db); },
  get sendTimeVerify() { return createSendTimeVerifyDb(db); },
  get pauseManual() { return createPauseManualDb(db); },
  get estimateTimeoutWorker() { return createEstimateTimeoutWorkerDb(db); },
  get pullForwardExpiryWorker() { return createPullForwardExpiryWorkerDb(db); },
  get skillTagValidationWorker() { return createSkillTagValidationWorkerDb(db); },
  get manualPositionExpiryWorker() { return createManualPositionExpiryWorkerDb(db); },
  get morningBriefingWorker() { return createMorningBriefingWorkerDb(db); },
  get timerCheckInWorker() { return createTimerCheckInWorkerDb(db); },
  get projectScopePromptWorker() { return createProjectScopePromptWorkerDb(db); },
  get heartbeatDb() { return createHeartbeatDb(); },
  get osrmDeps() { return createOsrmDeps(); },
};

// ── Wire everything ───────────────────────────────────────────

export function initProductionEngine(): void {
  // 1. AI response generator → real Claude client
  _setClaudeCallForTest(productionClaudeCall);

  // 2. Queue worker → real Twilio SMS sender
  _setTwilioSendForTest(productionTwilioSend);

  // 3. Webhook handler → real Twilio signature validator
  _setTwilioValidatorForTest(productionTwilioValidator);

  // 4. Email integration → stub sender (real provider TBD)
  _setEmailSenderForTest(productionEmailSender);

  // 5. Notification engine → stub SMS + stub email senders
  _setSmsSenderForTest(notificationSmsSender);
  _setNotifEmailSenderForTest(productionNotificationEmailSender);

  // 6. Calendar sync → stub Google Calendar client (real OAuth TBD)
  _setGoogleCalendarClientForTest(googleCalendarStub);

  // 7. Web-chat endpoint → real inbound message handler
  _setInboundHandlerForTest(webChatInboundAdapter);

  // 8. Scheduling engine — adapters are lazy via schedulingAdapters export
  // No wiring needed; callers import schedulingAdapters directly.

  console.log("[production-init] Engine wired with production clients.");
  console.log("[production-init] Scheduling adapters available via schedulingAdapters export.");
}
