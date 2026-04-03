// ============================================================
// src/engine/webhooks/__tests__/webhooks.test.ts
//
// TWILIO WEBHOOKS — UNIT TESTS
//
// All tests import from "../index" which does NOT exist yet,
// so the entire suite fails to load (all tests are "failing").
//
// Test categories:
//   SM01-SM07  SMS webhook
//   VO01-VO04  Voice webhook
//   BL01-BL03  Business lookup
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";

// ── Module under test (does not exist yet — all tests will fail) ──
import {
  handleInboundSms,
  handleInboundVoice,
  lookupBusinessByPhone,
  _resetWebhooksStoreForTest,
  _seedBusinessPhoneForTest,
  _setTwilioValidatorForTest,
  _setInboundHandlerForTest,
} from "../index";

// ── Constants from contract ───────────────────────────────────
import {
  EMPTY_TWIML,
  type TwilioSmsPayload,
  type TwilioVoicePayload,
  type InboundHandlerParams,
} from "../contract";

// ── Seed constants ────────────────────────────────────────────

const BIZ_TWILIO_NUMBER = "+15551234567";
const BIZ_ACTUAL_PHONE = "+15550000001";
const CALLER_NUMBER = "+15559876543";

function seedDefaultBusiness(overrides: Record<string, unknown> = {}): void {
  _seedBusinessPhoneForTest({
    twilioNumber: BIZ_TWILIO_NUMBER,
    businessId: "biz_001",
    businessName: "Speedy Plumbing",
    aiCallAnsweringEnabled: true,
    signoffName: "Mike",
    businessPhone: BIZ_ACTUAL_PHONE,
    ...overrides,
  });
}

function makeSmsPayload(overrides: Partial<TwilioSmsPayload> = {}): TwilioSmsPayload {
  return {
    From: CALLER_NUMBER,
    To: BIZ_TWILIO_NUMBER,
    Body: "Hi, I need help with my drain.",
    MessageSid: "SM_test_001",
    NumMedia: "0",
    ...overrides,
  };
}

function makeVoicePayload(overrides: Partial<TwilioVoicePayload> = {}): TwilioVoicePayload {
  return {
    From: CALLER_NUMBER,
    To: BIZ_TWILIO_NUMBER,
    CallSid: "CA_test_001",
    CallStatus: "ringing",
    Direction: "inbound",
    ...overrides,
  };
}

// ── SM: SMS webhook ───────────────────────────────────────────

describe("SM: SMS webhook", () => {
  beforeEach(() => {
    _resetWebhooksStoreForTest();
    _setTwilioValidatorForTest(() => true);
    _setInboundHandlerForTest(async () => ({ success: true }));
    seedDefaultBusiness();
  });

  it("SM01: valid signature + known business → success=true, returns empty TwiML", async () => {
    const result = await handleInboundSms(
      makeSmsPayload(),
      "valid_signature",
      "https://example.com/api/webhooks/sms",
    );

    expect(result.success).toBe(true);
    expect(result.twiml).toBe(EMPTY_TWIML);
    expect(result.businessId).toBe("biz_001");
  });

  it("SM02: invalid signature → returns error, nothing processed", async () => {
    _setTwilioValidatorForTest(() => false);

    let handlerCalled = false;
    _setInboundHandlerForTest(async () => {
      handlerCalled = true;
      return { success: true };
    });

    const result = await handleInboundSms(
      makeSmsPayload(),
      "bad_signature",
      "https://example.com/api/webhooks/sms",
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/403|forbidden|signature/i);
    expect(handlerCalled).toBe(false);
  });

  it("SM03: missing Body → returns 400 error, nothing processed", async () => {
    let handlerCalled = false;
    _setInboundHandlerForTest(async () => {
      handlerCalled = true;
      return { success: true };
    });

    const result = await handleInboundSms(
      { ...makeSmsPayload(), Body: undefined } as unknown as TwilioSmsPayload,
      "valid_signature",
      "https://example.com/api/webhooks/sms",
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/400|bad request|invalid/i);
    expect(handlerCalled).toBe(false);
  });

  it("SM04: unknown To number → returns 404 error, nothing processed", async () => {
    let handlerCalled = false;
    _setInboundHandlerForTest(async () => {
      handlerCalled = true;
      return { success: true };
    });

    const result = await handleInboundSms(
      makeSmsPayload({ To: "+19990000000" }),
      "valid_signature",
      "https://example.com/api/webhooks/sms",
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/404|not found|business/i);
    expect(handlerCalled).toBe(false);
  });

  it("SM05: media URLs extracted from NumMedia + MediaUrl fields and passed to inbound handler", async () => {
    let capturedParams: InboundHandlerParams | undefined;
    _setInboundHandlerForTest(async (params) => {
      capturedParams = params;
      return { success: true };
    });

    await handleInboundSms(
      makeSmsPayload({
        Body: "See the photos",
        NumMedia: "2",
        MediaUrl0: "https://api.twilio.com/media/img0.jpg",
        MediaUrl1: "https://api.twilio.com/media/img1.jpg",
        MediaContentType0: "image/jpeg",
        MediaContentType1: "image/jpeg",
      }),
      "valid_signature",
      "https://example.com/api/webhooks/sms",
    );

    expect(capturedParams?.mediaUrls).toHaveLength(2);
    expect(capturedParams?.mediaUrls).toContain("https://api.twilio.com/media/img0.jpg");
    expect(capturedParams?.mediaUrls).toContain("https://api.twilio.com/media/img1.jpg");
  });

  it("SM06: MessageSid passed through to inbound handler for dedupe", async () => {
    let capturedParams: InboundHandlerParams | undefined;
    _setInboundHandlerForTest(async (params) => {
      capturedParams = params;
      return { success: true };
    });

    await handleInboundSms(
      makeSmsPayload({ MessageSid: "SM_dedupe_abc123" }),
      "valid_signature",
      "https://example.com/api/webhooks/sms",
    );

    expect(capturedParams?.externalId).toBe("SM_dedupe_abc123");
  });

  it("SM07: empty Body with media (media-only message) → still processed successfully", async () => {
    const result = await handleInboundSms(
      makeSmsPayload({
        Body: "",
        NumMedia: "1",
        MediaUrl0: "https://api.twilio.com/media/img0.jpg",
        MediaContentType0: "image/jpeg",
      }),
      "valid_signature",
      "https://example.com/api/webhooks/sms",
    );

    expect(result.success).toBe(true);
    expect(result.twiml).toBe(EMPTY_TWIML);
  });
});

