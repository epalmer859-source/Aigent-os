// ============================================================
// src/engine/notifications/__tests__/notifications.test.ts
//
// INTERNAL NOTIFICATION DELIVERY — UNIT TESTS
//
// Test categories:
//   NF01  Urgent notification → dashboard + SMS + email
//   NF02  Standard notification → dashboard only by default
//   NF03  Dashboard-only notification → no SMS/email even if configured
//   NF04  Notification created for each business user
//   NF05  getUnreadNotifications returns only unread
//   NF06  markNotificationRead sets isRead = true
//   NF07  markNotificationRead on already-read → idempotent true
//   NF08  getUnreadNotifications filters by userId
//   NF09  Urgent notification sets isUrgent = true
//   NF10  Standard notification sets isUrgent = false
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";

import {
  deliverNotification,
  getUnreadNotifications,
  markNotificationRead,
  _resetNotificationsStoreForTest,
  _seedUserForTest,
  _seedNotificationForTest,
  _setSmsSenderForTest,
  _setEmailSenderForTest,
  _getNotificationForTest,
} from "../index";

// ── Constants ─────────────────────────────────────────────────

const BIZ_ID = "biz_nf_001";
const USER_A = "user_nf_001";
const USER_B = "user_nf_002";
const CONV_ID = "conv_nf_001";

// ── Helpers ───────────────────────────────────────────────────

function seedUsers(): void {
  _seedUserForTest({
    id: USER_A,
    businessId: BIZ_ID,
    name: "Alice",
    phone: "+15550001111",
    email: "alice@acme.example.com",
    receivesSmsNotifications: true,
    receivesEmailNotifications: true,
  });
  _seedUserForTest({
    id: USER_B,
    businessId: BIZ_ID,
    name: "Bob",
    phone: "+15550002222",
    email: "bob@acme.example.com",
    receivesSmsNotifications: true,
    receivesEmailNotifications: true,
  });
}

// ── Tests ─────────────────────────────────────────────────────

