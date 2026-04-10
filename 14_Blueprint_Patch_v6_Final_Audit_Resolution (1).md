# Communications OS — Blueprint Patch v6

## Final Audit Resolution

**Date:** March 31, 2026
**Status:** Binding patch — resolves every remaining gap, contradiction, and missing specification identified in the full 13-document system audit. Fully engineer-proof.

---

**Patch lock statement:**
- This patch resolves every open finding from the final full-system authority audit.
- Where this patch conflicts with any wording in any prior document, this patch wins.
- Schema Contract v4 FINAL is retired. Patch v5 (as amended by the Addendum and this patch) is the single schema source of truth.
- Blueprint Patch v4 is retired. Its content has been fully absorbed into Patch v5 and later documents.

---

# PART 1 — DOCUMENT RETIREMENTS

## 1.1 Schema Contract v4 FINAL — RETIRED

Schema Contract v4 FINAL is retired as a standalone authority. Its content has been fully absorbed into Blueprint Patch v5, the Patch v5 Addendum, and this patch. Engineers must not reference Schema Contract v4 for any table definition, enum, constraint, or write authority. The single schema source of truth is now the combined content of Patch v5 Part 2 + Addendum Part 2 + this patch.

## 1.2 Blueprint Patch v4 — RETIRED

Blueprint Patch v4 is retired. Its content has been fully absorbed into Patch v5, the Supplemental Engineering Contract, the Dashboard App Specification, and this patch. All authority references to "Patch v4" should be treated as pointing to Patch v5.

---

# PART 2 — SCHEMA FIXES

## 2.1 Escalation Category Enum — Fix Count

**Old:** "escalation_category (13 values)"

**New:** "escalation_category (14 values)"

The list of 14 values is correct and unchanged: complaint, legal_threat, safety_issue, billing_dispute, insurance_issue, permit_regulatory_issue, hostile_customer, damage_liability_incident, vendor_dispute, restricted_topic, scope_dispute, contract_interpretation, blame_fault, internal_staff_issue.

## 2.2 Appointment Status Enum — Add rescheduled

**Old:** appointment_status: booked, canceled, completed, no_show (4 values)

**New:** appointment_status: booked, rescheduled, canceled, completed, no_show (5 values)

When an admin reschedules an appointment, the old appointment record status changes to rescheduled and a new appointment record is created with status = booked for the replacement time. The rescheduled record preserves history. The appointment_change_request record links old and new appointments.

## 2.3 Conversations Table — Add Summary Cache and Collected Address

Add the following fields to the conversations table:

| Field | Type | Rule |
|---|---|---|
| cached_summary | text null | AI-generated conversation summary. Regenerated on every state change. |
| summary_updated_at | timestamptz null | When the cached summary was last generated. |
| collected_service_address | text null | Service address collected during intake, before an appointment exists. Copied into appointment.address when the appointment is created. |

**Summary generation rule:** The cached_summary is regenerated automatically every time the conversation primary_state changes. The summary is a concise 2-4 sentence description of the conversation context, current status, and pending actions. The AI runtime reads this summary + the last 20 messages per turn instead of loading full history.

**Summary staleness rule:** If summary_updated_at is more than 24 hours old and the conversation is in a non-closed state, the summary is regenerated on the next inbound message even if the state has not changed.

**Summary generation mechanism:** Generated as a secondary Claude API call (smaller/faster model) immediately after state-change processing. NOT inline during primary response. If the call fails, the old summary is retained and retry happens on next state change.

### Address lifecycle (no customer-level address field)

1. **During intake:** AI collects service address. Stored on conversations.collected_service_address.
2. **Service area matching:** AI uses collected_service_address to match against business_config.service_area_list before any appointment exists.
3. **Appointment creation:** When admin books, collected_service_address is copied into appointments.address. Appointment record becomes the address source of truth.
4. **Returning customers:** AI can reference the address from the most recent prior appointment (via customer_id join). AI always confirms — never assumes same address.
5. **Canonical rule:** appointment.address if appointment exists, otherwise conversations.collected_service_address.

