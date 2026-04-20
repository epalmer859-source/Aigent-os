// ============================================================
// src/engine/customer-resolver/__tests__/customer-resolver.test.ts
//
// CUSTOMER IDENTITY RESOLVER — CONTRACT + IMPLEMENTATION TESTS
//
// ALL TESTS FAIL until the implementation file is created at:
//   src/engine/customer-resolver/index.ts
//
// The module-not-found import below intentionally causes this
// entire file to fail at load time.
//
// Test categories:
//   A — Contact normalization
//   B — New customer creation
//   C — Existing customer lookup
//   D — Conversation resolution
//   E — Re-open logic (returning customer)
//   F — Edge cases
//
// Prisma is NOT used in tests. The implementation must maintain
// an in-memory store (identical pattern to state-machine/index.ts)
// and expose _resetStoreForTest / _closeConversationForTest /
// _setDoNotContactForTest / _getTagsForTest for test isolation.
// ============================================================

import { describe, it, expect, beforeEach } from "vitest";
import type { ResolveCustomerInput } from "../contract";

// ⚠ This import will fail until the implementation exists.
// That is intentional — all tests below should fail until
// src/engine/customer-resolver/index.ts is created.
import {
  resolveCustomer,
  normalizeContact,
  canonicalizePhone,
  _resetStoreForTest,
  _closeConversationForTest,
  _setDoNotContactForTest,
  _getTagsForTest,
  _setClosedAtForTest,
  _getConversationStateForTest,
  _seedBusinessAutoCloseDaysForTest,
} from "../index";

// ── Test helpers ──────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function makeBizId(): string {
  return `biz-${uid()}`;
}

function makeInput(overrides: Partial<ResolveCustomerInput> = {}): ResolveCustomerInput {
  return {
    businessId: makeBizId(),
    contactType: "phone",
    contactValue: `+1415555${Math.floor(1000 + Math.random() * 9000)}`,
    channel: "sms",
    ...overrides,
  };
}

// Reset in-memory store before every test for full isolation.
beforeEach(() => {
  _resetStoreForTest();
});

// ═══════════════════════════════════════════════════════════════
// A — CONTACT NORMALIZATION
// Source: NormalizeContactFn in contract.ts
// ═══════════════════════════════════════════════════════════════

describe("A — Contact normalization", () => {
  it("A01: phone already in E.164 is returned unchanged", () => {
    const result = normalizeContact("phone", "+12125551234");
    expect(result.isValid).toBe(true);
    expect(result.contactValue).toBe("+12125551234");
  });

  it("A02: phone with formatting characters normalizes to E.164", () => {
    const result = normalizeContact("phone", "(212) 555-1234");
    expect(result.isValid).toBe(true);
    expect(result.contactValue).toBe("+12125551234");
  });

  it("A03: email normalizes to lowercase", () => {
    const result = normalizeContact("email", "User@Example.COM");
    expect(result.isValid).toBe(true);
    expect(result.contactValue).toBe("user@example.com");
  });

  it("A04: phone with letters returns isValid=false", () => {
    const result = normalizeContact("phone", "not-a-phone");
    expect(result.isValid).toBe(false);
  });

  it("A05: email without @ sign returns isValid=false", () => {
    const result = normalizeContact("email", "notanemail");
    expect(result.isValid).toBe(false);
  });

  it("A06: original raw input is preserved in result.original", () => {
    const raw = "(212) 555-1234";
    const result = normalizeContact("phone", raw);
    expect(result.original).toBe(raw);
  });
});

// ═══════════════════════════════════════════════════════════════
// B — NEW CUSTOMER CREATION
// ═══════════════════════════════════════════════════════════════

