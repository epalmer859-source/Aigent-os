// ============================================================
// src/engine/admin-actions/contract.ts
//
// ADMIN ACTION PROCEDURES — CONTRACT (Part 1)
// Scheduling, Dispatch, Job Lifecycle
//
// Exports ONLY types and constants. Zero logic.
//
// Admin actions are tRPC mutations that power every button on
// the dashboard. Each action:
//   1. Enforces role permissions (owner vs admin).
//   2. Validates the conversation is in the correct state.
//   3. Executes side effects (state change, queue rows, events).
//   4. Returns a structured AdminActionResult for audit.
//
// Blueprint source: Doc 11 Part 2 — Admin Action Contract
// ============================================================

// ── Core result type ──────────────────────────────────────────

export interface AdminActionResult {
  success: boolean;
  /** Action name for audit trail. */
  action: string;
  /** Conversation ID affected, when applicable. */
  conversationId?: string;
  /** Whether the conversation's primary state changed. */
  stateChanged: boolean;
  /** The new state if stateChanged = true. */
  newState?: string;
  /** Message purposes of new outbound_queue rows created. */
  notificationsQueued: string[];
  /** Number of outbound_queue rows set to canceled. */
  queueRowsCanceled: number;
  /** event_code of the conversation_event row created. Empty string when no event logged. */
  eventLogged: string;
  /** Human-readable error description on failure. */
  error?: string;
}

// ── Actor context ─────────────────────────────────────────────

export interface ActorContext {
  userId: string;
  role: "owner" | "admin";
  businessId: string;
}

// ── Action param types ────────────────────────────────────────

export interface PlaceAppointmentParams {
  conversationId: string;
  /** ISO date string, e.g. "2024-07-15". */
  appointmentDate: string;
  /** 24-hour time string, e.g. "10:00". */
  appointmentTime: string;
  serviceType: string;
  technicianName?: string;
  /** Service address. If omitted, copied from conversation.collected_service_address. */
  address?: string;
  notes?: string;
}

export interface RescheduleAppointmentParams {
  appointmentId: string;
  newDate: string;
  newTime: string;
  reason?: string;
}

export interface CancelAppointmentParams {
  appointmentId: string;
  reason?: string;
}

export interface AssignTechnicianParams {
  appointmentId: string;
  technicianName: string;
}

export interface MarkEnRouteParams {
  appointmentId: string;
}

export interface MarkDelayedParams {
  appointmentId: string;
  reason?: string;
  updatedEta?: string;
}

export interface MarkJobInProgressParams {
  appointmentId: string;
}

export interface MarkJobPausedParams {
  appointmentId: string;
  reason: string;
}

export interface MarkJobCompleteParams {
  appointmentId: string;
}

export interface MarkNoShowParams {
  appointmentId: string;
}

export interface SendDirectMessageParams {
  conversationId: string;
  content: string;
}

export interface CancelPendingOutboundParams {
  queueRowId: string;
}

// ── Function signatures ───────────────────────────────────────

/**
 * Create an appointment and transition conversation to booked.
 * Valid from: waiting_on_admin_scheduling, reschedule_in_progress.
 * Queues: booking_confirmation.
 * Cancels: stale_waiting_internal_ping for scheduling, routine_followup rows.
 * Event: appointment_marked_booked.
 */
export type PlaceAppointmentFn = (
  actor: ActorContext,
  params: PlaceAppointmentParams,
) => Promise<AdminActionResult>;

/**
 * Update an existing appointment's date/time.
 * Transitions conversation state to booked.
 * Queues: reschedule_confirmation.
 * Cancels: existing appointment_reminder rows; new ones created.
 * Event: appointment_marked_rescheduled.
 */
export type RescheduleAppointmentFn = (
  actor: ActorContext,
  params: RescheduleAppointmentParams,
) => Promise<AdminActionResult>;

/**
 * Cancel an appointment.
 * Appointment status → canceled.
 * Queues: cancellation_confirmation.
 * Cancels: all appointment_reminder rows for this appointment.
 * Event: appointment_marked_canceled.
 */
