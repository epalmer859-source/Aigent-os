// ============================================================
// src/engine/inbound/__tests__/duplicate-detection.test.ts
//
// DUPLICATE CUSTOMER DETECTION — tests for Finding 4
//
// Test categories:
//   DD01  new customer with same service address → notification created
//   DD02  new customer with different address → no notification
//   DD03  new customer but no service address → no notification
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";

import {
  handleInboundMessage,
  _resetInboundStoreForTest,
  _seedContactServiceAddressForTest,
  _seedConversationServiceAddressForTest,
  _getDuplicateNotificationsForTest,
} from "../index";

import {
  _resetSuppressionStoreForTest,
  _seedBusinessForTest,
} from "../../suppression/index";

import {
  _resetStoreForTest as _resetResolverStoreForTest,
} from "../../customer-resolver/index";

import type { InboundParams } from "../contract";

// ── Constants ─────────────────────────────────────────────────

const BIZ_ID = "biz_dd_test";
// New customer's phone (normalizes to E.164 +1...)
const NEW_PHONE = "+15558880001";
// Existing conversation ID in the business
const EXISTING_CONV_ID = "conv_dd_existing_001";

// ── Helpers ───────────────────────────────────────────────────

function makeParams(overrides: Partial<InboundParams> = {}): InboundParams {
  return {
    businessId: BIZ_ID,
    fromContact: NEW_PHONE,
    contactType: "phone",
    channel: "sms",
    content: "Hi, I need a plumber",
    ...overrides,
  };
}

function seedBusiness(): void {
  _seedBusinessForTest({
    id: BIZ_ID,
    isPaused: false,
    quietHoursStart: "22:00",
    quietHoursEnd: "06:00",
    timezone: "UTC",
  });
}

function resetAll(): void {
  _resetInboundStoreForTest();
  _resetSuppressionStoreForTest();
  _resetResolverStoreForTest();
}

// ── DD: Duplicate detection tests ────────────────────────────

describe("DD: Duplicate customer detection", () => {
  beforeEach(() => {
    resetAll();
    seedBusiness();
  });

  it("DD01: new customer with same service address as existing recent conversation → notification created", async () => {
    const sharedAddress = "123 Main St, Nashville TN";

    // Seed the new customer's address (keyed by businessId:normalizedPhone)
    _seedContactServiceAddressForTest(BIZ_ID, NEW_PHONE, sharedAddress);

    // Seed an existing conversation in the same business with the same address, created recently
    _seedConversationServiceAddressForTest(EXISTING_CONV_ID, {
      businessId: BIZ_ID,
      customerId: "cust_existing_001",
      address: sharedAddress,
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
    });

    await handleInboundMessage(makeParams());

    const notifications = _getDuplicateNotificationsForTest();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]!.businessId).toBe(BIZ_ID);
    expect(notifications[0]!.phone).toBe(NEW_PHONE);
  });

  it("DD02: new customer with different service address → no notification", async () => {
    _seedContactServiceAddressForTest(BIZ_ID, NEW_PHONE, "456 Oak Ave, Nashville TN");

    _seedConversationServiceAddressForTest(EXISTING_CONV_ID, {
      businessId: BIZ_ID,
      customerId: "cust_existing_002",
      address: "789 Pine Rd, Nashville TN", // different address
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    await handleInboundMessage(makeParams());

    const notifications = _getDuplicateNotificationsForTest();
    expect(notifications).toHaveLength(0);
  });

  it("DD03: new customer but no service address collected yet → no notification (no false positives)", async () => {
    // Do NOT seed any address for the new customer
    _seedConversationServiceAddressForTest(EXISTING_CONV_ID, {
      businessId: BIZ_ID,
      customerId: "cust_existing_003",
      address: "123 Main St, Nashville TN",
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });

    await handleInboundMessage(makeParams());

    // No address for new customer → skip check entirely
    const notifications = _getDuplicateNotificationsForTest();
    expect(notifications).toHaveLength(0);
  });
});
