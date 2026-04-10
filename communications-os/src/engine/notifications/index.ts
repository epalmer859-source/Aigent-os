// ============================================================
// src/engine/notifications/index.ts
//
// INTERNAL NOTIFICATION DELIVERY — IMPLEMENTATION
//
// All DB access would go through Prisma in production.
// This module maintains in-memory stores so the test suite
// runs without a real DB.
//
// Production Prisma patterns:
//   await db.notifications.create({ data: { ... } });
//   await db.notifications.findMany({ where: { business_id, is_read: false } });
//   await db.notifications.update({ where: { id }, data: { is_read: true } });
//   const users = await db.users.findMany({ where: { business_id: businessId } });
// ============================================================

import { z } from "zod";
import {
  DASHBOARD_ONLY_NOTIFICATION_TYPES,
  URGENT_NOTIFICATION_TYPES,
  type DeliverNotificationParams,
  type DeliveryMethod,
  type Notification,
  type NotificationDeliveryResult,
  type NotificationEmailSenderFn,
  type NotificationSmsSenderFn,
  type NotificationUserRecord,
} from "./contract";

// ── Zod schemas ───────────────────────────────────────────────

const DeliverParamsSchema = z.object({
  businessId: z.string().min(1),
  conversationId: z.string().optional(),
  notificationType: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
});

// ── In-memory stores ──────────────────────────────────────────

const _notifications = new Map<string, Notification>();
const _users = new Map<string, NotificationUserRecord>();

interface BusinessForwardingConfig {
  smsForwardingEnabled: boolean;
  emailForwardingEnabled: boolean;
}
const _businessConfigs = new Map<string, BusinessForwardingConfig>();

// ── Injectables ───────────────────────────────────────────────

const _defaultSmsSender: NotificationSmsSenderFn = async () => ({
  success: false,
  error: "No SMS sender configured",
});

const _defaultEmailSender: NotificationEmailSenderFn = async () => ({
  success: false,
  error: "No email sender configured",
});

let _smsSender: NotificationSmsSenderFn = _defaultSmsSender;
let _emailSender: NotificationEmailSenderFn = _defaultEmailSender;

// ── ID generator ──────────────────────────────────────────────

