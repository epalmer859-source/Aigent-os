# Communications OS — Schema v6 Consolidated Reference

**Date:** March 31, 2026
**Status:** Single-source schema reference for migration scripts, ORM models, and code generation. Mechanically merged from Patch v5 Part 2 + Patch v5 Addendum Part 2 + Patch v6 Part 2. All amendments applied.

**Usage rule:** This is the migration source. If any discrepancy exists between this document and the authority documents (Patch v6 > Addendum > Patch v5), the authority document wins. This is a convenience consolidation, not a new authority.

---

# 1. Global Canonical Enums

## 1.1 conversation_primary_state (33 values)

new_lead, lead_qualified, booking_in_progress, quote_sent, lead_followup_active, waiting_on_customer_details, waiting_on_photos, waiting_on_admin_quote, waiting_on_admin_scheduling, waiting_on_parts_confirmation, waiting_on_approval, booked, reschedule_in_progress, tech_assigned, en_route, job_in_progress, job_paused, job_completed, complaint_open, billing_dispute_open, safety_issue_open, legal_threat_open, incident_liability_open, insurance_review_open, permits_regulatory_review_open, vendor_dispute_open, restricted_topic_open, hostile_customer_open, human_takeover_active, resolved, closed_unqualified, closed_lost, closed_completed.

## 1.2 escalation_category (14 values)

complaint, legal_threat, safety_issue, billing_dispute, insurance_issue, permit_regulatory_issue, hostile_customer, damage_liability_incident, vendor_dispute, restricted_topic, scope_dispute, contract_interpretation, blame_fault, internal_staff_issue.

## 1.3 appointment_status (5 values)

booked, rescheduled, canceled, completed, no_show.

## 1.4 dispatch_status (nullable — null means not yet dispatched)

en_route, delayed, arrived, on_site.

## 1.5 quote_status (9 values)

intake_open, under_review, approved_to_send, sent, accepted, declined, superseded, withdrawn, expired.

## 1.6 consent_status (3 values)

implied_inbound, opted_out, resubscribed.

## 1.7 appointment_change_requests.request_status (8 values)

draft, accepted_from_customer, sent_to_admin, admin_approved, admin_denied, completed, superseded, canceled.

## 1.8 recurring_service_change_requests.request_status (8 values)

draft, accepted_from_customer, sent_to_admin, admin_approved, admin_denied, completed, superseded, canceled.

## 1.9 recurring_service_change_requests.request_type (4 values)

cancel_service, skip_visit, reschedule_visit, change_frequency.

## 1.10 outbound_queue.audience_type

customer, internal.

## 1.11 outbound_queue.channel

sms, voice, email, web_chat, push, other.

## 1.12 outbound_queue.status (7 values)

pending, deferred, claimed, sent, failed_retryable, failed_terminal, canceled.

## 1.13 industry (21 values)

house_cleaning, commercial_cleaning, lawn_care, pressure_washing, junk_removal, painting, garage_door, landscaping, handyman, appliance_repair, tree_service, pool_service, window_cleaning, flooring, plumbing, hvac, electrical, auto_repair, carpet_cleaning, gutter_service, detailing.

## 1.14 user_role

owner, admin.

## 1.15 event_log.event_family

inbound, outbound, state_machine, admin_action, detector, scheduler, integration, system.

## 1.16 event_log.source_actor

customer, ai, admin_team, owner, provider, system, worker.

## 1.17 conversation_tags.tag_source

detector, ai, admin_team, owner, system.

## 1.18 notification_type (18 values)

safety_issue, legal_threat, complaint, scheduling_request, stale_item, quote_request, customer_message_during_takeover, job_complete, new_customer_message, approval_request, parts_request, recurring_appointment_created, urgent_service_request, ai_unavailable, calendar_deletion_pending, conversation_merged, customer_email_unsubscribed, customer_email_resubscribed.

## 1.19 event_log.event_code (canonical — no additions without formal amendment)

