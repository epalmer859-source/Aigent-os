# Communications OS — Blueprint Patch v5 Addendum

## Remaining Gap Closures, Admin Action Contracts, and Voice Edge Cases

**Date:** March 31, 2026
**Status:** Binding addendum to Blueprint Patch v5. Closes the final implementation gaps.

---

**Patch lock statement:**
- This addendum completes Blueprint Patch v5.
- It adds: detailed admin action contracts for all new features, service area matching logic, message template override schema, voice call edge cases, and the canonical list of customizable message types.
- Where this addendum conflicts with Patch v5 or any earlier document, this addendum wins.

---

# PART 1 — SERVICE AREA MATCHING LOGIC

## 1.1 How It Works (v1 — List-Based Only)

In v1, service area matching is list-based only. Radius-based matching with geocoding is deferred to v2.

The AI compares the customer's provided city or zip code against the structured service area data stored in business_config.

**Matching logic (service_area_type = 'list', the only active mode in v1):**

1. AI collects the customer's city or zip code during intake. The address is stored on conversations.collected_service_address.
2. AI checks if the customer's city or zip code appears in service_area_list.
3. Match is case-insensitive and supports partial matching (e.g., customer says "Marietta" and "Marietta, GA" is in the list).
4. If the address clearly falls within a listed city/region, the customer is in-area.
5. After confirming in-area, AI checks service_area_exclusions. If the address matches an excluded area, it is treated as out-of-area.
6. If the address is ambiguous or not clearly in/out, AI asks the customer for their zip code to confirm.

**Out-of-area handling:** If the address is outside the service area, the conversation moves to waiting_on_approval (per the existing out-of-radius/owner-approval flow). AI tells the customer: "That address is a bit outside our usual service area. Let me check with the team to see if we can help." Admin is notified.

**Deferred to v2:** Radius-based matching using service_area_radius_miles, service_area_center_address, and geocoding API. The schema fields remain for future use but are not active in v1.

---

# PART 2 — MESSAGE TEMPLATE OVERRIDE SCHEMA

## 2.1 message_templates table

| Field | Type | Rule |
|---|---|---|
| id | uuid pk | Primary key. |
| business_id | uuid not null | FK → businesses.id. |
| message_type | text enum not null | One of the canonical customizable message types (see §2.2). |
| custom_template | text not null | Owner's custom wording. May include variables: {customer_name}, {business_name}, {appointment_date}, {appointment_time}, {service_type}, {technician_name}, {review_link}, {phone_number}, {quote_amount}. |
| is_active | boolean not null default true | Owner can deactivate to revert to AI-generated. |
| created_at | timestamptz not null default now() | |
| updated_at | timestamptz not null default now() | |

**Constraint:** Unique (business_id, message_type) where is_active = true.

## 2.2 Customizable message types

| message_type | Default behavior (no template) | When template exists |
|---|---|---|
| booking_confirmation | AI-generated confirmation with appointment details | Owner's wording with variables filled in |
| reschedule_confirmation | AI-generated reschedule confirmation | Owner's wording |
| cancellation_confirmation | AI-generated cancellation acknowledgment | Owner's wording |
| appointment_reminder_24h | AI-generated next-day reminder with access request | Owner's wording |
| appointment_reminder_3h | AI-generated same-day reminder | Owner's wording |
| dispatch_notice | AI-generated on-the-way message | Owner's wording |
| delay_notice | AI-generated delay update | Owner's wording |
| closeout | AI-generated thank-you + review link + phone number | Owner's wording |
| missed_call_fallback | AI-generated missed-call text-back | Owner's wording |
| takeover_notification | AI-generated "team is taking over" message | Owner's wording |
| stale_waiting_customer_update | AI-generated "team is still working on this" | Owner's wording |
| business_pause_message | Default: "Thanks for reaching out! [Business name] is currently away..." | Owner's wording |
| human_request_retention | AI-generated retention step based on tone settings | Owner's wording |

**Rule:** If a custom template exists and is_active = true for a message_type, the system uses it with variable substitution. If no template exists or is_active = false, the AI generates the message naturally per existing rules. Owner manages templates in Settings > AI Behavior > Message Templates.

