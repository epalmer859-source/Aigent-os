// ============================================================
// src/engine/admin-actions/__tests__/admin-actions.test.ts
//
// ADMIN ACTION PROCEDURES — UNIT TESTS (Part 1)
// Scheduling, Dispatch, Job Lifecycle
//
// All tests import from "../index" which does NOT exist yet,
// so the entire suite fails to load (all tests are "failing").
//
// Test categories:
//   PA01-PA04  Place appointment
//   RS01-RS02  Reschedule appointment
//   CA01-CA02  Cancel appointment
//   AT01-AT02  Assign technician
//   DR01-DR02  Dispatch (en route / delayed)
//   JL01-JL07  Job lifecycle
//   DM01       Direct message
//   CO01-CO02  Cancel outbound
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";

// ── Module under test (does not exist yet — all tests will fail) ──
import {
  placeAppointment,
  rescheduleAppointment,
  cancelAppointment,
  assignTechnician,
  markEnRoute,
  markDelayed,
  markJobInProgress,
  markJobPaused,
  markJobComplete,
  markNoShow,
  sendDirectMessage,
  cancelPendingOutbound,
  approveQuote,
  reviseQuote,
  confirmParts,
  approveRequest,
  denyRequest,
  takeOverConversation,
  returnToAI,
  resolveConversation,
  resolveEscalation,
  pauseBusiness,
  unpauseBusiness,
  changeUserRole,
  removeUser,
  _resetAdminActionsStoreForTest,
  _seedConversationForTest,
  _seedAppointmentForTest,
  _seedQueueRowForTest,
  _seedQuoteForTest,
  _seedApprovalRecordForTest,
  _seedEscalationForTest,
  _seedBusinessForTest,
  _seedUserForTest,
  _getConversationForTest,
  _getAppointmentForTest,
  _getAppointmentByConversationForTest,
  _getQueueRowForTest,
  _getQueuedPurposesForTest,
  _getEventLogsForTest,
  _getMessageLogsForTest,
  _getQuoteForTest,
  _getApprovalRecordForTest,
  _getEscalationForTest,
  _getBusinessForTest,
  _getUserForTest,
  _getPendingQueueRowsByBusinessForTest,
} from "../index";

// ── Constants from contract ───────────────────────────────────
import {
  type ActorContext,
  CLOSEOUT_BLOCKING_TAGS,
} from "../contract";

// ── Shared constants ──────────────────────────────────────────

const BIZ_ID = "biz_001";
const CONV_ID = "conv_001";
const APPT_ID = "appt_001";

const actor: ActorContext = {
  userId: "user_001",
  role: "admin",
  businessId: BIZ_ID,
};

// ── Seed helpers ──────────────────────────────────────────────

function seedConv(
  primaryState = "waiting_on_admin_scheduling",
  overrides: Record<string, unknown> = {},
): void {
  _seedConversationForTest({
    id: CONV_ID,
    businessId: BIZ_ID,
    primaryState,
    tags: [],
    collectedServiceAddress: null,
    isNoShow: false,
    ...overrides,
  });
}

function seedAppt(overrides: Record<string, unknown> = {}): void {
  _seedAppointmentForTest({
    id: APPT_ID,
    conversationId: CONV_ID,
    businessId: BIZ_ID,
    status: "booked",
    appointmentDate: "2024-07-15",
    appointmentTime: "10:00",
    serviceType: "drain cleaning",
    technicianName: null,
    address: "123 Main St",
    ...overrides,
  });
}

// ── PA: Place appointment ─────────────────────────────────────

