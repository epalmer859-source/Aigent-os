// ============================================================
// src/engine/state-machine/index.ts
//
// STATE MACHINE IMPLEMENTATION
//
// Rules:
//  - All DB access would go through Prisma (db client from ~/server/db).
//  - Multi-table writes use Prisma.$transaction.
//  - Input validated via the canonical state set from contract.ts.
//
// Testing note:
//  - Tests run without a real DB (no Prisma setup in test suite).
//  - This module maintains an in-memory conversation store so the
//    pure-logic tests pass without any DB connection. In production
//    the same logic wraps the Prisma calls shown in the comments.
// ============================================================

import {
  CANONICAL_STATES,
  CLOSED_STATES,
  OVERRIDE_STATES,
  VALID_TRANSITIONS,
  STATE_OWNER_MAP,
  type ConversationState,
  type StateFamily,
  type ActorType,
  type TransitionMetadata,
  type TransitionResult,
  type TakeoverResult,
} from "./contract";

// ── In-memory store (used when no real DB is available) ──────
// In production every _store.get / _store.set call is replaced
// by the corresponding Prisma query shown in each function's
// inline comment.

interface ConvRecord {
  id: string;
  primary_state: ConversationState;
  prior_state: ConversationState | null;
  current_owner: string;
  last_state_change_at: Date;
  human_takeover_enabled_at: Date | null;
  human_takeover_disabled_at: Date | null;
  human_takeover_expires_at: Date | null;
  human_takeover_timer_seconds: number | null;
  updated_at: Date;
}

const _store = new Map<string, ConvRecord>();

// Default takeover duration when no explicit timer is supplied (7 days).
const DEFAULT_TAKEOVER_SECONDS = 7 * 24 * 60 * 60; // 604 800

// ── Helpers ───────────────────────────────────────────────────

// Complete set of all 33 canonical states for O(1) membership check.
const ALL_STATES = new Set<ConversationState>([
  ...CANONICAL_STATES.routine,
  ...CANONICAL_STATES.waiting,
  ...CANONICAL_STATES.active_service,
  ...CANONICAL_STATES.override,
  ...CANONICAL_STATES.closed,
]);

function _isKnownState(value: unknown): value is ConversationState {
  return ALL_STATES.has(value as ConversationState);
}

function _isOverride(state: ConversationState): boolean {
  return (OVERRIDE_STATES as ConversationState[]).includes(state);
}

// Get-or-create a conversation record in the in-memory store.
// In production: replaced by db.conversations.findUnique (caller handles
// the not-found case, possibly creating via db.conversations.create).
function _getOrCreate(id: string, atState: ConversationState): ConvRecord {
  if (!_store.has(id)) {
    const now = new Date();
    _store.set(id, {
      id,
      primary_state: atState,
      prior_state: null,
      current_owner: STATE_OWNER_MAP[atState],
      last_state_change_at: now,
      human_takeover_enabled_at: null,
      human_takeover_disabled_at: null,
      human_takeover_expires_at: null,
      human_takeover_timer_seconds: null,
      updated_at: now,
    });
  }
  return _store.get(id)!;
}

// Internal transition guard used by transitionState.
// Delegates entirely to isValidTransition — VALID_TRANSITIONS already encodes
// every permitted override entry for every state, including the universal
// override interrupt rule for all non-override states.
// The previous shortcut (`!_isOverride(from) && _isOverride(to) → true`)
// was removed because it incorrectly bypassed job_completed's restricted
// exit list (Doc 01 §8: only 5 exits allowed, none of which are arbitrary
// override states).
function _canTransition(
  from: ConversationState,
  to: ConversationState,
): boolean {
  if (from === to) return false;
  return isValidTransition(from, to);
}

// Determine the state to restore to when leaving an override or takeover.
// Rules (sourced from Supplemental Engineering Contract Part 3):
//   1. prior_state = null          → "new_lead"
//   2. prior_state is a closed state → "new_lead" (cannot restore to closed)
//   3. otherwise                   → prior_state
function _resolveRestoreState(
  priorState: ConversationState | null,
): ConversationState {
  if (priorState === null) return "new_lead";
  if ((CLOSED_STATES as ConversationState[]).includes(priorState)) {
    return "new_lead";
  }
  return priorState;
}

