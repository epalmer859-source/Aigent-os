# Final Blueprint-vs-Code Compliance Audit

**Date:** 2026-04-09
**Blueprint:** `unified-scheduling-spec.md` (single source of truth)
**Codebase:** `communications-os/src/engine/scheduling/` + supporting files
**Test suite:** 18 files, 543 tests, all passing

---

## 1. Final Verdict

**MOSTLY MATCHES WITH FIXES NEEDED**

The 12-module scheduling engine faithfully implements the blueprint's core architecture: queue-based same-day dispatch, deterministic capacity math, atomic transactions with row-level locks, injectable dependencies, OSRM-first routing with haversine fallback, and the full state machine. Three numerical constants deviate from the spec. Four blueprint background workers are not yet implemented. No architectural contradictions exist.

---

## 2. Critical Contradictions

### C1. Fast-completion threshold: 25% vs blueprint's 50%
- **Blueprint:** "Under 50% of estimated duration -> accepted, owner auto-flagged"
- **Code:** `FAST_COMPLETION_THRESHOLD = 0.25` (25%) in `transition-hooks.ts:52`
- **Impact:** Only catches extremely suspicious completions. A 60-min job done in 25 min (42%) would not flag under current code but should per blueprint.
- **Fix:** Change constant to `0.50`.

### C2. Estimate timeout: 15 min vs blueprint's 20 min
- **Blueprint:** "20-minute soft gate: If no reply within 20 min of arrived"
- **Code:** `ESTIMATE_TIMEOUT_MINUTES = 15` in `scheduling-workers.ts:288`
- **Impact:** Techs get prompted 5 minutes too early.
- **Fix:** Change constant to `20`.

### C3. GPS mismatch metric: 2km haversine vs blueprint's "15+ min drive"
- **Blueprint:** "GPS shows 15+ min from job address"
- **Code:** `GPS_MISMATCH_THRESHOLD_KM = 2.0` in `transition-hooks.ts:49` using haversine distance
- **Impact:** 2km haversine is a reasonable proxy (~4 min drive in urban, ~2 min highway), but the blueprint explicitly says "15+ min" which is approximately 5-8km depending on road type. Current threshold is too tight and would over-flag.
- **Fix:** Either increase to ~8km, or use OSRM drive time (would require making the hook async with OSRM dependency).

---

## 3. Missing Blueprint Pieces

### M1. Morning briefing sender (worker)
- **Blueprint:** "Morning briefing sender — Daily, 30min before open — Queue summary to each tech"
- **Status:** Not implemented. No `morningBriefing` worker, no communication handler, no template.

### M2. Timer check-in worker
- **Blueprint:** "Timer check-in — Every 60s — 'Still on this one?' when estimated duration passes"
- **Status:** Not implemented. No worker checks if a tech's actual time on-site exceeds their estimate.

### M3. 60-min project scope prompt worker
- **Blueprint:** "60-min project scope prompt — Every 60s — 'Standard visit or more extensive?' at 60-min mark"
- **Status:** Not implemented. No worker sends the project-scope prompt.

### M4. Worker heartbeat
- **Blueprint:** "Worker heartbeat — Every 60s — Log heartbeat. 5-min gap -> dashboard alert"
- **Status:** Not implemented. Workers have no heartbeat logging or staleness detection.

### M5. Capacity revalidation on profile change (route-level wiring)
- **Blueprint:** "Capacity revalidation — Event-driven (on profile change) — Revalidate future days, flag overcapacity"
- **Status:** Engine function `revalidateCapacity()` exists and is tested. But no tRPC route for updating tech profiles calls it. The revalidation runs inside `resetToAI` and `buildResyncAudit`, but NOT on profile save.

### M6. GPS mismatch accumulation + owner flagging
- **Blueprint:** "3+ mismatches per tech -> owner auto-flagged under tech's profile"
- **Status:** GPS mismatch is detected and logged (console.warn), but there is no persistence of mismatch count per tech and no auto-flag to owner after 3 mismatches.

### M7. Fast-completion owner flagging
- **Blueprint:** "owner auto-flagged under tech's profile"
- **Status:** Fast completion is detected and console.warned, but not persisted or routed to owner notification.

### M8. AI text generation (live Claude)
- **Blueprint:** "AI-generated preferred. Every message type has a canned template fallback"
- **Status:** All `AiTextGenerator` instances use the `ai_unavailable` stub. Templates exist as fallback. Live Claude integration for scheduling text generation is deferred.