inbound_message_received, inbound_call_received, missed_call_detected, voicemail_received, customer_done_sending, human_requested, human_requested_repeat, negative_job_mention_detected, override_detected, complaint_detected, safety_detected, hostility_detected, legal_threat_detected, billing_dispute_detected, state_changed, appointment_change_request_created, appointment_marked_booked, appointment_marked_rescheduled, appointment_marked_canceled, appointment_marked_no_show, technician_assigned, dispatch_marked_en_route, dispatch_marked_delayed, job_marked_in_progress, job_marked_paused, job_marked_complete, admin_quote_approved, quote_intake_complete, quote_sent_to_admin, quote_delivered_to_customer, quote_follow_up_sent, quote_accepted_by_customer, quote_declined_by_customer, quote_non_commitment_detected, quote_expired, quote_withdrawn, quote_revised, parts_confirmed, approval_record_approved, approval_record_denied, human_takeover_enabled, human_takeover_disabled, human_takeover_timer_expired, conversation_resolved, conversation_auto_closed, conversation_merged, escalation_created, escalation_resolved, closeout_queued, closeout_sent, closeout_blocked, closeout_canceled, outbound_message_canceled_by_admin, recurring_service_created, recurring_visit_generated, recurring_visit_skipped, recurring_visit_rescheduled, recurring_frequency_changed, recurring_service_canceled, recurring_change_request_created, customer_opted_out, customer_resubscribed, customer_email_unsubscribed, customer_email_resubscribed, calendar_sync_inbound, calendar_sync_outbound, business_paused, business_unpaused, ai_generation_failed, urgent_service_request_detected, internal_staff_issue_detected, user_role_changed, user_removed.

---

# 2. businesses

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | Primary key. |
| owner_user_id | uuid not null unique | FK → users.id. The founding owner who created this business. Used for lockout recovery. Multiple users may hold the 'owner' role — see users table. |
| business_name | text not null | From onboarding Q1. |
| industry | text enum not null | One of 21 values. Locked after onboarding. |
| timezone | text not null | IANA timezone string. Used for all timing calculations. |
| join_code | text not null | Owner-created during onboarding. Editable in settings. |
| is_paused | boolean not null default false | Global AI pause. |
| pause_message | text null | Custom away message when paused. |
| default_takeover_timer_seconds | integer not null default 604800 | 7 days. 0 = never. |
| google_review_link | text null | From Q21. |
| preferred_phone_number | text null | From Q21. |
| urgent_alert_phone | text null | From Q2. |
| urgent_alert_email | text null | From Q2. |
| ai_signoff_name | text null | From Q1. First message only. |
| ai_tone_description | text null | From Q15. |
| always_say | text null | From Q16. |
| never_say | text null | From Q16. |
| supported_languages | text null default 'English' | From Q15. Language list for multilingual. |
| multilingual_enabled | boolean not null default false | AI responds in customer's language if supported. |
| ai_call_answering_enabled | boolean not null default true | |
| rough_estimate_mode_enabled | boolean not null default false | From Q9. |
| labor_pricing_method | text null | by_the_hour or by_the_job. |
| payment_management_enabled | boolean not null default true | UI toggle only. Records always created. |
| cancellation_policy | text null | From Q14. |
| warranty_policy | text null | From Q22. |
| payment_methods | text null | From Q11. |
| emergency_rules | text null | From Q17. |
| customer_prep | text null | From Q13. |
| common_questions | text null | From Q18. |
| typical_process | text null | From Q19. |
| important_details | text null | From Q20. |
| customer_philosophy | text null | From Q23. |
| takeover_notification_message | text null | Customizable in Settings > AI Behavior. |
| quiet_hours_start | time not null default '22:00' | Configurable. Minimum 6-hour window. |
| quiet_hours_end | time not null default '06:00' | Configurable. |
| quote_expiry_days | integer not null default 30 | |
| auto_close_days | integer not null default 30 | |
| onboarding_completed_at | timestamptz null | Dashboard blocked until non-null. |
| deleted_at | timestamptz null | Soft delete. 30-day grace then hard delete. |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

---

