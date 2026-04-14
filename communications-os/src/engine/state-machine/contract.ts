// ============================================================
// src/engine/state-machine/contract.ts
//
// TYPES AND CONSTANTS ONLY — ZERO IMPLEMENTATION LOGIC
//
// Source of truth: 01_Unified_State_Authority_FINAL.md
// All VALID_TRANSITIONS entries are derived exclusively from the
// "Legal exits / transitions" section of each state block.
// Do not add transitions not listed in that document.
// ============================================================

// ── 1. Primitive types ───────────────────────────────────────

export type ConversationState =
  // Routine (5)
  | "new_lead"
  | "lead_qualified"
  | "booking_in_progress"
  | "quote_sent"
  | "lead_followup_active"
  // Waiting (5)
  | "waiting_on_customer_details"
  | "waiting_on_photos"
  | "waiting_on_admin_quote"
  | "waiting_on_parts_confirmation"
  | "waiting_on_approval"
  // Active service (7)
  | "booked"
  | "reschedule_in_progress"
  | "tech_assigned"
  | "en_route"
  | "job_in_progress"
  | "job_paused"
  | "job_completed"
  // Override (11)
  | "complaint_open"
  | "billing_dispute_open"
  | "safety_issue_open"
  | "legal_threat_open"
  | "incident_liability_open"
  | "insurance_review_open"
  | "permits_regulatory_review_open"
  | "vendor_dispute_open"
  | "restricted_topic_open"
  | "hostile_customer_open"
  | "human_takeover_active"
  // Closed (4)
  | "resolved"
  | "closed_unqualified"
  | "closed_lost"
  | "closed_completed";

export type StateFamily =
  | "routine"
  | "waiting"
  | "active_service"
  | "override"
  | "closed";

export type ActorType = "ai" | "admin" | "owner" | "system";

// ── 2. Canonical state groupings ─────────────────────────────
// Total: 5 + 5 + 7 + 11 + 4 = 32 states

export const CANONICAL_STATES: Record<StateFamily, ConversationState[]> = {
  routine: [
    "new_lead",
    "lead_qualified",
    "booking_in_progress",
    "quote_sent",
    "lead_followup_active",
  ],
  waiting: [
    "waiting_on_customer_details",
    "waiting_on_photos",
    "waiting_on_admin_quote",
    "waiting_on_parts_confirmation",
    "waiting_on_approval",
  ],
  active_service: [
    "booked",
    "reschedule_in_progress",
    "tech_assigned",
    "en_route",
    "job_in_progress",
    "job_paused",
    "job_completed",
  ],
  override: [
    "complaint_open",
    "billing_dispute_open",
    "safety_issue_open",
    "legal_threat_open",
    "incident_liability_open",
    "insurance_review_open",
    "permits_regulatory_review_open",
    "vendor_dispute_open",
    "restricted_topic_open",
    "hostile_customer_open",
    "human_takeover_active",
  ],
  closed: [
    "resolved",
    "closed_unqualified",
    "closed_lost",
    "closed_completed",
  ],
};

export const CLOSED_STATES: ConversationState[] = [...CANONICAL_STATES.closed];
export const OVERRIDE_STATES: ConversationState[] = [...CANONICAL_STATES.override];
export const WAITING_STATES: ConversationState[] = [...CANONICAL_STATES.waiting];

// ── 3. Valid transitions ──────────────────────────────────────
// Source: §6–§10 of 01_Unified_State_Authority_FINAL.md
//
// Universal override interrupt rule (§5):
//   Any non-override state may transition to any override state.
//   Those exits are included inline below for each applicable state.
//
// IMPORTANT EXCEPTION — job_completed:
//   Exits to only 5 specific states, NOT all overrides.
//   See §8 job_completed "Legal exits / transitions".
//
// IMPORTANT EXCEPTION — override states:
//   Each override state has its own restricted exit list.
//   safety_issue_open and legal_threat_open may ONLY exit to
//   human_takeover_active or resolved.

// Internal shorthand — all 11 override states
const _ALL_OVERRIDES: ConversationState[] = [
  "complaint_open",
  "billing_dispute_open",
  "safety_issue_open",
  "legal_threat_open",
  "incident_liability_open",
  "insurance_review_open",
  "permits_regulatory_review_open",
  "vendor_dispute_open",
  "restricted_topic_open",
  "hostile_customer_open",
  "human_takeover_active",
];

