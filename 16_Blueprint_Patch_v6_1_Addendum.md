# Communications OS — Blueprint Patch v6.1 Addendum

## Final Gap Closure

**Date:** March 31, 2026  
**Status:** Binding addendum to Blueprint Patch v6. Closes all 8 remaining implementation gaps identified in the full-system audit.

---

**Patch lock statement:**
- This addendum resolves the final 8 implementation gaps.
- Where this addendum conflicts with any prior document, this addendum wins.
- After this addendum, the blueprint is engineer-proof. No engineer should need to invent missing logic.

---

# PART 1 — ROW LEVEL SECURITY POLICIES

## 1.1 Multi-Tenant RLS Requirement

Every table with a `business_id` column must enforce Row Level Security in Supabase. No authenticated user may read, insert, update, or delete rows belonging to a different business.

## 1.2 RLS Policy Pattern

All policies use the same core pattern. The authenticated user's `business_id` is resolved via the `users` table:

```
auth.uid() = users.id → users.business_id = row.business_id
```

For convenience, create a Postgres function:

```sql
CREATE OR REPLACE FUNCTION auth_business_id()
RETURNS uuid AS $$
  SELECT business_id FROM users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

## 1.3 Policy Table

| Table | SELECT | INSERT | UPDATE | DELETE | Notes |
|---|---|---|---|---|---|
| businesses | Own business only | Onboarding flow only | Owner only | Owner only (soft delete) | |
| business_config | Own business only | Onboarding flow only | Owner only | Never (tied to business lifecycle) | |
| users | Own business only | Auth system + join code flow | Own record only | Owner can remove admins | |
| customers | Own business only | Own business only | Own business only | Never (soft delete via do_not_contact) | |
| customer_contacts | Own business only | Own business only | Own business only | Own business only | |
| conversations | Own business only | Own business only | Own business only | Never (archived, not deleted) | |
| conversation_tags | Own business only | Own business only | Own business only | Own business only | |
| message_log | Own business only | Own business only | Never (append-only) | Never | |
| attachments | Own business only | Own business only | Never | Never | |
| event_log | Own business only | Own business only | Never (append-only) | Never | |
| appointments | Own business only | Own business only | Own business only | Never (status = canceled) | |
| appointment_change_requests | Own business only | Own business only | Own business only | Never | |
| quotes | Own business only | Own business only | Own business only | Never (status = expired/superseded) | |
| escalations | Own business only | Own business only | Own business only | Never | |
| pricing_items | Own business only | Owner only | Owner only | Owner only | |
| payment_management | Own business only | Own business only | Owner only | Never | |
| approval_requests | Own business only | Own business only | Own business only | Never | |
| parts_inquiries | Own business only | Own business only | Own business only | Never | |
| recurring_services | Own business only | Own business only | Own business only | Never (status = canceled) | |
| recurring_service_change_requests | Own business only | Own business only | Own business only | Never | |
| notifications | Own business only (own user_id or null) | Own business only | Own business only (is_read, dismissed_at) | Never (auto-expire) | |
| outbound_queue | Own business only | Own business only | Own business only | Never | |
| post_job_closeouts | Own business only | Own business only | Own business only | Never | |
| message_templates | Own business only | Owner only | Owner only | Owner only | |
| prompt_log | Never (system/debug only) | System only (service role) | Never | System only (expiry worker) | No user-facing RLS. Service role only. |
| calendar_sync_log | Own business only (read) | System only (service role) | System only (service role) | Never | Read-only for users. |
| conversation_merges | Own business only (read) | System only (service role) | Never | Never | |
| web_chat_sessions | Never (system only) | System only (service role) | Never | System only (cleanup worker) | No user-facing access. |

## 1.4 Service Role Bypass

Supabase Edge Functions and n8n workers use the service role key, which bypasses RLS. This is required for:
- Inbound message processing (creates conversations, customers, message_log entries)
- AI response generation (writes to message_log, outbound_queue, prompt_log)
- Trigger evaluation worker (reads/writes across conversations)
- Calendar sync worker (writes to calendar_sync_log, appointments)
- All scheduled workers (auto-close, visit generation, cleanup jobs)

## 1.5 Admin vs Owner Enforcement

RLS enforces business-level isolation only. The Owner-vs-Admin permission distinction (e.g., admin cannot edit business config) is enforced at the Edge Function / API layer, not in RLS. RLS ensures no cross-business access. Application logic ensures no cross-role access within a business.

---

# PART 2 — RECURRING APPOINTMENT CONVERSATION CREATION

## 2.1 The Problem

The visit generation worker creates appointment records with `conversation_id = null` for auto-generated recurring visits. Appointment reminders require `outbound_queue.conversation_id NOT NULL`. If a 24h reminder fires before any conversation exists for that visit, the queue insert fails.

## 2.2 The Rule

**When scheduling reminders for a recurring appointment with `conversation_id = null`, the system must first create a conversation for that visit.**

Conversation creation rule for recurring visits:

1. **Trigger:** The reminder scheduling step (not the visit generation step) checks `appointments.conversation_id`. If null, create the conversation before queuing the reminder.
2. **Conversation fields:**
   - `business_id` = appointment.business_id
   - `customer_id` = appointment.customer_id
   - `matter_key` = `recurring:{recurring_service_id}:{appointment_id}`
   - `primary_state` = `booked`
   - `current_owner` = `ai`
   - `channel` = `sms` (default; recurring customers are SMS-primary)
   - `contact_handle` = customer's primary phone number from customer_contacts
   - `collected_service_address` = recurring_services.address
3. **Link back:** Set `appointments.conversation_id` = the new conversation ID.
4. **No customer message:** Creating this conversation does not send any message to the customer. The first customer-facing message is the 24h reminder itself.

## 2.3 Visit Generation Worker Update

The visit generation worker (daily midnight) does NOT create conversations. It only creates appointment records with `conversation_id = null`. Conversations are created lazily when:
- A reminder needs to be scheduled (this rule), OR
- The customer contacts about the upcoming visit (existing inbound message handling), OR
- The AI or admin initiates communication about the visit

Whichever happens first creates the conversation and links it.

---

# PART 3 — SIMPLIFIED CONVERSATION STATUS LABEL MAPPING

## 3.1 The Four Labels

Conversations in the app display one of four simplified status labels. No primary_state codes are shown to the user.

## 3.2 Canonical Mapping

| Display Label | Primary States |
|---|---|
| **AI Handling** | new_lead, lead_qualified, booking_in_progress, quote_sent, lead_followup_active, waiting_on_customer_details, waiting_on_photos, booked, reschedule_in_progress, tech_assigned, en_route, job_in_progress, job_paused, job_completed |
| **Waiting on You** | waiting_on_admin_quote, waiting_on_admin_scheduling, waiting_on_parts_confirmation, waiting_on_approval, complaint_open, billing_dispute_open, safety_issue_open, legal_threat_open, incident_liability_open, insurance_review_open, permits_regulatory_review_open, vendor_dispute_open, restricted_topic_open, hostile_customer_open |
| **You Took Over** | human_takeover_active |
| **Closed** | resolved, closed_unqualified, closed_lost, closed_completed |

## 3.3 Implementation

Store the mapping as a constant in frontend code. Derive the label from `conversations.primary_state` on every render. No database field needed.

**Rationale for override states under "Waiting on You":** Override states (complaints, legal, safety, etc.) require admin action. From the business owner's perspective, these are situations where the ball is in their court. The specific override type is visible on the Escalations tab and inside the conversation detail view — the simplified label just tells the owner "you need to act."

---

# PART 4 — STALE-WAITING DEPENDENCY ID CONSTRUCTION

## 4.1 Dedupe Key Pattern

Every stale-waiting message (both internal pings and customer updates) requires a `dedupe_key` on the outbound_queue. The pattern is:

```
{message_purpose}:{dependency_type}:{dependency_id}:{cadence_step}
```

## 4.2 Dependency Type and ID by State

| Primary State | dependency_type | dependency_id source | Example dedupe_key |
|---|---|---|---|
| waiting_on_admin_quote | `quote` | `quotes.id` for the active quote | `stale_waiting_internal_ping:quote:abc-123:6h` |
| waiting_on_admin_scheduling | `scheduling` | `conversations.id` (the conversation waiting for booking) | `stale_waiting_internal_ping:scheduling:def-456:immediate` |
| waiting_on_approval | `approval` | `approval_requests.id` for the pending request | `stale_waiting_internal_ping:approval:ghi-789:12h` |
| waiting_on_parts_confirmation | `parts` | `parts_inquiries.id` for the pending inquiry | `stale_waiting_customer_update_parts:parts:jkl-012:6h` |

## 4.3 Cadence Step Values

For normal stale waiting: `immediate`, `6h`, `12h`, `24h`, `36h`, `48h`, etc. (every 12h after the first 12h).

For parts subtype: `6h`, `24h` (then stops).

## 4.4 Cancellation

When the dependency is resolved (quote approved, appointment booked, approval decided, parts confirmed), ALL outbound_queue rows matching `{dependency_type}:{dependency_id}` in the dedupe_key prefix are canceled, regardless of cadence step.

---

# PART 5 — VOICE → SMS CROSS-CHANNEL OUTBOUND RULE

## 5.1 Rule

Voice conversations may generate SMS outbound messages. The `outbound_queue.channel` field controls the delivery method per individual message, independent of `conversations.channel`.

When the AI follows up a voice call via SMS:
- `outbound_queue.channel` = `sms`
- `conversations.channel` remains `voice`
- The sender uses the business's Twilio SMS number
- The message appears in the same conversation thread in the dashboard

## 5.2 Scope

This rule applies to:
- Post-call SMS summary and next steps (after every voice call)
- Call drop recovery SMS (Doc 13 §3.2)
- Human request follow-up after voice call (Doc 13 §3.4)
- Any scheduled follow-up (reminders, stale updates) for a conversation that originated as a voice call

## 5.3 Channel Priority for Outbound

When the system needs to send a message on a conversation and no specific channel is dictated by the message purpose:
- If `conversations.channel` = `sms` → send via SMS
- If `conversations.channel` = `voice` → send via SMS (voice is inbound-only for AI-initiated outreach)
- If `conversations.channel` = `email` → send via email
- If `conversations.channel` = `web_chat` → send via web chat (if session active), else SMS (if phone number available), else email

---

# PART 6 — AI DISCLOSURE TRACKING

## 6.1 New Field

Add to the `customers` table:

| Field | Type | Rule |
|---|---|---|
| ai_disclosure_sent_at | timestamptz null | Set when the first outbound AI message including the disclosure is sent to this customer. |

## 6.2 Behavior

- On every first outbound message to a customer, the AI checks `customers.ai_disclosure_sent_at`.
- If null: include the full disclosure (business identification, AI handles communications, STOP opt-out or web chat close instruction, business sign-off name). Set `ai_disclosure_sent_at = now()` after send.
- If not null: do not include the disclosure. The customer has already been informed.
- This is per-customer, not per-conversation. A returning customer with a new conversation does not receive the disclosure again.

## 6.3 Web Chat Exception

On web chat, the disclosure is included in the first message of every session regardless of `ai_disclosure_sent_at`, because web chat sessions are independent and the customer may not remember prior interactions. The `ai_disclosure_sent_at` field is still set but does not suppress web chat disclosures.

---

# PART 7 — STALE ITEM DEFINITION FOR URGENT TAB

## 7.1 What Qualifies as Stale

A conversation appears as a "stale item" on the Urgent tab when ALL of the following are true:

1. `primary_state` is in the stale-eligible set (see §7.2)
2. `last_state_change_at < now() - interval '24 hours'`
3. Conversation is not in a closed state
4. `is_archived = false`
5. `is_no_show = false`

## 7.2 Stale-Eligible States

| State | Why it qualifies |
|---|---|
| waiting_on_admin_quote | Admin hasn't provided pricing |
| waiting_on_admin_scheduling | Admin hasn't booked the appointment |
| waiting_on_parts_confirmation | Admin hasn't confirmed parts info |
| waiting_on_approval | Admin hasn't approved/denied |
| complaint_open | Complaint unresolved for 24h+ |
| billing_dispute_open | Billing dispute unresolved for 24h+ |
| safety_issue_open | Safety issue unresolved for 24h+ |
| legal_threat_open | Legal threat unresolved for 24h+ |
| incident_liability_open | Liability issue unresolved for 24h+ |
| insurance_review_open | Insurance review unresolved for 24h+ |
| permits_regulatory_review_open | Permit/regulatory review unresolved for 24h+ |
| vendor_dispute_open | Vendor dispute unresolved for 24h+ |
| restricted_topic_open | Restricted topic unresolved for 24h+ |
| hostile_customer_open | Hostility situation unresolved for 24h+ |

## 7.3 Deduplication with Escalation Cards

Override states already appear on the Urgent tab as escalation cards. When an override state also qualifies as stale (24h+), the existing escalation card receives a "Stale — 24h+" badge rather than creating a duplicate card. The stale badge is additive, not a separate item.

For waiting_on_admin_* states, the stale item is its own card (these don't have escalation cards).

## 7.4 Query

```sql
SELECT c.*
FROM conversations c
WHERE c.business_id = :business_id
  AND c.primary_state IN (
    'waiting_on_admin_quote', 'waiting_on_admin_scheduling',
    'waiting_on_parts_confirmation', 'waiting_on_approval',
    'complaint_open', 'billing_dispute_open', 'safety_issue_open',
    'legal_threat_open', 'incident_liability_open', 'insurance_review_open',
    'permits_regulatory_review_open', 'vendor_dispute_open',
    'restricted_topic_open', 'hostile_customer_open'
  )
  AND c.last_state_change_at < now() - interval '24 hours'
  AND c.is_archived = false
  AND c.is_no_show = false
