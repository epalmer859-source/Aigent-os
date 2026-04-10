// ============================================================
// src/engine/__tests__/gauntlet.test.ts
//
// END-TO-END GAUNTLET — 10-SCENARIO VERIFICATION
//
// Each scenario exercises a full pipeline path through multiple engine
// modules. Clock is pinned to 2:00 PM UTC to avoid quiet-hours deferrals.
//
// Reset strategy: ALL in-memory stores are cleared before each test.
// Twilio is replaced with a success spy. Claude is replaced with a stub.
// ============================================================

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// ── Engine: inbound ───────────────────────────────────────────────────────
import {
  handleInboundMessage,
  _resetInboundStoreForTest,
  _setConversationOwnerForTest,
  _getConsentStatusForTest,
} from "../inbound/index";

// ── Engine: customer-resolver ─────────────────────────────────────────────
import { _resetStoreForTest as _resetCustomerResolverForTest } from "../customer-resolver/index";

// ── Engine: suppression ───────────────────────────────────────────────────
import {
  _resetSuppressionStoreForTest,
  _seedBusinessForTest as _seedSuppressionBusinessForTest,
  _seedCustomerForTest as _seedSuppressionCustomerForTest,
  _seedConversationForTest as _seedSuppressionConversationForTest,
  _seedOutboundQueueForTest as _seedSuppressionQueueForTest,
} from "../suppression/index";

// ── Engine: queue-worker ──────────────────────────────────────────────────
import {
  processQueue,
  _resetQueueWorkerStoreForTest,
  _seedQueueRowForTest,
  _getQueueRowForTest,
  _setTwilioSendForTest,
} from "../queue-worker/index";
import type { QueueRow } from "../queue-worker/contract";

// ── Engine: admin-actions ─────────────────────────────────────────────────
import {
  placeAppointment,
  takeOverConversation,
  returnToAI,
  _resetAdminActionsStoreForTest,
  _seedConversationForTest as _seedAdminConversationForTest,
  _getConversationForTest as _getAdminConversationForTest,
  _getAppointmentByConversationForTest,
} from "../admin-actions/index";
import type { ActorContext } from "../admin-actions/contract";

// ── Engine: ai-response ───────────────────────────────────────────────────
import {
  _resetAIResponseStoreForTest,
  _setClaudeCallForTest,
} from "../ai-response/index";

// ── Shared test fixtures ──────────────────────────────────────────────────

const BUSINESS_ID = "biz_gauntlet_001";

const ACTOR: ActorContext = {
  businessId: BUSINESS_ID,
  userId: "usr_admin_gauntlet",
  role: "admin",
};