describe("PA: Place appointment", () => {
  beforeEach(() => {
    _resetAdminActionsStoreForTest();
    seedConv("waiting_on_admin_scheduling");
  });

  it("PA01: valid state (waiting_on_admin_scheduling) → appointment created, state = booked, booking_confirmation queued", async () => {
    const result = await placeAppointment(actor, {
      conversationId: CONV_ID,
      appointmentDate: "2024-07-20",
      appointmentTime: "09:00",
      serviceType: "drain cleaning",
      address: "456 Oak Ave",
    });

    expect(result.success).toBe(true);
    expect(result.stateChanged).toBe(true);
    expect(result.newState).toBe("booked");
    expect(result.notificationsQueued).toContain("booking_confirmation");
    expect(result.eventLogged).toBe("appointment_marked_booked");

    const conv = _getConversationForTest(CONV_ID);
    expect(conv?.primaryState).toBe("booked");
  });

  it("PA02: invalid state (new_lead) → rejected, nothing changed", async () => {
    _resetAdminActionsStoreForTest();
    seedConv("new_lead");

    const result = await placeAppointment(actor, {
      conversationId: CONV_ID,
      appointmentDate: "2024-07-20",
      appointmentTime: "09:00",
      serviceType: "drain cleaning",
    });

    expect(result.success).toBe(false);
    expect(result.stateChanged).toBe(false);
    expect(result.error).toBeTruthy();

    const conv = _getConversationForTest(CONV_ID);
    expect(conv?.primaryState).toBe("new_lead");
  });

  it("PA03: copies collected_service_address to appointment when admin provides no address", async () => {
    _resetAdminActionsStoreForTest();
    seedConv("waiting_on_admin_scheduling", {
      collectedServiceAddress: "789 Elm Street, Nashville",
    });

    await placeAppointment(actor, {
      conversationId: CONV_ID,
      appointmentDate: "2024-07-20",
      appointmentTime: "09:00",
      serviceType: "pipe repair",
      // no address provided
    });

    const appt = _getAppointmentByConversationForTest(CONV_ID);
    expect(appt?.address).toBe("789 Elm Street, Nashville");
  });

  it("PA04: cancels stale_waiting_internal_ping queue row on appointment placement", async () => {
    _seedQueueRowForTest({
      id: "queue_pa04_stale",
      conversationId: CONV_ID,
      messagePurpose: "stale_waiting_internal_ping",
      status: "pending",
      appointmentId: null,
    });

    await placeAppointment(actor, {
      conversationId: CONV_ID,
      appointmentDate: "2024-07-20",
      appointmentTime: "09:00",
      serviceType: "drain cleaning",
      address: "123 Main St",
    });

    const row = _getQueueRowForTest("queue_pa04_stale");
    expect(row?.status).toBe("canceled");
  });
});

// ── RS: Reschedule ────────────────────────────────────────────

describe("RS: Reschedule appointment", () => {
  beforeEach(() => {
    _resetAdminActionsStoreForTest();
    seedConv("booked");
    seedAppt();
  });

  it("RS01: reschedule → appointment updated, state = booked, reschedule_confirmation queued", async () => {
    const result = await rescheduleAppointment(actor, {
      appointmentId: APPT_ID,
      newDate: "2024-07-22",
      newTime: "14:00",
      reason: "Customer requested different time",
    });

    expect(result.success).toBe(true);
    expect(result.notificationsQueued).toContain("reschedule_confirmation");
    expect(result.eventLogged).toBe("appointment_marked_rescheduled");

    const appt = _getAppointmentForTest(APPT_ID);
    expect(appt?.appointmentDate).toBe("2024-07-22");
    expect(appt?.appointmentTime).toBe("14:00");
  });

  it("RS02: old appointment_reminder rows are canceled on reschedule", async () => {
    _seedQueueRowForTest({
      id: "queue_rs02_24h",
      conversationId: CONV_ID,
      messagePurpose: "appointment_reminder_24h",
      status: "pending",
      appointmentId: APPT_ID,
    });
    _seedQueueRowForTest({
      id: "queue_rs02_3h",
      conversationId: CONV_ID,
      messagePurpose: "appointment_reminder_3h",
      status: "pending",
      appointmentId: APPT_ID,
    });

    await rescheduleAppointment(actor, {
      appointmentId: APPT_ID,
      newDate: "2024-07-22",
      newTime: "14:00",
    });

    expect(_getQueueRowForTest("queue_rs02_24h")?.status).toBe("canceled");
    expect(_getQueueRowForTest("queue_rs02_3h")?.status).toBe("canceled");
  });
});

// ── CA: Cancel appointment ────────────────────────────────────

