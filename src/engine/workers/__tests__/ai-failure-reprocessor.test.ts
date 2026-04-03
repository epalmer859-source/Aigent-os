// ============================================================
// src/engine/workers/__tests__/ai-failure-reprocessor.test.ts
//
// AI FAILURE REPROCESSOR — tests for Finding 2
//
// Test categories:
//   FR01  fallback message + no subsequent AI success → reprocessed
//   FR02  fallback message + subsequent AI success → skipped
//   FR03  fallback message older than 24h → not picked up
//   FR04  reprocessing succeeds → succeeded count incremented
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";

import {
  aiFailureReprocessorWorker,
  _resetWorkersStoreForTest,
  _seedWorkerMessageLogForTest,
  _setAIReprocessFnForTest,
  _getReprocessedConversationsForTest,
} from "../index";

import { FALLBACK_RESPONSE } from "../../ai-response/contract";

// ── Constants ─────────────────────────────────────────────────

const BIZ_ID = "biz_fr_test";
const CONV_A = "conv_fr_a";
const CONV_B = "conv_fr_b";

// ── Helpers ───────────────────────────────────────────────────

function minutesAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 1000);
}

function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 60 * 1000);
}

function seedFallbackEntry(opts: {
  id: string;
  conversationId: string;
  inboundMessageId?: string;
  createdAt: Date;
}): void {
  _seedWorkerMessageLogForTest({
    id: opts.id,
    conversationId: opts.conversationId,
    businessId: BIZ_ID,
    direction: "outbound",
    senderType: "ai",
    content: FALLBACK_RESPONSE,
    inboundMessageId: opts.inboundMessageId,
    createdAt: opts.createdAt,
  });
}

function seedSuccessEntry(opts: {
  id: string;
  conversationId: string;
  createdAt: Date;
}): void {
  _seedWorkerMessageLogForTest({
    id: opts.id,
    conversationId: opts.conversationId,
    businessId: BIZ_ID,
    direction: "outbound",
    senderType: "ai",
    content: "Hi! I can help you schedule a plumber.",
    createdAt: opts.createdAt,
  });
}

// ── FR: AI failure reprocessor tests ─────────────────────────

describe("FR: AI failure reprocessor", () => {
  beforeEach(() => {
    _resetWorkersStoreForTest();
    // Default: reprocess fn returns success
    _setAIReprocessFnForTest(async () => ({ success: true }));
  });

  it("FR01: fallback message with no subsequent AI success → conversation is reprocessed", async () => {
    seedFallbackEntry({
      id: "fb_001",
      conversationId: CONV_A,
      inboundMessageId: "inbound_a_001",
      createdAt: minutesAgo(30),
    });

    const result = await aiFailureReprocessorWorker();

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.skipped).toBe(0);

    const reprocessed = _getReprocessedConversationsForTest();
    expect(reprocessed).toContain(CONV_A);
  });

  it("FR02: fallback message with subsequent successful AI response → skipped", async () => {
    const fallbackTime = minutesAgo(60);
    const successTime = minutesAgo(30);

    seedFallbackEntry({
      id: "fb_002",
      conversationId: CONV_B,
      inboundMessageId: "inbound_b_001",
      createdAt: fallbackTime,
    });
    seedSuccessEntry({
      id: "ok_002",
      conversationId: CONV_B,
      createdAt: successTime,
    });

    const result = await aiFailureReprocessorWorker();

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.succeeded).toBe(0);

    const reprocessed = _getReprocessedConversationsForTest();
    expect(reprocessed).not.toContain(CONV_B);
  });

  it("FR03: fallback message older than 24 hours → not included in run", async () => {
    seedFallbackEntry({
      id: "fb_003",
      conversationId: CONV_A,
      inboundMessageId: "inbound_a_002",
      createdAt: hoursAgo(25), // outside the 24h window
    });

    const result = await aiFailureReprocessorWorker();

    expect(result.processed).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it("FR04: reprocessing succeeds → succeeded count is incremented and conversation tracked", async () => {
    const capturedCalls: Array<{ conversationId: string; inboundMessageId: string }> = [];

    _setAIReprocessFnForTest(async (params) => {
      capturedCalls.push({
        conversationId: params.conversationId,
        inboundMessageId: params.inboundMessageId,
      });
      return { success: true };
    });

    seedFallbackEntry({
      id: "fb_004",
      conversationId: CONV_A,
      inboundMessageId: "inbound_a_003",
      createdAt: minutesAgo(15),
    });

    const result = await aiFailureReprocessorWorker();

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);

    expect(capturedCalls).toHaveLength(1);
    expect(capturedCalls[0]!.conversationId).toBe(CONV_A);
    expect(capturedCalls[0]!.inboundMessageId).toBe("inbound_a_003");
  });
});