ORDER BY c.last_state_change_at ASC;
```

---

# PART 8 — DONE KEYWORD MATCHING LOGIC

## 8.1 Detection Method

DONE detection is **intent-based**, not string-matching. The AI classifies whether the customer's message indicates they are finished sending materials.

## 8.2 Classification Rules

**Counts as DONE (customer is finished sending):**
- "DONE"
- "done"
- "that's everything"
- "that's all I have"
- "all set"
- "I'm done"
- "that's it"
- "nothing else to add"
- "you have everything"
- "all done"
- Any message that clearly communicates completion of material submission

**Does NOT count as DONE (neutral acknowledgments):**
- "okay"
- "thanks"
- "got it"
- "sounds good"
- "alright"
- "cool"
- "will do"
- Any message that acknowledges receipt but does not indicate completion

**Ambiguous (AI asks one clarification):**
- "I think so"
- "probably"
- "should be"
- AI asks: "Just to confirm — is that everything you'd like to send, or do you have more to add?"

## 8.3 AI Instruction to Customer

The AI must explicitly tell the customer what to say when finished. Standard instruction: "Send everything you'd like to include, and just let me know when you're done so I can get it all over to the team."

The AI does NOT require the exact word "DONE." It accepts any clear completion signal per §8.2.

## 8.4 Alignment with Neutral/Ambiguous Authority

This rule is consistent with Doc 06 §5.2 (waiting_on_photos and customer_done_sending). Neutral acknowledgments do not count as completion. The AI's intent classification is the mechanism. The global neutral-response decision ladder (Doc 06 §3) governs ambiguous cases.

---

# AUTHORITY LOCK

This addendum is binding. Full precedence order:

1. This document (Blueprint Patch v6.1 Addendum)
2. Blueprint Patch v6
3. Blueprint Patch v5 Addendum
4. Blueprint Patch v5
5. Dashboard App Specification
6. Supplemental Engineering Contract
7. Unified State Authority
8. Merged Trigger Authority
9. Communications Rules
10. Source of Truth Map
11. Neutral and Ambiguous Customer Response Authority
12. Capabilities
13. Prohibitions
14. Onboarding Questionnaire

**15 — Schema v6 Consolidated Reference** remains a convenience merge. Update it to include the additions from this addendum (customers.ai_disclosure_sent_at field, RLS policy notes).

---

**End of Blueprint Patch v6.1 Addendum.**