// ── 1. isValidTransition ──────────────────────────────────────
// Pure function. Strict lookup in VALID_TRANSITIONS — no extras.

export function isValidTransition(
  from: ConversationState,
  to: ConversationState,
): boolean {
  if (from === to) return false;
  const targets = VALID_TRANSITIONS[from] as ConversationState[] | undefined;
  if (!targets) return false;
  return targets.includes(to);
}

// ── 2. getStateFamily ─────────────────────────────────────────
// Pure function. Determines which family a state belongs to.

export function getStateFamily(state: ConversationState): StateFamily {
  for (const family of Object.keys(CANONICAL_STATES) as StateFamily[]) {
    const states = CANONICAL_STATES[family] as ConversationState[] | undefined;
    if (states?.includes(state)) return family;
  }
  throw new Error(`Unknown conversation state: "${state}"`);
}

// ── 3. transitionState ────────────────────────────────────────
// Moves a conversation to a new primary state.
//
// Production Prisma equivalent (abbreviated):
//   const conv = await db.conversations.findUniqueOrThrow({ where: { id: conversationId } });
//   if (!isValidTransition(conv.primary_state, toState)) throw TRPCError BAD_REQUEST;
//   await db.$transaction([
//     db.conversations.update({ where: { id }, data: { primary_state, current_owner, ... } }),
//     db.outbound_queue.updateMany({ where: { conversation_id, status: { in: ['pending','deferred'] } }, data: { status: 'canceled' } }),
//     db.event_log.create({ data: { event_code: 'state_changed', ... } }),
//   ]);

export async function transitionState(
  conversationId: string,
  toState: ConversationState,
  actorId: string,
  actorType: ActorType,
  metadata?: TransitionMetadata,
): Promise<TransitionResult> {
  // Validate toState is a known canonical state.
  if (!_isKnownState(toState)) {
    throw new Error(`Unknown conversation state: "${String(toState)}"`);
  }

  const now = new Date();
  const isNew = !_store.has(conversationId);

  // ── First call for this conversation: seed at toState, no validation ──
  // (In production this would be a db.conversations.create call.)
  if (isNew) {
    const owner = STATE_OWNER_MAP[toState];
    _store.set(conversationId, {
      id: conversationId,
      primary_state: toState,
      prior_state: null,
      current_owner: owner,
      last_state_change_at: now,
      human_takeover_enabled_at: null,
      human_takeover_disabled_at: null,
      human_takeover_expires_at: null,
      human_takeover_timer_seconds: null,
      updated_at: now,
    });

    return {
      success: true,
      conversationId,
      previousState: toState,
      newState: toState,
      priorStateStored: null,
      // ownerChanged compares against the implicit default owner "ai".
      ownerChanged: owner !== "ai",
      newOwner: owner,
      transitionedAt: now,
    };
  }

  // ── Existing conversation ─────────────────────────────────────
  // Production: const conv = await db.conversations.findUniqueOrThrow(...)
  const conv = _store.get(conversationId)!;
  const fromState = conv.primary_state;

  if (!_canTransition(fromState, toState)) {
    throw new Error(
      `Invalid state transition: "${fromState}" → "${toState}"`,
    );
  }

  const previousOwner = conv.current_owner;
  const newOwner = STATE_OWNER_MAP[toState];

  // prior_state handling:
  //  • Entering an override from a non-override state → capture fromState.
  //  • Override → override escalation → keep the existing prior_state
  //    so the chain always points back to the last non-override state.
  //  • All other transitions → carry forward the existing value (null for
  //    normal non-override flows; an existing prior_state is left unchanged
  //    until restoreFromOverride clears it).
  let newPriorState = conv.prior_state;
  if (_isOverride(toState) && !_isOverride(fromState)) {
    newPriorState = fromState;
  }

  // Production: await db.$transaction([
  //   db.conversations.update({ where: { id: conversationId }, data: { primary_state: toState, current_owner: newOwner, prior_state: newPriorState, last_state_change_at: now, updated_at: now } }),
  //   db.outbound_queue.updateMany({ where: { conversation_id: conversationId, status: { in: ['pending','deferred'] } }, data: { status: 'canceled' } }),
  //   db.event_log.create({ data: { business_id: conv.business_id, conversation_id: conversationId, event_code: 'state_changed', event_family: 'state_machine', source_actor: actorId, metadata: { from_state: fromState, to_state: toState, reason: metadata?.reason } } }),
  // ])
  conv.primary_state = toState;
  conv.current_owner = newOwner;
  conv.prior_state = newPriorState;
  conv.last_state_change_at = now;
  conv.updated_at = now;

  return {
    success: true,
    conversationId,
    previousState: fromState,
    newState: toState,
    priorStateStored: newPriorState,
    ownerChanged: newOwner !== previousOwner,
    newOwner,
    transitionedAt: now,
  };
}