describe("CA: Cancel appointment", () => {
  beforeEach(() => {
    _resetAdminActionsStoreForTest();
    seedConv("booked");
    seedAppt();
  });

  it("CA01: cancel appointment → status = canceled, cancellation_confirmation queued", async () => {
    const result = await cancelAppointment(actor, {
      appointmentId: APPT_ID,
      reason: "Customer canceled",
    });

    expect(result.success).toBe(true);
    expect(result.notificationsQueued).toContain("cancellation_confirmation");
    expect(result.eventLogged).toBe("appointment_marked_canceled");

    const appt = _getAppointmentForTest(APPT_ID);
    expect(appt?.status).toBe("canceled");
  });

  it("CA02: all appointment_reminder rows for this appointment are canceled", async () => {
    _seedQueueRowForTest({
      id: "queue_ca02_24h",
      conversationId: CONV_ID,
      messagePurpose: "appointment_reminder_24h",
      status: "pending",
      appointmentId: APPT_ID,
    });
    _seedQueueRowForTest({
      id: "queue_ca02_3h",
      conversationId: CONV_ID,
      messagePurpose: "appointment_reminder_3h",
      status: "pending",
      appointmentId: APPT_ID,
    });

    await cancelAppointment(actor, { appointmentId: APPT_ID });

    expect(_getQueueRowForTest("queue_ca02_24h")?.status).toBe("canceled");
    expect(_getQueueRowForTest("queue_ca02_3h")?.status).toBe("canceled");
  });
});

// ── AT: Assign technician ─────────────────────────────────────

describe("AT: Assign technician", () => {
  beforeEach(() => {
    _resetAdminActionsStoreForTest();
  });

  it("AT01: assign from booked → state = tech_assigned, event logged", async () => {
    seedConv("booked");
    seedAppt({ status: "booked", technicianName: null });

    const result = await assignTechnician(actor, {
      appointmentId: APPT_ID,
      technicianName: "Carlos",
    });

    expect(result.success).toBe(true);
    expect(result.stateChanged).toBe(true);
    expect(result.newState).toBe("tech_assigned");
    expect(result.eventLogged).toBe("technician_assigned");

    const conv = _getConversationForTest(CONV_ID);
    expect(conv?.primaryState).toBe("tech_assigned");

    const appt = _getAppointmentForTest(APPT_ID);
    expect(appt?.technicianName).toBe("Carlos");
  });

  it("AT02: assign from tech_assigned → technician updated, state unchanged", async () => {
    seedConv("tech_assigned");
    seedAppt({ status: "booked", technicianName: "Old Tech" });

    const result = await assignTechnician(actor, {
      appointmentId: APPT_ID,
      technicianName: "New Tech",
    });

    expect(result.success).toBe(true);
    expect(result.stateChanged).toBe(false);

    const conv = _getConversationForTest(CONV_ID);
    expect(conv?.primaryState).toBe("tech_assigned");

    const appt = _getAppointmentForTest(APPT_ID);
    expect(appt?.technicianName).toBe("New Tech");
  });
});

// ── DR: Dispatch ──────────────────────────────────────────────

describe("DR: Dispatch", () => {
  beforeEach(() => {
    _resetAdminActionsStoreForTest();
    seedConv("tech_assigned");
    seedAppt();
  });

  it("DR01: mark en route → state = en_route, dispatch_notice queued", async () => {
    const result = await markEnRoute(actor, { appointmentId: APPT_ID });

    expect(result.success).toBe(true);
    expect(result.stateChanged).toBe(true);
    expect(result.newState).toBe("en_route");
    expect(result.notificationsQueued).toContain("dispatch_notice");
    expect(result.eventLogged).toBe("dispatch_marked_en_route");

    const conv = _getConversationForTest(CONV_ID);
    expect(conv?.primaryState).toBe("en_route");
  });

  it("DR02: mark delayed → delay_notice queued, event logged", async () => {
    seedConv("en_route");

    const result = await markDelayed(actor, {
      appointmentId: APPT_ID,
      reason: "Traffic on I-65",
      updatedEta: "11:30",
    });

    expect(result.success).toBe(true);
    expect(result.notificationsQueued).toContain("delay_notice");
    expect(result.eventLogged).toBe("dispatch_marked_delayed");
  });
});

