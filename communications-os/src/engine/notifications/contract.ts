// ============================================================
// src/engine/notifications/contract.ts
//
// INTERNAL NOTIFICATION DELIVERY — CONTRACT
//
// Exports ONLY types and constants. Zero logic.
//
// Internal notifications are created whenever an internal-purpose
// message is routed through the queue worker. They are stored for
// dashboard display and optionally forwarded to staff via SMS/email
// based on notification type and business configuration.
//
// Blueprint source: Doc 11 §1.2, Doc 12 Part 11
// ============================================================

// ── Core record ───────────────────────────────────────────────

export interface Notification {
  id: string;
  businessId: string;
  conversationId: string | null;
  /** null = broadcast to all users for this business */
  recipientUserId: string | null;
  /** Matches the internal message purpose */
  notificationType: string;
  title: string;
  body: string;
  isRead: boolean;
  isUrgent: boolean;
  deliveryMethod: DeliveryMethod;
  createdAt: Date;
}

export type DeliveryMethod =
  | "dashboard"
  | "dashboard_and_sms"
  | "dashboard_and_email"
  | "dashboard_sms_email";

// ── Result shapes ─────────────────────────────────────────────

export interface NotificationDeliveryResult {
  success: boolean;
  /** IDs of dashboard notification records created */
  notificationIds: string[];
  /** Count of staff SMS messages sent */
  smsDelivered: number;
  /** Count of staff emails sent */
  emailDelivered: number;
  error?: string;
}

// ── Input params ──────────────────────────────────────────────

export interface DeliverNotificationParams {
  businessId: string;
  conversationId?: string;
  notificationType: string;
  title: string;
  body: string;
}

// ── Injectables ───────────────────────────────────────────────

export interface SmsSendParams {
  to: string;
  body: string;
}

export interface SmsSendResult {
  success: boolean;
  error?: string;
}

export interface NotificationEmailParams {
  to: string;
  subject: string;
  body: string;
}

export interface NotificationEmailResult {
  success: boolean;
  error?: string;
}

export type NotificationSmsSenderFn = (
  params: SmsSendParams,
) => Promise<SmsSendResult>;

export type NotificationEmailSenderFn = (
  params: NotificationEmailParams,
) => Promise<NotificationEmailResult>;

// ── User record (for delivery targeting) ─────────────────────

export interface NotificationUserRecord {
  id: string;
  businessId: string;
  name: string;
  phone: string | null;
  email: string | null;
  /** Whether this user should receive SMS/email forwarding */
  receivesSmsNotifications: boolean;
  receivesEmailNotifications: boolean;
}

// ── Business notification config ──────────────────────────────

export interface BusinessNotificationConfig {
  businessId: string;
  /** If true, standard notification types also get SMS/email forwarding */
  smsForwardingEnabled: boolean;
  emailForwardingEnabled: boolean;
}

// ── Notification type classification ─────────────────────────

/** Always triggers dashboard + SMS + email to all users */
export const URGENT_NOTIFICATION_TYPES = [
  "escalation_alert",
  "human_takeover_summary",
  "urgent_service_request",
] as const;

/** Dashboard to all by default; SMS/email only if business has configured it */
export const STANDARD_NOTIFICATION_TYPES = [
  "new_quote_request",
  "new_approval_request",
  "parts_request",
  "stale_waiting_internal_ping",
] as const;

/** Dashboard only — never SMS/email regardless of configuration */
export const DASHBOARD_ONLY_NOTIFICATION_TYPES = [
  "payment_management_ready",
  "schedule_change_admin_notice",
] as const;

export type UrgentNotificationType =
  (typeof URGENT_NOTIFICATION_TYPES)[number];
export type StandardNotificationType =
  (typeof STANDARD_NOTIFICATION_TYPES)[number];
export type DashboardOnlyNotificationType =
  (typeof DASHBOARD_ONLY_NOTIFICATION_TYPES)[number];

// ── Function signatures ───────────────────────────────────────

export type DeliverNotificationFn = (
  params: DeliverNotificationParams,
) => Promise<NotificationDeliveryResult>;

export type GetUnreadNotificationsFn = (
  businessId: string,
  userId?: string,
) => Promise<Notification[]>;

export type MarkNotificationReadFn = (
  notificationId: string,
  userId: string,
) => Promise<boolean>;