export const VALID_TRANSITIONS: Record<ConversationState, ConversationState[]> = {

  // ── Routine ──────────────────────────────────────────────────

  // §6 new_lead: "lead_qualified; waiting_on_customer_details;
  //   closed_unqualified; or any valid override"
  new_lead: [
    "lead_qualified",
    "waiting_on_customer_details",
    "closed_unqualified",
    ..._ALL_OVERRIDES,
  ],

  // §6 lead_qualified: "booking_in_progress; waiting_on_admin_quote;
  //   waiting_on_photos; waiting_on_customer_details;
  //   waiting_on_approval; closed_unqualified; closed_lost; or a valid override"
  lead_qualified: [
    "booking_in_progress",
    "waiting_on_admin_quote",
    "waiting_on_photos",
    "waiting_on_customer_details",
    "waiting_on_approval",
    "closed_unqualified",
    "closed_lost",
    ..._ALL_OVERRIDES,
  ],

  // §6 booking_in_progress: "booked;
  //   waiting_on_customer_details; waiting_on_photos;
  //   waiting_on_approval; closed_lost; or a valid override"
  booking_in_progress: [
    "booked",
    "waiting_on_customer_details",
    "waiting_on_photos",
    "waiting_on_approval",
    "closed_lost",
    ..._ALL_OVERRIDES,
  ],

  // §6 quote_sent: "booking_in_progress; lead_followup_active;
  //   waiting_on_admin_quote if scope changed materially; closed_lost; or a valid override"
  quote_sent: [
    "booking_in_progress",
    "lead_followup_active",
    "waiting_on_admin_quote",
    "closed_lost",
    ..._ALL_OVERRIDES,
  ],

  // §6 lead_followup_active: "lead_qualified; booking_in_progress;
  //   quote_sent; closed_lost; or any valid override"
  lead_followup_active: [
    "lead_qualified",
    "booking_in_progress",
    "quote_sent",
    "closed_lost",
    ..._ALL_OVERRIDES,
  ],

  // ── Waiting ──────────────────────────────────────────────────

  // §7 waiting_on_customer_details: "Return to the blocked routine state;
  //   lead_followup_active if customer goes quiet; plus any valid override"
  waiting_on_customer_details: [
    "new_lead",
    "lead_qualified",
    "booking_in_progress",
    "quote_sent",
    "lead_followup_active",
    ..._ALL_OVERRIDES,
  ],

  // §7 waiting_on_photos: "Return to the blocked flow once media is complete;
  //   plus any valid override"
  waiting_on_photos: [
    "lead_qualified",
    "booking_in_progress",
    "waiting_on_admin_quote",
    ..._ALL_OVERRIDES,
  ],

  // §7 waiting_on_admin_quote: "quote_sent; booking_in_progress if scope changed;
  //   closed_lost; plus any valid override"
  waiting_on_admin_quote: [
    "quote_sent",
    "booking_in_progress",
    "closed_lost",
    ..._ALL_OVERRIDES,
  ],

  // §7 waiting_on_parts_confirmation: "job_in_progress; job_paused;
  //   plus any valid override"
  waiting_on_parts_confirmation: [
    "job_in_progress",
    "job_paused",
    ..._ALL_OVERRIDES,
  ],

  // §7 waiting_on_approval: "Return to the blocked routine or active-service state
  //   after approval; closed_unqualified if denied; plus any valid override or
  //   restricted_topic_open if the matter is actually restricted"
  waiting_on_approval: [
    // All routine states (blocked flow could be any)
    "new_lead",
    "lead_qualified",
    "booking_in_progress",
    "quote_sent",
    "lead_followup_active",
    // All active-service states (blocked flow could be any)
    "booked",
    "reschedule_in_progress",
    "tech_assigned",
    "en_route",
    "job_in_progress",
    "job_paused",
    "job_completed",
    // On denial
    "closed_unqualified",
    ..._ALL_OVERRIDES,
  ],

  // ── Active service ────────────────────────────────────────────

  // §8 booked: "reschedule_in_progress; tech_assigned; en_route;
  //   job_in_progress; job_completed through explicit operational correction only;
  //   resolved (via customer cancellation); plus any valid override"
  booked: [
    "reschedule_in_progress",
    "tech_assigned",
    "en_route",
    "job_in_progress",
    "job_completed",
    "resolved",
    ..._ALL_OVERRIDES,
  ],

  // §8 reschedule_in_progress: "booked with replacement time;
  //   booked with original time if reschedule is abandoned; plus any valid override"
  reschedule_in_progress: [
    "booked",
    ..._ALL_OVERRIDES,
  ],

  // §8 tech_assigned: "en_route; job_in_progress; reschedule_in_progress;
  //   or any valid override"
  tech_assigned: [
    "en_route",
    "job_in_progress",
    "reschedule_in_progress",
    ..._ALL_OVERRIDES,
  ],

  // §8 en_route: "job_in_progress; reschedule_in_progress;
  //   job_paused through a valid delay/hold path; or any valid override"
  en_route: [
    "job_in_progress",
    "reschedule_in_progress",
    "job_paused",
    ..._ALL_OVERRIDES,
  ],

  // §8 job_in_progress: "job_paused; waiting_on_parts_confirmation;
  //   job_completed; or any valid override"
  job_in_progress: [
    "job_paused",
    "waiting_on_parts_confirmation",
    "job_completed",
    ..._ALL_OVERRIDES,
  ],

  // §8 job_paused: "job_in_progress; waiting_on_parts_confirmation;
  //   job_completed; or any valid override"
  job_paused: [
    "job_in_progress",
    "waiting_on_parts_confirmation",
    "job_completed",
    ..._ALL_OVERRIDES,
  ],

  // §8 job_completed: "closed_completed after the single legal closeout path
  //   or direct manual close; resolved when staff closes the matter;
  //   complaint_open; incident_liability_open; human_takeover_active"
  // IMPORTANT: NOT all overrides — only these 5 specific exits.
  job_completed: [
    "closed_completed",
    "resolved",
    "complaint_open",
    "incident_liability_open",
    "human_takeover_active",
  ],

  // ── Override ──────────────────────────────────────────────────

  // §9 complaint_open: "human_takeover_active; resolved; legal_threat_open;
  //   safety_issue_open; incident_liability_open; hostile_customer_open"
  complaint_open: [
    "human_takeover_active",
    "resolved",
    "legal_threat_open",
    "safety_issue_open",
    "incident_liability_open",
    "hostile_customer_open",
  ],

  // §9 billing_dispute_open: "human_takeover_active; resolved;
  //   hostile_customer_open; legal_threat_open"
  billing_dispute_open: [
    "human_takeover_active",
    "resolved",
    "hostile_customer_open",
    "legal_threat_open",
  ],

  // §9 safety_issue_open: "human_takeover_active; resolved"
  // MOST RESTRICTIVE — only 2 exits allowed.
  safety_issue_open: [
    "human_takeover_active",
    "resolved",
  ],

  // §9 legal_threat_open: "human_takeover_active; resolved"
  // MOST RESTRICTIVE — only 2 exits allowed.
  legal_threat_open: [
    "human_takeover_active",
    "resolved",
  ],

  // §9 incident_liability_open: "human_takeover_active; legal_threat_open; resolved"
  incident_liability_open: [
    "human_takeover_active",
    "legal_threat_open",
    "resolved",
  ],

  // §9 insurance_review_open: "human_takeover_active; resolved;
  //   complaint_open; legal_threat_open"
  insurance_review_open: [
    "human_takeover_active",
    "resolved",
    "complaint_open",
    "legal_threat_open",
  ],

  // §9 permits_regulatory_review_open: "human_takeover_active; resolved;
  //   complaint_open; legal_threat_open"
  permits_regulatory_review_open: [
    "human_takeover_active",
    "resolved",
    "complaint_open",
    "legal_threat_open",
  ],

  // §9 vendor_dispute_open: "human_takeover_active; resolved;
  //   legal_threat_open; incident_liability_open"
  vendor_dispute_open: [
    "human_takeover_active",
    "resolved",
    "legal_threat_open",
    "incident_liability_open",
  ],

  // §9 restricted_topic_open: "resolved; human_takeover_active;
  //   waiting_on_approval only if the topic is no longer restricted"
  restricted_topic_open: [
    "resolved",
    "human_takeover_active",
    "waiting_on_approval",
  ],

  // §9 hostile_customer_open: "human_takeover_active; resolved; legal_threat_open"
  hostile_customer_open: [
    "human_takeover_active",
    "resolved",
    "legal_threat_open",
  ],

  // §9 human_takeover_active: "Any routine, waiting, active-service, or closed state
  //   when the takeover timer expires or owner manually re-enables AI;
  //   resolved when human closes the matter"
  human_takeover_active: [
    // Routine
    "new_lead",
    "lead_qualified",
    "booking_in_progress",
    "quote_sent",
    "lead_followup_active",
    // Waiting
    "waiting_on_customer_details",
    "waiting_on_photos",
    "waiting_on_admin_quote",
    "waiting_on_parts_confirmation",
    "waiting_on_approval",
    // Active service
    "booked",
    "reschedule_in_progress",
    "tech_assigned",
    "en_route",
    "job_in_progress",
    "job_paused",
    "job_completed",
    // Closed
    "resolved",
    "closed_unqualified",
    "closed_lost",
    "closed_completed",
  ],

  // ── Closed ────────────────────────────────────────────────────

  // §10 resolved: "new_lead or another routine state only
  //   when a materially new trigger starts a genuinely new matter"
  resolved: [
    "new_lead",
    "lead_qualified",
    "booking_in_progress",
    "quote_sent",
    "lead_followup_active",
  ],

  // §10 closed_unqualified: "new_lead only if materially new facts
  //   later make the request valid"
  closed_unqualified: [
    "new_lead",
  ],

  // §10 closed_lost: "new_lead for a genuinely new inbound matter"
  closed_lost: [
    "new_lead",
  ],

  // §10 closed_completed: "new_lead with repeat_customer tag
  //   when the customer returns with genuinely new work"
  closed_completed: [
    "new_lead",
  ],
};

