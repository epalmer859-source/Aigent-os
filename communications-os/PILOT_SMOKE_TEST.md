# Scheduling Engine — Pilot Go-Live Smoke Test

**Date:** 2026-04-09
**Scope:** All integrated tRPC routes + cron workers from the integration pass.
**Pre-condition:** `npx prisma db push` completed, pilot business + tech + customer rows exist.

---

## 0. Environment Pre-Checks

Before any smoke tests, verify these in order. If any fail, stop — you are not ready.

| # | Check | Command | Expected |
|---|-------|---------|----------|
| 0a | DB migrations applied | `npx prisma db push --dry-run` | "No changes" or "Already in sync" |
| 0b | `businesses.timezone` populated | `SELECT id, timezone FROM businesses WHERE deleted_at IS NULL;` | Every row has an IANA timezone (e.g. `America/Chicago`) |
| 0c | `businesses.scheduling_mode` | `SELECT id, scheduling_mode FROM businesses WHERE deleted_at IS NULL;` | Every row shows `active` |
| 0d | At least one technician exists | `SELECT id, name, business_id, working_hours_start, working_hours_end, home_base_lat, home_base_lng FROM technicians WHERE is_active = true LIMIT 5;` | At least 1 row with valid lat/lng and hours |
| 0e | At least one service_type exists | `SELECT id, name, base_duration_minutes, volatility_tier FROM service_types LIMIT 5;` | At least 1 row |
| 0f | At least one customer exists | `SELECT id FROM customers LIMIT 1;` | At least 1 row |
| 0g | OSRM reachable | `curl -s "$OSRM_BASE_URL/route/v1/driving/-97.7,30.2;-97.8,30.3?overview=false" \| jq .code` | `"Ok"` |
| 0h | Workers process starts | Start `npx tsx src/workers/main.ts` | Log: `[workers] Started 13 background workers.` and `[workers] Scheduling: morningReminder ...` |

**Record these IDs for use in all tests below:**
```
BUSINESS_ID=<from 0b>
TECH_ID=<from 0d>
CUSTOMER_ID=<from 0f>
SERVICE_TYPE_ID=<from 0e>
TIMEZONE=<from 0b>
```

---

## 1. SMOKE-01: Book a Job

**Route:** `scheduling.bookJob` (businessProcedure, mutation)

**tRPC call:**
```ts
const result = await trpc.scheduling.bookJob.mutate({
  jobId: crypto.randomUUID(),       // generate fresh
  technicianId: TECH_ID,
  customerId: CUSTOMER_ID,
  customerName: "Smoke Test Customer",
  scheduledDate: "2026-04-10T00:00:00.000Z",  // tomorrow
  timePreference: "MORNING",
  totalCostMinutes: 60,
  addressLat: 30.267,
  addressLng: -97.743,
  serviceType: SERVICE_TYPE_ID,
});
```

**Expected outcome:**
```json
{ "success": true, "jobId": "<uuid>", "queuePosition": 1 }
```

**DB verification:**
```sql
-- 1a: scheduling_jobs row created
SELECT id, status, queue_position, time_preference, scheduled_date, technician_id
FROM scheduling_jobs WHERE id = '<jobId>';
-- Expected: status=NOT_STARTED, queue_position=1, time_preference=MORNING

-- 1b: capacity_reservations updated
SELECT reserved_minutes, morning_reserved_minutes
FROM capacity_reservations
WHERE technician_id = '<TECH_ID>' AND date = '2026-04-10';
-- Expected: reserved_minutes=60, morning_reserved_minutes=60

-- 1c: scheduling_events audit row
SELECT event_type, old_value, new_value, triggered_by
FROM scheduling_events WHERE scheduling_job_id = '<jobId>';
-- Expected: event_type='status_change', new_value='NOT_STARTED', triggered_by='SYSTEM'
```

**Save:** `JOB_ID=<result.jobId>`

---

## 2. SMOKE-02: Transition Job Through Full Lifecycle

**Route:** `scheduling.transitionJob` (businessProcedure, mutation)

Run these 4 transitions in order. Each call:
```ts
await trpc.scheduling.transitionJob.mutate({
  jobId: JOB_ID,
  technicianId: TECH_ID,
  newStatus: "<status>",
  triggeredBy: "TECH",
});
```