function _genId(): string {
  // Production: crypto.randomUUID()
  return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── Type classification helpers ───────────────────────────────

function _isUrgent(notificationType: string): boolean {
  return (URGENT_NOTIFICATION_TYPES as readonly string[]).includes(
    notificationType,
  );
}

function _isDashboardOnly(notificationType: string): boolean {
  return (DASHBOARD_ONLY_NOTIFICATION_TYPES as readonly string[]).includes(
    notificationType,
  );
}

function _resolveDeliveryMethod(
  notificationType: string,
  businessId: string,
  user: NotificationUserRecord,
): DeliveryMethod {
  if (_isDashboardOnly(notificationType)) {
    return "dashboard";
  }

  const urgent = _isUrgent(notificationType);

  if (urgent) {
    // Urgent: always SMS + email for users who have contact info
    const hasSms = !!user.phone;
    const hasEmail = !!user.email;
    if (hasSms && hasEmail) return "dashboard_sms_email";
    if (hasSms) return "dashboard_and_sms";
    if (hasEmail) return "dashboard_and_email";
    return "dashboard";
  }

  // Standard: only forward if business has explicitly configured it
  const bizConfig = _businessConfigs.get(businessId);
  const wantsSms = (bizConfig?.smsForwardingEnabled ?? false) && !!user.phone && user.receivesSmsNotifications;
  const wantsEmail = (bizConfig?.emailForwardingEnabled ?? false) && !!user.email && user.receivesEmailNotifications;

  if (wantsSms && wantsEmail) return "dashboard_sms_email";
  if (wantsSms) return "dashboard_and_sms";
  if (wantsEmail) return "dashboard_and_email";
  return "dashboard";
}

// ── Production Prisma implementations ─────────────────────────

async function _deliverNotificationFromDb(
  params: DeliverNotificationParams,
): Promise<NotificationDeliveryResult> {
  const { db } = await import("~/server/db");
  const { businessId, conversationId, notificationType, title, body } = params;

  const [dbUsers, bizConfig] = await Promise.all([
    db.users.findMany({
      where: { business_id: businessId },
      select: { id: true, email: true, display_name: true, notification_preferences: true },
    }),
    db.business_config.findUnique({
      where: { business_id: businessId },
      select: { notification_defaults: true },
    }),
  ]);

  const bizDefaults = (bizConfig?.notification_defaults as any) ?? {};
  const bizForwarding: BusinessForwardingConfig = {
    smsForwardingEnabled: bizDefaults.smsForwardingEnabled ?? false,
    emailForwardingEnabled: bizDefaults.emailForwardingEnabled ?? false,
  };

  const businessUsers: NotificationUserRecord[] = dbUsers.map((u) => {
    const prefs = (u.notification_preferences as any) ?? {};
    return {
      id: u.id,
      businessId,
      name: u.display_name ?? u.email,
      phone: prefs.phone ?? null,
      email: u.email,
      receivesSmsNotifications: prefs.receivesSmsNotifications ?? false,
      receivesEmailNotifications: prefs.receivesEmailNotifications ?? true,
    };
  });

  const notificationIds: string[] = [];
  let smsDelivered = 0;
  let emailDelivered = 0;
  const urgent = _isUrgent(notificationType);

  _businessConfigs.set(businessId, bizForwarding);

  for (const user of businessUsers) {
    const method = _resolveDeliveryMethod(notificationType, businessId, user);

    const created = await db.notifications.create({
      data: {
        business_id: businessId,
        user_id: user.id,
        notification_type: notificationType as any,
        title,
        summary: body,
        is_read: false,
        ...(conversationId ? { reference_type: "conversation", reference_id: conversationId } : {}),
      },
    });
    notificationIds.push(created.id);

    if ((method === "dashboard_and_sms" || method === "dashboard_sms_email") && user.phone) {
      const smsResult = await _smsSender({ to: user.phone, body: `${title}: ${body}` });
      if (smsResult.success) smsDelivered++;
    }

    if ((method === "dashboard_and_email" || method === "dashboard_sms_email") && user.email) {
      const emailResult = await _emailSender({ to: user.email, subject: title, body });
      if (emailResult.success) emailDelivered++;
    }
  }

  _businessConfigs.delete(businessId);

  return { success: true, notificationIds, smsDelivered, emailDelivered };
}

async function _getUnreadNotificationsFromDb(
  businessId: string,
  userId?: string,
): Promise<Notification[]> {
  const { db } = await import("~/server/db");
  const rows = await db.notifications.findMany({
    where: {
      business_id: businessId,
      is_read: false,
      ...(userId ? { user_id: userId } : {}),
    },
    orderBy: { created_at: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    businessId: r.business_id,
    conversationId: r.reference_type === "conversation" ? (r.reference_id ?? null) : null,
    recipientUserId: r.user_id ?? null,
    notificationType: r.notification_type as string,
    title: r.title,
    body: r.summary ?? "",
    isRead: r.is_read,
    isUrgent: _isUrgent(r.notification_type as string),
    deliveryMethod: "dashboard" as DeliveryMethod,
    createdAt: r.created_at,
  }));
}

async function _markNotificationReadFromDb(
  notificationId: string,
): Promise<boolean> {
  const { db } = await import("~/server/db");
  const existing = await db.notifications.findUnique({
    where: { id: notificationId },
    select: { id: true },
  });
  if (!existing) return false;
  await db.notifications.update({
    where: { id: notificationId },
    data: { is_read: true },
  });
  return true;
}

// ── deliverNotification ───────────────────────────────────────

export async function deliverNotification(
  params: DeliverNotificationParams,
): Promise<NotificationDeliveryResult> {
  // 1. Validate params
  const parsed = DeliverParamsSchema.safeParse(params);
  if (!parsed.success) {
    return {
      success: false,
      notificationIds: [],
      smsDelivered: 0,
      emailDelivered: 0,
      error: "invalid_params",
    };
  }

  if (process.env.NODE_ENV !== "test") return _deliverNotificationFromDb(params);

  const { businessId, conversationId, notificationType, title, body } =
    parsed.data;

  // 2. Fetch all users for this business
  // Production: db.users.findMany({ where: { business_id: businessId, is_active: true } })
  const businessUsers = [..._users.values()].filter(
    (u) => u.businessId === businessId,
  );

  const notificationIds: string[] = [];
  let smsDelivered = 0;
  let emailDelivered = 0;
  const urgent = _isUrgent(notificationType);

  // 3. Create a notification record for each user and forward as configured
  for (const user of businessUsers) {
    const method = _resolveDeliveryMethod(notificationType, businessId, user);

    const notification: Notification = {
      id: _genId(),
      businessId,
      conversationId: conversationId ?? null,
      recipientUserId: user.id,
      notificationType,
      title,
      body,
      isRead: false,
      isUrgent: urgent,
      deliveryMethod: method,
      createdAt: new Date(),
    };

    // Production: db.notifications.create({ data: { ... } })
    _notifications.set(notification.id, notification);
    notificationIds.push(notification.id);

    // 4. SMS forwarding
    if (
      (method === "dashboard_and_sms" || method === "dashboard_sms_email") &&
      user.phone
    ) {
      const smsResult = await _smsSender({ to: user.phone, body: `${title}: ${body}` });
      if (smsResult.success) smsDelivered++;
    }

    // 5. Email forwarding
    if (
      (method === "dashboard_and_email" || method === "dashboard_sms_email") &&
      user.email
    ) {
      const emailResult = await _emailSender({
        to: user.email,
        subject: title,
        body,
      });
      if (emailResult.success) emailDelivered++;
    }
  }

  return {
    success: true,
    notificationIds,
    smsDelivered,
    emailDelivered,
  };
}

// ── getUnreadNotifications ────────────────────────────────────

export async function getUnreadNotifications(
  businessId: string,
  userId?: string,
): Promise<Notification[]> {
  if (process.env.NODE_ENV !== "test") return _getUnreadNotificationsFromDb(businessId, userId);
  // Production:
  //   db.notifications.findMany({
  //     where: {
  //       business_id: businessId,
  //       is_read: false,
  //       OR: userId
  //         ? [{ recipient_user_id: userId }, { recipient_user_id: null }]
  //         : undefined,
  //     },
  //     orderBy: { created_at: 'desc' },
  //   })
  return [..._notifications.values()].filter((n) => {
    if (n.businessId !== businessId) return false;
    if (n.isRead) return false;
    if (userId !== undefined) {
      return n.recipientUserId === userId || n.recipientUserId === null;
    }
    return true;
  });
}

// ── markNotificationRead ──────────────────────────────────────

export async function markNotificationRead(
  notificationId: string,
  _userId: string,
): Promise<boolean> {
  if (process.env.NODE_ENV !== "test") return _markNotificationReadFromDb(notificationId);
  // Production:
  //   await db.notifications.update({
  //     where: { id: notificationId },
  //     data: { is_read: true },
  //   });
  const notif = _notifications.get(notificationId);
  if (!notif) return false;
  notif.isRead = true;
  return true;
}

// ── Test helpers ──────────────────────────────────────────────

export function _resetNotificationsStoreForTest(): void {
  _notifications.clear();
  _users.clear();
  _businessConfigs.clear();
  _smsSender = _defaultSmsSender;
  _emailSender = _defaultEmailSender;
}

export function _seedUserForTest(data: Record<string, unknown>): void {
  // Production: db.users.upsert({ ... })
  _users.set(data["id"] as string, {
    id: data["id"] as string,
    businessId: data["businessId"] as string,
    name: data["name"] as string,
    phone: (data["phone"] as string | null) ?? null,
    email: (data["email"] as string | null) ?? null,
    receivesSmsNotifications: data["receivesSmsNotifications"] as boolean,
    receivesEmailNotifications: data["receivesEmailNotifications"] as boolean,
  });
}

export function _seedNotificationForTest(data: Record<string, unknown>): void {
  // Production: db.notifications.upsert({ ... })
  _notifications.set(data["id"] as string, data as unknown as Notification);
}

export function _setSmsSenderForTest(fn: NotificationSmsSenderFn): void {
  _smsSender = fn;
}

export function _setEmailSenderForTest(fn: NotificationEmailSenderFn): void {
  _emailSender = fn;
}

export function _getNotificationForTest(id: string): Notification | undefined {
  return _notifications.get(id);
}
