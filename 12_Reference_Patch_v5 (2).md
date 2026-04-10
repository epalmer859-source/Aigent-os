# Communications OS — Blueprint Patch v5

## Master Resolution Authority

**Date:** March 31, 2026
**Status:** Binding patch — resolves all remaining gaps, contradictions, ambiguities, and missing specifications identified in the full 11-document system audit.

---

**Patch lock statement:**
- This patch resolves every open finding from the full-system authority audit.
- Where this patch conflicts with any wording in the 9 core authority documents, Blueprint Patch v4, Dashboard App Specification, or Supplemental Engineering Contract, this patch wins.
- This document covers: schema definitions for all missing tables, operational decisions, channel authorities, consent/compliance, dashboard clarifications, recurring service lifecycle, data pipeline, system operations, and all remaining contradictions.

---

# PART 1 — CONTRADICTION RESOLUTIONS

## 1.1 Takeover Resume Model (Audit Finding: Trigger Authority §12 vs Patch v4/Dashboard Spec)

**Decision:** Timer-based auto-resume wins. Trigger Authority §12 must be updated.

**Old (Trigger Authority §12):** "AI resumes only when that exact thread is intentionally handed back by the owner/admin."

**New:** "AI resumes when the takeover timer expires (default 7 days) or when the owner/admin manually re-enables AI. On resume, AI does not send a notification to the customer. AI resumes naturally — if there is a pending action or reason to reach out, AI does so; otherwise AI waits for the customer's next message."

**Flag for future review:** Owner should confirm the problem is handled before AI resumes. Consider adding a pre-resume confirmation prompt in a future version.

## 1.2 Reschedule Suppression Trigger (Audit Finding: State Authority reschedule_in_progress vs Patch v4)

**Decision:** accepted_from_customer wins for the reschedule_in_progress state block.

**Old (State Authority §8, reschedule_in_progress):** "Original appointment reminders suppress once the change request reaches sent_to_admin."

**New:** "Original appointment reminders suppress once the change request reaches accepted_from_customer or later."

## 1.3 Admin Conversation Access

**SUPERSEDED BY PATCH v6 §3.11.** Admin now gets a searchable Conversations tab visible in main navigation. Admin can search by name/phone, view history, take over, and message. Admin still cannot access settings/config/customer-list/analytics.

~~**Original decision (superseded):** Admin accesses conversations through Urgent, Appointments, Quotes, and Escalations tabs for active items. To find other conversations (not in any queue), admin must ask the owner, who can look them up in Settings > Conversations.~~

~~Admin does NOT get a dedicated conversations list. This keeps the admin role focused on action items.~~

## 1.4 Admin Notification Settings Location

**Decision:** Both owner and admin see a profile icon in the top corner of the app. Tapping it opens personal settings: notification toggles and delivery method preferences. This is separate from the owner-only Settings tab.

**Profile icon menu (both roles):**
- Notification toggles (per notification type)
- Delivery method (SMS, push, or both)
- Account info (name, email)
- Sign out

## 1.5 State Count Verification

**Confirmed:** 33 canonical primary states after all patches applied. No drift.

## 1.6 Escalation Card Display

**Decision:** Simplified labels on the card surface. Full specific category visible on tap-to-expand.

**Card surface labels:** Safety Issue, Legal Threat, Complaint, Billing Dispute, Hostile Customer, Liability, Insurance, Permits/Regulatory, Vendor Dispute, Restricted Topic, Other.

**On expand:** Full canonical category from the 13-value enum is displayed along with all details.

---

# PART 2 — MISSING SCHEMA DEFINITIONS

All tables below are required additions to the Schema Contract. They use the same conventions as the existing schema: uuid PKs, business_id FKs, timestamptz timestamps, and text enums.

## 2.1 businesses

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | Primary key. |
| owner_user_id | uuid not null | FK → users.id. The founding owner who created this business. Used for lockout recovery only. Multiple users may hold the 'owner' role — see users table. |
| business_name | text not null | From onboarding Q1. |
| industry | text enum not null | One of 21 values: house_cleaning, commercial_cleaning, lawn_care, pressure_washing, junk_removal, painting, garage_door, landscaping, handyman, appliance_repair, tree_service, pool_service, window_cleaning, flooring, plumbing, hvac, electrical, auto_repair, carpet_cleaning, gutter_service, detailing. Locked after onboarding. Cannot be changed — owner must create a new account. |
| timezone | text not null | IANA timezone string (e.g., America/New_York). Set during onboarding. Used for all quiet-hours, business-hours, and timing calculations. |
| join_code | text not null | Created by owner during onboarding. Owner-editable in settings. |
| is_paused | boolean not null default false | Global AI pause. When true, AI responds to all customers with a configurable away message. |
| pause_message | text null | Custom away message when is_paused = true. Platform default: "Thanks for reaching out! [Business name] is currently away and will be back shortly. We'll get back to you as soon as possible." |
| default_takeover_timer_seconds | integer not null default 604800 | Default 7 days (604800 seconds). Null-equivalent: 0 means "never" (permanent takeover). |
| google_review_link | text null | From onboarding Q21. Used in closeout messages. |
| preferred_phone_number | text null | From onboarding Q21. Used in closeout and handoff messages. |
| urgent_alert_phone | text null | From onboarding Q2. |
| urgent_alert_email | text null | From onboarding Q2. |
| ai_signoff_name | text null | From onboarding Q1. Used in first message of each conversation only. |
| ai_tone_description | text null | From onboarding Q15. |
| always_say | text null | From onboarding Q16. |
| never_say | text null | From onboarding Q16. |
| supported_languages | text null default 'English' | From onboarding Q15. AI operates in English. If customer writes in another language, AI responds in English and notes the team may not speak that language. |
| ai_call_answering_enabled | boolean not null default true | Toggle for live AI call answering. When off, missed-call text-back activates. |
| rough_estimate_mode_enabled | boolean not null default false | From onboarding Q9. |
| labor_pricing_method | text null | 'by_the_hour' or 'by_the_job'. From onboarding Q9. |
| payment_management_enabled | boolean not null default true | Toggle for Payment Management section visibility. Records always created regardless of this toggle. |
| cancellation_policy | text null | From onboarding Q14. |
| warranty_policy | text null | From onboarding Q22. |
| payment_methods | text null | From onboarding Q11. |
| emergency_rules | text null | From onboarding Q17. |
| customer_prep | text null | From onboarding Q13. |
| common_questions | text null | From onboarding Q18. |
| typical_process | text null | From onboarding Q19. |
| important_details | text null | From onboarding Q20. |
| customer_philosophy | text null | From onboarding Q23. |
| takeover_notification_message | text null | Customizable in Settings > AI Behavior. Default: "[Business name]'s team has temporarily paused AI communication for this conversation. They'll reach out to you directly." |
| quote_expiry_days | integer not null default 30 | Configurable in settings. Quotes auto-expire after this many days. |
| auto_close_days | integer not null default 30 | Conversations auto-close to closed_lost after this many days of silence. |
| onboarding_completed_at | timestamptz null | Null until onboarding is finished. Dashboard access blocked until non-null. |
| deleted_at | timestamptz null | Soft delete. 30-day grace period before hard delete. |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