# 3. business_config

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null unique | FK → businesses.id. |
| business_hours | jsonb not null | {"monday": {"open": "08:00", "close": "17:00"}, ...} |
| holidays_closures | jsonb null | Array of date strings/ranges. |
| service_area_type | text not null default 'list' | list only in v1. Radius deferred to v2. |
| service_area_list | jsonb null | Array of cities, zips, regions. |
| service_area_radius_miles | integer null | Deferred to v2. |
| service_area_center_address | text null | Deferred to v2. |
| service_area_exclusions | jsonb null | |
| services_offered | jsonb not null | [{"name": "...", "description": "..."}] |
| services_not_offered | jsonb null | |
| owner_approval_job_types | jsonb null | |
| appointment_types | jsonb null | [{"name": "...", "duration_minutes": N, "advance_booking_days": N}] |
| same_day_booking_allowed | boolean not null default false | |
| secondary_contacts | jsonb null | [{"name": "...", "phone": "...", "email": "...", "handles": "..."}] |
| industry_answers | jsonb null | Structured industry-specific answers. |
| urgent_tab_categories | jsonb not null default '["safety","legal","complaint","scheduling","stale"]' | |
| notification_defaults | jsonb null | Default notification settings for new users. |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

---

# 4. users

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | Matches Supabase Auth user ID. |
| business_id | uuid null | FK → businesses.id. Null until onboarding/join. |
| email | text not null unique | |
| display_name | text null | |
| role | text enum not null | owner or admin. |
| notification_preferences | jsonb null | Per-user toggles and delivery methods. |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

Constraints: Multiple owners allowed per business. Unlimited admins. At least one owner must exist at all times — system prevents demotion of the last remaining owner. New users always join as 'admin' via join code. Any owner can promote to 'owner' or demote to 'admin' in Settings > Team Management. businesses.owner_user_id records the founding owner for lockout recovery only.

---

# 5. customers

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | FK → businesses.id. |
| display_name | text null | |
| first_contact_channel | text enum null | sms, voice, email, web_chat. |
| first_contact_at | timestamptz null | |
| consent_status | text enum not null default 'implied_inbound' | |
| opted_out_at | timestamptz null | |
| do_not_contact | boolean not null default false | |
| ai_disclosure_sent_at | timestamptz null | Set on first outbound AI message with disclosure. Per-customer, not per-conversation. Web chat always includes disclosure per session regardless. |
| notes | text null | |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

Identity resolution: Match on any phone or email via customer_contacts.

---

# 6. customer_contacts

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| customer_id | uuid not null | FK → customers.id. |
| business_id | uuid not null | FK → businesses.id. |
| contact_type | text enum not null | phone or email. |
| contact_value | text not null | E.164 phone or email. |
| is_primary | boolean not null default false | |
| is_opted_out | boolean not null default false | Email-only opt-out. Does not affect SMS. |
| opted_out_at | timestamptz null | When email unsubscribe was processed. |
| created_at | timestamptz not null default now() | |

Constraint: Unique (business_id, contact_type, contact_value).

---

# 7. conversations

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | FK → businesses.id. |
| customer_id | uuid not null | FK → customers.id. |
| matter_key | text not null | Unique matter identifier. Stable for life of matter. |
| primary_state | text enum not null | One of 33 canonical states. |
| prior_state | text null | For resume after override/takeover. |
| current_owner | text not null default 'ai' | ai, admin_team, owner, human_takeover. |
| current_workflow_step | text null | Machine-readable unresolved step. |
| secondary_tags | jsonb null | Cached helper view from conversation_tags. Not source of truth. |
| contact_handle | text not null | Phone number, email, or chat ID. |
| contact_display_name | text null | |
| channel | text enum not null | sms, voice, email, web_chat. |
| collected_service_address | text null | Service address collected during intake. Copied to appointment.address on booking. |
| cached_summary | text null | AI-generated conversation summary. Regenerated on every state change. |
| summary_updated_at | timestamptz null | When cached_summary was last generated. |
| last_customer_message_id | uuid null | FK → message_log.id. |
| last_outbound_message_id | uuid null | FK → message_log.id. |
| last_customer_message_at | timestamptz null | |
| last_ai_message_at | timestamptz null | |
| last_admin_message_at | timestamptz null | |
| last_state_change_at | timestamptz null | |
| human_takeover_enabled_at | timestamptz null | |
| human_takeover_disabled_at | timestamptz null | |
| human_takeover_expires_at | timestamptz null | When timer fires. Null if not in takeover or never. |
| human_takeover_timer_seconds | integer null | Per-conversation override. Null = business default. 0 = never. |
| is_no_show | boolean not null default false | AI sends zero messages when true. |
| auto_close_at | timestamptz null | last_activity + auto_close_days. |
| is_archived | boolean not null default false | Set after 90 days in closed state. |
| closed_at | timestamptz null | |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

