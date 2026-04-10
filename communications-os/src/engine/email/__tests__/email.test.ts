// ============================================================
// src/engine/email/__tests__/email.test.ts
//
// EMAIL INTEGRATION — UNIT TESTS
//
// Test categories:
//   EM01  Known business → success
//   EM02  Unknown business → error
//   EM03  Duplicate messageId → skipped
//   EM04  channel='email', contactType='email' passed to handler
//   EM05  Empty textBody with htmlBody → still processes
//   EM06  sendOutboundEmail success → providerMessageId returned
//   EM07  sendOutboundEmail failure → error returned
//   EM08  lookupBusinessByEmail unknown address → null
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";

import {
  handleInboundEmail,
  sendOutboundEmail,
  lookupBusinessByEmail,
  _resetEmailStoreForTest,
  _seedBusinessEmailForTest,
  _setInboundHandlerForTest,
  _setEmailSenderForTest,
} from "../index";

import {
  EMAIL_CHANNEL,
  EMAIL_CONTACT_TYPE,
  type EmailInboundParams,
  type EmailSendParams,
} from "../contract";

// ── Constants ─────────────────────────────────────────────────

const BIZ_ID = "biz_em_001";
const BIZ_EMAIL = "hello@acmeplumbing.example.com";
const BIZ_OUTBOUND = "no-reply@acmeplumbing.example.com";

// ── Helpers ───────────────────────────────────────────────────

function seedBusiness(id = BIZ_ID, email = BIZ_EMAIL): void {
  _seedBusinessEmailForTest({
    businessId: id,
    businessName: "Acme Plumbing",
    inboundEmailAddress: email,
    outboundEmailAddress: BIZ_OUTBOUND,
  });
}

function makePayload(overrides: Partial<{
  from: string;
  to: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  messageId: string;
  inReplyTo: string;
}> = {}) {
  return {
    from: "customer@example.com",
    to: BIZ_EMAIL,
    subject: "I need a plumber",
    textBody: "Hi, can you come fix my sink?",
    messageId: `msg_em_${Date.now()}`,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe("EM: Email integration", () => {
  beforeEach(() => {
    _resetEmailStoreForTest();
    seedBusiness();
    _setInboundHandlerForTest(async () => ({
      success: true,
      messageId: "msg_handler_001",
      customerId: "cust_em_001",
      conversationId: "conv_em_001",
    }));
    _setEmailSenderForTest(async () => ({
      success: true,
      providerMessageId: "provider_msg_001",
    }));
  });

  it("EM01: known business inbound email → success, returns messageId", async () => {
    const result = await handleInboundEmail(makePayload());

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("msg_handler_001");
    expect(result.skipped).toBeFalsy();
  });

  it("EM02: unknown business (to address not registered) → returns error", async () => {
    const result = await handleInboundEmail(
      makePayload({ to: "unknown@notabusiness.example.com" }),
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/business/i);
  });

  it("EM03: duplicate messageId → skipped, not processed twice", async () => {
    const payload = makePayload({ messageId: "dedup_msg_001" });

    // First delivery
    const first = await handleInboundEmail(payload);
    expect(first.success).toBe(true);
    expect(first.skipped).toBeFalsy();

    // Second delivery with same messageId
    const second = await handleInboundEmail(payload);
    expect(second.success).toBe(true);
    expect(second.skipped).toBe(true);
  });

  it("EM04: valid message hands off with channel=email and contactType=email", async () => {
    let capturedParams: EmailInboundParams | undefined;
    _setInboundHandlerForTest(async (params) => {
      capturedParams = params;
      return { success: true, messageId: "msg_capture_001" };
    });

    await handleInboundEmail(makePayload());

    expect(capturedParams).toBeTruthy();
    expect(capturedParams?.channel).toBe(EMAIL_CHANNEL);
    expect(capturedParams?.contactType).toBe(EMAIL_CONTACT_TYPE);
    expect(capturedParams?.businessId).toBe(BIZ_ID);
  });

  it("EM05: empty textBody with htmlBody present → still processes successfully", async () => {
    const result = await handleInboundEmail(
      makePayload({
        textBody: "",
        htmlBody: "<p>Hi, can you come fix my sink?</p>",
      }),
    );

    expect(result.success).toBe(true);
  });

  it("EM06: sendOutboundEmail success → returns providerMessageId", async () => {
    const params: EmailSendParams = {
      to: "customer@example.com",
      from: BIZ_OUTBOUND,
      subject: "Re: I need a plumber",
      body: "Hi! We can be there tomorrow at 9am.",
      replyToMessageId: "original_msg_001",
    };

    const result = await sendOutboundEmail(params);

    expect(result.success).toBe(true);
    expect(result.providerMessageId).toBe("provider_msg_001");
  });

  it("EM07: sendOutboundEmail provider failure → returns error", async () => {
    _setEmailSenderForTest(async () => ({
      success: false,
      error: "provider_timeout",
    }));

    const params: EmailSendParams = {
      to: "customer@example.com",
      from: BIZ_OUTBOUND,
      subject: "Re: I need a plumber",
      body: "We will be in touch.",
    };

    const result = await sendOutboundEmail(params);

    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("EM08: lookupBusinessByEmail with unknown address → returns null", async () => {
    const result = await lookupBusinessByEmail("nobody@nowhere.example.com");
    expect(result).toBeNull();
  });
});