| Step | newStatus | Expected `success` | DB: `scheduling_jobs.status` | DB: extra columns |
|------|-----------|--------------------|-----------------------------|-------------------|
| 2a | `EN_ROUTE` | `true` | `EN_ROUTE` | — |
| 2b | `ARRIVED` | `true` | `ARRIVED` | `arrived_at` is set |
| 2c | `IN_PROGRESS` | `true` | `IN_PROGRESS` | — |
| 2d | `COMPLETED` | `true` (wait >5 min after 2c OR use test clock) | `COMPLETED` | `completed_at` is set |

**DB verification after 2d:**
```sql
-- 2e: Full audit trail
SELECT event_type, old_value, new_value, triggered_by
FROM scheduling_events WHERE scheduling_job_id = '<JOB_ID>'
ORDER BY timestamp;
-- Expected: 5 rows (initial NOT_STARTED + 4 transitions)

-- 2f: No active jobs remaining for tech
SELECT COUNT(*) FROM scheduling_jobs
WHERE technician_id = '<TECH_ID>'
  AND status IN ('EN_ROUTE', 'ARRIVED', 'IN_PROGRESS');
-- Expected: 0
```

**Invalid transition test:**
```ts
// 2g: Try to transition a COMPLETED job — must fail
const bad = await trpc.scheduling.transitionJob.mutate({
  jobId: JOB_ID,
  technicianId: TECH_ID,
  newStatus: "EN_ROUTE",
  triggeredBy: "TECH",
});
// Expected: { success: false, reason: "invalid_transition" }
```

---

## 3. SMOKE-03: Book a Second Job + Get Queue + Get Capacity

**Route:** `scheduling.bookJob`, `scheduling.getQueue`, `scheduling.getCapacity`

```ts
// 3a: Book second job
const job2 = await trpc.scheduling.bookJob.mutate({
  jobId: crypto.randomUUID(),
  technicianId: TECH_ID,
  customerId: CUSTOMER_ID,
  customerName: "Smoke Test Customer 2",
  scheduledDate: "2026-04-10T00:00:00.000Z",
  timePreference: "AFTERNOON",
  totalCostMinutes: 90,
  addressLat: 30.300,
  addressLng: -97.700,
  serviceType: SERVICE_TYPE_ID,
});
// Expected: { success: true, queuePosition: 2 }

// 3b: Get queue
const queue = await trpc.scheduling.getQueue.query({
  technicianId: TECH_ID,
  date: "2026-04-10T00:00:00.000Z",
});
// Expected: array with 2 entries (COMPLETED job + new NOT_STARTED job),
// ordered by queue_position

// 3c: Get capacity
const cap = await trpc.scheduling.getCapacity.query({
  technicianId: TECH_ID,
  date: "2026-04-10T00:00:00.000Z",
});
// Expected: reserved_minutes=150 (60+90), afternoon_reserved_minutes=90
```

**Save:** `JOB2_ID=<job2.jobId>`

---

## 4. SMOKE-04: Pause Guard

**Route:** `scheduling.setSchedulingMode`, `scheduling.getSchedulingMode`, `scheduling.bookJob`

```ts
// 4a: Pause scheduling
await trpc.scheduling.setSchedulingMode.mutate({ mode: "paused" });

// 4b: Verify mode
const mode = await trpc.scheduling.getSchedulingMode.query();
// Expected: { mode: "paused" }

// 4c: Try to book while paused — must be rejected
const blocked = await trpc.scheduling.bookJob.mutate({
  jobId: crypto.randomUUID(),
  technicianId: TECH_ID,
  customerId: CUSTOMER_ID,
  customerName: "Should Fail",
  scheduledDate: "2026-04-10T00:00:00.000Z",
  timePreference: "SOONEST",
  totalCostMinutes: 45,
  addressLat: 30.267,
  addressLng: -97.743,
  serviceType: SERVICE_TYPE_ID,
});
// Expected: { success: false, reason: "scheduling_paused" }

// 4d: Resume scheduling
await trpc.scheduling.setSchedulingMode.mutate({ mode: "active" });
```