## 2.4 Businesses Table — Add Configurable Quiet Hours

| Field | Type | Rule |
|---|---|---|
| quiet_hours_start | time not null default '22:00' | Start of quiet hours (business local time). |
| quiet_hours_end | time not null default '06:00' | End of quiet hours (business local time). |

Owner can adjust in Settings > AI Behavior. Minimum 6-hour window enforced. Weird-hours deferral adjusts proportionally: begins 6 hours before quiet_hours_start, ends 4 hours after quiet_hours_start.

All existing hard-coded "10 PM – 6 AM" references should be read as "the business's configured quiet hours."

## 2.5 Businesses Table — Enforce One Business Per Account

Unique constraint on owner_user_id. One business per founding owner account. This field records who created the business during onboarding and is used for lockout recovery. Multiple users may hold the 'owner' role within a business — see users table constraints.

## 2.6 prompt_log Table — New

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | Primary key. |
| business_id | uuid not null | FK → businesses.id. |
| conversation_id | uuid not null | FK → conversations.id. |
| message_id | uuid null | FK → message_log.id. Null if no message generated. |
| prompt_purpose | text not null | response_generation, summary_generation, intent_classification, override_detection. |
| prompt_text | text not null | Full prompt sent to Claude. |
| response_text | text not null | Full response from Claude. |
| model | text not null | Model identifier. |
| token_count_prompt | integer null | |
| token_count_response | integer null | |
| latency_ms | integer null | |
| success | boolean not null default true | False if call failed after retries. |
| error_message | text null | Error details if success = false. |
| created_at | timestamptz not null default now() | |
| expires_at | timestamptz not null default (now() + interval '30 days') | |

Write authority: System only. Index: (business_id, conversation_id, created_at desc).

## 2.7 calendar_sync_log Table — New

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| appointment_id | uuid null | |
| google_calendar_event_id | text null | |
| sync_direction | text enum not null | inbound or outbound. |
| sync_action | text enum not null | created, updated, deleted. |
| before_snapshot | jsonb null | Appointment state before sync. Null on creation. |
| after_snapshot | jsonb null | Appointment state after sync. Null on deletion. |
| is_destructive | boolean not null default false | True if sync_action = deleted. |
| grace_period_expires_at | timestamptz null | For destructive inbound syncs only. |
| grace_period_undone | boolean not null default false | |
| processed_at | timestamptz null | |
| created_at | timestamptz not null default now() | |

Write authority: System only. Index: (business_id, created_at desc), (appointment_id, created_at desc).

## 2.8 Appointments Table — Add Grace Period Field

| Field | Type | Rule |
|---|---|---|
| pending_deletion_at | timestamptz null | Set on destructive inbound calendar sync. Cleared on undo or after processing. |

## 2.9 Recurring Visits — No Separate Table (Full Rewrite)

There is no recurring_visits table. Recurring visits are appointment records with is_recurring = true and recurring_service_id pointing to recurring_services.

**Event codes — kept but redefined to reference appointments:**
- recurring_visit_generated — fires when system auto-generates a new appointment with is_recurring = true. related_record_type = appointment.
- recurring_visit_skipped — fires when a recurring appointment is canceled as a skip. related_record_type = appointment.
- recurring_visit_rescheduled — fires when a recurring appointment date/time is changed. related_record_type = appointment.

**Admin actions rewritten:** All actions in Supplemental Engineering Contract §2.9 and Addendum §4.4–§4.9 that reference "recurring visit" operate on appointment records where is_recurring = true:
- Skip Visit: appointment.status → canceled. Event: recurring_visit_skipped.
- Reschedule Visit: appointment date/time updated (or old → rescheduled, new created). Event: recurring_visit_rescheduled.
- Complete Visit: same as Mark Job Complete on any appointment.