## 2.2 business_config (Structured Onboarding Data)

Stores the parsed/structured version of onboarding answers. Raw text is stored on the businesses table. This table holds the machine-readable versions.

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | Primary key. |
| business_id | uuid not null unique | FK → businesses.id. One config per business. |
| business_hours | jsonb not null | Structured schedule: {"monday": {"open": "08:00", "close": "17:00"}, ...}. Null day = closed. |
| holidays_closures | jsonb null | Array of date strings or date ranges. |
| service_area_type | text not null default 'list' | 'list' (cities/zips) or 'radius'. |
| service_area_list | jsonb null | Array of city names, zip codes, or regions. |
| service_area_radius_miles | integer null | If type = radius. |
| service_area_center_address | text null | If type = radius. |
| service_area_exclusions | jsonb null | Array of excluded areas. |
| services_offered | jsonb not null | Array of service objects: [{"name": "...", "description": "..."}]. |
| services_not_offered | jsonb null | Array of excluded services. |
| owner_approval_job_types | jsonb null | Array of job types requiring owner approval. |
| appointment_types | jsonb null | Array: [{"name": "...", "duration_minutes": N, "advance_booking_days": N}]. |
| same_day_booking_allowed | boolean not null default false | From onboarding Q12. |
| secondary_contacts | jsonb null | Array: [{"name": "...", "phone": "...", "email": "...", "handles": "..."}]. |
| industry_answers | jsonb null | Structured answers to the 2-3 industry-specific questions. |
| urgent_tab_categories | jsonb not null default '["safety","legal","complaint","scheduling","stale"]' | Configurable list of what shows on Urgent tab. |
| notification_defaults | jsonb null | Default notification settings for new users. |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

**Onboarding data pipeline rule:** During onboarding, each answer is stored as raw text on businesses AND parsed into the corresponding structured field on business_config. If parsing fails or the answer is "N/A", the structured field is set to null and the AI reads from the raw text as fallback. Settings edits update BOTH raw and structured fields immediately.

## 2.3 users

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | Primary key. Matches Supabase Auth user ID. |
| business_id | uuid null | FK → businesses.id. Null until onboarding complete (owner) or join code entered (admin). |
| email | text not null unique | Login email. |
| display_name | text null | |
| role | text enum not null | 'owner' or 'admin'. |
| notification_preferences | jsonb null | Per-user notification toggles and delivery methods. |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

**Constraints:** Multiple owners allowed per business. Unlimited admins per business. At least one owner must exist at all times — the system must prevent demotion of the last remaining owner.

**Role management:** Any user with role = 'owner' can toggle another user's role between 'owner' and 'admin' in Settings > Team Management. New users always join as 'admin' via the join code — an existing owner must promote them to 'owner' if desired.