**DB verification:**
```sql
SELECT scheduling_mode FROM businesses WHERE id = '<BUSINESS_ID>';
-- After 4a: 'paused'
-- After 4d: 'active'
```

---

## 5. SMOKE-05: Sick Tech Rebook Cascade

**Pre-req:** At least 2 active technicians for the business. Book 2 jobs on TECH_A for tomorrow.

**Route:** `scheduling.redistributeSickTech` (ownerProcedure, mutation)

```ts
const rebook = await trpc.scheduling.redistributeSickTech.mutate({
  technicianId: TECH_A_ID,
  date: "2026-04-10T00:00:00.000Z",
});
// Expected: { redistributed: [...], failed: [] }
// Each redistributed entry has: jobId, fromTechnicianId, toTechnicianId, toDate
```

**DB verification:**
```sql
-- 5a: Original tech's jobs are NEEDS_REBOOK or reassigned
SELECT id, technician_id, status FROM scheduling_jobs
WHERE technician_id = '<TECH_A_ID>' AND scheduled_date = '2026-04-10';
-- Expected: status changed to NEEDS_REBOOK or jobs moved to TECH_B

-- 5b: Rebook queue entries
SELECT * FROM rebook_queue WHERE scheduling_job_id IN ('<job1>', '<job2>');
-- Expected: rows exist with target tech/date
```

---

## 6. SMOKE-06: Gap-Fill Detect + Rank

**Pre-req:** A tech with a completed early job (creates a gap in the queue).

**Route:** `scheduling.detectAndRankGap` (businessProcedure, mutation)

```ts
const gapResult = await trpc.scheduling.detectAndRankGap.mutate({
  gapId: "smoke-gap-01",
  technicianId: TECH_ID,
  date: "2026-04-10T00:00:00.000Z",
  gapStartMinute: 120,         // 10:00 AM
  bookedDurationMinutes: 60,
  actualDurationMinutes: 30,   // finished 30 min early → 30 min gap
  previousJobId: JOB_ID,
  previousJobEndedAt: "2026-04-10T15:30:00.000Z",
  previousJobAddressLat: 30.267,
  previousJobAddressLng: -97.743,
});
```

**Expected outcomes (one of):**
- `{ outcome: "gap_too_small", gap: null, ranked: null }` — gap under threshold (valid)
- `{ outcome: "ranked", gap: {...}, ranked: [...] }` — candidates found and scored

**DB verification:** No DB writes for detect+rank (read-only operation). Verify no new rows in `pull_forward_offers`.

---

## 7. SMOKE-07: Accept Pull-Forward Offer

**Pre-req:** Manually insert a `pull_forward_offers` row with status `active` for a valid `scheduling_job_id`.

**Route:** `scheduling.acceptPullForward` (businessProcedure, mutation)

```ts
const accept = await trpc.scheduling.acceptPullForward.mutate({
  jobId: OFFER_JOB_ID,
});
```

**DB verification:**
```sql
-- 7a: Offer status changed
SELECT status FROM pull_forward_offers WHERE scheduling_job_id = '<OFFER_JOB_ID>';
-- Expected: 'accepted'

-- 7b: Job moved to new position
SELECT technician_id, queue_position, scheduled_date
FROM scheduling_jobs WHERE id = '<OFFER_JOB_ID>';
-- Expected: updated to target_technician_id, new_queue_position, target_date from the offer
```

---

## 8. SMOKE-08: Batch Transfer Evaluate + Execute

**Pre-req:** A tech with 2+ jobs on the same date, another tech with capacity.

**Route:** `scheduling.evaluateBatchTransfers`, `scheduling.executeBatchTransfers`

```ts
// 8a: Evaluate
const eval = await trpc.scheduling.evaluateBatchTransfers.mutate({
  technicianId: TECH_ID,
  date: "2026-04-10T00:00:00.000Z",
});
// Expected: { recommended: [...], blocked: [...], noImprovement: [...] }

// 8b: Execute (if any recommended)
const exec = await trpc.scheduling.executeBatchTransfers.mutate({
  technicianId: TECH_ID,
  date: "2026-04-10T00:00:00.000Z",
});
```