**Visit generation worker:** Runs daily at midnight (business timezone). For each active recurring_services record, checks future appointments with is_recurring = true for that service. If fewer than 2 weeks ahead exist, generates new appointment records. Each generated: business_id, conversation_id = null, customer_id, service_type, date/time from frequency + preferred_day/time, address from recurring service, status = booked, is_recurring = true, recurring_service_id set. Event: recurring_visit_generated.

**Recurring conversation creation (lazy):** The visit generation worker does NOT create conversations. Conversations are created lazily when needed. When scheduling reminders for a recurring appointment with conversation_id = null, the system must first create a conversation: business_id and customer_id from the appointment, matter_key = 'recurring:{recurring_service_id}:{appointment_id}', primary_state = booked, current_owner = ai, channel = sms, contact_handle = customer's primary phone from customer_contacts, collected_service_address = recurring_services.address. The appointment's conversation_id is then linked. No customer message is sent on creation — the first customer-facing message is the reminder itself. A conversation is also created if the customer contacts about the visit or the AI initiates communication, whichever happens first.

**No "recurring_visit ID" exists.** Use the appointment ID everywhere.

**Suppression for paused services:** When recurring_services.status = paused, visit generation stops. recurring_reminder messages are suppressed. Already-booked appointments keep standard appointment reminders until explicitly canceled.

## 2.10 Businesses Table — Add Multilingual Setting

| Field | Type | Rule |
|---|---|---|
| multilingual_enabled | boolean not null default false | AI responds in customer's language if supported. |

supported_languages field serves as the language list. Internal content always English.

## 2.11 Email Opt-Out Tracking

Add to customer_contacts:

| Field | Type | Rule |
|---|---|---|
| is_opted_out | boolean not null default false | Email-only opt-out. |
| opted_out_at | timestamptz null | |

Email unsubscribe does not affect SMS/voice.

## 2.12 conversation_merges Table — New

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| surviving_conversation_id | uuid not null | FK → conversations.id. |
| absorbed_conversation_id | uuid not null | FK → conversations.id. |
| customer_id | uuid not null | |
| merge_reason | text not null | Machine-readable: e.g., same_customer_same_service_request. |
| merge_confidence | text enum not null | high or manual. Only high auto-merges. |
| merged_at | timestamptz not null default now() | |

## 2.13 web_chat_sessions Table — New

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| conversation_id | uuid not null | FK → conversations.id. |
| session_token | uuid not null unique | Authentication token. |
| customer_ip | text null | Rate limiting. |
| created_at | timestamptz not null default now() | |
| expires_at | timestamptz not null default (now() + interval '24 hours') | |

Index: (business_id, session_token).

## 2.14 Write Authority for New Tables and Fields

| Record / field family | Allowed writer(s) | Guardrail |
|---|---|---|
| prompt_log.* | System only (Edge Functions) | No admin/owner writes. Auto-deleted after 30 days. |
| calendar_sync_log.* | System only (calendar sync worker) | Append-only. No edits or deletes except auto-expiry. |
| conversation_merges.* | System only (AI merge logic) | No admin writes. Merges are automatic or don't happen. |
| web_chat_sessions.* | System only (web chat Edge Function) | No admin writes. Auto-deleted after 24 hours. |
| conversations.cached_summary | System only (summary generation) | No admin/prompt writes. |
| conversations.collected_service_address | AI intake, admin override on Place Appointment | Admin can correct during booking. |
| appointments.pending_deletion_at | System only (calendar sync), admin undo | Set by sync worker, cleared by admin undo or grace processor. |

---

# PART 3 — OPERATIONAL DECISIONS

## 3.1 Quiet Hours — Configurable Per Business

Default 10 PM – 6 AM. Editable in Settings > AI Behavior. Minimum 6-hour window.

## 3.2 Language Handling — Basic Multilingual

If multilingual_enabled = true and customer writes in a supported language, AI responds in that language. Unsupported language → English with polite note. Internal content always English.

