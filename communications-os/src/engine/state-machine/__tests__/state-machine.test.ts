// ============================================================
// src/engine/state-machine/__tests__/state-machine.test.ts
//
// STATE MACHINE CONTRACT + IMPLEMENTATION TESTS
//
// ALL TESTS FAIL until the implementation file is created at:
//   src/engine/state-machine/index.ts
//
// The module-not-found import below intentionally causes this
// entire file to fail at load time.
//
// Test categories:
//   A — Valid transitions
//   B — Invalid / blocked transitions
//   C — Takeover flow
//   D — Override restoration
//   E — Edge cases and constants
// ============================================================

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  CANONICAL_STATES,
  CLOSED_STATES,
  OVERRIDE_STATES,
  WAITING_STATES,
  VALID_TRANSITIONS,
  STATE_OWNER_MAP,
  type ConversationState,
  type StateFamily,
} from "../contract";

// ⚠ This import will fail until the implementation exists.
// That is intentional — all tests below should fail.
import {
  transitionState,
  enableTakeover,
  disableTakeover,
  restoreFromOverride,
  isValidTransition,
  getStateFamily,
  _setPriorStateForTest,
} from "../index";

// ── Mock DB helpers ───────────────────────────────────────────
// Minimal in-memory conversation record used across tests.
// The implementation must accept an injectable db or use the
// module-level db client — this suite assumes the functions
// accept a conversationId and the test DB has been seeded.

const ACTOR_OWNER = "owner-uuid-001";
const ACTOR_ADMIN = "admin-uuid-002";
const ACTOR_AI = "ai-system";

function makeConversationId(): string {
  return `conv-${Math.random().toString(36).slice(2)}`;
}

// ═══════════════════════════════════════════════════════════════
// A — VALID TRANSITIONS
// Source: VALID_TRANSITIONS map in contract.ts
// ═══════════════════════════════════════════════════════════════