// ── VO: Voice webhook ─────────────────────────────────────────

describe("VO: Voice webhook", () => {
  beforeEach(() => {
    _resetWebhooksStoreForTest();
    _setTwilioValidatorForTest(() => true);
    _setInboundHandlerForTest(async () => ({ success: true }));
    seedDefaultBusiness({ aiCallAnsweringEnabled: true });
  });

  it("VO01: valid signature + known business + AI answering enabled → TwiML with Gather", async () => {
    const result = await handleInboundVoice(
      makeVoicePayload(),
      "valid_signature",
      "https://example.com/api/webhooks/voice",
    );

    expect(result.success).toBe(true);
    expect(result.businessId).toBe("biz_001");
    expect(result.twiml).toContain("<Gather");
  });

  it("VO02: valid signature + known business + AI answering disabled → TwiML with Dial forwarding", async () => {
    _resetWebhooksStoreForTest();
    seedDefaultBusiness({ aiCallAnsweringEnabled: false });

    const result = await handleInboundVoice(
      makeVoicePayload(),
      "valid_signature",
      "https://example.com/api/webhooks/voice",
    );

    expect(result.success).toBe(true);
    expect(result.twiml).toContain("<Dial");
  });

  it("VO03: invalid signature → returns 403 error", async () => {
    _setTwilioValidatorForTest(() => false);

    const result = await handleInboundVoice(
      makeVoicePayload(),
      "bad_signature",
      "https://example.com/api/webhooks/voice",
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/403|forbidden|signature/i);
  });

  it("VO04: unknown To number → returns 404 error", async () => {
    const result = await handleInboundVoice(
      makeVoicePayload({ To: "+19990000000" }),
      "valid_signature",
      "https://example.com/api/webhooks/voice",
    );

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/404|not found|business/i);
  });
});

// ── BL: Business lookup ───────────────────────────────────────

describe("BL: Business lookup", () => {
  beforeEach(() => {
    _resetWebhooksStoreForTest();
    seedDefaultBusiness();
  });

  it("BL01: phone number matches a business → returns businessId and config", async () => {
    const result = await lookupBusinessByPhone(BIZ_TWILIO_NUMBER);

    expect(result).not.toBeNull();
    expect(result?.businessId).toBe("biz_001");
    expect(result?.businessName).toBe("Speedy Plumbing");
    expect(result?.aiCallAnsweringEnabled).toBe(true);
    expect(result?.signoffName).toBe("Mike");
  });

  it("BL02: phone number matches no business → returns null", async () => {
    const result = await lookupBusinessByPhone("+19990000000");
    expect(result).toBeNull();
  });

  it("BL03: lookup normalizes number without leading + to E.164 and still finds business", async () => {
    // "15551234567" (no +) should normalise to "+15551234567" and match
    const result = await lookupBusinessByPhone("15551234567");
    expect(result).not.toBeNull();
    expect(result?.businessId).toBe("biz_001");
  });
});