Constraints: Unique (business_id, matter_key) where is_archived = false. Index (business_id, primary_state, current_owner, last_state_change_at).

---

# 8. conversation_tags

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| conversation_id | uuid not null | FK → conversations.id. |
| business_id | uuid not null | FK → businesses.id. |
| tag_code | text not null | Examples: urgent, repeat_customer, commercial, photos_received, owner_approval_required, negative_service_signal, hostility_detected, after_hours_contact, vip_customer, do_not_contact, closeout_blocked. |
| tag_source | text enum not null | detector, ai, admin_team, owner, system. |
| created_at | timestamptz not null default now() | |
| expires_at | timestamptz null | |
| is_active | boolean not null default true | |

Constraints: Unique (conversation_id, tag_code) where is_active = true.

---

# 9. message_log

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | FK → businesses.id. |
| conversation_id | uuid not null | FK → conversations.id. |
| direction | text enum not null | inbound or outbound. |
| channel | text enum not null | sms, voice, email, web_chat. |
| sender_type | text enum not null | customer, ai, admin_team, owner, system. |
| sender_user_id | uuid null | FK → users.id if admin/owner sent through app. |
| content | text null | |
| subject_line | text null | Email only. |
| media_urls | jsonb null | Array of attachment URLs. |
| twilio_message_sid | text null | Inbound SMS dedupe key. |
| is_voice_transcript | boolean not null default false | |
| voice_recording_url | text null | |
| created_at | timestamptz not null default now() | |

Constraint: Unique (twilio_message_sid) where twilio_message_sid is not null.

---

# 10. attachments

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| conversation_id | uuid not null | |
| message_id | uuid null | FK → message_log.id. |
| file_url | text not null | Supabase Storage URL. |
| file_type | text null | MIME type. |
| file_name | text null | |
| created_at | timestamptz not null default now() | |

---

# 11. event_log

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| conversation_id | uuid not null | |
| event_code | text not null | From canonical list §1.19. |
| event_family | text enum not null | |
| source_actor | text enum not null | |
| related_record_type | text null | |
| related_record_id | uuid null | |
| metadata | jsonb null | |
| created_at | timestamptz not null default now() | |

Index: (business_id, conversation_id, created_at desc).

---

# 12. appointments

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| conversation_id | uuid null | FK → conversations.id. Null for auto-generated recurring appointments. |
| customer_id | uuid not null | |
| service_type | text null | |
| appointment_date | date not null | |
| appointment_time | time not null | |
| duration_minutes | integer null | |
| address | text null | |
| technician_name | text null | Free-text per appointment. |
| status | text enum not null default 'booked' | booked, rescheduled, canceled, completed, no_show. |
| dispatch_status | text enum null | null, en_route, delayed, arrived, on_site. |
| access_notes | text null | |
| admin_notes | text null | |
| google_calendar_event_id | text null | Bidirectional sync key. |
| is_recurring | boolean not null default false | |
| recurring_service_id | uuid null | FK → recurring_services.id. |
| pending_deletion_at | timestamptz null | Set on destructive inbound calendar sync. 5-min grace period. |
| completed_at | timestamptz null | |
| canceled_at | timestamptz null | |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

---

# 13. appointment_change_requests

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| conversation_id | uuid not null | |
| appointment_id | uuid not null | FK → appointments.id. |
| request_type | text enum not null | cancel or reschedule. |
| request_status | text enum not null default 'draft' | From §1.7 enum. |
| customer_reason | text null | |
| preferred_day_text | text null | Reschedule only. |
| preferred_window_text | text null | Reschedule only. |
| flexibility_notes | text null | Reschedule only. |
| suppression_active | boolean not null default false | |
| suppression_started_at | timestamptz null | |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

---

# 14. quotes

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| conversation_id | uuid not null | |
| customer_id | uuid not null | |
| status | text enum not null default 'intake_open' | From §1.5 enum. |
| requested_service | text null | |
| quote_details | text null | |
| approved_amount | numeric null | |
| approved_terms | text null | |
| approved_by | uuid null | FK → users.id. |
| approved_at | timestamptz null | |
| sent_at | timestamptz null | |
| expires_at | timestamptz null | Calculated from businesses.quote_expiry_days. |
| customer_response | text null | accepted, declined, non_commitment. |
| customer_responded_at | timestamptz null | |
| superseded_by | uuid null | FK → quotes.id. |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