export type CancelAppointmentFn = (
  actor: ActorContext,
  params: CancelAppointmentParams,
) => Promise<AdminActionResult>;

/**
 * Assign a technician to an appointment.
 * Transitions state to tech_assigned if currently booked.
 * State unchanged if already tech_assigned (technician updated only).
 * Event: technician_assigned.
 */
export type AssignTechnicianFn = (
  actor: ActorContext,
  params: AssignTechnicianParams,
) => Promise<AdminActionResult>;

/**
 * Mark a technician as en route.
 * State → en_route.
 * Queues: dispatch_notice (urgent — exempt from quiet hours and 24h cap).
 * Event: dispatch_marked_en_route.
 */
export type MarkEnRouteFn = (
  actor: ActorContext,
  params: MarkEnRouteParams,
) => Promise<AdminActionResult>;

/**
 * Notify customer of a delay.
 * No state change.
 * Queues: delay_notice (urgent — exempt from quiet hours and 24h cap).
 * Event: dispatch_marked_delayed.
 */
export type MarkDelayedFn = (
  actor: ActorContext,
  params: MarkDelayedParams,
) => Promise<AdminActionResult>;

/**
 * Mark job as in progress.
 * State → job_in_progress.
 * Event: job_marked_in_progress.
 */
export type MarkJobInProgressFn = (
  actor: ActorContext,
  params: MarkJobInProgressParams,
) => Promise<AdminActionResult>;

/**
 * Mark job as paused.
 * State → job_paused.
 * Event: job_marked_paused.
 */
export type MarkJobPausedFn = (
  actor: ActorContext,
  params: MarkJobPausedParams,
) => Promise<AdminActionResult>;

/**
 * Mark job as complete.
 * State → job_completed.
 * Queues: closeout (unless conversation has a blocking tag:
 *   negative_service_signal, closeout_blocked, do_not_contact).
 * Queues: payment_management_ready (internal, always).
 * Event: job_marked_complete.
 */
export type MarkJobCompleteFn = (
  actor: ActorContext,
  params: MarkJobCompleteParams,
) => Promise<AdminActionResult>;

/**
 * Mark appointment as no-show.
 * Valid from: booked, tech_assigned, en_route.
 * Appointment status → no_show.
 * Conversation.is_no_show → true.
 * State → resolved.
 * Cancels: ALL pending outbound for this conversation.
 * Event: appointment_marked_no_show.
 */
export type MarkNoShowFn = (
  actor: ActorContext,
  params: MarkNoShowParams,
) => Promise<AdminActionResult>;

/**
 * Send a direct message from admin/owner to the customer.
 * Creates message_log row (direction: outbound, sender_type: actor.role).
 * Queues: admin_response_relay.
 * Does NOT change conversation state.
 * No event logged (message_log is the audit record).
 */
export type SendDirectMessageFn = (
  actor: ActorContext,
  params: SendDirectMessageParams,
) => Promise<AdminActionResult>;

/**
 * Cancel a specific pending outbound_queue row.
 * Only works on rows with status = "pending" or "deferred".
 * Rejected if row is already sent, canceled, or failed.
 * Event: outbound_message_canceled_by_admin.
 */
export type CancelPendingOutboundFn = (
  actor: ActorContext,
  params: CancelPendingOutboundParams,
) => Promise<AdminActionResult>;

// ── Valid states for no-show ──────────────────────────────────

/**
 * Conversation must be in one of these states for markNoShow to proceed.
 */
export const NO_SHOW_VALID_STATES = [
  "booked",
  "tech_assigned",
  "en_route",
] as const;

/**
 * Conversation must be in one of these states for placeAppointment to proceed.
 */
export const PLACE_APPOINTMENT_VALID_STATES = [
  "waiting_on_admin_scheduling",
  "reschedule_in_progress",
] as const;

/**
 * Conversation tags that block the closeout message when marking a job complete.
 */
export const CLOSEOUT_BLOCKING_TAGS = [
  "negative_service_signal",
  "closeout_blocked",
  "do_not_contact",
] as const;

// ── Action name constants ─────────────────────────────────────

