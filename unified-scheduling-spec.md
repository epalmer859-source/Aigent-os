# Communications OS — Scheduling Engine Complete Specification

**This is the single source of truth for the queue-based same-day dispatch scheduling engine. There are no other documents to consult. Every rule, every decision, every edge case is here.**

---

## SYSTEM OVERVIEW

Communications OS is an AI-powered dispatch system for blue-collar service businesses (1–5 person shops). The AI is the dispatcher. There is no human dispatcher in the architecture.

**The lane:** Inquiry → first appointment. After the first appointment, the company handles everything.

**Operating shape:** Same-day service dispatch. 18 industries. Single-tech-per-job. Queue-based scheduling. Capacity measured in minutes, not job count.

**Core principle:** The AI handles conversation. Deterministic code handles every scheduling decision. The AI never decides capacity, state transitions, queue order, or job fit. Code does math. AI talks to humans.

---

## EXISTING STACK

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js App Router + React + Tailwind + Shadcn/ui |
| Backend API | tRPC (4 tiers: public, protected, business, owner) |
| Database | Prisma → Supabase Postgres |
| Validation | Zod on every mutation |
| AI | Claude API — Haiku (routine) / Sonnet (complex) |
| SMS/Voice | Twilio |
| Auth | NextAuth v5 (owner, admin, tech roles) |
| Workers | Railway (background processing, cron jobs) |
| Testing | Vitest — contract-first, test-first methodology |
| Routing Engine | OSRM (self-hosted Docker container) |
| Language | TypeScript end to end |

---

## 18 SAME-DAY DISPATCH INDUSTRIES

Locksmith, Garage Door Service, Appliance Repair, HVAC, Electrical, Pest Control, Pressure Washing, Septic/Drain Services, Chimney Sweep, Glass Repair/Window Replacement, Irrigation Repair, Hot Tub/Spa Repair, Generator Service, Gutter Cleaning, Carpet Cleaning, Air Duct Cleaning, Junk Removal, Mobile Mechanics.

**Recurring/Route-Heavy (Mode 2, future):** Lawn Care, Pool Service, House Cleaning, Commercial Cleaning.

**Vehicle-Service (Mode 3, future):** Oil Change/Lube Shops, Tire Shops, Windshield Repair.

---

## THE QUEUE-HYBRID MODEL

Not time slots. Not blocks. An ordered queue constrained by available hours. The only promise is the day and a rough window. Precision comes from the real-time "en route" text.

Each tech has an ordered list of jobs for the day. When one finishes, the next goes live. The AI handles all communication in real time.

**Customer window estimates by queue position:**
- Job 1: "First thing in the morning"
- Job 2: "Late morning to early afternoon"
- Job 3: "Afternoon"
- Job 4+: "Later in the afternoon"

Window labels map to projected start times. Customer always gets the label, never the exact projected time. Windows shift automatically as the day progresses.

---

## ROUTING ARCHITECTURE

### Tier 1 — OSRM (primary, all scheduling math)
Self-hosted Open Source Routing Machine. Docker container running on the same infrastructure as the main app. Handles 100% of drive time calculations: queue insertion, tech assignment, capacity, gap-fill, transfers. Sub-millisecond responses. No external API dependency.

- **Dev:** `http://localhost:5000`
- **Prod:** Internal Railway URL (e.g., `osrm.railway.internal:5000`)
- **Data:** Georgia state extract from Geofabrik, pre-processed. Add states as customers onboard.
- **Table API:** One call with all coordinates → NxN duration matrix. This is the queue insertion optimizer's data source.

### Tier 2 — Haversine (emergency fallback)
Pure math. Only if OSRM process crashes.
- Formula: `(haversine_distance × 1.4) / 30 mph`
- Round up to nearest 5 minutes
- 10-minute minimum floor
- Health check before every OSRM call. If down, use haversine via try/catch.

### Google Maps — navigation only
Deep links for tech navigation. Tappable address opens Google Maps natively on tech's phone. Not an API call. Not in the scheduling dependency chain.

---

## FIRST DRIVE TIME OF THE DAY

The first job's drive time is the least reliable — every other drive time uses the previous job's known address, but job #1 assumes home base.

**Default:** `OSRM(tech_home_base → job_1) × 1.25`, rounded up to nearest 5 minutes. Hard-coded multiplier, not configurable.