// ── JL: Job lifecycle ─────────────────────────────────────────

describe("JL: Job lifecycle", () => {
  beforeEach(() => {
    _resetAdminActionsStoreForTest();
  });

  it("JL01: mark in progress → state = job_in_progress", async () => {
    seedConv("en_route");
    seedAppt();

    const result = await markJobInProgress(actor, { appointmentId: APPT_ID });

    expect(result.success).toBe(true);
    expect(result.newState).toBe("job_in_progress");
    expect(result.eventLogged).toBe("job_marked_in_progress");

    const conv = _getConversationForTest(CONV_ID);
    expect(conv?.primaryState).toBe("job_in_progress");
  });

  it("JL02: mark paused → state = job_paused", async () => {
    seedConv("job_in_progress");
    seedAppt();

    const result = await markJobPaused(actor, {
      appointmentId: APPT_ID,
      reason: "Waiting on parts",
    });

    expect(result.success).toBe(true);
    expect(result.newState).toBe("job_paused");
    expect(result.eventLogged).toBe("job_marked_paused");

    const conv = _getConversationForTest(CONV_ID);
    expect(conv?.primaryState).toBe("job_paused");
  });

  it("JL03: mark complete → state = job_completed, closeout queued (no blocking tags)", async () => {
    seedConv("job_in_progress", { tags: [] });
    seedAppt();

    const result = await markJobComplete(actor, { appointmentId: APPT_ID });

    expect(result.success).toBe(true);
    expect(result.newState).toBe("job_completed");
    expect(result.notificationsQueued).toContain("closeout");
    expect(result.notificationsQueued).toContain("payment_management_ready");
    expect(result.eventLogged).toBe("job_marked_complete");
  });

  it("JL04: mark complete with negative_service_signal tag → closeout NOT queued", async () => {
    seedConv("job_in_progress", { tags: [CLOSEOUT_BLOCKING_TAGS[0]] });
    seedAppt();

    const result = await markJobComplete(actor, { appointmentId: APPT_ID });

    expect(result.success).toBe(true);
    expect(result.newState).toBe("job_completed");
    expect(result.notificationsQueued).not.toContain("closeout");
    // payment_management_ready is still queued regardless of tags
    expect(result.notificationsQueued).toContain("payment_management_ready");
  });

  it("JL05: mark no-show from booked → is_no_show = true, state = resolved, all pending outbound canceled", async () => {
    seedConv("booked");
    seedAppt({ status: "booked" });
    _seedQueueRowForTest({
      id: "queue_jl05_a",
      conversationId: CONV_ID,
      messagePurpose: "appointment_reminder_24h",
      status: "pending",
      appointmentId: APPT_ID,
    });
    _seedQueueRowForTest({
      id: "queue_jl05_b",
      conversationId: CONV_ID,
      messagePurpose: "routine_followup_1",
      status: "pending",
      appointmentId: null,
    });

    const result = await markNoShow(actor, { appointmentId: APPT_ID });

    expect(result.success).toBe(true);
    expect(result.newState).toBe("resolved");
    expect(result.eventLogged).toBe("appointment_marked_no_show");

    const conv = _getConversationForTest(CONV_ID);
    expect(conv?.primaryState).toBe("resolved");
    expect(conv?.isNoShow).toBe(true);

    const appt = _getAppointmentForTest(APPT_ID);
    expect(appt?.status).toBe("no_show");

    expect(_getQueueRowForTest("queue_jl05_a")?.status).toBe("canceled");
    expect(_getQueueRowForTest("queue_jl05_b")?.status).toBe("canceled");
  });

  it("JL06: mark no-show from new_lead → rejected (invalid state)", async () => {
    seedConv("new_lead");
    seedAppt({ status: "booked" });

    const result = await markNoShow(actor, { appointmentId: APPT_ID });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();

    const conv = _getConversationForTest(CONV_ID);
    expect(conv?.primaryState).toBe("new_lead");
  });

  it("JL07: mark no-show from en_route → valid, state = resolved", async () => {
    seedConv("en_route");
    seedAppt({ status: "booked" });

    const result = await markNoShow(actor, { appointmentId: APPT_ID });

    expect(result.success).toBe(true);
    expect(result.newState).toBe("resolved");

    const conv = _getConversationForTest(CONV_ID);
    expect(conv?.primaryState).toBe("resolved");
  });
});

