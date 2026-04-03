// ============================================================
// src/engine/queue-worker/__tests__/queue-worker.test.ts
//
// OUTBOUND QUEUE WORKER — CONTRACT + IMPLEMENTATION TESTS
//
// ALL TESTS FAIL until the implementation file is created at:
//   src/engine/queue-worker/index.ts
//
// The module-not-found import below intentionally causes this
// entire file to fail at load time.
//
// Test categories:
//   P — processQueue basics (P01–P07)
//   S — sendMessage routing + retry (S01–S04)
//   R — Retry logic (R01–R04)
//   D — Deferred message processing (D01–D03)
//
// The implementation must maintain an in-memory queue store and
// expose _seed* / _reset* / _set* helpers for test isolation.
// Suppression engine state is seeded via its own test helpers
// (imported from ../../suppression/index).
// ============================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { QueueRow } from "../contract";

// ⚠ This import will fail until the implementation exists.
// That is intentional — all tests below should fail until
// src/engine/queue-worker/index.ts is created.
import {
  processQueue,
  sendMessage,
  processDeferredMessages,
  _resetQueueWorkerStoreForTest,
  _seedQueueRowForTest,
  _getQueueRowForTest,
  _setTwilioSendForTest,
} from "../index";

// Suppression engine test helpers — used to control what shouldSendMessage()
// returns when the queue worker calls it for each claimed row.
import {
  _resetSuppressionStoreForTest,
  _seedBusinessForTest,
  _seedCustomerForTest,
  _seedConversationForTest,
} from "../../suppression/index";

// ── Fixed test IDs ────────────────────────────────────────────

const BIZ_ID = "biz-qw-test";
const CUSTOMER_ID = "cust-qw-test";
const CONV_ID = "conv-qw-test";
const ROW_ID = "row-qw-test";

// ── Test helpers ──────────────────────────────────────────────

/** Seed a "clear" suppression state: not paused, no DNC, UTC QH 22:00-06:00. */
function seedSuppressionBase(primaryState = "lead_qualified"): void {
  _seedBusinessForTest({
    id: BIZ_ID,
    isPaused: false,
    quietHoursStart: "22:00",
    quietHoursEnd: "06:00",
    timezone: "UTC",
  });
  _seedCustomerForTest({
    id: CUSTOMER_ID,
    businessId: BIZ_ID,
    consentStatus: "implied_inbound",
    doNotContact: false,
  });
  _seedConversationForTest({
    id: CONV_ID,
    businessId: BIZ_ID,
    customerId: CUSTOMER_ID,
    primaryState,
    isNoShow: false,
  });
}

/** Minimal queue row with sensible defaults. */
function makeRow(overrides: Partial<QueueRow> = {}): Omit<QueueRow, "createdAt" | "updatedAt"> {
  return {
    id: ROW_ID,
    businessId: BIZ_ID,
    conversationId: CONV_ID,
    customerId: CUSTOMER_ID,
    messagePurpose: "routine_followup_1",
    audienceType: "customer",
    channel: "sms",
    messageBody: "Test message body",
    status: "pending",
    scheduledSendAt: new Date(Date.now() - 1000), // eligible immediately
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
    ...overrides,
  };
}

/** Default successful Twilio stub. */
const DEFAULT_SEND_SUCCESS = async (_row: QueueRow) => ({
  success: true as const,
  providerMessageId: "SM_test_provider_id",
});

/** Twilio stub that always fails. */
const DEFAULT_SEND_FAILURE = async (_row: QueueRow) => ({
  success: false as const,
  errorCode: "21211",
  errorMessage: "Invalid phone number",
});

// Reset all in-memory state before every test.
beforeEach(() => {
  _resetQueueWorkerStoreForTest();
  _resetSuppressionStoreForTest();
  _setTwilioSendForTest(DEFAULT_SEND_SUCCESS);
});

// ═══════════════════════════════════════════════════════════════
// P — PROCESS QUEUE BASICS
// ═══════════════════════════════════════════════════════════════