---

# 15. escalations

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| conversation_id | uuid not null | |
| customer_id | uuid null | |
| category | text enum not null | From §1.2 enum. |
| status | text enum not null default 'open' | open, in_progress, resolved. |
| urgency | text enum not null default 'standard' | standard, high, critical. |
| ai_summary | text null | |
| resolution_note | text null | |
| resolved_by | uuid null | FK → users.id. |
| created_at | timestamptz not null default now() | |
| resolved_at | timestamptz null | |

---

# 16. pricing_items

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| service_name | text not null | |
| price_type | text enum not null | fixed, starting, package, trip_fee, diagnostic_fee, after_hours_fee, disposal_fee, emergency_fee, minimum_charge, other_fee. |
| amount | numeric not null | |
| description | text null | |
| is_shareable_by_ai | boolean not null default true | |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

---

# 17. payment_management

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| appointment_id | uuid null | |
| conversation_id | uuid null | |
| customer_id | uuid not null | |
| job_description | text null | |
| amount_due | numeric null | |
| payment_status | text enum not null default 'pending' | pending, paid, waived. |
| job_date | date null | |
| completion_date | date null | |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

Rule: Always created on job completion regardless of payment_management_enabled toggle.

---

# 18. approval_requests

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| conversation_id | uuid not null | |
| customer_id | uuid null | |
| request_type | text not null | |
| status | text enum not null default 'pending' | pending, approved, denied. |
| ai_summary | text null | |
| admin_notes | text null | |
| decided_by | uuid null | |
| created_at | timestamptz not null default now() | |
| decided_at | timestamptz null | |

---

# 19. parts_inquiries

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| conversation_id | uuid not null | |
| appointment_id | uuid null | |
| part_description | text not null | |
| model_number | text null | |
| urgency | text enum not null default 'standard' | standard, high. |
| status | text enum not null default 'pending' | pending, confirmed, unavailable. |
| confirmed_price | numeric null | |
| confirmed_eta | text null | |
| confirmed_by | uuid null | |
| created_at | timestamptz not null default now() | |
| confirmed_at | timestamptz null | |

---

# 20. recurring_services

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| customer_id | uuid not null | |
| service_type | text not null | |
| frequency | text enum not null | weekly, biweekly, monthly, custom. |
| frequency_details | text null | |
| preferred_day | text null | |
| preferred_time | time null | |
| address | text null | |
| status | text enum not null default 'active' | active, paused, canceled. |
| start_date | date not null | |
| end_date | date null | Null = indefinite. |
| created_by | text enum not null | admin or ai. |
| admin_notes | text null | |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

Recurring visits are tracked as appointment records with is_recurring = true and recurring_service_id linked. No separate recurring_visits table.

**Recurring conversation creation (lazy):** Auto-generated recurring appointments have conversation_id = null. When a reminder needs to be scheduled for such an appointment, the system first creates a conversation (matter_key = 'recurring:{recurring_service_id}:{appointment_id}', primary_state = booked, current_owner = ai, channel = sms) and links it to the appointment before queuing the reminder. A conversation is also created if the customer or AI initiates communication about the visit first.

---

# 21. recurring_service_change_requests

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| recurring_service_id | uuid not null | FK → recurring_services.id. |
| conversation_id | uuid null | |
| request_type | text enum not null | From §1.9 enum. |
| request_status | text enum not null default 'draft' | From §1.8 enum. |
| customer_reason | text null | |
| preferred_day_text | text null | |
| preferred_window_text | text null | |
| flexibility_notes | text null | |
| new_frequency | text null | For change_frequency. |
| suppression_active | boolean not null default false | |
| suppression_started_at | timestamptz null | |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

---

# 22. notifications

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| user_id | uuid null | Null = all users for this business. |
| notification_type | text enum not null | From §1.18 enum (18 values). |
| reference_type | text null | conversation, appointment, quote, escalation, approval, parts. |
| reference_id | uuid null | |
| title | text not null | |
| summary | text null | |
| is_read | boolean not null default false | |
| dismissed_at | timestamptz null | |
| expires_at | timestamptz null default (now() + interval '30 days') | |
| created_at | timestamptz not null default now() | |

---