## 3.3 Service Area Matching — List-Only in v1

List-based matching only. AI asks for city/zip, matches against service_area_list. Case-insensitive, partial matching. Radius matching deferred to v2. service_area_type defaults to list.

Matching logic:
1. AI collects city/zip during intake.
2. Match case-insensitive against service_area_list.
3. Check service_area_exclusions. If excluded → out-of-area.
4. If ambiguous → ask for zip code.
5. If out-of-area → waiting_on_approval per existing flow.

## 3.4 Google Calendar — 5-Minute Grace Period on Deletions

**Creates (Google → app):** Sync immediately. calendar_sync_log entry created.

**Updates (Google → app):** Sync immediately (last-write-wins). calendar_sync_log entry with before/after snapshots.

**Deletions (Google → app):**
1. Set appointments.pending_deletion_at = now().
2. calendar_sync_log entry with is_destructive = true, grace_period_expires_at = now() + 5 min, before_snapshot.
3. Immediate admin notification: "Google Calendar event for [customer] on [date] deleted. Appointment cancels in 5 min unless you undo."
4. During grace: appointment still active, "Pending Deletion" badge visible. Reminders continue. Customer not notified.
5. Admin clicks Undo: pending_deletion_at → null, grace_period_undone → true. Google Calendar event re-created. Admin notified: "Deletion undone."
6. 5 min pass, no undo: appointment canceled (status → canceled). All reminders canceled. calendar_sync_log.processed_at set. Admin notified if customer has active thread.

**Outbound (app → Google):** Immediate, no grace. calendar_sync_log entry created.

### Undo Calendar Deletion — Admin Action
- Who: Admin, owner
- Valid when: pending_deletion_at not null AND pending_deletion_at + 5 min > now()
- Records: pending_deletion_at → null, calendar_sync_log.grace_period_undone → true, Google event re-created
- Audit: calendar_sync_outbound event logged

## 3.5 Claude API Unavailability — Fallback

Retry: 3 attempts, backoff 5s / 15s / 45s.

If all fail:
1. Send customer: "We received your message — our team will get back to you shortly." (message_purpose = ai_fallback_response)
2. Urgent admin notification (type: ai_unavailable).
3. prompt_log entry with success = false.
4. Event: ai_generation_failed. Inbound message flagged in event_log metadata: ai_response_failed = true.
5. Cron reprocesses flagged messages when Claude recovers. Skips if already handled.

Fallback counts toward 24h cap. Not quiet-hours restricted (response to customer contact).

## 3.6 Conversation Presence Lock

Supabase Realtime presence per conversation. No schema changes.

1. Admin opens conversation → joins presence channel with user_id, display_name.
2. Others see "Being handled by [name]." Action buttons disabled.
3. Auto-release: 5 min inactivity or navigation away. Supabase heartbeat handles crash (~30s).
4. Owner can force-break admin's lock via "Take over from [name]." Admin cannot break owner's lock. Owner cannot break another owner's lock — they must wait for the 5-minute inactivity timeout or for the other owner to navigate away.

## 3.7 Cross-Channel Conversation Merge — Deterministic Rules

### Hard merge conditions (ALL must be true):
1. Same customer_id (matched via customer_contacts).
2. Different channels (one SMS/voice, other email/web_chat).
3. Same service request: AI classifies same service type AND same collected_service_address AND both in routine/waiting/booking states (not override).
4. Both active (not closed).
5. Both had activity within last 48 hours.

ALL five → confidence = high → auto-merge. Any fails → no merge.

### Merge execution:
1. SMS/voice conversation survives. If both non-SMS, older survives.
2. Absorbed conversation: primary_state → resolved, tag added: merged_into:{surviving_id}.
3. Message history: all message_log entries re-linked to surviving conversation. System message inserted: "Messages from an email conversation about the same request have been merged."
4. Side records (quotes, appointments, escalations, approvals) re-linked to surviving conversation.
5. Pending outbound_queue for absorbed conversation → canceled.
6. All future dedupe_keys use surviving conversation_id. Old dedupe_keys invalidated.
7. Admin notified: "Merged [name]'s email into SMS thread — same [service] at [address]."
8. conversation_merges record created.
9. Event: conversation_merged on surviving conversation.