**Starting My Day button:** Top of tech's daily queue view. Tech taps after morning prep when driving to first client. System grabs GPS coordinates, fires OSRM call from actual location to job #1, replaces the 1.25x estimate with real data. Disappears after tapping. If never tapped, 1.25x holds all day.

---

## TECH REQUIREMENTS

All technicians MUST have location services enabled. Enforced on first app login — app blocks access to queue view until permissions are granted. Used for: Starting My Day, drive time accuracy, dispatching, GPS mismatch detection, real-time queue management. If revoked, owner is flagged.

---

## CAPACITY MATH ENGINE

This is deterministic code. The AI never touches capacity decisions.

### Available Minutes Formula
```
available_minutes = (end_time + overtime_cap) - start_time - lunch_duration
```

### Duration Multiplier Stack (applied in order)
1. Owner's base estimate for the service type
2. 1.3x minimum floor multiplier (always applied to owner estimates)
3. Short-duration check: if result < 30 min → floor to 45 min
4. Volatility buffer: Low 1.2x, Medium 1.4x, High 1.6x
5. Round up to nearest 5 minutes

**Example:** Owner says 45 min → 1.3x = 58.5 → not under 30 so no floor → High volatility 1.6x = 93.6 → round up = 95 min booked.

**Example:** Owner says 20 min → 1.3x = 26 → under 30 so floor to 45 → Low volatility 1.2x = 54 → round up = 55 min booked.

### Job Cost
```
job_cost = booked_duration + drive_time + buffer
```

### Atomic Capacity Reservation
Every booking is a database transaction: read remaining capacity → check if job fits → reserve minutes → insert job. One atomic operation using `Prisma.$transaction` with row-level lock (`SELECT FOR UPDATE`).

If two bookings hit simultaneously, one succeeds and one gets "no room."

### Morning/Afternoon Sub-Capacity
Morning-only jobs must fit within morning sub-capacity (start → lunch), not just total day capacity. Three morning-only customers when only two fit = third rejected.

### Capacity Override
**HARD BLOCK.** Capacity math is never overridden by anyone, including the owner. If the day is full, the day is full. Owner must extend overtime cap or rebook something else first. No exceptions. This keeps capacity math authoritative, not advisory.

### Profile Change Revalidation
Any change to a tech's working hours, lunch break, or overtime preference triggers immediate capacity revalidation of all future queued days. Overcapacity days flagged to owner.

---

## TWO-TIER DURATION FALLBACK

**Classified jobs (AI confidently identified service type):** Standard duration + buffer with all multipliers.