describe("NF: Internal notification delivery", () => {
  beforeEach(() => {
    _resetNotificationsStoreForTest();
    seedUsers();
    _setSmsSenderForTest(async () => ({ success: true }));
    _setEmailSenderForTest(async () => ({ success: true }));
  });

  it("NF01: urgent notification (escalation_alert) → dashboard + SMS + email delivered", async () => {
    const result = await deliverNotification({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      notificationType: "escalation_alert",
      title: "Escalation Alert",
      body: "Customer requested a human agent.",
    });

    expect(result.success).toBe(true);
    expect(result.notificationIds.length).toBeGreaterThan(0);
    expect(result.smsDelivered).toBeGreaterThan(0);
    expect(result.emailDelivered).toBeGreaterThan(0);
  });

  it("NF02: standard notification (new_quote_request) → dashboard only by default, no SMS/email", async () => {
    const result = await deliverNotification({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      notificationType: "new_quote_request",
      title: "New Quote Request",
      body: "Customer requested a quote for drain cleaning.",
    });

    expect(result.success).toBe(true);
    expect(result.notificationIds.length).toBeGreaterThan(0);
    expect(result.smsDelivered).toBe(0);
    expect(result.emailDelivered).toBe(0);
  });

  it("NF03: dashboard-only notification (payment_management_ready) → no SMS/email regardless of config", async () => {
    // Even though users have SMS/email enabled, dashboard-only types never forward
    const smsCalls: unknown[] = [];
    _setSmsSenderForTest(async (p) => { smsCalls.push(p); return { success: true }; });

    const result = await deliverNotification({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      notificationType: "payment_management_ready",
      title: "Payment Ready",
      body: "Payment management portal is ready for review.",
    });

    expect(result.success).toBe(true);
    expect(result.smsDelivered).toBe(0);
    expect(result.emailDelivered).toBe(0);
    expect(smsCalls).toHaveLength(0);
  });

  it("NF04: notification created for each user in the business", async () => {
    const result = await deliverNotification({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      notificationType: "escalation_alert",
      title: "Urgent",
      body: "Please respond immediately.",
    });

    // Two users seeded → at least two notification records
    expect(result.notificationIds.length).toBeGreaterThanOrEqual(2);
  });

  it("NF05: getUnreadNotifications returns only unread notifications", async () => {
    // Seed one unread and one read
    _seedNotificationForTest({
      id: "notif_unread_001",
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      recipientUserId: USER_A,
      notificationType: "escalation_alert",
      title: "Unread Alert",
      body: "This is unread.",
      isRead: false,
      isUrgent: true,
      deliveryMethod: "dashboard_sms_email",
      createdAt: new Date(),
    });
    _seedNotificationForTest({
      id: "notif_read_001",
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      recipientUserId: USER_A,
      notificationType: "new_quote_request",
      title: "Read Quote",
      body: "This is read.",
      isRead: true,
      isUrgent: false,
      deliveryMethod: "dashboard",
      createdAt: new Date(),
    });

    const unread = await getUnreadNotifications(BIZ_ID);
    expect(unread.length).toBe(1);
    expect(unread[0]?.id).toBe("notif_unread_001");
  });

  it("NF06: markNotificationRead sets isRead = true", async () => {
    _seedNotificationForTest({
      id: "notif_mark_001",
      businessId: BIZ_ID,
      conversationId: null,
      recipientUserId: USER_A,
      notificationType: "new_quote_request",
      title: "Quote",
      body: "New quote request.",
      isRead: false,
      isUrgent: false,
      deliveryMethod: "dashboard",
      createdAt: new Date(),
    });

    const marked = await markNotificationRead("notif_mark_001", USER_A);
    expect(marked).toBe(true);

    const notif = _getNotificationForTest("notif_mark_001");
    expect(notif?.isRead).toBe(true);
  });

  it("NF07: markNotificationRead on already-read notification → returns true (idempotent)", async () => {
    _seedNotificationForTest({
      id: "notif_already_read_001",
      businessId: BIZ_ID,
      conversationId: null,
      recipientUserId: USER_A,
      notificationType: "parts_request",
      title: "Parts",
      body: "Parts needed.",
      isRead: true,
      isUrgent: false,
      deliveryMethod: "dashboard",
      createdAt: new Date(),
    });

    const result = await markNotificationRead("notif_already_read_001", USER_A);
    expect(result).toBe(true);
  });

  it("NF08: getUnreadNotifications filters by userId when provided", async () => {
    _seedNotificationForTest({
      id: "notif_user_a_001",
      businessId: BIZ_ID,
      conversationId: null,
      recipientUserId: USER_A,
      notificationType: "stale_waiting_internal_ping",
      title: "Stale",
      body: "Conversation is stale.",
      isRead: false,
      isUrgent: false,
      deliveryMethod: "dashboard",
      createdAt: new Date(),
    });
    _seedNotificationForTest({
      id: "notif_user_b_001",
      businessId: BIZ_ID,
      conversationId: null,
      recipientUserId: USER_B,
      notificationType: "stale_waiting_internal_ping",
      title: "Stale",
      body: "Conversation is stale.",
      isRead: false,
      isUrgent: false,
      deliveryMethod: "dashboard",
      createdAt: new Date(),
    });

    const userANotifs = await getUnreadNotifications(BIZ_ID, USER_A);
    expect(userANotifs.length).toBe(1);
    expect(userANotifs[0]?.recipientUserId).toBe(USER_A);
  });

  it("NF09: urgent notification type sets isUrgent = true on created records", async () => {
    const result = await deliverNotification({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      notificationType: "urgent_service_request",
      title: "Urgent Service",
      body: "Water main break — urgent response needed.",
    });

    expect(result.notificationIds.length).toBeGreaterThan(0);
    const notif = _getNotificationForTest(result.notificationIds[0]!);
    expect(notif?.isUrgent).toBe(true);
  });

  it("NF10: standard notification type sets isUrgent = false on created records", async () => {
    const result = await deliverNotification({
      businessId: BIZ_ID,
      conversationId: CONV_ID,
      notificationType: "new_scheduling_request",
      title: "Scheduling Request",
      body: "Customer wants to schedule a visit.",
    });

    expect(result.notificationIds.length).toBeGreaterThan(0);
    const notif = _getNotificationForTest(result.notificationIds[0]!);
    expect(notif?.isUrgent).toBe(false);
  });
});