---

# PART 3 — VOICE CALL EDGE CASES

## 3.1 Max Call Duration

Maximum call duration: 15 minutes. At 14 minutes, AI gives a natural wrap-up: "I want to make sure I've got everything — let me get this over to the team and follow up with you by text with all the details." At 15 minutes, AI gracefully ends the call and immediately follows up via SMS with a summary and next steps.

## 3.2 Call Drop Handling

If a call drops mid-conversation, AI sends an SMS within 30 seconds: "Looks like we got disconnected! Here's where we left off: [brief summary of what was discussed and collected so far]. Feel free to call back or just reply here by text and we'll keep going."

The conversation record is preserved. If the customer calls back, AI picks up with full context from the dropped call.

## 3.3 Simultaneous Calls

Each inbound call gets its own AI instance via Twilio. Multiple simultaneous calls are handled independently. No queuing, no hold music, no limit on concurrent calls (Twilio handles scaling).

## 3.4 Call Transfer to Admin

If the customer requests a human during a voice call:
1. AI follows the same one-time retention step as SMS (guideline-based, not scripted).
2. If the customer still wants a person, AI says: "Let me connect you with the team. I'll send them everything we've discussed so they're up to speed."
3. AI creates the handoff record and escalation notification.
4. Call ends. AI immediately texts the customer: "I've let the team know about your call. They'll reach out to you directly at this number. If you need to reach them sooner, you can call [preferred phone number]."
5. Conversation moves to human_takeover_active.

**Note:** In v1, there is no live call transfer (warm handoff). The AI ends the call and the admin follows up separately. Live transfer can be added in a future version.

## 3.5 Voicemail During AI Call Answering

If ai_call_answering_enabled = true, calls do not go to voicemail — the AI answers directly. Voicemail is only relevant when ai_call_answering_enabled = false (missed call scenario).

---

# PART 4 — ADMIN ACTION CONTRACTS (NEW FEATURES)

All actions follow the same format as the existing Supplemental Engineering Contract Part 2.

## 4.1 Mark No-Show

- **Who may click:** Admin, owner
- **Valid from states:** booked, tech_assigned, en_route
- **Required input:** Appointment ID
- **Records created/updated:** Appointment record updated: status = no_show. Conversation updated: is_no_show = true.
- **Notifications triggered:** None to customer. AI sends zero messages for this job going forward.
- **Queue effects:** ALL pending outbound messages for this conversation are canceled. No closeout message queued. No follow-up of any kind.
- **State change:** Conversation primary_state → resolved (silent close).
- **Audit:** Event logged: appointment_marked_no_show.

## 4.2 Pause Business

- **Who may click:** Owner only
- **Valid when:** Business is currently unpaused (is_paused = false).
- **Required input:** None (optional: custom pause message).
- **Records created/updated:** businesses.is_paused = true. businesses.pause_message updated if custom message provided.
- **Notifications triggered:** None to customers. All future inbound customer messages receive the pause_message auto-response only. Admin is notified that business was paused.
- **Queue effects:** ALL pending non-urgent outbound messages across ALL conversations for this business are canceled. Urgent operational messages (confirmed dispatch, confirmed schedule changes) are also canceled since nobody is operating.
- **Audit:** Event logged: business_paused.

## 4.3 Unpause Business

- **Who may click:** Owner only
- **Valid when:** Business is currently paused (is_paused = true).
- **Required input:** None.
- **Records created/updated:** businesses.is_paused = false.
- **Notifications triggered:** None to customers. AI resumes normal operation. No "we're back" message sent.
- **Queue effects:** No old queue rows are resurrected. AI starts fresh — new timers and automations begin only on new qualifying events.
- **Audit:** Event logged: business_unpaused.

## 4.4 Create Recurring Service (Admin)