**Unknown/unclassifiable jobs (AI couldn't figure it out):** Longest common duration for that industry + highest volatility buffer. Conservative. Tech corrects on arrival.

Both tiers are corrected by the mandatory tech on-site estimate. The conservative booking holds the slot — the tech's estimate is what the day runs on.

---

## SERVICE TYPE CLASSIFICATION

### Symptom-based types
Replace broad categories like "repair" with symptom-based types. "HVAC — not cooling," "HVAC — water leak," "HVAC — no power." Each symptom gets its own duration estimate and buffer. Pre-built per industry template.

### Customer-language phrase mapping
10–20 common customer phrases stored per service type. "Won't turn on," "no power," "keeps tripping" all map to electrical diagnostic. AI matches against this library.

### One clarifying question max
When description is genuinely ambiguous, AI asks one targeted question. "Is the door not opening at all or making a noise?" Not an interrogation. If answer doesn't narrow it, conservative fallback.

### Tech confirms on arrival
When tech hits arrived, system shows AI-assigned service type. Tech confirms or changes with one tap. Duration updates immediately, day recalculates.

### AI guess vs tech confirmation logged
Every job logs what AI classified vs what tech confirmed. Data collected for future improvement. No auto-refinement in V1.

---

## INTAKE FLOW

### Three-exchange max
"How can I help?" → customer describes → "Any details about the job?" → customer says whatever → AI maps to symptom category → straight to scheduling. Under 2 minutes. No diagnostic interview.

### Unit age question (industry-specific)
"Roughly how old is your [unit/system]?" Asked for: HVAC, appliance repair, electrical, generator service, hot tub/spa repair. NOT asked for: carpet cleaning, pressure washing, pest control, junk removal, gutter cleaning, chimney sweep.

### Property type question (for dual industries)
Asked when industry serves both residential and commercial with significant duration differences: pest control, carpet cleaning, pressure washing, air duct cleaning, locksmith, electrical, HVAC, junk removal, glass repair.

### Multiple problems
AI classifies by most complex/longest-duration symptom. Other issues go in job notes. Book one job, not multiple. Tech determines on site.

---

## SCHEDULING STATE MACHINE

### Valid Transitions
```
not_started    → en_route, canceled, needs_rebook
en_route       → arrived, not_started (tech turned back)
arrived        → in_progress
in_progress    → completed, incomplete, beyond_same_day
completed      → (terminal)
incomplete     → (terminal — triggers follow-up scheduling)
canceled       → (terminal)
needs_rebook   → not_started, canceled
beyond_same_day → (terminal — owner handles project-scope)
```

### Locked States
en_route, arrived, in_progress = LOCKED. Cannot be reordered, moved, or transferred by any code path.

### One Active Job Per Tech
Database-level constraint. A tech can have at most one job in en_route, arrived, or in_progress at any time. Before any transition into an active state: `SELECT COUNT(*) FROM scheduling_jobs WHERE technician_id = ? AND status IN ('en_route', 'arrived', 'in_progress')`. If count > 0 and it's not the same job, reject.

### 5-Minute Minimum Duration
"completed" within 5 minutes of "arrived" timestamp = rejected. Catches accidental taps.

### End-of-Day Sweep
2 hours after tech's scheduled end time, any job still in `in_progress` → flagged to owner. NOT auto-closed.

---

## QUEUE INSERTION LOGIC

### Priority Order
1. **Time preference constraint (hard):** Morning-only in first half of day. Afternoon-only in second half. Cannot violate.
2. **Geographic optimization (soft):** Among valid positions, AI finds spot that minimizes total drive time. Uses OSRM Table API — try every valid insertion point, pick lowest total.
3. **No-preference customers are lubricant:** Fill gaps between constrained customers.

### Manual Arrangement
When owner drags a job to a new position in a future day's queue:
- Job gets `manual_position = true`
- Queue gets `manually_arranged` timestamp for that day/tech
- AI inserts new jobs without disrupting manually-placed jobs
- "Reset to AI Optimization" button clears all flags
- Only applies to future days — lock states take over once day starts

### Reordering Rules
Queue doesn't randomly reshuffle. Reorder only on: new insertion, disruption trigger, or explicit optimization pass. Existing order preserved otherwise.

---

## TECH ASSIGNMENT SCORING

### Filter Pipeline
1. Filter by skill tags (binary: can do this service type or can't)
2. Filter by remaining capacity (enough minutes today?)
3. Filter by time preference (morning/afternoon slot available?)

### Scoring Formula
```
score = (geographic_proximity × 0.6) + (availability_balance × 0.4)

geographic_proximity = 1 - (drive_time_to_job / max_drive_time_across_all_techs)
availability_balance = remaining_capacity / max_remaining_capacity_across_all_techs

Highest score wins. Ties broken by: fewer jobs today > closer to home base.
```

### Workload Fairness
Target: all techs within 10–15% of each other on daily utilized hours. Part-time techs naturally get less (shorter hours in profile). Weekly balance matters more than daily.

### Skill Tag Warnings
Alert if: any tech has zero skill tags, any service type has zero qualified techs. Runs on tech profile save, service type save, and daily cron.

---

## TECH INTERACTION MODEL

### 0 · Starting My Day (once per day)
Button at top of daily queue view. Taps after morning prep. System grabs GPS, recalculates job #1 drive time via OSRM. Replaces 1.25x with real data. Disappears after tap.

### 1 · Hit Arrived
Auto-triggers estimate request and service type confirmation. Logs arrival timestamp and GPS coordinates. If GPS shows 15+ min from job address, transition accepted but GPS mismatch logged. 3+ mismatches per tech → owner auto-flagged.

### 2 · Reply with Estimate
"How's this one looking?" Tech replies with time estimate. AI recalculates remaining day.

**20-minute soft gate:** If no reply within 20 min of arrived, system proceeds on booked duration (all multipliers already applied). When tech eventually replies, day recalculates with real data. Soft gate, not a hard block.

### 3 · Hit Done
**Mandatory completion note first:** One tap — "fixed it" / "needs follow-up" / "customer declined service." Logged permanently. Doesn't block state transition — it's the next screen before queue advances.

**Review modes:** Complete with review request, or complete with pending review.

**Suspiciously fast Done:** Under 50% of estimated duration → accepted, owner auto-flagged under tech's profile data. Never blocked.

Triggers en route to next customer.

### No-Show / Wrong Address
No-show button with comment field. Tech writes details ("wrong address," "gate code didn't work," "nobody home"). Comment sent to AI and owner as notification.

### Tech-to-AI Scheduling Chat
Techs talk to AI directly about scheduling: "Can you move my 2pm?" "I need a longer break." "This job needs a return visit." AI parses intent, algorithms execute, downstream communication handled.

### Follow-Up Scheduling
When job marked "needs follow-up" or "incomplete": tech uses scheduling chat, AI scans all queues for capacity and same-tech availability, books return visit through same capacity math as any booking. V1 feature.

---

## DISRUPTION THRESHOLDS

| Variance | System Behavior |
|----------|----------------|
| Under 15 min | Silent. Absorb internally. |
| 15–45 min | Update internal projections. Only contact customer if window label changes. |
| 45+ min | Contact affected customer(s) with update. |
| Window boundary crossed | Always communicate, regardless of time threshold. 20-min variance crossing noon > 40-min variance staying in afternoon. |
| Day is impossible | Rebook affected customers. |

### Cumulative Drift
Each job 10 min late = 50 min behind after 5 jobs. If cumulative drift exceeds 30 min in one direction, trigger full recalculation regardless of per-job thresholds.

---

## REBOOK CASCADE

When a tech's day blows up or a tech calls in sick:

1. Check capacity on next 3 business days in order
2. Each day uses same atomic capacity reservation as a new booking
3. First day with room gets the job at top of queue
4. If all 3 days full → job enters `needs_rebook` status
5. Owner flagged via text with customer name, phone, service type, original date
6. Customer gets: "We need to reschedule — [company] will reach out shortly"
7. System never silently drops a rebook

### Sick Tech
AI auto-redistributes jobs to other techs. Jobs that don't fit → rebook cascade. AI asks sick tech when they'll return.

---

## GAP-FILL PROTOCOL

When a job finishes way under estimate and a gap opens:

### Tier 1 (first 30 minutes)
Already-booked customers with future appointments who are geographically close and whose job fits the time slot. First come first served.

### Tier 2 (after 30 min no response)
Unbooked and waitlisted customers. AI confirms they're available right now before booking. If not available, next person.

### Rules
- No spamming — only geographically close customers whose job fits
- If a job gets pulled from another tech's queue, AI tries to replace from waitlist
- Every move passes capacity math — no exceptions
- Gap-fill texts are pre-booking communication, outside the 4-text-per-appointment sequence

---

## INTER-TECH TRANSFERS

AI can move jobs between techs when it improves drive time, workload, or fills gaps.

### Eligibility
- Only `not_started` / unlocked jobs
- Receiving tech must be skill-qualified with remaining capacity
- Customer's day, window, and preference maintained
- Customer is NEVER contacted about transfers — invisible

### Approval Rules
- Same-day transfers: AI-decided (time-sensitive)
- Next 1-3 day transfers: AI-recommended, owner approves
- Maximum one transfer per job per day (optimization transfers)
- Emergency events (sick tech, major disruption): bypass one-transfer cap

---

## AI COMMUNICATION LAYER

### Post-Booking Text Sequence (4 texts on a clean job)
1. **Confirmation:** Day + window + "we'll text when en route"
2. **Morning reminder:** Business name + service type + tiered window by position. No tech name.
3. **En route:** Real ETA from OSRM
4. **Completion:** Done + tech direct number + review request

### Morning Reminder Tiers
- **Position 1–2:** "[Business] — you have a tech coming this morning for your [service type]. We'll text when they're on the way."
- **Position 3:** "[Business] — you have a tech coming today for your [service type], likely around midday."
- **Position 4+:** "[Business] — you have a tech coming today for your [service type]. We'll send a text when they're heading your way."

### Scheduling Text Generation
AI-generated preferred. Every message type has a canned template fallback with variables. If Claude is down, system sends template version automatically. Customer always gets the right info — just less conversational during outages.

### Gap-Fill Offers
Pre-booking communication, outside the 4-text sequence. Pull-forward offers: "Reply YES to confirm" + explicit day/window. 20-minute expiration.

### Ratchet Rule
AI only moves customers earlier, one at a time, with explicit yes. Schedule tightens, never shifts sideways.

---

## LOCK STATES

| State | Locked? | Meaning |
|-------|---------|---------|
| completed | LOCKED | Done. Immutable. |
| in_progress | LOCKED | Tech working. Cannot move. |
| en_route | LOCKED | Customer knows tech is coming. Cannot move. |
| not_started | REORDERABLE | No promise made. AI can reorder. |

---

## UNCERTAINTY TIERS (buffer multiplier per service type)

| Tier | Buffer | Examples |
|------|--------|----------|
| Low volatility | 1.2x | Gutter cleaning, carpet cleaning, pressure washing, lockout |
| Medium volatility | 1.4x | Appliance repair, garage door, generator, irrigation |
| High volatility | 1.6x | HVAC, electrical, septic/drain, glass repair |

Owner sets per service type during onboarding. Industry template provides defaults.

---

## PAUSE / RESYNC

### Pause Mode
Owner pauses AI scheduling. Human dispatcher takes over. AI receptionist still collects intake but passes to dispatcher instead of auto-booking. AI still sends existing reminders, en route, completion texts.

Capacity math is still enforced during pause — hard block, even for human dispatcher.

### Resync
When AI comes back on: read-only audit first. Scans all queues, identifies violations (overcapacity, skill mismatches, stuck states). Surfaces as warnings. Owner approves before AI resumes active management. AI never auto-fixes during resync.

---

## DEPENDENCY FAILURE MODES

### Twilio Outage
All texts queued in outbound queue, retry every 60 seconds. Texts send in order when recovered. Owner sees "Comms Down" dashboard banner. Scheduling engine keeps running — techs still work, queue still moves, just no texts.

### Claude Outage
New inbound leads routed to owner's phone via SMS: "New lead from [phone] — AI is temporarily down. Message: [their text]." Owner phone number required during business setup. Existing jobs proceed normally. Scheduling texts fall back to canned templates automatically.

### Worker Crash / Lag
Self-healing workers with auto-catch-up: if a cron job is late by 5+ min, runs immediately on next check. Dashboard alert if delay exceeds 5 minutes. Workers log heartbeat every 60 seconds.

---

## TECH ACCOUNTABILITY

### GPS Mismatch on Arrived
Tech hits Arrived but GPS shows 15+ min away. Transition accepted, mismatch logged. 3+ mismatches per tech → owner auto-flagged under tech's profile.

### Suspiciously Fast Done
Job completed under 50% of estimated duration. Accepted, owner auto-flagged under tech's profile. Never blocked.

### Mandatory Completion Note
After Done: "fixed it" / "needs follow-up" / "customer declined." Logged permanently. Next screen before queue advances.

### No-Show Comment
No-show button includes comment field. Details sent to AI + owner as notification.

---

## CROSS-CHANNEL DEDUPE

Same customer sends booking via SMS + web chat + call within minutes. Dedupe by phone + address + date. Merge into one conversation on text. AI responds to first, replies to others: "Looks like you already reached out — I'll reach out via text from now on."

---

## ALERT ROUTING

When system flags a human: all users with 'owner' role + primary alert contact from onboarding. First to tap "handling it" claims the alert.

Primary alert contact is an onboarding question: "Who should get system alerts?" Can be owner, office manager, or lead tech. If not set, only owners get alerts.

---

## OWNER ONBOARDING (scheduling additions)

| Setting | Source |
|---------|--------|
| Industry | Owner picks → pre-fills everything |
| Working days | Owner sets |
| Working hours | Owner sets |
| Service types + durations | Industry template → owner adjusts |
| Buffer per service type | Suggested defaults → owner sets |
| Service area | Owner sets |
| Hard daily cap (optional) | Owner sets |
| Blackout days | Owner sets |
| No-show wait time | Owner sets |
| Overtime policy | Owner sets company default. Per-tech override. |
| Owner phone number | Owner sets — REQUIRED for Claude outage routing |
| Primary alert contact | Owner sets — optional. All owners always get alerts. |
| AI tone | Already built |

### Per-Tech Settings
Name, skill tags, working hours, lunch break, home base address, part-time/full-time, constraints (e.g., residential only), overtime preference (overrides company default), location services (required — enforced on first login).

---

## BACKGROUND WORKERS

| Worker | Frequency | Purpose |
|--------|-----------|---------|
| Morning reminder sender | Daily, 1hr before open | Tiered reminders to all today's customers |
| Morning briefing sender | Daily, 30min before open | Queue summary to each tech |
| Estimate timeout checker | Every 60s | Flag arrived jobs past 20-min with no estimate |
| Timer check-in | Every 60s | "Still on this one?" when estimated duration passes |
| 60-min project scope prompt | Every 60s | "Standard visit or more extensive?" at 60-min mark |
| End-of-day sweep | Daily, 2hr after latest end time | Flag stuck in_progress jobs |
| Pull-forward expiration | Every 60s | Expire unanswered offers after 20 min |
| Drift tracker | Event-driven (on job completion) | Cumulative drift → recalculation if 30+ min |
| Capacity revalidation | Event-driven (on profile change) | Revalidate future days, flag overcapacity |
| Skill tag validator | Daily + on changes | Warn on zero-tech or zero-tag gaps |
| Worker heartbeat | Every 60s | Log heartbeat. 5-min gap → dashboard alert |

---

## WHAT MUST BE HARD CODE — AI NEVER DECIDES

- Capacity check — remaining minutes ≥ job cost. Arithmetic only.
- Lock state transitions — validated state machine. No skipping.
- Lock state dashboard enforcement — locked jobs not draggable.
- Duplicate detection — exact match criteria, code-enforced.
- Atomic capacity reservation — database transaction.
- Buffer application — every job gets its buffer, every time.
- Working hours / lunch subtraction — arithmetic.
- Window boundary crossing detection — hard comparison.
- Minimum job duration (5 min) — hard rejection.
- Short-duration floor (45 min) — hard floor.
- Owner estimate floor multiplier (1.3x) — applied automatically.
- One active job per tech — database constraint.
- Capacity override — hard block. Never overridden.
- Morning/afternoon sub-capacity — arithmetic.
- Rebook destination capacity check — same atomic reservation.

## WHAT AI CAN DECIDE

- Intake conversation and info collection
- Service type classification (with conservative fallback)
- Customer communication text generation
- Answering customer questions
- Tech conversational scheduling changes
- Parsing tech estimate replies
- Morning briefing and weekly report generation
- Same-day inter-tech transfers (validated by code)

## AI RECOMMENDS, CODE CONFIRMS

- Queue insertion position (code validates constraints)
- Tech assignment (code validates skill + capacity)
- Rebook destination (code validates capacity)
- Next 1-3 day inter-tech transfers (owner approves)
- Anomaly alerts (owner decides action)

---

## V1 OVERENGINEERING TO AVOID

These sound smart but should be cut from V1:

- **Auto-refinement of duration estimates.** Collect data. Build in V2.
- **Confidence scoring on classifications.** Conservative fallback gets 80% of benefit with 10% of complexity.
- **Dynamic buffers based on traffic/time of day.** Static buffers per service type are sufficient.
- **Customer satisfaction routing.** Requires rating system + value model. Ship later.
- **Territory zones.** Useful at 10+ techs.
- **Crew grouping.** Two-tech jobs are rare for 1-5 person shops. Owner handles manually.
- **Weekly workload balancing algorithm.** Daily balancing compounds naturally.
- **Multi-day projects.** Use beyond_same_day escape hatch. Build project model later.
- **Parts inventory scheduling.** Use parts_inquiries table + follow-up chat. Full inventory system later.
- **Multi-crew scheduling.** Single technician_id per job for now. Add junction table later.

---

## TOP 5 KILL SHOTS TO PREVENT

1. **Optimistic owner estimates compound.** Fix: 1.3x floor on all owner estimates.
2. **Cumulative drift with no notification.** Fix: 30-min cumulative threshold triggers full recalculation.
3. **Morning customer served in afternoon.** Fix: Morning/afternoon sub-capacity validation + window boundary detection.
4. **Concurrent bookings overbook.** Fix: Atomic database transaction with row lock.
5. **Resync silently fixes everything.** Fix: Read-only audit first. Owner approves.

---

## DATABASE SCHEMA ADDITIONS

### New Tables

**technicians** — name, business_id, home_base_lat, home_base_lng, home_base_address, working_hours_start, working_hours_end, lunch_start, lunch_end, overtime_cap_minutes, is_active, location_services_enabled.

**technician_skill_tags** — technician_id, service_type_id. Many-to-many.

**service_types** — name, business_id, industry, base_duration_minutes, volatility_tier (low/medium/high), buffer_multiplier, property_type_variants (JSON), symptom_phrases (JSON array).

**scheduling_jobs** — business_id, technician_id, customer_id, appointment_id, service_type_id, status (enum), queue_position, scheduled_date, time_preference (morning/afternoon/soonest/none), estimated_duration_minutes, actual_duration_minutes, drive_time_minutes, address_lat, address_lng, address_text, job_notes, manual_position (boolean), ai_classified_type, tech_confirmed_type, completion_note (fixed/needs_followup/customer_declined), created_at, updated_at.

**capacity_reservations** — technician_id, date, total_available_minutes, reserved_minutes, morning_reserved_minutes, afternoon_reserved_minutes. One row per tech per day.

**scheduling_events** — job_id, event_type, old_value, new_value, triggered_by (ai/owner/tech/system), timestamp.

**rebook_queue** — job_id, original_date, original_technician_id, reason, customer_notified, owner_notified, resolved_at.

**queue_arrangements** — technician_id, date, manually_arranged_at, reset_at.

### Scheduling Job Status Enum
```
not_started | en_route | arrived | in_progress | completed | incomplete | canceled | needs_rebook | beyond_same_day
```

### Link to Existing Schema
Add `scheduling_job_id` FK to existing appointments table. The appointment stays as-is for receptionist booking flow. The scheduling_job wraps it with queue-specific data.

---

## EDGE CASES

| Edge Case | Handling |
|-----------|---------|
| Outside service area | Soft decline — AI flags for owner approval |
| After-hours intake | AI responds at 9pm, auto-books into next day queue. Customer gets confirmation immediately. |
| Customer cancels same-day | Queue adjusts silently. Owner + tech notified. Freed slot → waitlist. |
| Customer no-show | Wait time per company setting. Tech taps no-show with comment. |
| Emergency job, schedule full | Reserved emergency slot per day. If unused, becomes buffer. |
| Job needs return visit | Tech marks incomplete. Follow-up via scheduling chat. Same capacity math. |
| Cancellation opens slot | Waitlist activated. Urgent first, then FCFS. Ratchet rule. |
| Repeat customer | AI recognizes phone, pulls history for faster intake. |
| Warranty/callback | AI detects "you guys were just here." Flags as callback, priority for same tech. |
| Schedule full for days | Customer goes on waitlist. Urgent first, then FCFS. |
| Tech done early | Gap-fill protocol. Two tiers. Capacity validated. |
| Wrong address | Tech uses no-show button with comment. AI + owner notified. |
| Duplicate cross-channel | Merge to text conversation. AI acknowledges others. |
| Twilio down | Queue and retry. Dashboard banner. Engine keeps running. |
| Claude down | Leads routed to owner phone. Templates for scheduling texts. |
| Worker crash | Self-healing catch-up. Dashboard alert at 5-min delay. |
| Tech goes dark after en route | No special handling. Customer has ETA. System's job done. |

---

## CLAUDE CODE RULES (enforce on every prompt)

```
1. NEVER import from @supabase/supabase-js. All DB access through Prisma.
2. NEVER create Supabase Edge Functions. All logic in tRPC or API routes.
3. NEVER use Supabase Realtime. Polling via tRPC useQuery with refetchInterval.
4. Every tRPC procedure filters by ctx.businessId.
5. Every database query uses Prisma, never raw SQL.
6. Input validation uses Zod on every mutation.
7. Scheduling decisions are deterministic code, never AI judgment.
8. Capacity math uses Prisma.$transaction with row-level locks.
9. State transitions validated against VALID_TRANSITIONS map.
10. One active job per tech enforced at database level.
11. All drive times come from OSRM service, haversine fallback on failure.
12. Test each module in isolation with injectable dependencies.
13. Every test traces to a specific rule in this document.
```