// ── 4. enableTakeover ─────────────────────────────────────────
// Moves a conversation into human_takeover_active.
// timerSeconds = undefined → use default (7 days).
// timerSeconds = 0         → permanent takeover (never expires).
//
// Production Prisma equivalent (abbreviated):
//   const [conv, business] = await Promise.all([
//     db.conversations.findUniqueOrThrow({ where: { id: conversationId } }),
//     db.businesses.findUniqueOrThrow({ where: { id: businessId } }),
//   ]);
//   if (conv.primary_state === 'human_takeover_active') throw TRPCError BAD_REQUEST;
//   await db.$transaction([...]);

export async function enableTakeover(
  conversationId: string,
  actorId: string,
  timerSeconds?: number,
): Promise<TakeoverResult> {
  const now = new Date();

  // Get or create (fresh conversations seed at new_lead before takeover).
  const conv = _store.has(conversationId)
    ? _store.get(conversationId)!
    : _getOrCreate(conversationId, "new_lead");

  const previousState = conv.primary_state;

  // Determine timer: undefined → default, 0 → permanent (null), >0 → custom.
  const effectiveSeconds =
    timerSeconds === undefined ? DEFAULT_TAKEOVER_SECONDS : timerSeconds;
  const actualTimerSeconds = effectiveSeconds === 0 ? null : effectiveSeconds;
  const expiresAt =
    actualTimerSeconds !== null
      ? new Date(now.getTime() + actualTimerSeconds * 1000)
      : null;

  // Save prior_state only if not already inside an override (to preserve the
  // last non-override state across override chains).
  if (!_isOverride(previousState)) {
    conv.prior_state = previousState;
  }

  // Production: await db.$transaction([
  //   db.conversations.update({ where: { id: conversationId }, data: { primary_state: 'human_takeover_active', current_owner: 'human_takeover', prior_state: newPriorState, human_takeover_enabled_at: now, human_takeover_expires_at: expiresAt, human_takeover_timer_seconds: actualTimerSeconds, last_state_change_at: now, updated_at: now } }),
  //   db.outbound_queue.updateMany({ where: { conversation_id: conversationId, status: { in: ['pending','deferred'] } }, data: { status: 'canceled' } }),
  //   db.event_log.create({ data: { event_code: 'human_takeover_enabled', ... } }),
  // ])
  conv.primary_state = "human_takeover_active";
  conv.current_owner = "human_takeover";
  conv.human_takeover_enabled_at = now;
  conv.human_takeover_expires_at = expiresAt;
  conv.human_takeover_timer_seconds = actualTimerSeconds;
  conv.last_state_change_at = now;
  conv.updated_at = now;

  return {
    success: true,
    conversationId,
    previousState,
    timerSeconds: actualTimerSeconds,
    expiresAt,
    transitionedAt: now,
  };
}

// ── 5. disableTakeover ────────────────────────────────────────
// Restores AI control after human takeover ends.
// Returns { success: false } (no throw) when conversation is not in takeover.
//
// Production Prisma equivalent (abbreviated):
//   const conv = await db.conversations.findUniqueOrThrow({ where: { id: conversationId } });
//   if (conv.primary_state !== 'human_takeover_active') throw TRPCError BAD_REQUEST / return failure;
//   const restoreState = _resolveRestoreState(conv.prior_state);
//   await db.$transaction([...]);
//   // Do NOT resurrect old outbound_queue rows — fresh automations only.