### M9. No-show handling
- **Blueprint:** "No-show button with comment field. Details sent to AI + owner as notification"
- **Status:** No no-show route or communication handler exists. The state machine has no NO_SHOW status (incomplete covers it conceptually, but the comment-forwarding flow is absent).

---

## 4. Unexpected / Unintended Implementation

### U1. Worker frequencies differ from blueprint
- **Pull-forward expiration:** Every 5 min (code) vs every 60s (blueprint). Acceptable for V1 — 60s polling is aggressive.
- **Estimate timeout:** Every 5 min (code) vs every 60s (blueprint). Same reasoning. 5-min granularity is reasonable.
- **Morning reminder:** Every 15 min (code) vs "1hr before open" (blueprint). Code covers a wider window, which is actually more robust for multi-timezone businesses.

These are deliberate engineering trade-offs, not bugs. Documenting for awareness.

### U2. transitionJob returns hook results in response
- The router returns `gpsMismatch` and `fastCompletion` objects in the mutation response. Blueprint doesn't specify this, but it's harmless and useful for the dashboard to surface flags immediately.

### U3. Drift tracker is route-triggered, not event-driven
- **Blueprint:** "Drift tracker — Event-driven (on job completion)"
- **Code:** Drift evaluation is a separate `evaluateDrift` tRPC route that the caller must invoke explicitly. It's not automatically triggered on COMPLETED transition.
- **Impact:** Drift accumulation requires the dashboard to call `evaluateDrift` after each completion, rather than being automatic. Works but is a different integration pattern.

---

## 5. Module-by-Module 12-Module Audit

| # | Module | File | Verdict |
|---|--------|------|---------|
| 1 | Capacity Math | `capacity-math.ts` | **Matches blueprint.** 1.3x floor, short-duration floor (45 min), volatility tiers (1.2/1.4/1.6x), ceilTo5, morning/afternoon sub-capacity, atomic reservation with row-level lock, revalidation on profile change. All tested. |
| 2 | Booking Orchestrator | `booking-orchestrator.ts` | **Matches blueprint.** Atomic job creation (capacity + job + event in one transaction), service type required, queue position assignment, drive time integration. |
| 3 | Scheduling State Machine | `scheduling-state-machine.ts` | **Matches blueprint.** All 9 states, valid transitions match spec exactly, 5-min minimum duration, one active job per tech with SELECT FOR UPDATE, conversation bridge, end-of-day sweep with 2-hour grace. |
| 4 | Queue Insertion | `queue-insertion.ts` | **Matches blueprint.** Time preference constraints (morning/afternoon), geographic optimization via OSRM Table API, manual_position preservation, no-preference as lubricant. |
| 5 | Tech Assignment | `tech-assignment.ts` | **Matches blueprint.** Scoring formula `(proximity * 0.6) + (availability * 0.4)`, skill tag filtering, capacity filtering, tie-breaking by fewer jobs then closer to home. |
| 6 | OSRM Service | `osrm-service.ts` | **Matches blueprint.** OSRM primary with haversine fallback (1.4x road factor, 30 mph, 10-min floor, ceilTo5), first-job 1.25x multiplier, Starting My Day GPS override, health check before OSRM calls. |
| 7 | Rebook Cascade | `rebook-cascade.ts` | **Matches blueprint.** Check next 3 business days, atomic capacity reservation per attempt, NEEDS_REBOOK fallback, communication wired via onSickTechNotice + onJobRebooked. |
| 8 | Gap-Fill | `gap-fill.ts` | **Matches blueprint.** 30-min minimum gap, two tiers (booked vs waitlisted), scoring by proximity/utilization, pull-forward offers with 20-min expiry, ratchet rule (earlier only). |
| 9 | Inter-Tech Transfer | `inter-tech-transfer.ts` | **Matches blueprint.** NOT_STARTED only, skill + capacity validation, same-day auto (AI), future owner-approval, one transfer per job per day cap, emergency bypass. |
| 10 | Drift Tracker | `drift-tracker.ts` | **Matches blueprint.** Per-job thresholds (<15 silent, 15-45 internal, 45+ customer), 30-min cumulative recalculation trigger, window boundary crossing detection. |
| 11 | Communication Wiring | `communication-wiring.ts` | **Mostly matches.** 11 handlers covering booking, morning reminder, en route, arrived, completed, canceled, sick tech, rebook, drift, pull-forward offer/accept. All queue to outbound_queue with dedupe keys. Missing: morning briefing handler. |
| 12 | Pause/Manual Controls | `pause-manual-controls.ts` | **Matches blueprint.** Pause/resume/resync lifecycle, manual arrangement with 24-hour expiry, reset-to-AI, Starting My Day with GPS + OSRM, resync audit (read-only). |