- **Who may click:** Admin, owner
- **Required input:** Customer ID, service type, frequency (weekly/biweekly/monthly/custom), preferred day, preferred time, address, start date, end date (optional).
- **Records created/updated:** recurring_services record created with status = active, created_by = 'admin'. First recurring_visit and corresponding appointment record generated.
- **Notifications triggered:** notification to admin confirming creation. booking_confirmation queued to customer for the first visit.
- **Queue effects:** Appointment reminders (24h + 3h) scheduled for the first generated visit.
- **Audit:** Event logged: recurring_service_created.

## 4.5 Create Recurring Service (AI)

- **Triggered by:** AI conversation with customer requesting regular service.
- **Records created/updated:** recurring_services record created with status = active, created_by = 'ai'. First recurring_visit and corresponding appointment record generated (pending admin confirmation of time).
- **Notifications triggered:** Immediate notification to admin: "AI set up a recurring [service type] for [customer name] — [frequency] starting [date]. Review and confirm." booking_confirmation to customer after admin confirms.
- **Queue effects:** Appointment reminders scheduled after admin confirms first visit time.
- **Audit:** Event logged: recurring_service_created.
- **Note:** If admin wants to modify the schedule, they can do so before confirming. The recurring service is created but the first visit may need admin time-slot approval depending on business rules.

## 4.6 Skip Recurring Visit

- **Who may click:** Admin, owner (or AI on customer request via recurring_service_change_request)
- **Required input:** Recurring visit ID.
- **Records created/updated:** Recurring visit status = skipped. Appointment record (if generated) updated: status = canceled. recurring_service_change_request created with request_type = skip_visit if initiated by customer through AI.
- **Notifications triggered:** If customer-initiated: cancellation_confirmation to customer. If admin-initiated: none to customer unless admin explicitly sends a message.
- **Queue effects:** All reminders for the skipped visit canceled. Next visit remains on schedule.
- **Audit:** Event logged: recurring_visit_skipped.

## 4.7 Reschedule Recurring Visit

- **Who may click:** Admin, owner (or AI on customer request)
- **Required input:** Recurring visit ID, new date, new time.
- **Records created/updated:** Recurring visit updated with new date/time. Appointment record updated. recurring_service_change_request created with request_type = reschedule_visit if customer-initiated.
- **Notifications triggered:** reschedule_confirmation to customer.
- **Queue effects:** Old reminders canceled. New reminders scheduled for new date/time.
- **Audit:** Event logged: recurring_visit_rescheduled.

## 4.8 Change Recurring Frequency

- **Who may click:** Admin, owner (or AI on customer request)
- **Required input:** Recurring service ID, new frequency.
- **Records created/updated:** recurring_services.frequency updated. Future visits regenerated based on new frequency. recurring_service_change_request created with request_type = change_frequency if customer-initiated.
- **Notifications triggered:** admin_response_relay to customer confirming the change.
- **Queue effects:** Old future visit reminders canceled. New reminders generated for new schedule.
- **Audit:** Event logged: recurring_frequency_changed.

## 4.9 Cancel Recurring Service

- **Who may click:** Admin, owner (or AI on customer request)
- **Required input:** Recurring service ID, reason (optional).
- **Records created/updated:** recurring_services.status = canceled. All future recurring_visit records canceled. All future appointment records linked to this service canceled. recurring_service_change_request created with request_type = cancel_service if customer-initiated.
- **Notifications triggered:** If customer-initiated: confirmation to customer that the recurring service has been canceled. If admin-initiated: none to customer unless admin explicitly sends a message.
- **Queue effects:** All future reminders for all visits in this series canceled.
- **Audit:** Event logged: recurring_service_canceled.

## 4.10 Approve Request (from Approvals tab)

- **Who may click:** Admin, owner
- **Valid from states:** waiting_on_approval
- **Required input:** Approval request ID, decision = approved, notes (optional).
- **Records created/updated:** approval_requests.status = approved, decided_by = user_id, decided_at = now(). Conversation primary_state returns to the blocked routine or active-service state.
- **Notifications triggered:** admin_response_relay queued to customer confirming approval outcome. stale_waiting_internal_ping for this approval dependency canceled.
- **Queue effects:** Stale waiting timers for this dependency canceled. Routine workflow resumes.
- **Audit:** Event logged: approval_record_approved.