**DB verification (if transfers executed):**
```sql
-- 8c: Transfer events logged
SELECT scheduling_job_id, from_technician_id, to_technician_id, approval_type
FROM transfer_events ORDER BY created_at DESC LIMIT 5;
-- Expected: new rows with approval_type = 'auto_same_day'

-- 8d: Jobs moved
SELECT id, technician_id FROM scheduling_jobs WHERE id IN ('<transferred_job_ids>');
-- Expected: technician_id changed to target tech

-- 8e: Capacity updated for both techs
SELECT technician_id, reserved_minutes FROM capacity_reservations
WHERE date = '2026-04-10' AND technician_id IN ('<from_tech>', '<to_tech>');
-- Expected: from_tech reserved_minutes decreased, to_tech increased
```

---

## 9. SMOKE-09: Worker Cron Logs

**What to look for:** Start the worker process and let it run through one cron cycle.

### Morning Reminder Worker (runs `*/15 6-13 * * * UTC`)

**Expected log lines:**
```
[morningReminder] Would queue reminder for job <uuid>
```
— OR, if no NOT_STARTED jobs exist for today:
```
(no log — worker runs but finds nothing)
```

**DB verification:**
```sql
-- No DB writes from the reminder worker itself (callback is stub).
-- When wired: check message_queue for reminder entries.
```

### End-of-Day Sweep Worker (runs `*/30 20-23,0-6 * * * UTC`)

**Expected log lines (if stuck jobs exist):**
```
[endOfDaySweep] Business <uuid>: N stuck jobs detected ["<jobId1>", ...]
```
— OR, if no stuck jobs:
```
(no log — worker runs cleanly)
```

**DB verification:**
```sql
-- Sweep is read-only. No DB writes. Verify no job statuses changed:
SELECT id, status FROM scheduling_jobs
WHERE status = 'IN_PROGRESS' AND scheduled_date = CURRENT_DATE;
-- Expected: same rows as before sweep (sweep flags, never auto-closes)
```

### Worker startup verification:
```
[workers] Started 13 background workers.
[workers] Scheduling: morningReminder (*/15 6-13 UTC), endOfDaySweep (*/30 20-06 UTC)
```

---

## 10. Rollback Steps

If any smoke test fails, follow the rollback for that test. Do NOT proceed to the next test until the failure is resolved or explicitly deferred.

### General rollback (any test):
```sql
-- Delete all scheduling data created during smoke tests
DELETE FROM scheduling_events WHERE scheduling_job_id IN (
  SELECT id FROM scheduling_jobs WHERE customer_id = '<SMOKE_CUSTOMER_ID>'
);
DELETE FROM pull_forward_offers WHERE scheduling_job_id IN (
  SELECT id FROM scheduling_jobs WHERE customer_id = '<SMOKE_CUSTOMER_ID>'
);
DELETE FROM transfer_events WHERE scheduling_job_id IN (
  SELECT id FROM scheduling_jobs WHERE customer_id = '<SMOKE_CUSTOMER_ID>'
);
DELETE FROM rebook_queue WHERE scheduling_job_id IN (
  SELECT id FROM scheduling_jobs WHERE customer_id = '<SMOKE_CUSTOMER_ID>'
);
DELETE FROM scheduling_jobs WHERE customer_id = '<SMOKE_CUSTOMER_ID>';
DELETE FROM capacity_reservations
  WHERE technician_id = '<TECH_ID>' AND date = '2026-04-10';
```

### Per-test rollback:

| Test | Rollback |
|------|----------|
| SMOKE-01 (bookJob) | Delete the `scheduling_jobs` row + `capacity_reservations` row + `scheduling_events` rows |
| SMOKE-02 (transitions) | No rollback needed — job is in terminal state COMPLETED |
| SMOKE-03 (second book) | Delete job2 row + update capacity |
| SMOKE-04 (pause) | `UPDATE businesses SET scheduling_mode = 'active' WHERE id = '<BIZ_ID>';` |
| SMOKE-05 (rebook) | Delete `rebook_queue` rows, restore original `technician_id` on moved jobs |
| SMOKE-06 (gap detect) | No rollback — read-only |
| SMOKE-07 (accept PF) | `UPDATE pull_forward_offers SET status = 'active' WHERE ...;` + restore job position |
| SMOKE-08 (transfers) | Delete `transfer_events`, restore `technician_id` + `queue_position` on moved jobs, recalculate capacity |
| SMOKE-09 (workers) | Stop worker process. No DB writes to roll back. |