**Founding owner:** businesses.owner_user_id records the user who created the account during onboarding. This field is used only for platform-level lockout recovery (Ethan's safety net) and does not grant special privileges beyond the normal 'owner' role.

**Admin removal:** When an owner removes an admin or demotes an owner to admin, any conversations that user had taken over are transferred to the acting owner automatically.

## 2.4 customers

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | Primary key. |
| business_id | uuid not null | FK → businesses.id. |
| display_name | text null | Collected during intake. |
| first_contact_channel | text enum null | sms, voice, email, web_chat. |
| first_contact_at | timestamptz null | |
| consent_status | text enum not null default 'implied_inbound' | 'implied_inbound' (customer contacted first), 'opted_out', 'resubscribed'. |
| opted_out_at | timestamptz null | When STOP was processed. |
| do_not_contact | boolean not null default false | |
| ai_disclosure_sent_at | timestamptz null | Set when the first outbound AI message including the disclosure is sent to this customer. Per-customer, not per-conversation. Once set, disclosure is not repeated except on web chat (where every session includes it). |
| notes | text null | |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

**Identity resolution:** Match on any phone number OR email address. If a match is found, link to existing customer. If no match, create new customer record.

**Multiple contact methods:** One customer can have multiple phone numbers and emails via the customer_contacts table.

## 2.5 customer_contacts

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | Primary key. |
| customer_id | uuid not null | FK → customers.id. |
| business_id | uuid not null | FK → businesses.id. |
| contact_type | text enum not null | 'phone' or 'email'. |
| contact_value | text not null | Phone number (E.164) or email address. |
| is_primary | boolean not null default false | |
| created_at | timestamptz not null default now() | |

**Constraint:** Unique (business_id, contact_type, contact_value).

## 2.6 appointments

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | Primary key. |
| business_id | uuid not null | FK → businesses.id. |
| conversation_id | uuid null | FK → conversations.id. Null for auto-generated recurring appointments with no originating conversation yet. A conversation is created when customer or AI first communicates about that visit. |
| customer_id | uuid not null | FK → customers.id. |
| service_type | text null | |
| appointment_date | date not null | |
| appointment_time | time not null | |
| duration_minutes | integer null | |
| address | text null | |
| technician_name | text null | Free-text. No roster table — typed per appointment. |
| status | text enum not null default 'booked' | booked, rescheduled, canceled, completed, no_show. |
| dispatch_status | text enum null default null | null (not dispatched), en_route, delayed, arrived, on_site. |
| access_notes | text null | Gate codes, lockbox, pet info, etc. |
| admin_notes | text null | |
| google_calendar_event_id | text null | For bidirectional sync. |
| is_recurring | boolean not null default false | |
| recurring_service_id | uuid null | FK → recurring_services.id if part of a recurring schedule. |
| completed_at | timestamptz null | |
| canceled_at | timestamptz null | |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

**No-show handling:** Admin marks appointment as no_show status. When no_show is set, the AI sends zero messages for that job going forward — no closeout, no follow-up, nothing. Equivalent to a silent close. Flagged for future review.

## 2.7 quotes

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | Primary key. |
| business_id | uuid not null | FK → businesses.id. |
| conversation_id | uuid not null | FK → conversations.id. |
| customer_id | uuid not null | FK → customers.id. |
| status | text enum not null default 'intake_open' | intake_open, under_review, approved_to_send, sent, accepted, declined, superseded, withdrawn, expired. |
| requested_service | text null | |
| quote_details | text null | AI-collected details, measurements, notes. |
| approved_amount | numeric null | Set by admin on approval. |
| approved_terms | text null | |
| approved_by | uuid null | FK → users.id. |
| approved_at | timestamptz null | |
| sent_at | timestamptz null | When quote was delivered to customer. |
| expires_at | timestamptz null | Calculated from businesses.quote_expiry_days. |
| customer_response | text null | accepted, declined, non_commitment, or null. |
| customer_responded_at | timestamptz null | |
| superseded_by | uuid null | FK → quotes.id if a newer quote replaced this one. |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

## 2.8 escalations

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | Primary key. |
| business_id | uuid not null | FK → businesses.id. |
| conversation_id | uuid not null | FK → conversations.id. |
| customer_id | uuid null | FK → customers.id. |
| category | text enum not null | Uses the canonical 13-value escalation_category enum. |
| status | text enum not null default 'open' | open, in_progress, resolved. |
| urgency | text enum not null default 'standard' | standard, high, critical. |
| ai_summary | text null | AI-generated summary at escalation time. |
| resolution_note | text null | Admin writes on resolution. |
| resolved_by | uuid null | FK → users.id. |
| created_at | timestamptz not null default now() | |
| resolved_at | timestamptz null | |

## 2.9 pricing_items

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | Primary key. |
| business_id | uuid not null | FK → businesses.id. |
| service_name | text not null | |
| price_type | text enum not null | 'fixed', 'starting', 'package', 'trip_fee', 'diagnostic_fee', 'after_hours_fee', 'disposal_fee', 'emergency_fee', 'minimum_charge', 'other_fee'. |
| amount | numeric not null | |
| description | text null | |
| is_shareable_by_ai | boolean not null default true | Toggle per price. |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

## 2.10 payment_management

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | Primary key. |
| business_id | uuid not null | FK → businesses.id. |
| appointment_id | uuid null | FK → appointments.id. |
| conversation_id | uuid null | FK → conversations.id. |
| customer_id | uuid not null | FK → customers.id. |
| job_description | text null | |
| amount_due | numeric null | |
| payment_status | text enum not null default 'pending' | pending, paid, waived. Owner-managed. |
| job_date | date null | |
| completion_date | date null | |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

**Rule:** Records are ALWAYS created on job completion regardless of payment_management_enabled toggle. The toggle only controls UI visibility.

## 2.11 approval_requests

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | Primary key. |
| business_id | uuid not null | FK → businesses.id. |
| conversation_id | uuid not null | FK → conversations.id. |
| customer_id | uuid null | FK → customers.id. |
| request_type | text not null | Description of what needs approval (e.g., "out-of-radius job", "restricted service type"). |
| status | text enum not null default 'pending' | pending, approved, denied. |
| ai_summary | text null | |
| admin_notes | text null | |
| decided_by | uuid null | FK → users.id. |
| created_at | timestamptz not null default now() | |
| decided_at | timestamptz null | |

## 2.12 parts_inquiries

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | Primary key. |
| business_id | uuid not null | FK → businesses.id. |
| conversation_id | uuid not null | FK → conversations.id. |
| appointment_id | uuid null | FK → appointments.id. |
| part_description | text not null | |
| model_number | text null | |
| urgency | text enum not null default 'standard' | standard, high. |
| status | text enum not null default 'pending' | pending, confirmed, unavailable. |
| confirmed_price | numeric null | |
| confirmed_eta | text null | |
| confirmed_by | uuid null | FK → users.id. |
| created_at | timestamptz not null default now() | |
| confirmed_at | timestamptz null | |

## 2.13 notifications

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | Primary key. |
| business_id | uuid not null | FK → businesses.id. |
| user_id | uuid null | FK → users.id. Null = all users for this business. |
| notification_type | text enum not null | safety_issue, legal_threat, complaint, scheduling_request, stale_item, quote_request, customer_message_during_takeover, job_complete, new_customer_message, approval_request, parts_request, recurring_appointment_created, urgent_service_request, ai_unavailable, calendar_deletion_pending, conversation_merged, customer_email_unsubscribed, customer_email_resubscribed. |
| reference_type | text null | 'conversation', 'appointment', 'quote', 'escalation', 'approval', 'parts'. |
| reference_id | uuid null | ID of the referenced record. |
| title | text not null | Short notification title. |
| summary | text null | AI-generated summary. |
| is_read | boolean not null default false | |
| dismissed_at | timestamptz null | |
| expires_at | timestamptz null default (now() + interval '30 days') | Auto-expire after 30 days. |
| created_at | timestamptz not null default now() | |

## 2.14 message_log

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | Primary key. |
| business_id | uuid not null | FK → businesses.id. |
| conversation_id | uuid not null | FK → conversations.id. |
| direction | text enum not null | 'inbound' or 'outbound'. |
| channel | text enum not null | sms, voice, email, web_chat. |
| sender_type | text enum not null | customer, ai, admin_team, owner, system. |
| sender_user_id | uuid null | FK → users.id if sent by admin/owner through the app. |
| content | text null | Message text content. |
| subject_line | text null | For email messages only. |
| media_urls | jsonb null | Array of attachment URLs. |
| twilio_message_sid | text null | For inbound SMS deduplication. |
| is_voice_transcript | boolean not null default false | True if this is a transcription of a voice conversation. |
| voice_recording_url | text null | URL to voice recording if applicable. |
| created_at | timestamptz not null default now() | |

**Constraint:** Unique (twilio_message_sid) where twilio_message_sid is not null. Prevents double-processing of Twilio webhook retries.

## 2.15 attachments

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | Primary key. |
| business_id | uuid not null | FK → businesses.id. |
| conversation_id | uuid not null | FK → conversations.id. |
| message_id | uuid null | FK → message_log.id. |
| file_url | text not null | Supabase Storage URL. |
| file_type | text null | MIME type. |
| file_name | text null | Original filename. |
| created_at | timestamptz not null default now() | |

## 2.16 conversations table additions

Add the following fields to the existing conversations table:

| Field | Type | Rule |
|---|---|---|
| customer_id | uuid not null | FK → customers.id. |
| human_takeover_expires_at | timestamptz null | When the takeover timer will fire. Null if not in takeover or set to "never". |
| human_takeover_timer_seconds | integer null | Per-conversation override. Null = use business default. 0 = never. |
| is_no_show | boolean not null default false | Set when admin marks no_show. AI sends zero messages when true. |
| auto_close_at | timestamptz null | Calculated: last_activity + auto_close_days. |

## 2.17 recurring_services (hardened definition)

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | Primary key. |
| business_id | uuid not null | FK → businesses.id. |
| customer_id | uuid not null | FK → customers.id. |
| service_type | text not null | |
| frequency | text enum not null | weekly, biweekly, monthly, custom. |
| frequency_details | text null | For custom frequencies. |
| preferred_day | text null | |
| preferred_time | time null | |
| address | text null | |
| status | text enum not null default 'active' | active, paused, canceled. |
| start_date | date not null | |
| end_date | date null | Null = indefinite. |
| created_by | text enum not null | 'admin' or 'ai'. |
| admin_notes | text null | |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

**Rule:** When AI creates a recurring service, admin is notified immediately via notification. Admin can modify or cancel.

**Dashboard location:** Sub-section inside the Appointments tab called "Recurring."

**Reminder cadence:** Same as regular appointments — 24h and 3h before each visit.

---

# PART 3 — CONSENT & OPT-OUT AUTHORITY

## 3.1 Consent Model

**Consent acquisition:** When a customer initiates contact (inbound SMS, call, email, or web chat), this constitutes implied consent for all transactional and conversational messaging related to their inquiry, including follow-ups, appointment reminders, closeout messages, and routine workflow messages.

**No explicit opt-in required** for customers who initiate contact. The first AI response includes the business sign-off name (first message only). No separate opt-in confirmation message is sent.

## 3.2 STOP Keyword Processing

**Scope:** Phone-number level. Twilio enforces this at the carrier level automatically. When a customer texts STOP, Twilio blocks all outbound messages to that phone number from the business Twilio number.

**System behavior on STOP:**
1. Twilio auto-blocks outbound to that number.
2. System receives the STOP webhook from Twilio.
3. Customer record updated: consent_status = 'opted_out', opted_out_at = now().
4. All pending outbound_queue rows for conversations with that customer are canceled.
5. Admin is notified that a customer opted out.

**Auto-resubscribe:** If the customer sends any new inbound message after opting out, consent is automatically restored. Customer record updated: consent_status = 'resubscribed'. A new conversation is created. AI proceeds normally.

## 3.3 HELP Keyword Processing

When a customer texts HELP, the system auto-responds with: "This is [Business name]. For assistance, call us at [preferred phone number] or reply to this message. Reply STOP to opt out of messages." Admin is also notified.

## 3.4 STOP Footer

No STOP footer is appended to messages by default. **Compliance note:** A2P 10DLC registration may require opt-out instructions on the first message to a new customer. If the carrier or registration process requires it, add "Reply STOP to opt out" to the first outbound message per new customer only. This should be configurable at the platform level.

---

# PART 4 — CHANNEL AUTHORITIES

## 4.1 SMS Authority

**Status:** Primary channel. In v1 scope.
**Character limit:** No cap. Twilio handles concatenation for long messages.
**AI behavior:** Concise, conversational. No character limit enforced but AI should keep SMS messages focused and avoid unnecessary length.
**Sign-off:** Business sign-off name on first message of each conversation only.
**Transport:** Twilio.

## 4.2 Voice/Call Authority

**Status:** In v1 scope. Live AI call answering is the default mode.

**Call flow:**
1. Inbound call arrives.
2. If ai_call_answering_enabled = true: AI answers with a voice greeting ("Thanks for calling [Business name], how can I help you?") and conducts the conversation by voice.
3. AI handles the conversation as far as possible — intake, qualification, scheduling preference collection, question answering — without pressuring the customer.
4. When the call ends, AI follows up via SMS with any necessary confirmations, status updates, or next steps based on what was discussed.
5. If ai_call_answering_enabled = false: Call goes to voicemail. After 2-minute hold, missed-call fallback text is sent. If voicemail was left, the fallback text references the voicemail content.

**Voicemail transcription:** Twilio built-in transcription.

**Conversation record:** A voice call creates a conversation record and a message_log entry with is_voice_transcript = true and the transcribed content. The voice recording URL is stored for audit purposes.

**Voice → SMS cross-channel outbound rule:** Voice conversations may generate SMS outbound messages. The outbound_queue.channel field controls the delivery method per individual message, independent of conversations.channel. When the AI follows up a voice call via SMS, the outbound_queue row has channel = 'sms' even though conversations.channel = 'voice'. The sender uses the business's Twilio SMS number. This applies to post-call summaries, call drop recovery, human request follow-up, and any scheduled follow-up (reminders, stale updates) for a voice-originated conversation.

**Channel priority for outbound:** When the system sends a message and no specific channel is dictated by message purpose: voice conversations → send via SMS (voice is inbound-only for AI-initiated outreach); email conversations → send via email; web chat conversations → send via web chat if session active, else SMS if phone available, else email; SMS conversations → send via SMS.

## 4.3 Email Authority

**Status:** In v1 scope. Gmail integration via Composio for both customer communication and admin notifications.

**Email behavior:**
- AI uses business name in the From display name.
- Subject lines are AI-generated based on conversation context.
- Email formatting is cleaner and more structured than SMS — proper paragraphs, no abbreviations.
- Replies maintain the email thread using In-Reply-To and References headers.

**Thread matching:** Inbound emails are matched to existing conversations by: (1) email thread headers (In-Reply-To), (2) customer email address match to existing customer with an active conversation, (3) if no match, create new conversation.

**Gmail integration (Composio):** Used for both customer-facing email communication AND admin notification delivery (urgent alerts via email).

## 4.4 Web Chat Authority

**Status:** In v1 scope for businesses that want it.

**Behavior:** Embedded chat widget on the business's website. Conversation flows into the same system as SMS/email. Customer identified by captured name/email/phone during chat.

**Transport:** Web socket or polling to Supabase. Messages stored in message_log with channel = 'web_chat'.

## 4.5 Cross-Channel Rules

**Default per channel:** Each channel creates its own conversation. Conversations are NOT merged across channels by default.

**Cross-channel merge:** If the AI detects (by customer information, job details, or clear evidence) that an SMS conversation and an email conversation are clearly the same issue from the same customer, the system consolidates to SMS as the primary channel. Admin is notified of the merge.

**AI identity:** AI is honest about being AI when directly asked. Default language: "I'm an AI assistant that handles communications for [Business name]. I can help with most things — scheduling, questions, job details — and I'll connect you with the team directly whenever something needs their personal attention."

---

# PART 5 — GOOGLE CALENDAR SYNC CONTRACT

## 5.1 Sync Direction

Bidirectional. Appointments can be created, modified, or deleted from either the app or Google Calendar.

## 5.2 Conflict Resolution

Last-write-wins. Whichever platform had the most recent change is treated as the source of truth. The other platform syncs to match.

## 5.3 Change Notifications

Any change synced from Google Calendar into the app triggers a dashboard notification to admin informing them of the change. Any change made in the app and synced to Google Calendar also generates a notification per existing rules (§1.9 of Communications Rules).

## 5.4 External Edit Handling

If someone edits or deletes a Google Calendar event directly, the app auto-updates the appointment record to match. No admin review gate — the sync is automatic. Admin is notified of the change.

## 5.5 Calendar Sync Requirement

Google Calendar integration is required for v1 launch. The app cannot operate without it for appointment management.

## 5.6 Integration

Composio handles Google Calendar OAuth and bidirectional sync. Field mapping: calendar event title → service_type + customer name, event time → appointment_date/time, event description → admin_notes, event location → address.

---

# PART 6 — RECURRING SERVICE LIFECYCLE

## 6.1 Scope

Recurring services are in v1 scope. Implemented as "repeating appointments."

## 6.2 Creation

**Both admin and AI can create recurring services.** When AI creates one (based on customer conversation), admin receives an immediate notification. Admin can modify or cancel.

**Admin creation:** From the Appointments tab > Recurring sub-section. Admin sets customer, service, frequency, preferred day/time, address, start date, and optional end date.

**AI creation:** During conversation, if a customer requests regular service, AI collects frequency, preferred day/time, and details. AI creates the recurring_service record and notifies admin.

## 6.3 Visit Generation

The system auto-generates upcoming appointment records (with is_recurring = true and recurring_service_id linked) based on the recurring service frequency. Visits are generated at least 2 weeks in advance. Generated appointments have conversation_id = null — conversations are created lazily (see §6.4).

## 6.4 Reminders

Same cadence as regular appointments: 24h reminder + 3h same-day reminder per visit. Suppression rules follow the same appointment_change_request logic.

**Recurring conversation creation:** When scheduling reminders for a recurring appointment with conversation_id = null, the system must first create a conversation for that visit before queuing the reminder. Conversation fields: business_id and customer_id from the appointment, matter_key = 'recurring:{recurring_service_id}:{appointment_id}', primary_state = booked, current_owner = ai, channel = sms, contact_handle = customer's primary phone from customer_contacts, collected_service_address = recurring_services.address. The appointment's conversation_id is then set to the new conversation. No customer message is sent — the first customer-facing message is the reminder itself. A conversation is also created if the customer contacts about the visit or the AI initiates communication, whichever happens first.

## 6.5 Customer Actions (via AI)

Customers can request through the AI: skip a visit, reschedule a visit, change frequency, or cancel the recurring service. These create recurring_service_change_request records per the existing schema.

## 6.6 Dashboard

**Location:** Sub-section inside the Appointments tab called "Recurring."

**Shows:** All active recurring services per customer. Frequency, next visit date, service type, address. Actions: edit, pause, cancel, view history.

---

# PART 7 — OPERATIONAL DECISIONS

## 7.1 Onboarding Data Pipeline

**Rule:** Every onboarding answer is stored BOTH as raw text on the businesses table AND as structured data on the business_config table.

**Processing:** During onboarding, after the owner submits each answer, the system parses it into structured fields. If parsing is ambiguous, the raw text is stored and the AI reads from raw text as fallback.

**Settings edits:** When the owner edits any config in settings, both the raw text and structured fields update immediately. AI behavior changes immediately.

**All 23 universal questions must be answered.** "N/A" is accepted as a valid answer meaning not applicable. The 2-3 industry questions must also be answered. Onboarding is blocked until all questions for the selected industry are complete.

**Owner can go back and edit any answer during onboarding before final submit.**

## 7.2 AI Runtime Architecture

**Prompt loading:** Only relevant slices per turn. Load: global rules (always), industry prohibitions (for this business's industry), business-specific config (from business_config + businesses), and channel rules (for the active channel). Do NOT load the entire rulebook every turn.

**Conversation history:** AI receives a cached summary of the conversation + the last 20 messages per turn.

**Intent classification:** Claude handles inline classification during response generation. Single API call per inbound message. No separate classifier step.

**Override detection:** Claude-based classification inline. The AI evaluates each inbound message for override triggers (complaint, hostility, safety, legal threat, etc.) as part of its response generation.

## 7.3 Message Generation

**All messages are AI-generated.** No hardcoded templates. The AI generates every message naturally based on conversation context, business config, tone settings, and the current workflow state.

**Owner customization:** Owner can optionally set custom message templates in settings for specific message types (confirmations, reminders, closeout, etc.). If a custom template exists, the AI uses it. If not, the AI generates naturally.

**Sign-off:** Business sign-off name (e.g., "- Sarah, ABC Plumbing") on the first message of each conversation only.

## 7.4 Default Handoff Language

When the AI doesn't know something and needs to hand off, the default customer-facing language is: "Let me check with the team and get back to you." AI adapts this naturally to the conversation context.

## 7.5 Human Request Retention Script

The script in Communications Rules §1.7 is a guideline, not literal production wording. The AI generates the retention message naturally based on the business's tone settings, while covering the key points: acknowledge the request, briefly mention what the AI can help with, and offer to connect them with the team directly if they still prefer.

## 7.6 AI Identity

When asked directly if it's an AI, the AI is honest. It says something like: "Yes, I'm an AI that handles communications for [Business name]. I can help with scheduling, questions, job details, and more — and I'll connect you with the team directly whenever something needs their personal attention."

## 7.7 Language Handling

If the business has multilingual_enabled = true and the customer writes in a language listed in the business's supported_languages, the AI responds in that language. If the customer's language is not in the supported list, the AI responds in English and politely notes the limitation. Internal summaries, admin notifications, and dashboard content always remain in English. If multilingual_enabled = false, the AI operates in English only and responds in English regardless of the customer's language.

## 7.8 Auto-Close

Conversations in non-closed states with no activity for 30 days (configurable via businesses.auto_close_days) are automatically closed to closed_lost. If the customer texts back after auto-close, a new conversation is created with repeat_customer tag.

## 7.9 New Contact from Closed Conversation

When a customer contacts again after their conversation is closed (closed_completed, closed_lost, resolved), regardless of channel, a NEW conversation is always created with a new matter_key and the repeat_customer tag. The old conversation stays closed. This applies to SMS, voice, email, and web chat. For email: even if the inbound email's In-Reply-To header matches a closed conversation, the system creates a new conversation rather than reopening the closed one.

## 7.10 Multi-Job Same Thread

If a customer texts about two different jobs in the same SMS thread, the AI handles them sequentially in one thread. No automatic splitting.

## 7.11 Global Business Pause

Owner can toggle is_paused on the business. When paused, AI responds to ALL inbound customer messages with the configurable pause_message and takes no other action. Admin is notified of all inbound messages. When unpaused, AI resumes normal operation.

## 7.12 Account Deletion

30-day grace period on soft delete. During grace period, owner can contact Ethan to recover. After 30 days, hard delete of all data.

## 7.13 Closeout Without Review Link

If the Google review link is missing or invalid, the closeout message still sends without the review link. Just the thank-you message + business phone number.

---

# PART 8 — SYSTEM OPERATIONS

## 8.1 Architecture Split

- **n8n Cloud:** Workflow orchestration, trigger evaluation, queue processing, stale-waiting checks, timer expiration, scheduled jobs (auto-close, recurring visit generation).
- **Supabase Edge Functions:** API routes, Twilio webhooks, inbound message processing, AI response generation, Composio integrations.
- **Supabase Realtime:** Dashboard live updates, notification delivery.

## 8.2 Trigger Evaluation

Event-driven on each inbound message and admin action, PLUS a cron-based sweep every 60 seconds for time-based triggers (stale waiting, auto-close, takeover timer expiration, quiet-hours deferred releases, recurring visit generation).

## 8.3 Message Retry Logic

max_retry_count = 3. Exponential backoff: 1st retry at 30 seconds, 2nd at 2 minutes, 3rd at 10 minutes. After 3 failures, status = failed_terminal and admin is notified.

## 8.4 Inbound Idempotency

Twilio MessageSid is the dedupe key on message_log. Unique constraint on twilio_message_sid (where not null) prevents double-processing.

## 8.5 Webhook Security

Twilio webhook signature validation required on every inbound request. Reject any request that fails validation.

## 8.6 Timezone

Business timezone set during onboarding (stored on businesses.timezone). All quiet-hours, business-hours, weird-hours deferral, and timing calculations use the business timezone.

## 8.7 Conversation Archival

Conversations in closed states are archived (is_archived = true) after 90 days. Archived conversations are hidden from active lists but remain queryable in logs/history.

## 8.8 Concurrent Admin Actions

Optimistic concurrency with last-write-wins. If two admins act on the same conversation simultaneously, the last action wins. The earlier action's effects may be overwritten. No locking mechanism in v1. The same rule applies to Settings edits by multiple owners: if two owners edit different settings fields simultaneously, both changes persist (they write to different columns). If two owners edit the same field simultaneously, the last save wins. No field-level locking in v1.

## 8.9 System Failure Handling

If Supabase or Edge Functions fail mid-conversation, the system silently fails. No fallback message to the customer. The inbound message is retried by Twilio's webhook retry mechanism. If retries exhaust, the message is logged when the system recovers.

## 8.10 Rate Limiting

Beyond the 24-hour rolling cap of 2 non-urgent messages, add a hard safety limit: no more than 10 outbound messages per phone number per hour regardless of purpose. This prevents bugs from blasting customers.

## 8.11 AI Prompt Logging

Log the full AI prompt and response for every interaction, stored separately from message_log. Used for debugging only. Retained for 30 days, then auto-deleted.

## 8.12 Outbound Queue Status Enum (Canonical)

Locked values: pending, deferred, claimed, sent, failed_retryable, failed_terminal, canceled.

'deferred' is added for quiet-hours holds — message is valid but waiting for the quiet-hours window to end.

## 8.13 dispatch_status Initial Value

null when an appointment is first booked and nobody has marked en_route. The first dispatch action sets it to en_route.

## 8.14 event_codes

Hard-locked canonical list. No new values without formal amendment. The Schema Contract §4.1 "Examples" must be changed to "Canonical event codes."

Full list: inbound_message_received, inbound_call_received, missed_call_detected, voicemail_received, customer_done_sending, human_requested, human_requested_repeat, negative_job_mention_detected, override_detected, complaint_detected, safety_detected, hostility_detected, legal_threat_detected, billing_dispute_detected, state_changed, appointment_change_request_created, appointment_marked_booked, appointment_marked_rescheduled, appointment_marked_canceled, appointment_marked_no_show, technician_assigned, dispatch_marked_en_route, dispatch_marked_delayed, job_marked_in_progress, job_marked_paused, job_marked_complete, admin_quote_approved, quote_intake_complete, quote_sent_to_admin, quote_delivered_to_customer, quote_follow_up_sent, quote_accepted_by_customer, quote_declined_by_customer, quote_non_commitment_detected, quote_expired, quote_withdrawn, parts_confirmed, approval_record_approved, approval_record_denied, human_takeover_enabled, human_takeover_disabled, human_takeover_timer_expired, conversation_resolved, conversation_auto_closed, escalation_created, escalation_resolved, closeout_queued, closeout_sent, closeout_blocked, closeout_canceled, recurring_service_created, recurring_visit_generated, recurring_change_request_created, customer_opted_out, customer_resubscribed, calendar_sync_inbound, calendar_sync_outbound, business_paused, business_unpaused.

## 8.15 Handoff Summaries

Stored as fields on the escalation record (ai_summary) and as event_log entries. No separate handoff_summaries table.

## 8.16 Platform Admin (Ethan)

Minimal platform admin via Supabase dashboard directly. Capabilities: view all businesses, toggle business active/inactive (kill switch), view owner contact info for lockout recovery, access join codes for owner recovery. No dedicated admin UI in v1.

---

# PART 9 — DASHBOARD CLARIFICATIONS

## 9.1 Approvals

Dedicated "Approvals" sub-section in the main navigation. Shows all pending approval requests (out-of-radius jobs, owner-approval-required items). Available to both owner and admin.

**Updated main navigation:**

| Tab | What it is |
|---|---|
| Urgent | Home screen. Everything needing attention now. |
| Appointments | Schedule management + Recurring sub-section. |
| Quotes | Pricing requests. |
| Approvals | Pending approval requests. |
| Escalations | Complaints, legal, safety, all flagged problems. |
| Settings | (Owner only) All configuration. |

## 9.2 Appointment Change Requests

When a customer asks to cancel or reschedule and the AI creates an appointment_change_request, it shows BOTH in the Appointments tab (as a sub-item on the relevant appointment) AND as an urgent item on the Urgent tab.

## 9.3 Quote Management

Quotes auto-expire after the configurable period (default 30 days). Quotes stay in "sent" status until the customer responds or the quote expires. Admin cannot manually withdraw in v1 — quotes expire automatically. The expiration window is adjustable in Settings.

## 9.4 Outbound Queue Visibility

Owner and admin can see pending scheduled outbound messages and cancel them manually. Accessible from within each conversation view as a "Pending Messages" indicator.

## 9.5 Closeout Status

Completed jobs show whether the closeout message was sent, blocked, or skipped. Visible on the appointment card in the Appointments tab. Owner/admin can cancel a pending closeout message per job.

## 9.6 Conversation State

No primary_state badge visible on conversations. Too technical for blue-collar owners. Conversations show simplified status: "AI Handling" / "Waiting on You" / "You Took Over" / "Closed."

## 9.7 Conversation Tags

Tags are internal only. Not visible in the UI.

## 9.8 Thread Timeline

No timeline view of state changes or events. Just message history in the conversation view.

## 9.9 Industry Change

Industry is locked after onboarding. Owner must create a new account to change industry.

## 9.10 Analytics

Simple analytics in v1: leads this week/month, jobs completed this week/month, quotes sent, average response time, conversion rate (leads → booked jobs). Clean numbers, no complex charts. All v1 analytics are calculated as real-time queries against existing tables (conversations, appointments, quotes, message_log). No separate analytics table, materialized view, or pre-aggregation required.

## 9.11 Search

Owner/admin can search conversations by customer name and phone number. No keyword search in v1.

## 9.12 Filtering

Appointments: filterable by status (booked, completed, canceled, no_show).
Urgent tab: filterable by urgency type (safety, legal, complaint, scheduling, stale, etc.).

## 9.13 Pagination

Paginated pages (page 1, 2, 3...) for all long lists.

## 9.14 Photos

Thumbnails displayed inline in conversation view with tap-to-expand to full size.

## 9.15 Dark Mode

Supported from day one.

## 9.16 Urgent Tab Item Lifecycle

Items can be manually dismissed from the Urgent tab. All items auto-expire and disappear 30 days after creation.

## 9.17 Admin Direct Messaging During Takeover

When admin messages a customer during takeover, they can choose: send through the app (from the Twilio business number) OR use their personal phone directly (customer contact info is visible in the conversation). Both options available. Messages sent through the app are logged in message_log. Messages sent via admin's personal phone/email are not logged in the system — the admin is responsible for any communication that happens outside the app. A future version may support importing external messages for continuity.

## 9.18 Native App

Web app + PWA + native app (iOS App Store target). All three from v1. Push notifications available on native app and PWA.

---

# PART 10 — SUPPRESSION DECISION MATRIX

| Message Purpose | Blocked by States | Blocked by Tags | Blocked by Records | Other Blocking Conditions |
|---|---|---|---|---|
| missed_call_fallback | human_takeover_active | do_not_contact | — | Cancel if fallback already sent, thread changes, or human/live reply resolves |
| routine_followup_1 | All override states, human_takeover_active, all closed states | do_not_contact | — | Customer reply, state change, stronger workflow |
| routine_followup_final | Same as routine_followup_1 | do_not_contact | — | Same as routine_followup_1 |
| quote_followup_1 | All override states, human_takeover_active, all closed states | do_not_contact | — | Customer approval, question, non-commitment, state change, stronger workflow |
| quote_followup_final | Same as quote_followup_1 | do_not_contact | — | Same as quote_followup_1 |
| appointment_reminder_24h | All override states, human_takeover_active | do_not_contact | appointment_change_request at accepted_from_customer or later | Appointment record change, is_no_show = true |
| appointment_reminder_3h | Same as appointment_reminder_24h | do_not_contact | Same | Same |
| closeout | All override states, human_takeover_active | do_not_contact, negative_service_signal, closeout_blocked | — | State change away from job_completed, is_no_show = true |
| booking_confirmation | human_takeover_active | do_not_contact | — | State change before send |
| reschedule_confirmation | human_takeover_active | do_not_contact | — | State change before send |
| cancellation_confirmation | human_takeover_active | do_not_contact | — | None (immediate) |
| dispatch_notice | human_takeover_active | do_not_contact | — | Dispatch status change |
| delay_notice | human_takeover_active | do_not_contact | — | Subsequent dispatch update |
| schedule_change_notice | human_takeover_active | do_not_contact | — | None (confirmed data) |
| stale_waiting_customer_update | All override states (high-risk only), human_takeover_active | do_not_contact | — | Dependency resolved, stronger workflow covers same need |
| handoff_response | human_takeover_active | do_not_contact | — | None (fires once at override entry) |
| quote_delivery | human_takeover_active | do_not_contact | — | State change, newer quote supersedes |
| admin_response_relay | human_takeover_active | do_not_contact | — | State change before send |
| recurring_reminder | human_takeover_active | do_not_contact | recurring_service_change_request at accepted_from_customer for that visit | Service cancellation |

**Global suppression rules that apply to ALL purposes:**
- is_paused = true on business → AI sends pause_message only, all other purposes blocked.
- consent_status = 'opted_out' on customer → All outbound blocked.
- Rolling 24-hour cap: max 2 non-urgent customer-facing messages per thread. Urgent/operational exempt.
- Quiet hours (10 PM – 6 AM): All non-urgent messages deferred. Urgent/operational exempt.
- is_no_show = true on conversation → All messages blocked.

---

# PART 11 — PERMISSION MATRIX

| Action | Owner | Admin |
|---|---|---|
| View Urgent tab | ✓ | ✓ |
| View Appointments tab | ✓ | ✓ |
| View Quotes tab | ✓ | ✓ |
| View Approvals tab | ✓ | ✓ |
| View Escalations tab | ✓ | ✓ |
| View Settings tab | ✓ | ✗ |
| View all conversations (Settings > Conversations) | ✓ | ✗ |
| View Customer List | ✓ | ✗ |
| View Payment Management | ✓ | ✗ |
| View Analytics | ✓ | ✗ |
| Edit Business Configuration | ✓ | ✗ |
| Change/view join code | ✓ | ✗ |
| Remove user (admin or owner, cannot remove last owner) | ✓ | ✗ |
| Change user role (promote admin to owner / demote owner to admin) | ✓ | ✗ |
| Toggle payment management | ✓ | ✗ |
| Toggle AI call answering | ✓ | ✗ |
| Adjust takeover timer default | ✓ | ✗ |
| Adjust urgent tab categories | ✓ | ✗ |
| Pause/unpause business | ✓ | ✗ |
| Take over conversation | ✓ | ✓ |
| Turn AI back on | ✓ | ✓ |
| Message customer directly | ✓ | ✓ |
| Book appointment | ✓ | ✓ |
| Reschedule appointment | ✓ | ✓ |
| Cancel appointment | ✓ | ✓ |
| Mark no-show | ✓ | ✓ |
| Mark en route | ✓ | ✓ |
| Mark delayed | ✓ | ✓ |
| Mark in progress | ✓ | ✓ |
| Mark complete | ✓ | ✓ |
| Assign technician | ✓ | ✓ |
| Approve/deny quote | ✓ | ✓ |
| Approve/deny request | ✓ | ✓ |
| Resolve escalation | ✓ | ✓ |
| Cancel pending outbound message | ✓ | ✓ |
| Cancel closeout message | ✓ | ✓ |
| Create recurring service | ✓ | ✓ |
| Edit/cancel recurring service | ✓ | ✓ |
| Edit personal notification preferences | ✓ | ✓ |
| Search conversations | ✓ | ✓ |
| Dismiss urgent items | ✓ | ✓ |

---

# AUTHORITY LOCK

This patch is binding. It supersedes all prior documents where conflicts exist. The full authority precedence order is:

1. Blueprint Patch v6 (Final Audit Resolution) — supersedes this document where conflicts exist
2. Blueprint Patch v5 Addendum
3. This document (Blueprint Patch v5)
4. Dashboard App Specification
5. Supplemental Engineering Contract
6. Unified State Authority
7. Merged Trigger Authority
8. Communications Rules
9. Source of Truth Map
10. Capabilities
11. Prohibitions
12. Onboarding Questionnaire

**Retired documents:** Schema Contract v4 FINAL (absorbed into this document + Patch v6), Blueprint Patch v4 (absorbed into this document).

---

**End of Blueprint Patch v5.**