## 4.11 Deny Request (from Approvals tab)

- **Who may click:** Admin, owner
- **Valid from states:** waiting_on_approval
- **Required input:** Approval request ID, decision = denied, reason.
- **Records created/updated:** approval_requests.status = denied, decided_by = user_id, decided_at = now(). Conversation primary_state → closed_unqualified (or back to prior state if partial denial with alternative path).
- **Notifications triggered:** admin_response_relay queued to customer explaining outcome within approved language. stale_waiting_internal_ping canceled.
- **Queue effects:** Stale waiting timers canceled.
- **Audit:** Event logged: approval_record_denied.

## 4.12 Cancel Closeout Message

- **Who may click:** Admin, owner
- **Valid when:** A closeout message is in pending/deferred status in outbound_queue for a completed job.
- **Required input:** Outbound queue row ID (or job/appointment ID to identify the closeout).
- **Records created/updated:** outbound_queue row updated: status = canceled, invalidated_by_event_id = the admin action event. post_job_closeouts record updated: eligibility_status = skipped.
- **Notifications triggered:** None.
- **Queue effects:** Closeout message removed from queue. No replacement queued.
- **Audit:** Event logged: closeout_canceled.

## 4.13 Cancel Pending Outbound Message

- **Who may click:** Admin, owner
- **Valid when:** Any outbound_queue row is in pending or deferred status.
- **Required input:** Outbound queue row ID.
- **Records created/updated:** outbound_queue row updated: status = canceled, invalidated_by_event_id = the admin action event.
- **Notifications triggered:** None.
- **Queue effects:** Message removed from queue.
- **Audit:** Event logged: outbound_message_canceled_by_admin.

---

# PART 5 — ADDITIONAL EVENT CODES

The following event codes are added to the canonical list in Patch v5 §8.14:

- appointment_marked_no_show
- business_paused
- business_unpaused
- recurring_service_created
- recurring_visit_skipped
- recurring_visit_rescheduled
- recurring_frequency_changed
- recurring_service_canceled
- closeout_canceled (already listed, confirmed)
- outbound_message_canceled_by_admin

---

# PART 6 — UPDATED NAVIGATION

The main navigation with the new Approvals tab:

| Tab | What it is | Who sees it |
|---|---|---|
| **Urgent** | Home screen. Everything needing attention now. | Owner, Admin |
| **Appointments** | Schedule management. Sub-sections: Requests, Scheduled, Recurring. | Owner, Admin |
| **Quotes** | Pricing requests. Sub-sections: Pending, Sent. | Owner, Admin |
| **Approvals** | Pending approval requests (out-of-radius, owner-approval-required). | Owner, Admin |
| **Escalations** | Complaints, legal, safety, all flagged problems. | Owner, Admin |
| **Settings** | All configuration, conversations, customer list, payment management, analytics. | Owner only |

Profile icon (top corner, both roles): notification preferences, account info, sign out.

---

# PART 7 — NEUTRAL AND AMBIGUOUS CUSTOMER RESPONSE AUTHORITY

**Status:** Referenced across multiple authority documents but not yet audited against this patch. Owner has confirmed this document exists and will upload it separately.

**Action required:** Once uploaded, audit the Neutral and Ambiguous Customer Response Authority against:
1. The canonical state catalog (33 states)
2. The trigger timing rules (silence follow-up, quote follow-up)
3. The DONE keyword photo completion trigger
4. The override detection logic
5. The message-purpose catalog
6. Any customer response classification rules that affect state transitions

**Until audited:** If any rule in the Neutral and Ambiguous Authority conflicts with this patch or Patch v5, this patch wins.

---

# AUTHORITY LOCK

This addendum is binding alongside Blueprint Patch v5 and Patch v6. The combined authority precedence order is:

1. Blueprint Patch v6 (Final Audit Resolution)
2. This addendum (Patch v5 Addendum)
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

**Retired documents:** Schema Contract v4 FINAL, Blueprint Patch v4.

---

**End of Blueprint Patch v5 Addendum.**