Below threshold: nothing happens. No manual merge in v1.

## 3.8 Quote Withdraw — Revise-Only

No standalone cancel. Withdraw only by replacing with corrected quote.

1. Owner clicks "Revise Quote" on sent quote.
2. Enters corrected price/terms. Reason optional.
3. Old quote: status → superseded, superseded_by → new ID.
4. New quote: status = approved_to_send, queued immediately.
5. AI delivers and explains the update naturally.
6. **ALL pending quote_followup_1 and quote_followup_final for the old quote → canceled immediately.**
7. New follow-up ladder starts fresh.

### Revise Quote — Admin Action
- Who: Admin, owner
- Input: Old quote ID, new amount, new terms (opt), reason (opt)
- Records: Old quote superseded. New quote created and queued.
- Queue: ALL pending quote follow-ups for old quote canceled.
- Audit: Event: quote_revised.

## 3.9 Multi-Job Same Thread

Closeout for first job naturally canceled by state change. Second job handled in same thread. New closeout fires after second job completes. Existing rules produce correct outcome. No special handling.

## 3.10 Paused Recurring Service Suppression

paused status → visit generation stops, recurring_reminder suppressed. Already-booked appointments keep standard reminders until canceled.

## 3.11 Admin Conversation Access

Admin gets searchable conversation list (search by name/phone). Can view history, take over, message. Cannot access settings/config/customer-list/analytics.

### Updated main navigation:

| Tab | Who |
|---|---|
| Urgent | Owner, Admin |
| Conversations | Owner, Admin |
| Appointments | Owner, Admin |
| Quotes | Owner, Admin |
| Approvals | Owner, Admin |
| Escalations | Owner, Admin |
| Settings | Owner only |

Profile icon (top corner, both roles): notification prefs, account, sign out.

## 3.12 Email Unsubscribe — CAN-SPAM

Every outbound email includes footer: "Unsubscribe from email messages."

On click:
1. customer_contacts: is_opted_out = true, opted_out_at = now().
2. Pending email outbound canceled.
3. Admin notified.
4. SMS/voice continues.
5. Event: customer_email_unsubscribed.

Re-subscribe on new inbound email: is_opted_out → false. Event: customer_email_resubscribed.

## 3.13 One Business Per Founding Account

Unique on businesses.owner_user_id. A user can only create (found) one business. Being promoted to 'owner' role within another business does not violate this constraint — owner_user_id records the founding user only.

## 3.14 Web Chat — Complete Widget Contract

Embeddable JS widget installed by Ethan on business website.

**Embed:**
```html
<script src="https://[platform]/widget.js" data-business-id="[uuid]"></script>
```

**Pre-chat form:** Name (required), phone (optional), email (optional), Start Chat button.

**Identity resolution:** Phone/email match → existing customer. No match → new customer + contacts.

**Session:** HttpOnly cookie, 24h expiry, stores conversation_id. Persists across same-site navigation. New session = new conversation.

**Transport:** WebSocket via Supabase Realtime. Messages sent via Edge Function: POST /api/web-chat/message { business_id, conversation_id, content, session_token }.

**Inbound adapter:** Same pipeline as SMS. Only difference: channel = web_chat.

**Response delivery:** AI writes to message_log with channel = web_chat. Widget receives via Realtime subscription.

**Security:** Session tokens (UUIDs) in web_chat_sessions table. Rate limit: 30 msgs/hour/session. business_id must be valid.

**Widget UI:** Floating button (bottom-right, customizable color via data-color). Window 400x500px. Message bubbles, timestamps, text input, typing indicator, file upload. "Powered by [Platform]" footer.