// ── 4. State owner map ────────────────────────────────────────
// Maps each state to the default current_owner value.
// Values: "ai" | "admin_team" | "human_takeover"

export const STATE_OWNER_MAP: Record<ConversationState, string> = {
  // Routine — AI drives the thread
  new_lead: "ai",
  lead_qualified: "ai",
  booking_in_progress: "ai",
  quote_sent: "ai",
  lead_followup_active: "ai",
  // Waiting — customer-side waits owned by AI; admin-side waits owned by team
  waiting_on_customer_details: "ai",
  waiting_on_photos: "ai",
  waiting_on_admin_quote: "admin_team",
  waiting_on_parts_confirmation: "admin_team",
  waiting_on_approval: "admin_team",
  // Active service
  booked: "ai",
  reschedule_in_progress: "ai",
  tech_assigned: "ai",
  en_route: "ai",
  job_in_progress: "ai",
  job_paused: "admin_team",
  job_completed: "ai",
  // Override — team handles all except human_takeover_active
  complaint_open: "admin_team",
  billing_dispute_open: "admin_team",
  safety_issue_open: "admin_team",
  legal_threat_open: "admin_team",
  incident_liability_open: "admin_team",
  insurance_review_open: "admin_team",
  permits_regulatory_review_open: "admin_team",
  vendor_dispute_open: "admin_team",
  restricted_topic_open: "admin_team",
  hostile_customer_open: "admin_team",
  human_takeover_active: "human_takeover",
  // Closed — no active owner (AI is silent)
  resolved: "ai",
  closed_unqualified: "ai",
  closed_lost: "ai",
  closed_completed: "ai",
};