# 23. outbound_queue

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| conversation_id | uuid not null | |
| message_purpose | text not null | From canonical message-purpose catalog. |
| audience_type | text enum not null | customer, internal. |
| channel | text enum not null | From §1.11. |
| template_code | text null | |
| content | text null | |
| dedupe_key | text not null | purpose + scope identifiers. |
| workflow_key | text null | |
| state_snapshot | text enum null | State at queue creation. |
| status | text enum not null default 'pending' | From §1.12. |
| scheduled_send_at | timestamptz not null | |
| quiet_hours_deferred_until | timestamptz null | |
| claim_token | uuid null | |
| claimed_at | timestamptz null | |
| claim_expires_at | timestamptz null | |
| send_attempt_count | integer not null default 0 | |
| max_retry_count | integer not null default 3 | |
| last_attempt_at | timestamptz null | |
| next_retry_at | timestamptz null | |
| invalidated_by_event_id | uuid null | FK → event_log.id. |
| send_result_code | text null | |
| terminal_failure_reason | text null | Required when status = failed_terminal. |
| created_at | timestamptz not null default now() | |

Constraints: Unique (business_id, dedupe_key). Retry: 30s, 2min, 10min. After 3 failures → failed_terminal.

---

# 24. post_job_closeouts

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| conversation_id | uuid not null | |
| completion_record_type | text not null | |
| completion_record_id | uuid not null | |
| eligibility_status | text enum not null | eligible, queued, sent, blocked, suppressed, skipped. |
| blocked_reason | text null | |
| queued_queue_id | uuid null | FK → outbound_queue.id. |
| sent_message_log_id | uuid null | |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

---

# 25. message_templates

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| message_type | text enum not null | booking_confirmation, reschedule_confirmation, cancellation_confirmation, appointment_reminder_24h, appointment_reminder_3h, dispatch_notice, delay_notice, closeout, missed_call_fallback, takeover_notification, stale_waiting_customer_update, business_pause_message, human_request_retention. |
| custom_template | text not null | May include variables: {customer_name}, {business_name}, {appointment_date}, {appointment_time}, {service_type}, {technician_name}, {review_link}, {phone_number}, {quote_amount}. |
| is_active | boolean not null default true | |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

Constraint: Unique (business_id, message_type) where is_active = true.

---

# 26. prompt_log

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| conversation_id | uuid not null | |
| message_id | uuid null | FK → message_log.id. |
| prompt_purpose | text not null | response_generation, summary_generation, intent_classification, override_detection. |
| prompt_text | text not null | |
| response_text | text not null | |
| model | text not null | |
| token_count_prompt | integer null | |
| token_count_response | integer null | |
| latency_ms | integer null | |
| success | boolean not null default true | |
| error_message | text null | |
| created_at | timestamptz not null default now() | |
| expires_at | timestamptz not null default (now() + interval '30 days') | |

Index: (business_id, conversation_id, created_at desc).

---

# 27. calendar_sync_log

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| appointment_id | uuid null | |
| google_calendar_event_id | text null | |
| sync_direction | text enum not null | inbound or outbound. |
| sync_action | text enum not null | created, updated, deleted. |
| before_snapshot | jsonb null | |
| after_snapshot | jsonb null | |
| is_destructive | boolean not null default false | |
| grace_period_expires_at | timestamptz null | |
| grace_period_undone | boolean not null default false | |
| processed_at | timestamptz null | |
| created_at | timestamptz not null default now() | |

Index: (business_id, created_at desc), (appointment_id, created_at desc).

---

# 28. conversation_merges

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| surviving_conversation_id | uuid not null | FK → conversations.id. |
| absorbed_conversation_id | uuid not null | FK → conversations.id. |
| customer_id | uuid not null | |
| merge_reason | text not null | |
| merge_confidence | text enum not null | high or manual. |
| merged_at | timestamptz not null default now() | |

---

# 29. web_chat_sessions

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | |
| business_id | uuid not null | |
| conversation_id | uuid not null | FK → conversations.id. |
| session_token | uuid not null unique | |
| customer_ip | text null | |
| created_at | timestamptz not null default now() | |
| expires_at | timestamptz not null default (now() + interval '24 hours') | |

Index: (business_id, session_token).

---

# 30. Write Authority Summary