**Opt-out / end chat:** Customer can close the chat window at any time (X button). If the customer types "stop" or "end chat" in the widget, the AI acknowledges ("Thanks for reaching out! Feel free to come back anytime."), the session ends, and no further messages are sent for that session. The STOP keyword (SMS opt-out) does not apply to web chat. Web chat has no persistent opt-out — each session is independent.

**AI disclosure in web chat:** The first AI message includes the standard disclosure (business identification, AI handles communications, will connect to team) but replaces the SMS STOP instruction with: "You can close this chat at any time."

## 3.15 Conversation Archival

90 days. is_archived = true. Visible in customer timeline. Hidden from main list unless "Include archived" filter toggled.

## 3.16 Platform Admin

Supabase dashboard for v1. Webhook secrets as Edge Function env vars. Composio tokens via Composio dashboard. No in-app admin UI.

---

# PART 4 — CONTRADICTION RESOLUTIONS

4.1 Trigger Authority §12 takeover resume → timer-based wins.
4.2 State Authority §8 reschedule suppression → accepted_from_customer wins.
4.3 Appointment status → 5-value enum (booked, rescheduled, canceled, completed, no_show).
4.4 Language handling → basic multilingual per §3.2.
4.5 Schema source → Schema Contract v4 retired, Patch v5 + this patch wins.

---

# PART 5 — UPDATED CANONICAL LISTS

## 5.1 Event Codes — Additions

- ai_generation_failed
- conversation_merged
- quote_revised
- customer_email_unsubscribed
- customer_email_resubscribed
- urgent_service_request_detected
- internal_staff_issue_detected

## 5.2 Message Purposes — Addition

| Purpose | Description | Urgent? | Quiet-hours? | Dedupe | Cancel triggers |
|---|---|---|---|---|---|
| ai_fallback_response | Fallback when Claude unavailable | No | No | One per failed inbound | None (immediate) |

## 5.3 Notification Types — Additions

- ai_unavailable
- calendar_deletion_pending

## 5.4 Quote Follow-Up Collision Prevention (Hard Rule)

When ANY new quote is created for a conversation, ALL pending outbound_queue rows where conversation_id matches AND message_purpose IN (quote_followup_1, quote_followup_final) AND status IN (pending, deferred) are immediately canceled. New quote follow-up ladder starts fresh.

## 5.5 Updated Suppression Matrix Rows

recurring_reminder: add "recurring_services.status = paused" as blocking condition.
quote_followup_1/final: add "any new quote creation for same conversation cancels immediately."

## 5.6 Updated Permission Matrix

| Action | Owner | Admin |
|---|---|---|
| Search/view all conversations | ✓ | ✓ |
| Revise quote | ✓ | ✓ |
| Undo calendar deletion | ✓ | ✓ |

---

# PART 6 — SETTINGS ADDITIONS

Settings > AI Behavior:
- Quiet Hours Start (default 10 PM, editable, min 6h window)
- Quiet Hours End (default 6 AM, editable)
- Multilingual Support toggle

---

# PART 7 — WORKERS AND CRON JOBS

| Worker | Schedule | What it does |
|---|---|---|
| Trigger evaluation | Every 60s | Stale waiting, auto-close, takeover timer, quiet-hours release |
| Recurring visit generation | Daily midnight (biz tz) | Generate appointments is_recurring=true 2+ weeks ahead |
| Prompt log cleanup | Daily 3 AM UTC | Delete expired prompt_log rows |
| Conversation archival | Daily 4 AM UTC | Archive closed conversations > 90 days |
| Calendar deletion grace | Every 60s | Cancel appointments with expired grace period |
| Web chat session cleanup | Daily 2 AM UTC | Delete expired sessions |
| Quote expiry | Daily midnight UTC | Expire sent quotes past quote_expiry_days. quotes.status → expired. If conversation.primary_state = quote_sent and no other active quote exists for the conversation, conversation.primary_state → lead_followup_active. All pending quote_followup rows for that conversation canceled. Event: quote_expired. |
| Notification cleanup | Daily 5 AM UTC | Delete expired notifications |
| AI failure reprocessor | Every 5 min | Reprocess inbound messages flagged ai_response_failed when Claude is available |