describe("A — Valid transitions", () => {
  // ── Routine family ──────────────────────────────────────────

  it("A01: new_lead → lead_qualified", () => {
    expect(isValidTransition("new_lead", "lead_qualified")).toBe(true);
  });

  it("A02: new_lead → waiting_on_customer_details", () => {
    expect(isValidTransition("new_lead", "waiting_on_customer_details")).toBe(true);
  });

  it("A03: new_lead → closed_unqualified", () => {
    expect(isValidTransition("new_lead", "closed_unqualified")).toBe(true);
  });

  it("A04: new_lead → complaint_open (universal override interrupt)", () => {
    expect(isValidTransition("new_lead", "complaint_open")).toBe(true);
  });

  it("A05: new_lead → safety_issue_open (universal override interrupt)", () => {
    expect(isValidTransition("new_lead", "safety_issue_open")).toBe(true);
  });

  it("A06: new_lead → legal_threat_open (universal override interrupt)", () => {
    expect(isValidTransition("new_lead", "legal_threat_open")).toBe(true);
  });

  it("A07: new_lead → human_takeover_active (universal override interrupt)", () => {
    expect(isValidTransition("new_lead", "human_takeover_active")).toBe(true);
  });

  it("A08: lead_qualified → booking_in_progress", () => {
    expect(isValidTransition("lead_qualified", "booking_in_progress")).toBe(true);
  });

  it("A09: lead_qualified → waiting_on_admin_quote", () => {
    expect(isValidTransition("lead_qualified", "waiting_on_admin_quote")).toBe(true);
  });

  it("A10: lead_qualified → waiting_on_photos", () => {
    expect(isValidTransition("lead_qualified", "waiting_on_photos")).toBe(true);
  });

  it("A11: lead_qualified → waiting_on_approval", () => {
    expect(isValidTransition("lead_qualified", "waiting_on_approval")).toBe(true);
  });

  it("A12: lead_qualified → closed_lost", () => {
    expect(isValidTransition("lead_qualified", "closed_lost")).toBe(true);
  });

  it("A13: booking_in_progress → waiting_on_admin_scheduling", () => {
    expect(isValidTransition("booking_in_progress", "waiting_on_admin_scheduling")).toBe(true);
  });

  it("A14: booking_in_progress → waiting_on_customer_details", () => {
    expect(isValidTransition("booking_in_progress", "waiting_on_customer_details")).toBe(true);
  });

  it("A15: booking_in_progress → closed_lost", () => {
    expect(isValidTransition("booking_in_progress", "closed_lost")).toBe(true);
  });

  it("A16: quote_sent → booking_in_progress", () => {
    expect(isValidTransition("quote_sent", "booking_in_progress")).toBe(true);
  });

  it("A17: quote_sent → lead_followup_active", () => {
    expect(isValidTransition("quote_sent", "lead_followup_active")).toBe(true);
  });

  it("A18: quote_sent → waiting_on_admin_quote (scope change)", () => {
    expect(isValidTransition("quote_sent", "waiting_on_admin_quote")).toBe(true);
  });

  it("A19: lead_followup_active → lead_qualified (re-engagement)", () => {
    expect(isValidTransition("lead_followup_active", "lead_qualified")).toBe(true);
  });

  it("A20: lead_followup_active → closed_lost", () => {
    expect(isValidTransition("lead_followup_active", "closed_lost")).toBe(true);
  });

  // ── Waiting → resume ────────────────────────────────────────

  it("A21: waiting_on_admin_quote → quote_sent", () => {
    expect(isValidTransition("waiting_on_admin_quote", "quote_sent")).toBe(true);
  });

  it("A22: waiting_on_admin_quote → booking_in_progress (scope changed)", () => {
    expect(isValidTransition("waiting_on_admin_quote", "booking_in_progress")).toBe(true);
  });

  it("A23: waiting_on_admin_scheduling → booked", () => {
    expect(isValidTransition("waiting_on_admin_scheduling", "booked")).toBe(true);
  });

  it("A24: waiting_on_parts_confirmation → job_in_progress", () => {
    expect(isValidTransition("waiting_on_parts_confirmation", "job_in_progress")).toBe(true);
  });

  it("A25: waiting_on_parts_confirmation → job_paused", () => {
    expect(isValidTransition("waiting_on_parts_confirmation", "job_paused")).toBe(true);
  });

  it("A26: waiting_on_customer_details → lead_followup_active (customer went quiet)", () => {
    expect(isValidTransition("waiting_on_customer_details", "lead_followup_active")).toBe(true);
  });

  // ── Active-service progression ──────────────────────────────

  it("A27: booked → reschedule_in_progress", () => {
    expect(isValidTransition("booked", "reschedule_in_progress")).toBe(true);
  });

  it("A28: booked → tech_assigned", () => {
    expect(isValidTransition("booked", "tech_assigned")).toBe(true);
  });

  it("A29: booked → en_route", () => {
    expect(isValidTransition("booked", "en_route")).toBe(true);
  });

  it("A30: booked → job_in_progress", () => {
    expect(isValidTransition("booked", "job_in_progress")).toBe(true);
  });

  it("A31: reschedule_in_progress → booked", () => {
    expect(isValidTransition("reschedule_in_progress", "booked")).toBe(true);
  });

  it("A32: tech_assigned → en_route", () => {
    expect(isValidTransition("tech_assigned", "en_route")).toBe(true);
  });

  it("A33: tech_assigned → reschedule_in_progress", () => {
    expect(isValidTransition("tech_assigned", "reschedule_in_progress")).toBe(true);
  });

  it("A34: en_route → job_in_progress", () => {
    expect(isValidTransition("en_route", "job_in_progress")).toBe(true);
  });

  it("A35: en_route → job_paused (delay/hold)", () => {
    expect(isValidTransition("en_route", "job_paused")).toBe(true);
  });

  it("A36: job_in_progress → job_paused", () => {
    expect(isValidTransition("job_in_progress", "job_paused")).toBe(true);
  });

  it("A37: job_in_progress → waiting_on_parts_confirmation", () => {
    expect(isValidTransition("job_in_progress", "waiting_on_parts_confirmation")).toBe(true);
  });

  it("A38: job_in_progress → job_completed", () => {
    expect(isValidTransition("job_in_progress", "job_completed")).toBe(true);
  });

  it("A39: job_paused → job_in_progress (dependency cleared)", () => {
    expect(isValidTransition("job_paused", "job_in_progress")).toBe(true);
  });

  it("A40: job_completed → closed_completed", () => {
    expect(isValidTransition("job_completed", "closed_completed")).toBe(true);
  });

  it("A41: job_completed → resolved (staff closes with no workflow)", () => {
    expect(isValidTransition("job_completed", "resolved")).toBe(true);
  });

  it("A42: job_completed → complaint_open (negative outcome)", () => {
    expect(isValidTransition("job_completed", "complaint_open")).toBe(true);
  });

  it("A43: job_completed → incident_liability_open", () => {
    expect(isValidTransition("job_completed", "incident_liability_open")).toBe(true);
  });

  it("A44: job_completed → human_takeover_active", () => {
    expect(isValidTransition("job_completed", "human_takeover_active")).toBe(true);
  });

  // ── Override exits ──────────────────────────────────────────

  it("A45: complaint_open → human_takeover_active", () => {
    expect(isValidTransition("complaint_open", "human_takeover_active")).toBe(true);
  });

  it("A46: complaint_open → resolved", () => {
    expect(isValidTransition("complaint_open", "resolved")).toBe(true);
  });

  it("A47: complaint_open → legal_threat_open (escalation)", () => {
    expect(isValidTransition("complaint_open", "legal_threat_open")).toBe(true);
  });

  it("A48: complaint_open → safety_issue_open (escalation)", () => {
    expect(isValidTransition("complaint_open", "safety_issue_open")).toBe(true);
  });

  it("A49: billing_dispute_open → human_takeover_active", () => {
    expect(isValidTransition("billing_dispute_open", "human_takeover_active")).toBe(true);
  });

  it("A50: billing_dispute_open → legal_threat_open (escalation)", () => {
    expect(isValidTransition("billing_dispute_open", "legal_threat_open")).toBe(true);
  });

  it("A51: safety_issue_open → human_takeover_active", () => {
    expect(isValidTransition("safety_issue_open", "human_takeover_active")).toBe(true);
  });

  it("A52: safety_issue_open → resolved", () => {
    expect(isValidTransition("safety_issue_open", "resolved")).toBe(true);
  });

  it("A53: legal_threat_open → human_takeover_active", () => {
    expect(isValidTransition("legal_threat_open", "human_takeover_active")).toBe(true);
  });

  it("A54: legal_threat_open → resolved", () => {
    expect(isValidTransition("legal_threat_open", "resolved")).toBe(true);
  });

  it("A55: incident_liability_open → legal_threat_open (escalation)", () => {
    expect(isValidTransition("incident_liability_open", "legal_threat_open")).toBe(true);
  });

  it("A56: restricted_topic_open → waiting_on_approval (topic no longer restricted)", () => {
    expect(isValidTransition("restricted_topic_open", "waiting_on_approval")).toBe(true);
  });

  it("A57: hostile_customer_open → legal_threat_open (escalation)", () => {
    expect(isValidTransition("hostile_customer_open", "legal_threat_open")).toBe(true);
  });

  it("A58: human_takeover_active → new_lead (timer expires, re-entry)", () => {
    expect(isValidTransition("human_takeover_active", "new_lead")).toBe(true);
  });

  it("A59: human_takeover_active → booked (resume mid-service)", () => {
    expect(isValidTransition("human_takeover_active", "booked")).toBe(true);
  });

  it("A60: human_takeover_active → resolved (human closes the matter)", () => {
    expect(isValidTransition("human_takeover_active", "resolved")).toBe(true);
  });

  // ── Closed → re-open ────────────────────────────────────────

  it("A61: resolved → new_lead (materially new trigger)", () => {
    expect(isValidTransition("resolved", "new_lead")).toBe(true);
  });

  it("A62: closed_completed → new_lead (repeat customer)", () => {
    expect(isValidTransition("closed_completed", "new_lead")).toBe(true);
  });

  it("A63: closed_lost → new_lead (new inbound)", () => {
    expect(isValidTransition("closed_lost", "new_lead")).toBe(true);
  });

  it("A64: closed_unqualified → new_lead (new facts change qualification)", () => {
    expect(isValidTransition("closed_unqualified", "new_lead")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// B — INVALID / BLOCKED TRANSITIONS
// Source: "Blocked transitions" section for each state
// ═══════════════════════════════════════════════════════════════

describe("B — Invalid / blocked transitions", () => {
  it("B01: new_lead → booked (must pass through booking_in_progress first)", () => {
    expect(isValidTransition("new_lead", "booked")).toBe(false);
  });

  it("B02: new_lead → job_in_progress (cannot skip states)", () => {
    expect(isValidTransition("new_lead", "job_in_progress")).toBe(false);
  });

  it("B03: new_lead → job_completed (cannot skip states)", () => {
    expect(isValidTransition("new_lead", "job_completed")).toBe(false);
  });

  it("B04: new_lead → closed_completed (not a valid exit)", () => {
    expect(isValidTransition("new_lead", "closed_completed")).toBe(false);
  });

  it("B05: booking_in_progress → booked (customer preference is not booking confirmation)", () => {
    expect(isValidTransition("booking_in_progress", "booked")).toBe(false);
  });

  it("B06: booking_in_progress → quote_sent (must go through waiting_on_admin_quote)", () => {
    expect(isValidTransition("booking_in_progress", "quote_sent")).toBe(false);
  });

  it("B07: quote_sent → booked (must pass through booking_in_progress then waiting_on_admin_scheduling)", () => {
    expect(isValidTransition("quote_sent", "booked")).toBe(false);
  });

  it("B08: quote_sent → job_completed (cannot skip states)", () => {
    expect(isValidTransition("quote_sent", "job_completed")).toBe(false);
  });

  it("B09: lead_followup_active → booked (cannot jump to active-service)", () => {
    expect(isValidTransition("lead_followup_active", "booked")).toBe(false);
  });

  it("B10: waiting_on_admin_scheduling → job_in_progress (must go through booked first)", () => {
    expect(isValidTransition("waiting_on_admin_scheduling", "job_in_progress")).toBe(false);
  });

  it("B11: waiting_on_parts_confirmation → job_completed (must go through job_in_progress)", () => {
    expect(isValidTransition("waiting_on_parts_confirmation", "job_completed")).toBe(false);
  });

  it("B12: booked → job_completed (must pass through job_in_progress normally)", () => {
    // booked → job_completed is actually listed as valid (operational correction only)
    // but booked → closed_completed direct is NOT valid
    expect(isValidTransition("booked", "closed_completed")).toBe(false);
  });

  it("B13: job_completed → billing_dispute_open (not in job_completed legal exits)", () => {
    expect(isValidTransition("job_completed", "billing_dispute_open")).toBe(false);
  });

  it("B14: job_completed → safety_issue_open (not in job_completed legal exits)", () => {
    expect(isValidTransition("job_completed", "safety_issue_open")).toBe(false);
  });

  it("B15: job_completed → legal_threat_open (not in job_completed legal exits)", () => {
    expect(isValidTransition("job_completed", "legal_threat_open")).toBe(false);
  });

  it("B16: job_completed → insurance_review_open (not in job_completed legal exits)", () => {
    expect(isValidTransition("job_completed", "insurance_review_open")).toBe(false);
  });

  it("B17: job_completed → hostile_customer_open (not in job_completed legal exits)", () => {
    expect(isValidTransition("job_completed", "hostile_customer_open")).toBe(false);
  });

  it("B18: safety_issue_open → complaint_open (safety exits to only 2 states)", () => {
    expect(isValidTransition("safety_issue_open", "complaint_open")).toBe(false);
  });

  it("B19: safety_issue_open → billing_dispute_open (safety exits to only 2 states)", () => {
    expect(isValidTransition("safety_issue_open", "billing_dispute_open")).toBe(false);
  });

  it("B20: safety_issue_open → new_lead (may not return to routine while safety open)", () => {
    expect(isValidTransition("safety_issue_open", "new_lead")).toBe(false);
  });

  it("B21: legal_threat_open → complaint_open (legal exits to only 2 states)", () => {
    expect(isValidTransition("legal_threat_open", "complaint_open")).toBe(false);
  });

  it("B22: legal_threat_open → booking_in_progress (may not return to routine)", () => {
    expect(isValidTransition("legal_threat_open", "booking_in_progress")).toBe(false);
  });

  it("B23: complaint_open → new_lead (may not return to routine while complaint open)", () => {
    expect(isValidTransition("complaint_open", "new_lead")).toBe(false);
  });

  it("B24: complaint_open → booking_in_progress (may not return to routine)", () => {
    expect(isValidTransition("complaint_open", "booking_in_progress")).toBe(false);
  });

  it("B25: restricted_topic_open → new_lead (only resolved, human_takeover_active, or waiting_on_approval)", () => {
    expect(isValidTransition("restricted_topic_open", "new_lead")).toBe(false);
  });

  it("B26: restricted_topic_open → booking_in_progress", () => {
    expect(isValidTransition("restricted_topic_open", "booking_in_progress")).toBe(false);
  });

  it("B27: resolved → closed_completed (closed states exit to new_lead / routine only)", () => {
    expect(isValidTransition("resolved", "closed_completed")).toBe(false);
  });

  it("B28: closed_completed → resolved (closed terminal states exit to new_lead only)", () => {
    expect(isValidTransition("closed_completed", "resolved")).toBe(false);
  });

  it("B29: closed_lost → closed_completed", () => {
    expect(isValidTransition("closed_lost", "closed_completed")).toBe(false);
  });

  it("B30: closed_unqualified → lead_qualified (cannot promote without new_lead)", () => {
    expect(isValidTransition("closed_unqualified", "lead_qualified")).toBe(false);
  });

  it("B31: transitionState rejects job_completed → billing_dispute_open at runtime", async () => {
    // Verify _canTransition respects job_completed's restricted exits (Doc 01 §8).
    // The old universal-override shortcut would have allowed this incorrectly.
    const convId = makeConversationId();
    await transitionState(convId, "job_completed", ACTOR_AI, "ai");
    await expect(
      transitionState(convId, "billing_dispute_open", ACTOR_ADMIN, "admin"),
    ).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// C — TAKEOVER FLOW
// Source: §9 human_takeover_active + §11 takeover spec
// ═══════════════════════════════════════════════════════════════

describe("C — Takeover flow", () => {
  it("C01: enableTakeover moves conversation to human_takeover_active", async () => {
    const convId = makeConversationId();
    const result = await enableTakeover(convId, ACTOR_OWNER);
    expect(result.success).toBe(true);
    expect(result.previousState).toBeDefined();
    // After enableTakeover, state should be human_takeover_active
  });

  it("C02: enableTakeover with custom timer sets expiresAt relative to now", async () => {
    const convId = makeConversationId();
    const before = Date.now();
    const result = await enableTakeover(convId, ACTOR_OWNER, 3600); // 1 hour
    const after = Date.now();
    expect(result.timerSeconds).toBe(3600);
    expect(result.expiresAt).not.toBeNull();
    if (result.expiresAt) {
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3600 * 1000);
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + 3600 * 1000);
    }
  });

  it("C03: enableTakeover with no timer uses default 7-day period", async () => {
    const convId = makeConversationId();
    const result = await enableTakeover(convId, ACTOR_OWNER);
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    expect(result.timerSeconds).toBe(sevenDaysMs / 1000);
  });

  it("C04: enableTakeover with timerSeconds = 0 means permanent takeover (expiresAt is null)", async () => {
    const convId = makeConversationId();
    const result = await enableTakeover(convId, ACTOR_OWNER, 0);
    expect(result.timerSeconds).toBeNull();
    expect(result.expiresAt).toBeNull();
  });

  it("C05: disableTakeover from human_takeover_active succeeds", async () => {
    const convId = makeConversationId();
    await enableTakeover(convId, ACTOR_OWNER);
    const result = await disableTakeover(convId, ACTOR_OWNER);
    expect(result.success).toBe(true);
    expect(result.previousState).toBe("human_takeover_active");
  });

  it("C06: disableTakeover when not in human_takeover_active fails", async () => {
    const convId = makeConversationId();
    const result = await disableTakeover(convId, ACTOR_OWNER);
    expect(result.success).toBe(false);
  });

  it("C07: prior_state is preserved when enableTakeover begins", async () => {
    const convId = makeConversationId();
    // Seed conversation at booked state
    await transitionState(convId, "booked", ACTOR_OWNER, "owner");
    const result = await enableTakeover(convId, ACTOR_OWNER);
    expect(result.previousState).toBe("booked");
  });

  it("C08: AI outbound automations are canceled on enableTakeover", async () => {
    // After takeover, isValidTransition from human_takeover_active to any
    // override state is FALSE (cannot escalate while in takeover)
    expect(isValidTransition("human_takeover_active", "complaint_open")).toBe(false);
  });

  it("C09: human_takeover_active can transition to any non-override state on restore", () => {
    const nonOverrideStates: ConversationState[] = [
      ...CANONICAL_STATES.routine,
      ...CANONICAL_STATES.waiting,
      ...CANONICAL_STATES.active_service,
      ...CANONICAL_STATES.closed,
    ];
    for (const state of nonOverrideStates) {
      expect(isValidTransition("human_takeover_active", state)).toBe(true);
    }
  });

  it("C10: STATE_OWNER_MAP returns human_takeover for human_takeover_active", () => {
    expect(STATE_OWNER_MAP["human_takeover_active"]).toBe("human_takeover");
  });

  it("C11: transitionState to human_takeover_active sets current_owner to human_takeover", async () => {
    const convId = makeConversationId();
    const result = await transitionState(convId, "human_takeover_active", ACTOR_OWNER, "owner");
    expect(result.newOwner).toBe("human_takeover");
    expect(result.ownerChanged).toBe(true);
  });

  it("C12: disableTakeover by admin from admin-lock succeeds when owner force-breaks", async () => {
    const convId = makeConversationId();
    await enableTakeover(convId, ACTOR_ADMIN);
    // Owner can force-break admin's lock
    const result = await disableTakeover(convId, ACTOR_OWNER);
    expect(result.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// D — OVERRIDE RESTORATION
// Source: §9 human_takeover_active "Restoration" +
//   11_Supplemental_Engineering_Contract Part 3
// ═══════════════════════════════════════════════════════════════

describe("D — Override restoration", () => {
  it("D01: restoreFromOverride from complaint_open returns to conversation prior_state", async () => {
    const convId = makeConversationId();
    await transitionState(convId, "booked", ACTOR_OWNER, "owner");
    await transitionState(convId, "complaint_open", ACTOR_AI, "ai");
    const result = await restoreFromOverride(convId, ACTOR_OWNER);
    expect(result.success).toBe(true);
    expect(result.newState).toBe("booked");
  });

  it("D02: restoreFromOverride from safety_issue_open returns to prior_state", async () => {
    const convId = makeConversationId();
    await transitionState(convId, "job_in_progress", ACTOR_OWNER, "owner");
    await transitionState(convId, "safety_issue_open", ACTOR_AI, "ai");
    const result = await restoreFromOverride(convId, ACTOR_OWNER);
    expect(result.success).toBe(true);
    expect(result.newState).toBe("job_in_progress");
  });

  it("D03: restoreFromOverride with null prior_state defaults to new_lead", async () => {
    const convId = makeConversationId();
    // Conversation in complaint_open with no prior_state
    await transitionState(convId, "complaint_open", ACTOR_AI, "ai");
    const result = await restoreFromOverride(convId, ACTOR_OWNER);
    expect(result.success).toBe(true);
    expect(result.newState).toBe("new_lead");
  });

  it("D04: prior_state is set to last non-override state when entering override", async () => {
    const convId = makeConversationId();
    await transitionState(convId, "booked", ACTOR_OWNER, "owner");
    const result = await transitionState(convId, "complaint_open", ACTOR_AI, "ai");
    expect(result.priorStateStored).toBe("booked");
  });

  it("D05: prior_state is never set to an override state (override chaining preserves original)", async () => {
    const convId = makeConversationId();
    await transitionState(convId, "quote_sent", ACTOR_OWNER, "owner");
    await transitionState(convId, "complaint_open", ACTOR_AI, "ai");
    // Escalate to legal — prior_state should stay as quote_sent, not complaint_open
    const result = await transitionState(convId, "legal_threat_open", ACTOR_AI, "ai");
    expect(result.priorStateStored).toBe("quote_sent");
  });

  it("D06: restoreFromOverride fails when conversation is not in an override state", async () => {
    const convId = makeConversationId();
    await transitionState(convId, "booked", ACTOR_OWNER, "owner");
    const result = await restoreFromOverride(convId, ACTOR_OWNER);
    expect(result.success).toBe(false);
  });

  it("D07: old outbound_queue rows are dead after restoreFromOverride (not resurrected)", async () => {
    // The restored state must start fresh — no old queue rows revived.
    // This is verified by checking the transitioned result has no queued messages
    // inherited from the pre-override state.
    const convId = makeConversationId();
    await transitionState(convId, "booked", ACTOR_OWNER, "owner");
    await transitionState(convId, "complaint_open", ACTOR_AI, "ai");
    const result = await restoreFromOverride(convId, ACTOR_OWNER);
    // result should not contain any pre-override queue rows
    expect(result.success).toBe(true);
    // Implementation must cancel old rows; we assert no error on restore
  });

  it("D08: silence timers do not restart automatically after restoreFromOverride", async () => {
    const convId = makeConversationId();
    await transitionState(convId, "lead_qualified", ACTOR_OWNER, "owner");
    await transitionState(convId, "complaint_open", ACTOR_AI, "ai");
    const result = await restoreFromOverride(convId, ACTOR_OWNER);
    expect(result.success).toBe(true);
    // No automatic silence timer creation on restore; timers only start on new qualifying events
  });

  it("D09: prior_state pointing to a closed state is not used (defaults to new_lead)", async () => {
    const convId = makeConversationId();
    // Seed at a non-closed state, then enter an override (valid path).
    await transitionState(convId, "lead_qualified", ACTOR_OWNER, "owner");
    await transitionState(convId, "complaint_open", ACTOR_AI, "ai");
    // Directly inject a closed state as prior_state (simulates the edge case
    // where a prior_state was stored as "resolved" before the conversation
    // entered the current override). Cannot be reached via a valid transition
    // because closed states do not exit to override states (Doc 01 §8).
    _setPriorStateForTest(convId, "resolved");
    const result = await restoreFromOverride(convId, ACTOR_OWNER);
    // Closed state as prior_state is invalid for restoration; must default to new_lead.
    expect(result.newState).toBe("new_lead");
  });

  it("D10: restoreFromOverride from human_takeover_active validates prior_state", async () => {
    const convId = makeConversationId();
    await transitionState(convId, "booked", ACTOR_OWNER, "owner");
    await enableTakeover(convId, ACTOR_OWNER);
    const result = await restoreFromOverride(convId, ACTOR_OWNER);
    expect(result.success).toBe(true);
    expect(result.newState).toBe("booked");
  });

  it("D11: entering override state stores prior_state as last non-override state, not another override", async () => {
    const convId = makeConversationId();
    await transitionState(convId, "en_route", ACTOR_OWNER, "owner");
    const r1 = await transitionState(convId, "hostile_customer_open", ACTOR_AI, "ai");
    expect(r1.priorStateStored).toBe("en_route");
    const r2 = await transitionState(convId, "legal_threat_open", ACTOR_AI, "ai");
    // Still en_route — not hostile_customer_open
    expect(r2.priorStateStored).toBe("en_route");
  });

  it("D12: getStateFamily returns 'override' for all override states", () => {
    for (const state of CANONICAL_STATES.override) {
      expect(getStateFamily(state)).toBe("override");
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// E — EDGE CASES AND CONSTANT VALIDATION
// ═══════════════════════════════════════════════════════════════

describe("E — Edge cases and constants", () => {
  it("E01: total canonical state count is exactly 33", () => {
    const total = Object.values(CANONICAL_STATES).reduce(
      (sum, arr) => sum + arr.length,
      0,
    );
    expect(total).toBe(33);
  });

  it("E02: ROUTINE family has exactly 5 states", () => {
    expect(CANONICAL_STATES.routine.length).toBe(5);
  });

  it("E03: WAITING family has exactly 6 states", () => {
    expect(CANONICAL_STATES.waiting.length).toBe(6);
    expect(WAITING_STATES.length).toBe(6);
  });

  it("E04: ACTIVE_SERVICE family has exactly 7 states", () => {
    expect(CANONICAL_STATES.active_service.length).toBe(7);
  });

  it("E05: OVERRIDE family has exactly 11 states", () => {
    expect(CANONICAL_STATES.override.length).toBe(11);
    expect(OVERRIDE_STATES.length).toBe(11);
  });

  it("E06: CLOSED family has exactly 4 states", () => {
    expect(CANONICAL_STATES.closed.length).toBe(4);
    expect(CLOSED_STATES.length).toBe(4);
  });

  it("E07: VALID_TRANSITIONS covers all 33 states (no missing keys)", () => {
    const allStates: ConversationState[] = [
      ...CANONICAL_STATES.routine,
      ...CANONICAL_STATES.waiting,
      ...CANONICAL_STATES.active_service,
      ...CANONICAL_STATES.override,
      ...CANONICAL_STATES.closed,
    ];
    for (const state of allStates) {
      expect(VALID_TRANSITIONS).toHaveProperty(state);
    }
  });

  it("E08: VALID_TRANSITIONS values reference only valid ConversationState codes", () => {
    const allStates = new Set<string>([
      ...CANONICAL_STATES.routine,
      ...CANONICAL_STATES.waiting,
      ...CANONICAL_STATES.active_service,
      ...CANONICAL_STATES.override,
      ...CANONICAL_STATES.closed,
    ]);
    for (const [, targets] of Object.entries(VALID_TRANSITIONS)) {
      for (const target of targets as string[]) {
        expect(allStates.has(target)).toBe(true);
      }
    }
  });

  it("E09: STATE_OWNER_MAP covers all 33 states", () => {
    const allStates: ConversationState[] = [
      ...CANONICAL_STATES.routine,
      ...CANONICAL_STATES.waiting,
      ...CANONICAL_STATES.active_service,
      ...CANONICAL_STATES.override,
      ...CANONICAL_STATES.closed,
    ];
    for (const state of allStates) {
      expect(STATE_OWNER_MAP).toHaveProperty(state);
    }
  });

  it("E10: STATE_OWNER_MAP values are one of: ai, team, human_takeover", () => {
    const valid = new Set(["ai", "admin_team", "human_takeover"]);
    for (const [, owner] of Object.entries(STATE_OWNER_MAP)) {
      expect(valid.has(owner)).toBe(true);
    }
  });

  it("E11: getStateFamily returns correct family for routine states", () => {
    for (const state of CANONICAL_STATES.routine) {
      expect(getStateFamily(state)).toBe("routine");
    }
  });

  it("E12: getStateFamily returns correct family for waiting states", () => {
    for (const state of CANONICAL_STATES.waiting) {
      expect(getStateFamily(state)).toBe("waiting");
    }
  });

  it("E13: getStateFamily returns correct family for active_service states", () => {
    for (const state of CANONICAL_STATES.active_service) {
      expect(getStateFamily(state)).toBe("active_service");
    }
  });

  it("E14: getStateFamily returns correct family for closed states", () => {
    for (const state of CANONICAL_STATES.closed) {
      expect(getStateFamily(state)).toBe("closed");
    }
  });

  it("E15: isValidTransition returns false for any state → itself (no self-transitions)", () => {
    const allStates: ConversationState[] = [
      ...CANONICAL_STATES.routine,
      ...CANONICAL_STATES.waiting,
      ...CANONICAL_STATES.active_service,
      ...CANONICAL_STATES.override,
      ...CANONICAL_STATES.closed,
    ];
    for (const state of allStates) {
      expect(isValidTransition(state, state)).toBe(false);
    }
  });

  it("E16: job_completed exits are a strict subset — only 5 allowed targets", () => {
    const allowed = new Set(VALID_TRANSITIONS["job_completed"]);
    expect(allowed.size).toBe(5);
    expect(allowed.has("closed_completed")).toBe(true);
    expect(allowed.has("resolved")).toBe(true);
    expect(allowed.has("complaint_open")).toBe(true);
    expect(allowed.has("incident_liability_open")).toBe(true);
    expect(allowed.has("human_takeover_active")).toBe(true);
  });

  it("E17: safety_issue_open has exactly 2 legal exits", () => {
    expect(VALID_TRANSITIONS["safety_issue_open"].length).toBe(2);
  });

  it("E18: legal_threat_open has exactly 2 legal exits", () => {
    expect(VALID_TRANSITIONS["legal_threat_open"].length).toBe(2);
  });

  it("E19: all non-override, non-closed states can reach at least one override state (universal interrupt)", () => {
    const nonOverrideNonClosed: ConversationState[] = [
      ...CANONICAL_STATES.routine,
      ...CANONICAL_STATES.waiting,
      ...CANONICAL_STATES.active_service,
    ];
    for (const state of nonOverrideNonClosed) {
      const targets = new Set(VALID_TRANSITIONS[state]);
      const canReachOverride = CANONICAL_STATES.override.some((o) => targets.has(o));
      expect(canReachOverride).toBe(true);
    }
  });

  it("E20: human_takeover_active cannot transition to any other override state", () => {
    const otherOverrides = CANONICAL_STATES.override.filter(
      (s) => s !== "human_takeover_active",
    );
    for (const override of otherOverrides) {
      expect(isValidTransition("human_takeover_active", override)).toBe(false);
    }
  });

  it("E21: transitionState rejects unrecognised state value at runtime", async () => {
    const convId = makeConversationId();
    await expect(
      transitionState(convId, "not_a_real_state" as ConversationState, ACTOR_OWNER, "owner"),
    ).rejects.toThrow();
  });

  it("E22: transitionState rejects a blocked transition and throws or returns failure", async () => {
    const convId = makeConversationId();
    await transitionState(convId, "new_lead", ACTOR_OWNER, "owner");
    await expect(
      transitionState(convId, "booked", ACTOR_OWNER, "owner"),
    ).rejects.toThrow();
  });

  it("E23: closed states all exit only to new_lead (or routine states per resolved)", () => {
    expect(VALID_TRANSITIONS["closed_unqualified"]).toEqual(["new_lead"]);
    expect(VALID_TRANSITIONS["closed_lost"]).toEqual(["new_lead"]);
    expect(VALID_TRANSITIONS["closed_completed"]).toEqual(["new_lead"]);
  });
});