| Record / field family | Allowed writer(s) | Guardrail |
|---|---|---|
| businesses.* | Owner (settings), onboarding flow, platform admin | Admin cannot edit business config. |
| business_config.* | Owner (settings), onboarding flow | Updates both raw and structured. |
| users.* | Auth system, owner (team management, role changes) | Owner can change roles and remove users. Cannot demote last owner. |
| customers.* | Inbound bootstrap, AI intake, admin | |
| conversations.primary_state | State machine only | No direct UI write. |
| conversations.cached_summary | System only (summary generation) | No admin/prompt writes. |
| conversations.collected_service_address | AI intake, admin override on Place Appointment | Admin can correct during booking. |
| conversations.matter_key | Inbound bootstrap, admin matter-split | Cannot be rewritten casually. |
| conversation_tags | Detector, admin/owner, system, authorized AI workflow | No free-form prompt minting. |
| event_log | Adapters, detector, scheduler, admin actions, state machine, integrations | Real system actions only. |
| appointment_change_requests.suppression_* | Workflow service, admin actions | Client UI cannot toggle directly. |
| appointments.pending_deletion_at | System only (calendar sync), admin undo | Set by sync worker, cleared by undo or grace processor. |
| outbound_queue claim/retry/sent | Queue workers only | No admin/prompt path may fake send. |
| appointments.* | Admin actions, calendar sync, workflow service | |
| quotes.* | AI intake, admin approval, workflow service | |
| escalations.* | Detector, admin resolution | |
| message_templates.* | Owner only (settings) | |
| prompt_log.* | System only (Edge Functions) | No admin/owner writes. Auto-deleted after 30 days. |
| calendar_sync_log.* | System only (calendar sync worker) | Append-only. |
| conversation_merges.* | System only (AI merge logic) | No admin writes. |
| web_chat_sessions.* | System only (web chat Edge Function) | Auto-deleted after 24 hours. |

---

# 31. Row Level Security Policies

## RLS Helper Function

```sql
CREATE OR REPLACE FUNCTION auth_business_id()
RETURNS uuid AS $$
  SELECT business_id FROM users WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

## RLS Policy Table

Every table with business_id enforces RLS. "Own business only" means `business_id = auth_business_id()`.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| businesses | Own business | Onboarding only | Owner only | Owner only (soft delete) |
| business_config | Own business | Onboarding only | Owner only | Never |
| users | Own business | Auth + join code | Own record + owner can change roles | Owner changes roles, removes users (cannot demote last owner) |
| customers | Own business | Own business | Own business | Never |
| customer_contacts | Own business | Own business | Own business | Own business |
| conversations | Own business | Own business | Own business | Never |
| conversation_tags | Own business | Own business | Own business | Own business |
| message_log | Own business | Own business | Never | Never |
| attachments | Own business | Own business | Never | Never |
| event_log | Own business | Own business | Never | Never |
| appointments | Own business | Own business | Own business | Never |
| appointment_change_requests | Own business | Own business | Own business | Never |
| quotes | Own business | Own business | Own business | Never |
| escalations | Own business | Own business | Own business | Never |
| pricing_items | Own business | Owner only | Owner only | Owner only |
| payment_management | Own business | Own business | Owner only | Never |
| approval_requests | Own business | Own business | Own business | Never |
| parts_inquiries | Own business | Own business | Own business | Never |
| recurring_services | Own business | Own business | Own business | Never |
| recurring_service_change_requests | Own business | Own business | Own business | Never |
| notifications | Own business (own user_id or null) | Own business | Own business | Never |
| outbound_queue | Own business | Own business | Own business | Never |
| post_job_closeouts | Own business | Own business | Own business | Never |
| message_templates | Own business | Owner only | Owner only | Owner only |
| prompt_log | Never | Service role only | Never | Service role only |
| calendar_sync_log | Own business (read) | Service role only | Service role only | Never |
| conversation_merges | Own business (read) | Service role only | Never | Never |
| web_chat_sessions | Never | Service role only | Never | Service role only |

**Service role bypass:** Edge Functions and n8n workers use the Supabase service role key, which bypasses RLS. Required for all system-initiated writes (inbound processing, AI responses, trigger evaluation, calendar sync, scheduled workers).

**Admin vs Owner enforcement:** RLS provides business-level isolation only. Owner-vs-Admin permission differences are enforced at the API/Edge Function layer, not RLS.

---

**End of Schema v6 Consolidated Reference.**
**29 tables. 19 canonical enums. Complete write authority. Full RLS policies.**