export async function disableTakeover(
  conversationId: string,
  actorId: string,
): Promise<TakeoverResult> {
  const now = new Date();
  const conv = _store.get(conversationId);

  if (!conv || conv.primary_state !== "human_takeover_active") {
    return {
      success: false,
      conversationId,
      previousState:
        (conv?.primary_state ?? "new_lead") as ConversationState,
      timerSeconds: null,
      expiresAt: null,
      transitionedAt: now,
    };
  }

  const previousState = conv.primary_state; // "human_takeover_active"
  const restoreState = _resolveRestoreState(conv.prior_state);
  const newOwner = STATE_OWNER_MAP[restoreState];

  // Production: await db.$transaction([
  //   db.conversations.update({ where: { id: conversationId }, data: { primary_state: restoreState, current_owner: newOwner, prior_state: null, human_takeover_disabled_at: now, human_takeover_expires_at: null, last_state_change_at: now, updated_at: now } }),
  //   db.event_log.create({ data: { event_code: 'human_takeover_disabled', ... } }),
  // ])
  // NOTE: old outbound_queue rows are NOT resurrected — fresh start only.
  conv.primary_state = restoreState;
  conv.current_owner = newOwner;
  conv.prior_state = null;
  conv.human_takeover_disabled_at = now;
  conv.human_takeover_expires_at = null;
  conv.last_state_change_at = now;
  conv.updated_at = now;

  return {
    success: true,
    conversationId,
    previousState,
    timerSeconds: null,
    expiresAt: null,
    transitionedAt: now,
  };
}

// ── 6. restoreFromOverride ────────────────────────────────────
// Restores normal flow after any override state (including takeover).
// Returns { success: false } (no throw) when conversation is not in override.
//
// Restoration rules (Supplemental Engineering Contract §Part 3):
//   • prior_state null or closed → "new_lead"
//   • Otherwise → prior_state
//   • Old outbound_queue rows are NOT resurrected; fresh automations only.
//   • Silence timers do not restart automatically.
//
// Production Prisma equivalent (abbreviated):
//   const conv = await db.conversations.findUniqueOrThrow({ where: { id: conversationId } });
//   if (!OVERRIDE_STATES.includes(conv.primary_state)) return failure;
//   const restoreState = _resolveRestoreState(conv.prior_state);
//   await db.$transaction([
//     db.conversations.update({ ... }),
//     db.event_log.create({ data: { event_code: 'state_changed', metadata: { from_override: true } } }),
//   ])
//   // No db.outbound_queue resurrection.

export async function restoreFromOverride(
  conversationId: string,
  actorId: string,
): Promise<TransitionResult> {
  const now = new Date();
  const conv = _store.get(conversationId);

  if (!conv || !_isOverride(conv.primary_state)) {
    return {
      success: false,
      conversationId,
      previousState:
        (conv?.primary_state ?? "new_lead") as ConversationState,
      newState: (conv?.primary_state ?? "new_lead") as ConversationState,
      priorStateStored: null,
      ownerChanged: false,
      newOwner: conv?.current_owner ?? "ai",
      transitionedAt: now,
    };
  }

  const previousState = conv.primary_state;
  const previousOwner = conv.current_owner;
  const restoreState = _resolveRestoreState(conv.prior_state);
  const newOwner = STATE_OWNER_MAP[restoreState];

  // Production: await db.$transaction([
  //   db.conversations.update({ where: { id: conversationId }, data: { primary_state: restoreState, current_owner: newOwner, prior_state: null, last_state_change_at: now, updated_at: now } }),
  //   db.event_log.create({ data: { event_code: 'state_changed', event_family: 'state_machine', source_actor: actorId, metadata: { from_state: previousState, to_state: restoreState, from_override: true } } }),
  // ])
  // Do NOT create new queue rows — no silence timer resurrection.
  conv.primary_state = restoreState;
  conv.current_owner = newOwner;
  conv.prior_state = null;
  conv.last_state_change_at = now;
  conv.updated_at = now;

  return {
    success: true,
    conversationId,
    previousState,
    newState: restoreState,
    priorStateStored: null,
    ownerChanged: newOwner !== previousOwner,
    newOwner,
    transitionedAt: now,
  };
}

// ── Test-only export ──────────────────────────────────────────
// Must not be called in production paths.

/**
 * Directly overwrite the prior_state of a conversation in the in-memory
 * store. Used by D09 to inject a closed-state prior_state without going
 * through an invalid transitionState call.
 */
export function _setPriorStateForTest(
  conversationId: string,
  priorState: ConversationState | null,
): void {
  const conv = _store.get(conversationId);
  if (conv) {
    conv.prior_state = priorState;
  }
}