### If OSRM is down:
All booking, rebook, gap-fill, and transfer operations will fail with a network error. **Do not proceed** — fix OSRM first.

### If a tRPC auth error occurs:
The `businessProcedure` / `ownerProcedure` requires an authenticated session with `businessId`. Ensure you are calling from an authenticated context (dashboard session or API key with business scope).

---

## 11. GO / NO-GO Checklist

All items must be YES for GO. Any NO is a hard stop.

| # | Criterion | Status |
|---|-----------|--------|
| G1 | `npx prisma db push` reports no pending changes | [ ] YES / [ ] NO |
| G2 | All pilot businesses have `timezone` set (IANA format) | [ ] YES / [ ] NO |
| G3 | All pilot businesses have `scheduling_mode = 'active'` | [ ] YES / [ ] NO |
| G4 | At least 1 technician per pilot business with valid lat/lng and hours | [ ] YES / [ ] NO |
| G5 | OSRM instance reachable from production server | [ ] YES / [ ] NO |
| G6 | SMOKE-01 (bookJob) passed | [ ] YES / [ ] NO |
| G7 | SMOKE-02 (full lifecycle) passed | [ ] YES / [ ] NO |
| G8 | SMOKE-03 (queue + capacity reads) passed | [ ] YES / [ ] NO |
| G9 | SMOKE-04 (pause guard blocks + resumes) passed | [ ] YES / [ ] NO |
| G10 | SMOKE-05 (sick rebook) passed OR deferred (single-tech pilot) | [ ] YES / [ ] NO / [ ] DEFERRED |
| G11 | SMOKE-06 (gap detect) passed | [ ] YES / [ ] NO |
| G12 | SMOKE-07 (accept pull-forward) passed OR deferred | [ ] YES / [ ] NO / [ ] DEFERRED |
| G13 | SMOKE-08 (batch transfer) passed OR deferred (single-tech pilot) | [ ] YES / [ ] NO / [ ] DEFERRED |
| G14 | SMOKE-09 (worker cron logs confirmed) | [ ] YES / [ ] NO |
| G15 | Smoke test data cleaned up (general rollback SQL executed) | [ ] YES / [ ] NO |
| G16 | `scheduling_events` table is empty or contains only smoke-test residue | [ ] YES / [ ] NO |
| G17 | Workers process restarts cleanly after stop/start | [ ] YES / [ ] NO |
| G18 | No tsc errors in scheduling files (`npx tsc --noEmit \| grep scheduling`) | [ ] YES / [ ] NO |
| G19 | Scheduling test suite green (17/17, 513/513) | [ ] YES / [ ] NO |

### Decision:

- **All YES (G10/G12/G13 may be DEFERRED for single-tech pilots):** **GO**
- **Any NO on G1-G9, G14, G17-G19:** **NO-GO** — fix before launch
- **G10/G12/G13 NO (not deferred):** **NO-GO** — multi-tech features broken

---

## Quick-Reference: Tables Touched by Scheduling Engine

| Table | Written By | Read By |
|-------|-----------|---------|
| `scheduling_jobs` | bookJob, transitionJob, rebook, acceptPullForward, executeTransfer | All queries, gap-fill, sweep |
| `scheduling_events` | transitionJob, bookJob | Audit trail queries |
| `capacity_reservations` | bookJob, rebook, executeTransfer | getCapacity, bookJob (check) |
| `pull_forward_offers` | gap-fill create offer | acceptPullForward, gap-fill detect |
| `transfer_events` | executeTransfer | Transfer history queries |
| `rebook_queue` | redistributeSickTech | Rebook processing |
| `queue_arrangements` | manual reorder (future) | Queue reads |
| `businesses` | setSchedulingMode | pauseGuard, worker loop |
| `technicians` | — (read-only) | bookJob (home base), workers (profiles) |