---

# PART 8 — ROW LEVEL SECURITY POLICIES

## 8.1 Multi-Tenant RLS Requirement

Every table with a business_id column must enforce Row Level Security in Supabase. No authenticated user may read, insert, update, or delete rows belonging to a different business.

## 8.2 RLS Helper Function

```sql
CREATE OR REPLACE FUNCTION auth_business_id()
RETURNS uuid AS $$
  SELECT business_id FROM users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

## 8.3 RLS Policy Table

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| businesses | Own business only | Onboarding flow only | Owner only | Owner only (soft delete) |
| business_config | Own business only | Onboarding flow only | Owner only | Never |
| users | Own business only | Auth system + join code flow | Own record + owner can change roles | Owner changes roles, removes users (cannot demote last owner) |
| customers | Own business only | Own business only | Own business only | Never |
| customer_contacts | Own business only | Own business only | Own business only | Own business only |
| conversations | Own business only | Own business only | Own business only | Never |
| conversation_tags | Own business only | Own business only | Own business only | Own business only |
| message_log | Own business only | Own business only | Never (append-only) | Never |
| attachments | Own business only | Own business only | Never | Never |
| event_log | Own business only | Own business only | Never (append-only) | Never |
| appointments | Own business only | Own business only | Own business only | Never |
| appointment_change_requests | Own business only | Own business only | Own business only | Never |
| quotes | Own business only | Own business only | Own business only | Never |
| escalations | Own business only | Own business only | Own business only | Never |
| pricing_items | Own business only | Owner only | Owner only | Owner only |
| payment_management | Own business only | Own business only | Owner only | Never |
| approval_requests | Own business only | Own business only | Own business only | Never |
| parts_inquiries | Own business only | Own business only | Own business only | Never |
| recurring_services | Own business only | Own business only | Own business only | Never |
| recurring_service_change_requests | Own business only | Own business only | Own business only | Never |
| notifications | Own business only (own user_id or null) | Own business only | Own business only (is_read, dismissed_at) | Never |
| outbound_queue | Own business only | Own business only | Own business only | Never |
| post_job_closeouts | Own business only | Own business only | Own business only | Never |
| message_templates | Own business only | Owner only | Owner only | Owner only |
| prompt_log | Never (system only) | System only (service role) | Never | System only (expiry worker) |
| calendar_sync_log | Own business only (read) | System only (service role) | System only (service role) | Never |
| conversation_merges | Own business only (read) | System only (service role) | Never | Never |
| web_chat_sessions | Never (system only) | System only (service role) | Never | System only (cleanup worker) |

## 8.4 Service Role Bypass

Supabase Edge Functions and n8n workers use the service role key, which bypasses RLS. Required for inbound message processing, AI response generation, trigger evaluation, calendar sync, and all scheduled workers.

## 8.5 Admin vs Owner Enforcement

RLS enforces business-level isolation only. The Owner-vs-Admin permission distinction (e.g., admin cannot edit business config) is enforced at the Edge Function / API layer, not in RLS.

---

# AUTHORITY LOCK

This patch is binding. Full precedence order:

1. This document (Blueprint Patch v6)
2. Blueprint Patch v5 Addendum
3. Blueprint Patch v5
4. Dashboard App Specification
5. Supplemental Engineering Contract
6. Unified State Authority
7. Merged Trigger Authority
8. Communications Rules
9. Source of Truth Map
10. Neutral and Ambiguous Customer Response Authority
11. Capabilities
12. Prohibitions
13. Onboarding Questionnaire

**Retired:** Schema Contract v4 FINAL, Blueprint Patch v4.

---

**End of Blueprint Patch v6.**