describe("B — New customer creation", () => {
  it("B01: first contact returns isNew=true on customer", async () => {
    const result = await resolveCustomer(makeInput());
    expect(result.customer.isNew).toBe(true);
  });

  it("B02: new customer gets a non-empty string id", async () => {
    const result = await resolveCustomer(makeInput());
    expect(typeof result.customer.id).toBe("string");
    expect(result.customer.id.length).toBeGreaterThan(0);
  });

  it("B03: new customer defaults to implied_inbound consent", async () => {
    const result = await resolveCustomer(makeInput());
    expect(result.customer.consentStatus).toBe("implied_inbound");
  });

  it("B04: new customer has doNotContact=false", async () => {
    const result = await resolveCustomer(makeInput());
    expect(result.customer.doNotContact).toBe(false);
  });

  it("B05: new customer gets a conversation (not null)", async () => {
    const result = await resolveCustomer(makeInput());
    expect(result.conversation).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// C — EXISTING CUSTOMER LOOKUP
// ═══════════════════════════════════════════════════════════════

describe("C — Existing customer lookup", () => {
  it("C01: second call with same contact returns isNew=false", async () => {
    const input = makeInput();
    await resolveCustomer(input);
    const second = await resolveCustomer(input);
    expect(second.customer.isNew).toBe(false);
  });

  it("C02: same customerId returned on repeated calls", async () => {
    const input = makeInput();
    const first = await resolveCustomer(input);
    const second = await resolveCustomer(input);
    expect(second.customer.id).toBe(first.customer.id);
  });

  it("C03: existing active conversation returned (same id, not duplicated)", async () => {
    const input = makeInput();
    const first = await resolveCustomer(input);
    const second = await resolveCustomer(input);
    expect(second.conversation!.id).toBe(first.conversation!.id);
  });

  it("C04: no new customer record created on repeated calls", async () => {
    const input = makeInput();
    await resolveCustomer(input);
    await resolveCustomer(input);
    const third = await resolveCustomer(input);
    expect(third.customer.isNew).toBe(false);
  });

  it("C05: no new conversation created when active conversation exists", async () => {
    const input = makeInput();
    const first = await resolveCustomer(input);
    const second = await resolveCustomer(input);
    const third = await resolveCustomer(input);
    expect(second.conversation!.id).toBe(first.conversation!.id);
    expect(third.conversation!.id).toBe(first.conversation!.id);
  });
});

// ═══════════════════════════════════════════════════════════════
// D — CONVERSATION RESOLUTION
// ═══════════════════════════════════════════════════════════════

describe("D — Conversation resolution", () => {
  it("D01: new conversation has primaryState = new_lead", async () => {
    const result = await resolveCustomer(makeInput());
    expect(result.conversation!.primaryState).toBe("new_lead");
  });

  it("D02: conversation channel matches input channel sms", async () => {
    const result = await resolveCustomer(makeInput({ channel: "sms" }));
    expect(result.conversation!.channel).toBe("sms");
  });

  it("D03: conversation channel matches input channel voice", async () => {
    const result = await resolveCustomer(makeInput({ channel: "voice" }));
    expect(result.conversation!.channel).toBe("voice");
  });

  it("D04: contact_handle is set to the normalized contact value", async () => {
    const phone = "+12125550001";
    const result = await resolveCustomer(makeInput({ contactValue: phone }));
    expect(result.conversation!.contactHandle).toBe(phone);
  });

  it("D05: contactDisplayName stored when provided", async () => {
    const result = await resolveCustomer(makeInput({ contactDisplayName: "Jane Doe" }));
    expect(result.conversation!.contactDisplayName).toBe("Jane Doe");
  });

  it("D06: contactDisplayName is null when not provided", async () => {
    const { contactDisplayName: _ignored, ...withoutName } = makeInput();
    const result = await resolveCustomer(withoutName);
    expect(result.conversation!.contactDisplayName).toBeNull();
  });

  it("D07: matterKey is a non-empty string", async () => {
    const result = await resolveCustomer(makeInput());
    expect(typeof result.conversation!.matterKey).toBe("string");
    expect(result.conversation!.matterKey.length).toBeGreaterThan(0);
  });

  it("D08: conversation businessId matches input businessId", async () => {
    const bizId = makeBizId();
    const result = await resolveCustomer(makeInput({ businessId: bizId }));
    expect(result.conversation!.businessId).toBe(bizId);
  });
});

// ═══════════════════════════════════════════════════════════════
// E — RE-OPEN LOGIC (returning customer)
// Blueprint rule: new contact after closed → NEW conversation,
//   isReopened = true, repeat_customer tag added.
// ═══════════════════════════════════════════════════════════════

describe("E — Re-open logic", () => {
  it("E01: isReopened=false for brand new customer", async () => {
    const result = await resolveCustomer(makeInput());
    expect(result.conversation!.isReopened).toBe(false);
  });

  it("E02: isReopened=false when active conversation already exists", async () => {
    const input = makeInput();
    await resolveCustomer(input);
    const second = await resolveCustomer(input);
    expect(second.conversation!.isReopened).toBe(false);
  });

  it("E03: new conversation id created after prior conversation is closed", async () => {
    const input = makeInput();
    const first = await resolveCustomer(input);
    _closeConversationForTest(first.conversation!.id);
    const second = await resolveCustomer(input);
    expect(second.conversation!.id).not.toBe(first.conversation!.id);
  });

  it("E04: isReopened=true when prior closed conversation exists", async () => {
    const input = makeInput();
    const first = await resolveCustomer(input);
    _closeConversationForTest(first.conversation!.id);
    const second = await resolveCustomer(input);
    expect(second.conversation!.isReopened).toBe(true);
  });

  it("E05: new conversation after re-open starts at primary_state = new_lead", async () => {
    const input = makeInput();
    const first = await resolveCustomer(input);
    _closeConversationForTest(first.conversation!.id);
    const second = await resolveCustomer(input);
    expect(second.conversation!.primaryState).toBe("new_lead");
  });

  it("E06: repeat_customer tag added when prior closed conversation exists", async () => {
    const input = makeInput();
    const first = await resolveCustomer(input);
    _closeConversationForTest(first.conversation!.id);
    const second = await resolveCustomer(input);
    const tags = _getTagsForTest(second.conversation!.id) as Array<{
      tagCode: string;
      isActive: boolean;
    }>;
    expect(tags.some((t) => t.tagCode === "repeat_customer" && t.isActive)).toBe(true);
  });

  it("E07: existing customer, conversation closed BEYOND auto_close_days — creates new conversation", async () => {
    // Default auto_close_days = 30; closed_at = 60 days ago is beyond the window.
    const input = makeInput();
    const first = await resolveCustomer(input);
    _closeConversationForTest(first.conversation!.id);
    _setClosedAtForTest(first.conversation!.id, 60); // backdate to 60 days ago

    const second = await resolveCustomer(input);

    expect(second.conversation!.id).not.toBe(first.conversation!.id);
    expect(second.conversation!.matterKey).not.toBe(first.conversation!.matterKey);
    expect(second.conversation!.primaryState).toBe("new_lead");
    expect(second.conversation!.currentOwner).toBe("ai");
    const tags = _getTagsForTest(second.conversation!.id) as Array<{
      tagCode: string;
      isActive: boolean;
    }>;
    expect(tags.some((t) => t.tagCode === "repeat_customer" && t.isActive)).toBe(true);
    expect(second.conversation!.isReopened).toBe(false);
    // Old conversation must remain closed — resolve must not mutate it.
    const oldState = _getConversationStateForTest(first.conversation!.id);
    expect(oldState?.primaryState).toBe("closed_completed");
  });

  it("E08: existing customer, conversation closed BEYOND custom auto_close_days — respects business setting", async () => {
    // Custom window of 7 days; closed_at = 10 days ago is beyond that window.
    const bizId = makeBizId();
    _seedBusinessAutoCloseDaysForTest(bizId, 7);
    const input = makeInput({ businessId: bizId });

    const first = await resolveCustomer(input);
    _closeConversationForTest(first.conversation!.id);
    _setClosedAtForTest(first.conversation!.id, 10); // backdate to 10 days ago

    const second = await resolveCustomer(input);

    expect(second.conversation!.id).not.toBe(first.conversation!.id);
    expect(second.conversation!.matterKey).not.toBe(first.conversation!.matterKey);
    expect(second.conversation!.primaryState).toBe("new_lead");
    expect(second.conversation!.currentOwner).toBe("ai");
    const tags = _getTagsForTest(second.conversation!.id) as Array<{
      tagCode: string;
      isActive: boolean;
    }>;
    expect(tags.some((t) => t.tagCode === "repeat_customer" && t.isActive)).toBe(true);
    expect(second.conversation!.isReopened).toBe(false);
    // Old conversation must remain closed — resolve must not mutate it.
    const oldState = _getConversationStateForTest(first.conversation!.id);
    expect(oldState?.primaryState).toBe("closed_completed");
  });
});

// ═══════════════════════════════════════════════════════════════
// F — EDGE CASES
// ═══════════════════════════════════════════════════════════════

describe("F — Edge cases", () => {
  it("F01: do_not_contact customer returns null conversation", async () => {
    const input = makeInput();
    const first = await resolveCustomer(input);
    _setDoNotContactForTest(first.customer.id);
    const second = await resolveCustomer(input);
    expect(second.conversation).toBeNull();
  });

  it("F02: do_not_contact customer still returns customer record with correct id", async () => {
    const input = makeInput();
    const first = await resolveCustomer(input);
    _setDoNotContactForTest(first.customer.id);
    const second = await resolveCustomer(input);
    expect(second.customer.id).toBe(first.customer.id);
    expect(second.customer.doNotContact).toBe(true);
  });

  it("F03: formatted phone and E.164 phone resolve to the same customer", async () => {
    const bizId = makeBizId();
    const formatted = await resolveCustomer(
      makeInput({ businessId: bizId, contactValue: "(212) 555-0099" }),
    );
    const e164 = await resolveCustomer(
      makeInput({ businessId: bizId, contactValue: "+12125550099" }),
    );
    expect(e164.customer.id).toBe(formatted.customer.id);
  });

  it("F04: email contactType resolves and normalizes correctly", async () => {
    const result = await resolveCustomer(
      makeInput({
        contactType: "email",
        contactValue: "CUSTOMER@EXAMPLE.COM",
        channel: "email",
      }),
    );
    expect(result.customer.isNew).toBe(true);
    expect(result.conversation!.contactHandle).toBe("customer@example.com");
  });
});

// ═══════════════════════════════════════════════════════════════
// G — canonicalizePhone
// ═══════════════════════════════════════════════════════════════

describe("G — canonicalizePhone", () => {
  it("G01: 10-digit US number → +1 prefix", () => {
    expect(canonicalizePhone("4758679800")).toBe("+14758679800");
  });

  it("G02: formatted US number → stripped and +1 prefix", () => {
    expect(canonicalizePhone("(475) 867-9800")).toBe("+14758679800");
  });

  it("G03: 11-digit starting with 1 → +1 prefix", () => {
    expect(canonicalizePhone("14758679800")).toBe("+14758679800");
  });

  it("G04: already E.164 → unchanged", () => {
    expect(canonicalizePhone("+14758679800")).toBe("+14758679800");
  });

  it("G05: too short → null", () => {
    expect(canonicalizePhone("123456")).toBeNull();
  });

  it("G06: contains letters → null", () => {
    expect(canonicalizePhone("475-abc-9800")).toBeNull();
  });

  it("G07: empty string → null", () => {
    expect(canonicalizePhone("")).toBeNull();
  });

  it("G08: different formatting produces same canonical output", () => {
    const variants = ["4758679800", "(475) 867-9800", "475-867-9800", "+14758679800", "1-475-867-9800"];
    const results = variants.map(canonicalizePhone);
    expect(new Set(results).size).toBe(1);
    expect(results[0]).toBe("+14758679800");
  });
});

// ═══════════════════════════════════════════════════════════════
// H — Customer dedup via phone
// ═══════════════════════════════════════════════════════════════

describe("H — Customer dedup via phone", () => {
  beforeEach(() => _resetStoreForTest());

  it("H01: second conversation with same phone reuses existing customer_id", async () => {
    const biz = makeBizId();
    const first = await resolveCustomer(makeInput({
      businessId: biz,
      contactType: "phone",
      contactValue: "4758679800",
      channel: "sms",
    }));
    expect(first.customer.isNew).toBe(true);
    const originalCustomerId = first.customer.id;

    const second = await resolveCustomer(makeInput({
      businessId: biz,
      contactType: "phone",
      contactValue: "(475) 867-9800",
      channel: "sms",
    }));
    expect(second.customer.isNew).toBe(false);
    expect(second.customer.id).toBe(originalCustomerId);
  });
});