/** Build a fully-populated QueueRow with sensible defaults for gauntlet tests. */
function makeQueueRow(overrides: Partial<QueueRow> = {}): QueueRow {
  const now = new Date();
  const id = `qrow_${Math.random().toString(36).slice(2, 9)}`;
  return {
    id,
    businessId: BUSINESS_ID,
    conversationId: `conv_${Math.random().toString(36).slice(2, 9)}`,
    customerId: `cust_${Math.random().toString(36).slice(2, 9)}`,
    messagePurpose: "booking_confirmation",
    audienceType: "customer",
    channel: "sms",
    messageBody: "Your appointment is confirmed.",
    status: "pending",
    scheduledSendAt: new Date(now.getTime() - 60_000), // 1 min in the past → immediately eligible
    claimToken: null,
    claimedAt: null,
    claimExpiresAt: null,
    sendAttemptCount: 0,
    maxRetryCount: 3,
    nextRetryAt: null,
    lastAttemptAt: null,
    quietHoursDeferredUntil: null,
    invalidatedBy: null,
    terminalFailureReason: null,
    dedupeKey: null,
    recurringServiceId: null,
    providerMessageId: null,
    schedulingJobId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** Reset every engine module's in-memory store. */
function resetAllStores(): void {
  _resetInboundStoreForTest();
  _resetCustomerResolverForTest();
  _resetSuppressionStoreForTest();
  _resetQueueWorkerStoreForTest();
  _resetAdminActionsStoreForTest();
  _resetAIResponseStoreForTest();
}

// ── Test suite ────────────────────────────────────────────────────────────

describe("END-TO-END GAUNTLET", () => {
  beforeEach(() => {
    // Pin clock to 14:00 UTC — well outside any typical quiet-hours window.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T14:00:00.000Z"));

    resetAllStores();

    // Stub Claude: return minimal valid text so ai-response module is happy.
    _setClaudeCallForTest(async () =>
      JSON.stringify({ action: "send_message", body: "Hello from stub Claude" }),
    );

    // Stub Twilio: always succeeds with a fixed provider message ID.
    _setTwilioSendForTest(async (_row) => ({
      success: true,
      providerMessageId: "SM_gauntlet_stub",
    }));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  // ── S01 — New inbound SMS: customer + conversation created, AI queued ─────

  it("S01 — new inbound SMS resolves new customer and queues AI response", async () => {
    const result = await handleInboundMessage({
      businessId: BUSINESS_ID,
      fromContact: "+15550001001",
      contactType: "phone",
      channel: "sms",
      content: "Hi, I need a plumber",
    });

    expect(result.isNewCustomer).toBe(true);
    expect(result.isNewConversation).toBe(true);
    expect(result.aiResponseQueued).toBe(true);
    expect(result.conversationId).toBeTruthy();
    expect(result.customerId).toBeTruthy();
    expect(result.messageId).toBeTruthy();
  });

  // ── S02 — Business paused: inbound allowed but AI response suppressed ─────

  it("S02 — business paused suppresses AI response on inbound", async () => {
    _seedSuppressionBusinessForTest({
      id: BUSINESS_ID,
      isPaused: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "08:00",
      timezone: "America/New_York",
    });

    const result = await handleInboundMessage({
      businessId: BUSINESS_ID,
      fromContact: "+15550001002",
      contactType: "phone",
      channel: "sms",
      content: "Is anyone there?",
    });

    expect(result.aiResponseQueued).toBe(false);
    // Message is still stored; business pause only blocks the AI response.
    expect(result.messageId).toBeTruthy();
  });

  // ── S03 — STOP keyword: customer opted out, AI response blocked ───────────

  it("S03 — STOP keyword opts out customer and blocks AI response", async () => {
    const result = await handleInboundMessage({
      businessId: BUSINESS_ID,
      fromContact: "+15550001003",
      contactType: "phone",
      channel: "sms",
      content: "STOP",
    });

    expect(result.aiResponseQueued).toBe(false);

    const consent = await _getConsentStatusForTest(BUSINESS_ID, "+15550001003");
    expect(consent).toBe("opted_out");
  });

  // ── S04 — Human takeover: subsequent inbound does not queue AI response ───

  it("S04 — human takeover blocks AI response on next inbound message", async () => {
    // First message creates the conversation.
    const first = await handleInboundMessage({
      businessId: BUSINESS_ID,
      fromContact: "+15550001004",
      contactType: "phone",
      channel: "sms",
      content: "I have a leaky pipe",
    });
    expect(first.aiResponseQueued).toBe(true);
    expect(first.conversationId).toBeTruthy();

    // Simulate human takeover by updating the inbound owner map.
    _setConversationOwnerForTest(first.conversationId, "human_takeover");

    // Second message from same number — same conversation, now taken over.
    const second = await handleInboundMessage({
      businessId: BUSINESS_ID,
      fromContact: "+15550001004",
      contactType: "phone",
      channel: "sms",
      content: "Still waiting...",
    });

    expect(second.conversationId).toBe(first.conversationId);
    expect(second.isNewCustomer).toBe(false);
    expect(second.aiResponseQueued).toBe(false);
  });

  // ── S05 — Queue worker delivers a pending customer SMS row ────────────────

  it("S05 — queue worker delivers a pending SMS row via Twilio stub", async () => {
    const rowId = "qrow_s05_fixed";
    _seedQueueRowForTest(makeQueueRow({ id: rowId }));

    const result = await processQueue();

    expect(result.processed).toBe(1);
    expect(result.sent).toBe(1);
    expect(result.suppressed).toBe(0);
    expect(result.failed).toBe(0);

    const row = _getQueueRowForTest(rowId);
    expect(row?.status).toBe("sent");
    expect(row?.providerMessageId).toBe("SM_gauntlet_stub");
  });

  // ── S06 — Queue worker suppresses row for opted-out customer ─────────────

  it("S06 — queue worker cancels row when customer has opted out", async () => {
    const custId = "cust_s06";
    const convId = "conv_s06";

    _seedSuppressionCustomerForTest({
      id: custId,
      businessId: BUSINESS_ID,
      consentStatus: "opted_out",
      doNotContact: false,
    });
    _seedSuppressionConversationForTest({
      id: convId,
      businessId: BUSINESS_ID,
      customerId: custId,
      primaryState: "booked",
      isNoShow: false,
    });

    const rowId = "qrow_s06_fixed";
    _seedQueueRowForTest(
      makeQueueRow({ id: rowId, customerId: custId, conversationId: convId }),
    );

    const result = await processQueue();

    expect(result.suppressed).toBe(1);
    expect(result.sent).toBe(0);
    expect(result.processed).toBe(1);

    const row = _getQueueRowForTest(rowId);
    expect(row?.status).toBe("canceled");
    expect(row?.invalidatedBy).toBe("opted_out");
  });

  // ── S07 — Admin places appointment → conversation transitions to booked ───

  it("S07 — placeAppointment transitions conversation from waiting to booked", async () => {
    const convId = "conv_s07";
    _seedAdminConversationForTest({
      id: convId,
      businessId: BUSINESS_ID,
      primaryState: "waiting_on_admin_scheduling",
      currentOwner: "ai",
    });

    const result = await placeAppointment(ACTOR, {
      conversationId: convId,
      appointmentDate: "2026-04-10",
      appointmentTime: "10:00",
      serviceType: "Plumbing repair",
    });

    expect(result.success).toBe(true);
    expect(result.stateChanged).toBe(true);
    expect(result.newState).toBe("booked");

    const conv = _getAdminConversationForTest(convId);
    expect(conv?.primaryState).toBe("booked");

    const appt = _getAppointmentByConversationForTest(convId);
    expect(appt).toBeTruthy();
    expect(appt?.status).toBe("booked");
    expect(appt?.serviceType).toBe("Plumbing repair");
    expect(appt?.appointmentDate).toBe("2026-04-10");
  });

  // ── S08 — Admin takes over conversation ──────────────────────────────────

  it("S08 — takeOverConversation sets state to human_takeover_active", async () => {
    const convId = "conv_s08";
    _seedAdminConversationForTest({
      id: convId,
      businessId: BUSINESS_ID,
      primaryState: "new_lead",
      currentOwner: "ai",
    });

    const result = await takeOverConversation(ACTOR, { conversationId: convId });

    expect(result.success).toBe(true);
    expect(result.stateChanged).toBe(true);
    expect(result.newState).toBe("human_takeover_active");
    expect(result.notificationsQueued).toContain("human_takeover_summary");

    const conv = _getAdminConversationForTest(convId);
    expect(conv?.primaryState).toBe("human_takeover_active");
    expect(conv?.currentOwner).toBe("human_takeover");
  });

  // ── S09 — Admin returns conversation to AI ────────────────────────────────

  it("S09 — returnToAI restores prior state and sets owner back to ai", async () => {
    const convId = "conv_s09";
    _seedAdminConversationForTest({
      id: convId,
      businessId: BUSINESS_ID,
      primaryState: "human_takeover_active",
      priorState: "new_lead",
      currentOwner: "human_takeover",
    });

    const result = await returnToAI(ACTOR, { conversationId: convId });

    expect(result.success).toBe(true);
    expect(result.stateChanged).toBe(true);
    expect(result.newState).toBe("new_lead");

    const conv = _getAdminConversationForTest(convId);
    expect(conv?.primaryState).toBe("new_lead");
    expect(conv?.currentOwner).toBe("ai");
  });

  // ── S10 — Suppression deduplication blocks a duplicate queue row ──────────

  it("S10 — suppression deduplication cancels row with matching dedupeKey", async () => {
    const convId = "conv_s10";
    const custId = "cust_s10";
    const dedupeKey = "booking_confirmation:conv_s10:2026-04-10:T10:00";

    // Existing row already in flight — seeded into the suppression store.
    _seedSuppressionQueueForTest({
      id: "existing_qrow_s10",
      conversationId: convId,
      businessId: BUSINESS_ID,
      messagePurpose: "booking_confirmation",
      dedupeKey,
      status: "pending",
    });

    // New duplicate row in the queue-worker store.
    const newRowId = "new_qrow_s10_fixed";
    _seedQueueRowForTest(
      makeQueueRow({
        id: newRowId,
        customerId: custId,
        conversationId: convId,
        messagePurpose: "booking_confirmation",
        dedupeKey,
      }),
    );

    const result = await processQueue();

    expect(result.suppressed).toBe(1);
    expect(result.sent).toBe(0);
    expect(result.processed).toBe(1);

    const row = _getQueueRowForTest(newRowId);
    expect(row?.status).toBe("canceled");
    expect(row?.invalidatedBy).toBe("duplicate_dedupe_key");
  });
});