// ── DM: Direct message ────────────────────────────────────────

describe("DM: Direct message", () => {
  beforeEach(() => {
    _resetAdminActionsStoreForTest();
    seedConv("lead_qualified");
  });

  it("DM01: send direct message → message_log created, admin_response_relay queued, state unchanged", async () => {
    const result = await sendDirectMessage(actor, {
      conversationId: CONV_ID,
      content: "Hi John, just checking in on your request!",
    });

    expect(result.success).toBe(true);
    expect(result.stateChanged).toBe(false);
    expect(result.notificationsQueued).toContain("admin_response_relay");

    const conv = _getConversationForTest(CONV_ID);
    expect(conv?.primaryState).toBe("lead_qualified");

    const messages = _getMessageLogsForTest(CONV_ID);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.content === "Hi John, just checking in on your request!")).toBe(true);
  });
});

// ── CO: Cancel outbound ───────────────────────────────────────

describe("CO: Cancel outbound", () => {
  beforeEach(() => {
    _resetAdminActionsStoreForTest();
    seedConv("lead_qualified");
  });

  it("CO01: cancel pending queue row → status = canceled", async () => {
    _seedQueueRowForTest({
      id: "queue_co01",
      conversationId: CONV_ID,
      messagePurpose: "routine_followup_1",
      status: "pending",
      appointmentId: null,
    });

    const result = await cancelPendingOutbound(actor, { queueRowId: "queue_co01" });

    expect(result.success).toBe(true);
    expect(result.eventLogged).toBe("outbound_message_canceled_by_admin");

    const row = _getQueueRowForTest("queue_co01");
    expect(row?.status).toBe("canceled");
  });

  it("CO02: cancel already-sent row → rejected", async () => {
    _seedQueueRowForTest({
      id: "queue_co02",
      conversationId: CONV_ID,
      messagePurpose: "routine_followup_1",
      status: "sent",
      appointmentId: null,
    });

    const result = await cancelPendingOutbound(actor, { queueRowId: "queue_co02" });

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();

    const row = _getQueueRowForTest("queue_co02");
    expect(row?.status).toBe("sent");
  });
});

// ── QT: Quotes ────────────────────────────────────────────────

describe("QT: Quotes", () => {
  beforeEach(() => {
    _resetAdminActionsStoreForTest();
    seedConv("waiting_on_admin_quote");
    _seedQuoteForTest({
      id: "quote_001",
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      status: "pending_approval",
      amount: 350,
      terms: null,
    });
  });

  it("QT01: approve quote → quote status = approved_to_send, state = quote_sent, quote_delivery queued", async () => {
    const result = await approveQuote(actor, {
      quoteId: "quote_001",
      approvedAmount: 350,
      approvedTerms: "Net 30",
    });

    expect(result.success).toBe(true);
    expect(result.newState).toBe("quote_sent");
    expect(result.notificationsQueued).toContain("quote_delivery");
    expect(result.eventLogged).toBe("admin_quote_approved");

    const quote = _getQuoteForTest("quote_001");
    expect(quote?.status).toBe("approved_to_send");

    const conv = _getConversationForTest(CONV_ID);
    expect(conv?.primaryState).toBe("quote_sent");
  });

  it("QT02: approve quote cancels all pending quote_followup rows for the conversation", async () => {
    _seedQueueRowForTest({
      id: "queue_qt02_f1",
      conversationId: CONV_ID,
      messagePurpose: "quote_followup_1",
      status: "pending",
      appointmentId: null,
    });
    _seedQueueRowForTest({
      id: "queue_qt02_ff",
      conversationId: CONV_ID,
      messagePurpose: "quote_followup_final",
      status: "pending",
      appointmentId: null,
    });

    await approveQuote(actor, { quoteId: "quote_001", approvedAmount: 350 });

    expect(_getQueueRowForTest("queue_qt02_f1")?.status).toBe("canceled");
    expect(_getQueueRowForTest("queue_qt02_ff")?.status).toBe("canceled");
  });

  it("QT03: revise quote → old quote superseded, new quote created, quote_delivery queued", async () => {
    const result = await reviseQuote(actor, {
      oldQuoteId: "quote_001",
      newAmount: 420,
      newTerms: "Due on completion",
      reason: "Scope increased after site visit",
    });

    expect(result.success).toBe(true);
    expect(result.notificationsQueued).toContain("quote_delivery");
    expect(result.eventLogged).toBe("quote_revised");

    const oldQuote = _getQuoteForTest("quote_001");
    expect(oldQuote?.status).toBe("superseded");
  });
});