describe("P — processQueue basics", () => {
  it("P01: empty queue → returns all zeros", async () => {
    const result = await processQueue();
    expect(result.processed).toBe(0);
    expect(result.sent).toBe(0);
    expect(result.suppressed).toBe(0);
    expect(result.deferred).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("P02: one pending row, suppression clears, send succeeds → status = sent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T14:00:00.000Z")); // 2 PM UTC — outside QH
    try {
      seedSuppressionBase();
      _seedQueueRowForTest(makeRow());
      _setTwilioSendForTest(DEFAULT_SEND_SUCCESS);

      const result = await processQueue();

      expect(result.processed).toBe(1);
      expect(result.sent).toBe(1);
      expect(result.suppressed).toBe(0);
      expect(result.deferred).toBe(0);
      expect(result.failed).toBe(0);
      expect(_getQueueRowForTest(ROW_ID)?.status).toBe("sent");
    } finally {
      vi.useRealTimers();
    }
  });

  it("P03: one pending row, suppression says suppress → status = canceled", async () => {
    // Customer has do_not_contact → shouldSendMessage returns suppress
    _seedBusinessForTest({ id: BIZ_ID, isPaused: false, quietHoursStart: "22:00", quietHoursEnd: "06:00", timezone: "UTC" });
    _seedCustomerForTest({ id: CUSTOMER_ID, businessId: BIZ_ID, consentStatus: "implied_inbound", doNotContact: true });
    _seedConversationForTest({ id: CONV_ID, businessId: BIZ_ID, customerId: CUSTOMER_ID, primaryState: "lead_qualified", isNoShow: false });
    _seedQueueRowForTest(makeRow());

    const result = await processQueue();

    expect(result.processed).toBe(1);
    expect(result.suppressed).toBe(1);
    expect(result.sent).toBe(0);
    expect(_getQueueRowForTest(ROW_ID)?.status).toBe("canceled");
    expect(_getQueueRowForTest(ROW_ID)?.invalidatedBy).toBeTruthy();
  });

  it("P04: one pending row, suppression says defer → status = deferred, deferUntil set", async () => {
    // Fake time is 23:00 UTC — inside quiet window 22:00-06:00
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T23:00:00.000Z"));
    try {
      seedSuppressionBase();
      _seedQueueRowForTest(makeRow({ scheduledSendAt: new Date("2024-06-15T22:30:00.000Z") }));

      const result = await processQueue();

      expect(result.processed).toBe(1);
      expect(result.deferred).toBe(1);
      expect(result.sent).toBe(0);
      expect(_getQueueRowForTest(ROW_ID)?.status).toBe("deferred");
      expect(_getQueueRowForTest(ROW_ID)?.quietHoursDeferredUntil).toBeInstanceOf(Date);
    } finally {
      vi.useRealTimers();
    }
  });

  it("P05: batchSize = 2 with 5 pending rows → only 2 processed this cycle", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T14:00:00.000Z"));
    try {
      seedSuppressionBase();
      for (let i = 1; i <= 5; i++) {
        _seedQueueRowForTest(makeRow({ id: `row-batch-${i}` }));
      }

      const result = await processQueue(2);

      expect(result.processed).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("P06: row with scheduledSendAt in the future → not claimed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T14:00:00.000Z"));
    try {
      seedSuppressionBase();
      _seedQueueRowForTest(makeRow({
        scheduledSendAt: new Date("2024-06-15T16:00:00.000Z"), // 2 hours in the future
      }));

      const result = await processQueue();

      expect(result.processed).toBe(0);
      expect(_getQueueRowForTest(ROW_ID)?.status).toBe("pending");
    } finally {
      vi.useRealTimers();
    }
  });

  it("P07: row already claimed by another worker (claim not expired) → not claimed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T14:00:00.000Z"));
    try {
      seedSuppressionBase();
      _seedQueueRowForTest(makeRow({
        status: "claimed",
        claimToken: "other-worker-token",
        claimedAt: new Date("2024-06-15T14:00:00.000Z"),
        claimExpiresAt: new Date("2024-06-15T14:00:30.000Z"), // 30 s in the future
      }));

      const result = await processQueue();

      expect(result.processed).toBe(0);
      // Row still belongs to the other worker
      expect(_getQueueRowForTest(ROW_ID)?.claimToken).toBe("other-worker-token");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// S — SEND ROUTING + FAILURE HANDLING
// ═══════════════════════════════════════════════════════════════

describe("S — sendMessage routing + failure handling", () => {
  it("S01: customer-facing SMS row → sendMessage returns success with providerMessageId", async () => {
    const row = makeRow({ audienceType: "customer", channel: "sms" }) as QueueRow;
    _setTwilioSendForTest(async () => ({ success: true, providerMessageId: "SM_abc123" }));

    const result = await sendMessage(row);

    expect(result.success).toBe(true);
    expect(typeof result.providerMessageId).toBe("string");
    expect(result.providerMessageId?.length).toBeGreaterThan(0);
  });

  it("S02: internal row → sendMessage returns success without calling Twilio", async () => {
    // Replace Twilio with a stub that throws — should never be called for internal.
    _setTwilioSendForTest(async () => { throw new Error("Twilio must not be called for internal messages"); });
    const row = makeRow({ audienceType: "internal", messagePurpose: "escalation_alert" }) as QueueRow;

    const result = await sendMessage(row);

    expect(result.success).toBe(true);
  });

  it("S03: send fails → status = failed_retryable, attempt count incremented, next_retry_at set", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T14:00:00.000Z"));
    try {
      seedSuppressionBase();
      _seedQueueRowForTest(makeRow({ maxRetryCount: 5 })); // high max so it retries
      _setTwilioSendForTest(DEFAULT_SEND_FAILURE);

      const result = await processQueue();

      expect(result.failed).toBe(1);
      expect(result.sent).toBe(0);
      const row = _getQueueRowForTest(ROW_ID);
      expect(row?.status).toBe("failed_retryable");
      expect(row?.sendAttemptCount).toBe(1);
      expect(row?.nextRetryAt).toBeInstanceOf(Date);
    } finally {
      vi.useRealTimers();
    }
  });

  it("S04: send fails MAX_RETRY_COUNT times → status = failed_terminal, reason set", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T14:00:00.000Z"));
    try {
      seedSuppressionBase();
      // Seed with sendAttemptCount already at max-1 so one more failure → terminal
      _seedQueueRowForTest(makeRow({
        sendAttemptCount: 2,
        maxRetryCount: 3,
      }));
      _setTwilioSendForTest(DEFAULT_SEND_FAILURE);

      const result = await processQueue();

      expect(result.failed).toBe(1);
      const row = _getQueueRowForTest(ROW_ID);
      expect(row?.status).toBe("failed_terminal");
      expect(row?.terminalFailureReason).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// R — RETRY LOGIC
// ═══════════════════════════════════════════════════════════════

describe("R — retry logic", () => {
  it("R01: failed_retryable row with nextRetryAt <= now → claimed and reprocessed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T14:00:00.000Z"));
    try {
      seedSuppressionBase();
      _seedQueueRowForTest(makeRow({
        status: "failed_retryable",
        sendAttemptCount: 1,
        nextRetryAt: new Date("2024-06-15T13:59:00.000Z"), // 1 minute in the past
      }));
      _setTwilioSendForTest(DEFAULT_SEND_SUCCESS);

      const result = await processQueue();

      expect(result.processed).toBe(1);
      expect(result.sent).toBe(1);
      expect(_getQueueRowForTest(ROW_ID)?.status).toBe("sent");
    } finally {
      vi.useRealTimers();
    }
  });

  it("R02: failed_retryable row with nextRetryAt in the future → not claimed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T14:00:00.000Z"));
    try {
      seedSuppressionBase();
      _seedQueueRowForTest(makeRow({
        status: "failed_retryable",
        sendAttemptCount: 1,
        nextRetryAt: new Date("2024-06-15T15:00:00.000Z"), // 1 hour in the future
      }));

      const result = await processQueue();

      expect(result.processed).toBe(0);
      expect(_getQueueRowForTest(ROW_ID)?.status).toBe("failed_retryable");
    } finally {
      vi.useRealTimers();
    }
  });

  it("R03: retry intervals are 30 s, 2 min, 10 min for attempts 1, 2, 3", async () => {
    vi.useFakeTimers();
    const now = new Date("2024-06-15T14:00:00.000Z");
    vi.setSystemTime(now);
    try {
      seedSuppressionBase();
      // Three rows at different attempt counts; maxRetryCount=5 so none go terminal.
      _seedQueueRowForTest(makeRow({ id: "row-r03-a", sendAttemptCount: 0, maxRetryCount: 5 }));
      _seedQueueRowForTest(makeRow({ id: "row-r03-b", sendAttemptCount: 1, maxRetryCount: 5 }));
      _seedQueueRowForTest(makeRow({ id: "row-r03-c", sendAttemptCount: 2, maxRetryCount: 5 }));
      _setTwilioSendForTest(DEFAULT_SEND_FAILURE);

      await processQueue(3);

      const rowA = _getQueueRowForTest("row-r03-a");
      const rowB = _getQueueRowForTest("row-r03-b");
      const rowC = _getQueueRowForTest("row-r03-c");

      // Attempt 1 → wait 30 s
      expect(rowA?.nextRetryAt?.getTime()).toBeCloseTo(now.getTime() + 30_000, -2);
      // Attempt 2 → wait 120 s
      expect(rowB?.nextRetryAt?.getTime()).toBeCloseTo(now.getTime() + 120_000, -2);
      // Attempt 3 → wait 600 s
      expect(rowC?.nextRetryAt?.getTime()).toBeCloseTo(now.getTime() + 600_000, -2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("R04: successful retry → status = sent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T14:00:00.000Z"));
    try {
      seedSuppressionBase();
      _seedQueueRowForTest(makeRow({
        status: "failed_retryable",
        sendAttemptCount: 1,
        nextRetryAt: new Date("2024-06-15T13:00:00.000Z"), // overdue
      }));
      _setTwilioSendForTest(DEFAULT_SEND_SUCCESS);

      const result = await processQueue();

      expect(result.sent).toBe(1);
      expect(_getQueueRowForTest(ROW_ID)?.status).toBe("sent");
    } finally {
      vi.useRealTimers();
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// D — DEFERRED MESSAGE PROCESSING
// ═══════════════════════════════════════════════════════════════

describe("D — deferred message processing", () => {
  it("D01: deferred row with quietHoursDeferredUntil <= now → processed and sent", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T14:00:00.000Z")); // 2 PM UTC — outside QH
    try {
      seedSuppressionBase();
      _seedQueueRowForTest(makeRow({
        status: "deferred",
        quietHoursDeferredUntil: new Date("2024-06-15T06:00:00.000Z"), // already passed
      }));
      _setTwilioSendForTest(DEFAULT_SEND_SUCCESS);

      const result = await processDeferredMessages();

      expect(result.processed).toBe(1);
      expect(result.sent).toBe(1);
      expect(_getQueueRowForTest(ROW_ID)?.status).toBe("sent");
    } finally {
      vi.useRealTimers();
    }
  });

  it("D02: deferred row with quietHoursDeferredUntil in the future → not processed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T14:00:00.000Z"));
    try {
      seedSuppressionBase();
      _seedQueueRowForTest(makeRow({
        status: "deferred",
        quietHoursDeferredUntil: new Date("2024-06-15T22:00:00.000Z"), // 8 hours away
      }));

      const result = await processDeferredMessages();

      expect(result.processed).toBe(0);
      expect(_getQueueRowForTest(ROW_ID)?.status).toBe("deferred");
    } finally {
      vi.useRealTimers();
    }
  });

  it("D03: deferred row re-suppressed when customer opted out during quiet hours → canceled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T14:00:00.000Z")); // 2 PM UTC — outside QH
    try {
      // Customer has opted out since the row was deferred
      _seedBusinessForTest({ id: BIZ_ID, isPaused: false, quietHoursStart: "22:00", quietHoursEnd: "06:00", timezone: "UTC" });
      _seedCustomerForTest({ id: CUSTOMER_ID, businessId: BIZ_ID, consentStatus: "opted_out", doNotContact: false });
      _seedConversationForTest({ id: CONV_ID, businessId: BIZ_ID, customerId: CUSTOMER_ID, primaryState: "lead_qualified", isNoShow: false });

      _seedQueueRowForTest(makeRow({
        status: "deferred",
        quietHoursDeferredUntil: new Date("2024-06-15T06:00:00.000Z"), // already passed
      }));

      const result = await processDeferredMessages();

      expect(result.processed).toBe(1);
      expect(result.suppressed).toBe(1);
      expect(_getQueueRowForTest(ROW_ID)?.status).toBe("canceled");
    } finally {
      vi.useRealTimers();
    }
  });
});