**Supporting modules:**
| Module | File | Verdict |
|--------|------|---------|
| Transition Hooks | `transition-hooks.ts` | **Mostly matches** — thresholds deviate (see C1, C3). |
| Send-Time Verify | `send-time-verify.ts` | **Matches blueprint.** Verifies job state before delivering scheduling messages. |
| Pause Guard | `pause-guard.ts` | **Matches blueprint.** All workers and automated actions check pause state. |
| Timezone | `timezone.ts` | **Matches blueprint.** Business timezone required, no UTC fallback. |
| Scheduling Workers | `scheduling-workers.ts` | **Mostly matches** — estimate timeout constant wrong (see C2). Missing 3 workers (M1-M3). |

---

## 6. Cross-Module Compatibility Audit

### 6.1 Booking -> Capacity -> Queue Insertion
**Compatible.** `bookJob` calls `reserveCapacity` (atomic transaction with row lock), then `insertJob` (queue position optimization), then creates scheduling event. All in one flow.

### 6.2 State Machine -> Communication Wiring -> Outbound Queue
**Compatible.** `transitionJob` route calls `transitionJobState` (state change + conversation bridge), then fires communication handler (switch on new status), which inserts into `outbound_queue`. Send-time-verify gate in queue worker prevents stale messages.

### 6.3 Gap-Fill -> Pull-Forward -> Communication
**Compatible.** `detectAndRankGap` creates offer via `createPullForwardOffer`, fires `onPullForwardOffer`. `acceptPullForward` validates and fires `onPullForwardAccepted`. Expiry worker cleans up.

### 6.4 Rebook Cascade -> Communication -> Rebook Queue
**Compatible.** `redistributeSickTechJobs` returns results, router fires `onSickTechNotice` for affected jobs. Jobs that can't be placed enter `NEEDS_REBOOK` with rebook_queue entry.

### 6.5 Drift Tracker -> Communication Wiring
**Mostly compatible.** Drift evaluation works correctly, fires `onDriftCommunicationTriggered` for actionable results. However, it's route-triggered not event-driven (see U3).

### 6.6 Pause Guard -> All Workers
**Compatible.** Every worker checks `checkPauseGuard` before processing. When paused, workers return zero-result objects.

### 6.7 Conversation Bridge -> State Machine
**Compatible.** `SCHEDULING_TO_CONVERSATION_MAP` correctly maps scheduling states to conversation states (ARRIVED -> null, meaning no conversation change). The bridge uses `appointments.scheduling_job_id -> conversation_id` lookup.

### 6.8 OSRM -> Queue Insertion / Tech Assignment / Gap-Fill / Transfer
**Compatible.** All modules accept `OsrmServiceDeps` as injectable dependency. Fallback to haversine is automatic.

---

## 7. File / Adapter / Worker / Route Alignment Audit

### 7.1 Prisma Schema
| Model | Blueprint Match |
|-------|----------------|
| `scheduling_jobs` | **Full match.** All columns present: status enum, queue_position, time_preference, manual_position, arrived_at, completed_at, service_type_id, completion_note, ai_classified_type, tech_confirmed_type. |
| `capacity_reservations` | **Full match.** Unique on (tech, date). Morning/afternoon sub-capacity columns. |
| `scheduling_events` | **Full match.** Event audit trail with triggered_by enum. |
| `rebook_queue` | **Full match.** Customer/owner notified flags, resolved_at. |
| `pull_forward_offers` | **Full match.** Status enum (active/accepted/expired/declined), expires_at, gap_id. |
| `transfer_events` | **Full match.** From/to tech, approval type, net drive time saving. |
| `queue_arrangements` | **Full match.** Manually_arranged_at, reset_at, unique on (tech, date). |
| `technicians` | **Full match.** Working hours, lunch, overtime cap, home base coords, skill tags, location_services_enabled. |
| `service_types` | **Full match.** Volatility tier, buffer multiplier, symptom phrases, property type variants. |
| `outbound_queue` | **Full match.** scheduling_job_id FK, audience_type supports customer/technician/owner/internal. |
| `scheduling_mode_events` | **Full match.** Pause/resync lifecycle audit. |
| `starting_my_day_log` | **Full match.** Unique on (tech, date) for idempotency. |
| Enums | **Full match.** SchedulingJobStatus (9 values), TimePreference (4), CompletionNote (3), SchedulingTriggeredBy (4), TransferApproval (3), PullForwardOfferStatus (4), SchedulingMode (3). |