// ── PT: Parts ─────────────────────────────────────────────────

describe("PT: Parts", () => {
  beforeEach(() => {
    _resetAdminActionsStoreForTest();
    seedConv("waiting_on_parts_confirmation");
  });

  it("PT01: confirm parts → parts record updated, admin_response_relay queued, event logged", async () => {
    _seedQueueRowForTest({
      id: "queue_pt01_ping",
      conversationId: CONV_ID,
      messagePurpose: "stale_waiting_internal_ping",
      status: "pending",
      appointmentId: null,
    });

    const result = await confirmParts(actor, {
      partsInquiryId: "parts_001",
      confirmedStatus: "in_stock",
      confirmedPrice: 89.99,
      confirmedEta: "2024-07-18",
    });

    expect(result.success).toBe(true);
    expect(result.notificationsQueued).toContain("admin_response_relay");
    expect(result.eventLogged).toBe("parts_confirmed");
  });
});

// ── AP: Approvals ─────────────────────────────────────────────

describe("AP: Approvals", () => {
  beforeEach(() => {
    _resetAdminActionsStoreForTest();
    seedConv("waiting_on_approval", { priorState: "lead_qualified" });
    _seedApprovalRecordForTest({
      id: "approval_001",
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      status: "pending",
      priorState: "lead_qualified",
    });
  });

  it("AP01: approve request → status = approved, state returns to prior state, admin_response_relay queued", async () => {
    const result = await approveRequest(actor, {
      approvalRecordId: "approval_001",
      notes: "Confirmed in-area job",
    });

    expect(result.success).toBe(true);
    expect(result.notificationsQueued).toContain("admin_response_relay");
    expect(result.eventLogged).toBe("approval_record_approved");

    const approval = _getApprovalRecordForTest("approval_001");
    expect(approval?.status).toBe("approved");

    const conv = _getConversationForTest(CONV_ID);
    expect(conv?.primaryState).toBe("lead_qualified");
  });

  it("AP02: deny request → status = denied, state = closed_unqualified, admin_response_relay queued", async () => {
    const result = await denyRequest(actor, {
      approvalRecordId: "approval_001",
      reason: "Out of service area",
    });

    expect(result.success).toBe(true);
    expect(result.newState).toBe("closed_unqualified");
    expect(result.notificationsQueued).toContain("admin_response_relay");
    expect(result.eventLogged).toBe("approval_record_denied");

    const approval = _getApprovalRecordForTest("approval_001");
    expect(approval?.status).toBe("denied");

    const conv = _getConversationForTest(CONV_ID);
    expect(conv?.primaryState).toBe("closed_unqualified");
  });
});

// ── TC: Thread control ────────────────────────────────────────