export const ACTION_PLACE_APPOINTMENT = "place_appointment";
export const ACTION_RESCHEDULE_APPOINTMENT = "reschedule_appointment";
export const ACTION_CANCEL_APPOINTMENT = "cancel_appointment";
export const ACTION_ASSIGN_TECHNICIAN = "assign_technician";
export const ACTION_MARK_EN_ROUTE = "mark_en_route";
export const ACTION_MARK_DELAYED = "mark_delayed";
export const ACTION_MARK_JOB_IN_PROGRESS = "mark_job_in_progress";
export const ACTION_MARK_JOB_PAUSED = "mark_job_paused";
export const ACTION_MARK_JOB_COMPLETE = "mark_job_complete";
export const ACTION_MARK_NO_SHOW = "mark_no_show";
export const ACTION_SEND_DIRECT_MESSAGE = "send_direct_message";
export const ACTION_CANCEL_PENDING_OUTBOUND = "cancel_pending_outbound";

// ── Part 2 param types ────────────────────────────────────────

export interface ApproveQuoteParams {
  quoteId: string;
  approvedAmount: number;
  approvedTerms?: string;
  notes?: string;
}

export interface ReviseQuoteParams {
  oldQuoteId: string;
  newAmount: number;
  newTerms?: string;
  reason?: string;
}

export interface ConfirmPartsParams {
  partsInquiryId: string;
  confirmedStatus: string;
  confirmedPrice?: number;
  confirmedEta?: string;
}

export interface ApproveRequestParams {
  approvalRecordId: string;
  notes?: string;
}

export interface DenyRequestParams {
  approvalRecordId: string;
  reason: string;
}

export interface TakeOverConversationParams {
  conversationId: string;
}

export interface ReturnToAIParams {
  conversationId: string;
  /** If provided, transition to this state instead of prior_state. */
  returnToState?: string;
}

export interface ResolveConversationParams {
  conversationId: string;
  note?: string;
}

export interface ResolveEscalationParams {
  escalationId: string;
  note: string;
  /** Admin-chosen state to transition to after resolving the escalation. */
  nextState: string;
}

export interface PauseBusinessParams {
  pauseMessage?: string;
}

export interface ChangeUserRoleParams {
  targetUserId: string;
  newRole: "owner" | "admin";
}

export interface RemoveUserParams {
  targetUserId: string;
}

// ── Part 2 function signatures ────────────────────────────────

/**
 * Approve a quote and send it to the customer.
 * Quote status → approved_to_send. State → quote_sent.
 * Queues: quote_delivery.
 * Cancels: stale_waiting_internal_ping for quote dependency,
 *   ALL pending quote_followup_1/final for this conversation.
 * Event: admin_quote_approved.
 */
export type ApproveQuoteFn = (
  actor: ActorContext,
  params: ApproveQuoteParams,
) => Promise<AdminActionResult>;

/**
 * Revise a quote: supersede the old one and create a new approved quote.
 * Old quote status → superseded. New quote created: status = approved_to_send.
 * State → quote_sent. Queues: quote_delivery for new quote.
 * Cancels: ALL pending quote_followup_1/final for this conversation.
 * Event: quote_revised.
 */
export type ReviseQuoteFn = (
  actor: ActorContext,
  params: ReviseQuoteParams,
) => Promise<AdminActionResult>;

/**
 * Confirm parts availability/pricing for a parts inquiry.
 * Parts record updated. Queues: admin_response_relay.
 * Cancels: stale_waiting pings for parts dependency.
 * Event: parts_confirmed.
 */
export type ConfirmPartsFn = (
  actor: ActorContext,
  params: ConfirmPartsParams,
) => Promise<AdminActionResult>;

/**
 * Approve a pending approval request (e.g. out-of-area job).
 * Approval status → approved. State returns to prior state or new_lead.
 * Queues: admin_response_relay.
 * Cancels: stale_waiting_internal_ping for approval dependency.
 * Event: approval_record_approved.
 */
export type ApproveRequestFn = (
  actor: ActorContext,
  params: ApproveRequestParams,
) => Promise<AdminActionResult>;