### 7.2 Prisma Adapter (`prisma-scheduling-adapter.ts`)
17 factory functions, each creating an interface implementation from PrismaClient:
- `createBookingOrchestratorDb` — booking + capacity + queue
- `createRebookCascadeDb` — rebook with capacity validation
- `createGapFillDb` — candidate queries + offer CRUD
- `createTransferDb` — transfer eligibility + execution
- `createSchedulingStateMachineDb` — state transitions + active job lock
- `createCapacityDb` — reservation CRUD
- `createPauseGuardDb` — scheduling mode check
- `createCommunicationWiringDb` — 13 lookup methods for communication handlers
- `createSendTimeVerifyDb` — job status lookup for send-time gate
- `createPauseManualDb` — 14 methods for pause/manual/startMyDay
- `createMorningReminderWorkerDb` — job listing + dedupe
- `createEndOfDaySweepWorkerDb` — tech profiles + state machine queries
- `createEstimateTimeoutWorkerDb` — arrived jobs without estimate
- `createPullForwardExpiryWorkerDb` — offer expiration
- `createSkillTagValidationWorkerDb` — skill mismatch detection
- `createManualPositionExpiryWorkerDb` — 24h manual flag cleanup
- `createOsrmDeps` — OSRM service configuration

**All adapters use `$transaction` and `FOR UPDATE` where blueprint requires atomicity.**

### 7.3 tRPC Scheduling Router
| Route | Blueprint Feature | Status |
|-------|------------------|--------|
| `bookJob` | Atomic booking + onJobBooked comm | Wired |
| `transitionJob` | State machine + conversation bridge + comm + GPS/fast-completion hooks | Wired |
| `redistributeSickTech` | Rebook cascade + onSickTechNotice | Wired |
| `detectAndRankGap` | Gap detection + ranking + auto-offer + onPullForwardOffer | Wired |
| `acceptPullForward` | Accept offer + onPullForwardAccepted | Wired |
| `evaluateDrift` | Drift evaluation + onDriftCommunicationTriggered | Wired |
| `evaluateBatchTransfers` | Transfer evaluation | Wired |
| `executeBatchTransfers` | Transfer execution | Wired |
| `pauseScheduling` | Pause mode | Wired |
| `requestResync` | Resync request | Wired |
| `resumeScheduling` | Resume mode | Wired |
| `buildResyncAudit` | Read-only audit | Wired |
| `getSchedulingMode` | Mode query | Wired |
| `arrangeJobManually` | Manual queue arrangement | Wired |
| `resetToAI` | Clear manual flags + re-optimize | Wired |
| `startMyDay` | GPS + OSRM drive time update | Wired |
| `getCapacity` | Capacity query | Wired |
| `getQueue` | Queue query | Wired |

### 7.4 Workers (`workers/main.ts`)
| Worker | Blueprint Match | Cron |
|--------|----------------|------|
| `morningReminderWorker` | Matches | `*/15 6-13 * * *` |
| `endOfDaySweepWorker` | Matches | `*/30 20-23,0-6 * * *` |
| `pullForwardExpiryWorker` | Matches (5min vs 60s) | `*/5 * * * *` |
| `skillTagValidationWorker` | Matches | `0 6 * * *` |
| `manualPositionExpiryWorker` | Matches | `0 * * * *` |
| `estimateTimeoutWorker` | Threshold wrong (C2) | `*/5 6-22 * * *` |
| Morning briefing | **Missing (M1)** | — |
| Timer check-in | **Missing (M2)** | — |
| 60-min project scope | **Missing (M3)** | — |
| Worker heartbeat | **Missing (M4)** | — |

### 7.5 Production Init (`production-init.ts`)
- All 8 engine modules wired (Claude, Twilio, email, notifications, calendar, web-chat, scheduling adapters)
- Scheduling adapters exposed as lazy getters — correct pattern
- Google Calendar still stub (documented as TBD)