// ── 5. Function type signatures ───────────────────────────────
// These are TYPE definitions only — no runtime values.
// Actual implementations live in the engine module (./index.ts).

export interface TransitionMetadata {
  reason?: string;
  priorState?: ConversationState;
}

export interface TransitionResult {
  success: boolean;
  conversationId: string;
  previousState: ConversationState;
  newState: ConversationState;
  /** The prior_state stored on the conversation after transition. */
  priorStateStored: ConversationState | null;
  ownerChanged: boolean;
  newOwner: string;
  transitionedAt: Date;
}

export interface TakeoverResult {
  success: boolean;
  conversationId: string;
  previousState: ConversationState;
  /** Null means permanent (never expires). */
  timerSeconds: number | null;
  expiresAt: Date | null;
  transitionedAt: Date;
}

export type TransitionStateFn = (
  conversationId: string,
  toState: ConversationState,
  actorId: string,
  actorType: ActorType,
  metadata?: TransitionMetadata
) => Promise<TransitionResult>;

export type EnableTakeoverFn = (
  conversationId: string,
  actorId: string,
  timerSeconds?: number
) => Promise<TakeoverResult>;

export type DisableTakeoverFn = (
  conversationId: string,
  actorId: string
) => Promise<TakeoverResult>;

export type RestoreFromOverrideFn = (
  conversationId: string,
  actorId: string
) => Promise<TransitionResult>;

export type IsValidTransitionFn = (
  from: ConversationState,
  to: ConversationState
) => boolean;

export type GetStateFamilyFn = (
  state: ConversationState
) => StateFamily;