describe("TC: Thread control", () => {
  beforeEach(() => {
    _resetAdminActionsStoreForTest();
    seedConv("lead_qualified", { priorState: null });
  });

  it("TC01: take over → state = human_takeover_active, all pending AI outbound canceled, human_takeover_summary queued", async () => {
    _seedQueueRowForTest({
      id: "queue_tc01_ai",
      conversationId: CONV_ID,
      messagePurpose: "routine_followup_1",
      status: "pending",
      appointmentId: null,
    });

    const result = await takeOverConversation(actor, { conversationId: CONV_ID });

    expect(result.success).toBe(true);
    expect(result.newState).toBe("human_takeover_active");
    expect(result.notificationsQueued).toContain("human_takeover_summary");
    expect(result.eventLogged).toBe("human_takeover_enabled");

    expect(_getQueueRowForTest("queue_tc01_ai")?.status).toBe("canceled");
  });

  it("TC02: take over preserves prior_state", async () => {
    await takeOverConversation(actor, { conversationId: CONV_ID });

    const conv = _getConversationForTest(CONV_ID);
    expect(conv?.primaryState).toBe("human_takeover_active");
    expect(conv?.priorState).toBe("lead_qualified");
  });

  it("TC03: return to AI → state restored to prior_state, current_owner = ai", async () => {
    // First take over
    seedConv("human_takeover_active", { priorState: "lead_qualified" });

    const result = await returnToAI(actor, { conversationId: CONV_ID });

    expect(result.success).toBe(true);
    expect(result.newState).toBe("lead_qualified");
    expect(result.eventLogged).toBe("human_takeover_disabled");

    const conv = _getConversationForTest(CONV_ID);
    expect(conv?.primaryState).toBe("lead_qualified");
    expect(conv?.currentOwner).toBe("ai");
  });

  it("TC04: return to AI with explicit returnToState → uses that state instead of prior_state", async () => {
    seedConv("human_takeover_active", { priorState: "lead_qualified" });

    const result = await returnToAI(actor, {
      conversationId: CONV_ID,
      returnToState: "booking_in_progress",
    });

    expect(result.success).toBe(true);
    expect(result.newState).toBe("booking_in_progress");

    const conv = _getConversationForTest(CONV_ID);
    expect(conv?.primaryState).toBe("booking_in_progress");
  });

  it("TC05: resolve conversation → state = resolved, all pending outbound canceled", async () => {
    _seedQueueRowForTest({
      id: "queue_tc05_a",
      conversationId: CONV_ID,
      messagePurpose: "routine_followup_1",
      status: "pending",
      appointmentId: null,
    });
    _seedQueueRowForTest({
      id: "queue_tc05_b",
      conversationId: CONV_ID,
      messagePurpose: "booking_confirmation",
      status: "pending",
      appointmentId: null,
    });

    const result = await resolveConversation(actor, {
      conversationId: CONV_ID,
      note: "Issue resolved over phone",
    });

    expect(result.success).toBe(true);
    expect(result.newState).toBe("resolved");
    expect(result.eventLogged).toBe("conversation_resolved");

    expect(_getQueueRowForTest("queue_tc05_a")?.status).toBe("canceled");
    expect(_getQueueRowForTest("queue_tc05_b")?.status).toBe("canceled");
  });
});

// ── ES: Escalation ────────────────────────────────────────────

describe("ES: Escalation", () => {
  beforeEach(() => {
    _resetAdminActionsStoreForTest();
    seedConv("complaint_open");
    _seedEscalationForTest({
      id: "escalation_001",
      conversationId: CONV_ID,
      businessId: BIZ_ID,
      status: "open",
    });
  });

  it("ES01: resolve escalation → escalation record resolved, state = admin's chosen nextState", async () => {
    const result = await resolveEscalation(actor, {
      escalationId: "escalation_001",
      note: "Customer accepted resolution",
      nextState: "job_completed",
    });

    expect(result.success).toBe(true);
    expect(result.newState).toBe("job_completed");
    expect(result.eventLogged).toBe("escalation_resolved");

    const escalation = _getEscalationForTest("escalation_001");
    expect(escalation?.status).toBe("resolved");

    const conv = _getConversationForTest(CONV_ID);
    expect(conv?.primaryState).toBe("job_completed");
  });
});

// ── BP: Business pause ────────────────────────────────────────