---

## 8. Green Tests vs Real Risks

### R1. No integration tests with real Prisma client
All 543 tests use in-memory stubs. The Prisma adapter (`prisma-scheduling-adapter.ts`, ~1600 lines) has zero tests. Row-level locking behavior (`SELECT FOR UPDATE`), transaction isolation, and upsert race conditions are only verifiable against a real database.

**Risk level: MEDIUM.** The adapter code is straightforward Prisma queries, but the `$transaction` + raw SQL `FOR UPDATE` paths are the most critical concurrency code in the system and have never been tested under load.

### R2. Communication wiring handlers are fire-and-forget
All `onXxx()` calls in the router use `.catch()` — failures are logged but don't fail the mutation. This is intentional (blueprint says "scheduling engine keeps running"), but means a silently broken communication handler would go unnoticed until customers report missing texts.

**Risk level: LOW.** Correct architecture per blueprint. Monitor via outbound_queue metrics.

### R3. Pre-existing type errors in adjacent modules
`admin-actions`, `state-machine` (conversation), `suppression`, `osrm-service.test`, `tech-assignment` have TS errors. These are in non-scheduling code and pre-date the scheduling engine, but `admin-actions/index.ts` shares the appointments table and could conflict.

**Risk level: LOW for scheduling engine.** These modules don't import from scheduling.

### R4. AiTextGenerator stub masks template quality
Every scheduling message currently sends `{ outcome: "ai_unavailable", content: "" }`. The canned fallback templates in communication-wiring are the actual production output. These templates have not been reviewed for customer-facing quality.

**Risk level: LOW.** Templates exist and contain the right data. Tone refinement is a product decision, not a correctness issue.

### R5. Drift evaluation not auto-triggered on completion
The `evaluateDrift` route must be called explicitly. If the dashboard doesn't call it after every COMPLETED transition, cumulative drift silently accumulates without customer notification.

**Risk level: MEDIUM.** The 45+ min customer notification and 30-min recalculation triggers only fire if someone calls the route.

---

## 9. Remaining Fixes Before I Can Trust This Completely

### Tier 1 — Blueprint constant corrections (30 min)

1. **`transition-hooks.ts:52`** — Change `FAST_COMPLETION_THRESHOLD` from `0.25` to `0.50`
2. **`scheduling-workers.ts:288`** — Change `ESTIMATE_TIMEOUT_MINUTES` from `15` to `20`
3. **`transition-hooks.ts:49`** — Increase `GPS_MISMATCH_THRESHOLD_KM` from `2.0` to approximately `8.0` (proxy for 15-min drive), or add OSRM-based drive-time check

### Tier 2 — Missing workers (2-4 hours each)

4. **Morning briefing worker** — Queue summary to each tech, 30 min before open
5. **Timer check-in worker** — "Still on this one?" when estimated duration passes
6. **60-min project scope prompt worker** — Project-scope check at 60-min mark
7. **Worker heartbeat** — Heartbeat logging + 5-min staleness alert

### Tier 3 — Persistence gaps (1-2 hours each)

8. **GPS mismatch accumulation** — Persist mismatch count per tech, auto-flag owner at 3+
9. **Fast-completion owner flagging** — Persist flag, route to owner notification
10. **Auto-trigger drift evaluation** — Fire `evaluateDrift` automatically on COMPLETED transition instead of requiring explicit route call

### Tier 4 — Route-level wiring (1 hour)

11. **Capacity revalidation on tech profile update** — Call `revalidateCapacity` when tech working hours, lunch, or overtime are modified

### Tier 5 — Integration testing (2-4 hours)

12. **Prisma adapter integration tests** — Test atomic capacity reservation under concurrent access against a real database

---

## 10. Final Go / No-Go

**GO WITH FIXES**

The scheduling engine's architecture, state machine, capacity math, and module boundaries faithfully implement the blueprint. All 12 core modules match or mostly match. The Prisma schema is complete. All tRPC routes are wired. The test suite covers engine logic thoroughly.

The three constant corrections (Tier 1) should be applied before any production deployment — they're one-line fixes. The missing workers (Tier 2) are additive features that don't break existing functionality. The persistence gaps (Tier 3) mean some blueprint-specified owner alerts won't fire yet, but core scheduling operations are unaffected.

No architectural redesign is needed. No module boundaries need to change. The remaining work is additive implementation, not remediation.