/**
 * Deny a pending approval request.
 * Approval status → denied. State → closed_unqualified.
 * Queues: admin_response_relay.
 * Cancels: stale_waiting_internal_ping for approval dependency.
 * Event: approval_record_denied.
 */
export type DenyRequestFn = (
  actor: ActorContext,
  params: DenyRequestParams,
) => Promise<AdminActionResult>;

/**
 * Admin/owner takes manual control of a conversation.
 * State → human_takeover_active. prior_state preserved.
 * current_owner → human_takeover.
 * Queues: human_takeover_summary (internal).
 * Cancels: ALL pending AI-generated outbound for this conversation.
 * Event: human_takeover_enabled.
 */
export type TakeOverConversationFn = (
  actor: ActorContext,
  params: TakeOverConversationParams,
) => Promise<AdminActionResult>;

/**
 * Return a conversation from human takeover back to AI control.
 * State → prior_state (or params.returnToState if provided).
 * current_owner → ai.
 * Event: human_takeover_disabled.
 */
export type ReturnToAIFn = (
  actor: ActorContext,
  params: ReturnToAIParams,
) => Promise<AdminActionResult>;

/**
 * Mark a conversation as resolved and clean up pending outbound.
 * State → resolved.
 * Cancels: ALL pending outbound for this conversation.
 * Event: conversation_resolved.
 */
export type ResolveConversationFn = (
  actor: ActorContext,
  params: ResolveConversationParams,
) => Promise<AdminActionResult>;

/**
 * Resolve an active escalation record and choose the next conversation state.
 * Escalation record → resolved. State → nextState (admin's choice).
 * Event: escalation_resolved.
 */
export type ResolveEscalationFn = (
  actor: ActorContext,
  params: ResolveEscalationParams,
) => Promise<AdminActionResult>;

/**
 * Owner-only. Pause all outgoing AI messages for the business.
 * businesses.is_paused → true.
 * Cancels: ALL pending non-urgent outbound across ALL conversations for this business.
 * Event: business_paused.
 */
export type PauseBusinessFn = (
  actor: ActorContext,
  params: PauseBusinessParams,
) => Promise<AdminActionResult>;

/**
 * Owner-only. Resume AI messaging for the business.
 * businesses.is_paused → false.
 * Event: business_unpaused.
 */
export type UnpauseBusinessFn = (actor: ActorContext) => Promise<AdminActionResult>;

/**
 * Owner-only. Change a team member's role.
 * Cannot demote the last remaining owner.
 * Event: user_role_changed.
 */
export type ChangeUserRoleFn = (
  actor: ActorContext,
  params: ChangeUserRoleParams,
) => Promise<AdminActionResult>;

/**
 * Owner-only. Remove a team member from the business.
 * Cannot remove the last remaining owner.
 * Cannot remove yourself.
 * Event: user_removed.
 */
export type RemoveUserFn = (
  actor: ActorContext,
  params: RemoveUserParams,
) => Promise<AdminActionResult>;

// ── Part 2 action name constants ──────────────────────────────

export const ACTION_APPROVE_QUOTE = "approve_quote";
export const ACTION_REVISE_QUOTE = "revise_quote";
export const ACTION_CONFIRM_PARTS = "confirm_parts";
export const ACTION_APPROVE_REQUEST = "approve_request";
export const ACTION_DENY_REQUEST = "deny_request";
export const ACTION_TAKE_OVER_CONVERSATION = "take_over_conversation";
export const ACTION_RETURN_TO_AI = "return_to_ai";
export const ACTION_RESOLVE_CONVERSATION = "resolve_conversation";
export const ACTION_RESOLVE_ESCALATION = "resolve_escalation";
export const ACTION_PAUSE_BUSINESS = "pause_business";
export const ACTION_UNPAUSE_BUSINESS = "unpause_business";
export const ACTION_CHANGE_USER_ROLE = "change_user_role";
export const ACTION_REMOVE_USER = "remove_user";

/**
 * Urgent message purposes exempt from business-pause cancellation.
 * These are never canceled when a business is paused.
 */
export const URGENT_PURPOSES_EXEMPT_FROM_PAUSE = [
  "dispatch_notice",
  "delay_notice",
  "schedule_change_notice",
] as const;