describe("BP: Business pause", () => {
  const ownerActor: ActorContext = { userId: "owner_001", role: "owner", businessId: BIZ_ID };
  const adminActor: ActorContext = { userId: "admin_001", role: "admin", businessId: BIZ_ID };

  beforeEach(() => {
    _resetAdminActionsStoreForTest();
    _seedBusinessForTest({
      id: BIZ_ID,
      isPaused: false,
    });
    // Seed non-urgent pending queue rows across conversations
    _seedConversationForTest({ id: "conv_bp_1", businessId: BIZ_ID, primaryState: "new_lead", tags: [], collectedServiceAddress: null, isNoShow: false });
    _seedConversationForTest({ id: "conv_bp_2", businessId: BIZ_ID, primaryState: "lead_qualified", tags: [], collectedServiceAddress: null, isNoShow: false });
    _seedQueueRowForTest({ id: "queue_bp_routine", conversationId: "conv_bp_1", messagePurpose: "routine_followup_1", status: "pending", appointmentId: null });
    _seedQueueRowForTest({ id: "queue_bp_urgent", conversationId: "conv_bp_2", messagePurpose: "dispatch_notice", status: "pending", appointmentId: null });
  });

  it("BP01: owner pauses business → is_paused = true, all non-urgent pending outbound canceled", async () => {
    const result = await pauseBusiness(ownerActor, { pauseMessage: "Out sick today" });

    expect(result.success).toBe(true);
    expect(result.eventLogged).toBe("business_paused");

    const biz = _getBusinessForTest(BIZ_ID);
    expect(biz?.isPaused).toBe(true);

    // Non-urgent row canceled
    expect(_getQueueRowForTest("queue_bp_routine")?.status).toBe("canceled");
    // Urgent row preserved
    expect(_getQueueRowForTest("queue_bp_urgent")?.status).toBe("pending");
  });

  it("BP02: admin tries to pause → rejected (owner only)", async () => {
    const result = await pauseBusiness(adminActor, {});

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/owner|permission|unauthorized/i);

    const biz = _getBusinessForTest(BIZ_ID);
    expect(biz?.isPaused).toBe(false);
  });

  it("BP03: owner unpauses business → is_paused = false", async () => {
    // First pause
    await pauseBusiness(ownerActor, {});

    const result = await unpauseBusiness(ownerActor);

    expect(result.success).toBe(true);
    expect(result.eventLogged).toBe("business_unpaused");

    const biz = _getBusinessForTest(BIZ_ID);
    expect(biz?.isPaused).toBe(false);
  });
});

// ── TM: Team management ───────────────────────────────────────

describe("TM: Team management", () => {
  const ownerActor: ActorContext = { userId: "owner_001", role: "owner", businessId: BIZ_ID };

  beforeEach(() => {
    _resetAdminActionsStoreForTest();
    _seedBusinessForTest({ id: BIZ_ID, isPaused: false });
    _seedUserForTest({ id: "owner_001", businessId: BIZ_ID, role: "owner" });
    _seedUserForTest({ id: "owner_002", businessId: BIZ_ID, role: "owner" });
    _seedUserForTest({ id: "admin_001", businessId: BIZ_ID, role: "admin" });
  });

  it("TM01: owner changes admin to owner → role updated", async () => {
    const result = await changeUserRole(ownerActor, {
      targetUserId: "admin_001",
      newRole: "owner",
    });

    expect(result.success).toBe(true);
    expect(result.eventLogged).toBe("user_role_changed");

    const user = _getUserForTest("admin_001");
    expect(user?.role).toBe("owner");
  });

  it("TM02: owner tries to demote last owner → rejected", async () => {
    // Remove second owner first so only one remains
    _resetAdminActionsStoreForTest();
    _seedBusinessForTest({ id: BIZ_ID, isPaused: false });
    _seedUserForTest({ id: "owner_001", businessId: BIZ_ID, role: "owner" });
    _seedUserForTest({ id: "admin_001", businessId: BIZ_ID, role: "admin" });

    const result = await changeUserRole(ownerActor, {
      targetUserId: "owner_001",
      newRole: "admin",
    });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/last owner|cannot demote/i);

    const user = _getUserForTest("owner_001");
    expect(user?.role).toBe("owner");
  });

  it("TM03: owner removes admin → user businessId = null", async () => {
    const result = await removeUser(ownerActor, { targetUserId: "admin_001" });

    expect(result.success).toBe(true);
    expect(result.eventLogged).toBe("user_removed");

    const user = _getUserForTest("admin_001");
    expect(user?.businessId).toBeNull();
  });

  it("TM04: owner tries to remove self → rejected", async () => {
    const result = await removeUser(ownerActor, { targetUserId: "owner_001" });

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/yourself|self|cannot remove/i);

    const user = _getUserForTest("owner_001");
    expect(user?.businessId).toBe(BIZ_ID);
  });
});
