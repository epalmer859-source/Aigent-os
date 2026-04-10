# Communications OS — Supplemental Engineering Contract

## Message-Purpose Catalog, Admin Action Contract, and Resume/Restoration Authority

**Date:** March 30, 2026
**Status:** Binding supplement to the 9 core authority documents and Blueprint Patch v4.

---

**Document use:** This supplement closes the three remaining engineering gaps identified during the full blueprint audit. It does not replace any existing authority. It adds the missing operational tables that sit between the existing spec documents and implementation code.

---

# PART 1 — Message-Purpose Catalog

Every row in `outbound_queue` must carry a `message_purpose` from this canonical list. No purpose outside this list may be queued without a formal amendment.

## 1.1 Customer-facing message purposes

| Purpose code | Description | Urgent? | Quiet-hours restricted? | Dedupe scope | Cancellation triggers | Allowed states | Max per cycle |
|---|---|---|---|---|---|---|---|
| missed_call_fallback | Text-back after missed call when live AI answering is off | No | No (triggered by live event) | One per missed-call event | Cancel if fallback already sent, thread changes, or human/live reply resolves the event | new_lead, any pre-existing active state | 1 per event |
| routine_followup_1 | First silence follow-up (8h after AI asked customer-answerable question) | No | Yes | One per active silence window per thread | Customer reply, state change, stronger workflow, human takeover, do_not_contact, closure | Any state where AI asked a customer-answerable question and customer went quiet | 1 |
| routine_followup_final | Final silence follow-up (24h after first follow-up) | No | Yes | One per active silence window per thread | Same as routine_followup_1 | Same as routine_followup_1 | 1 |
| quote_followup_1 | First quote follow-up (24h after quote delivered) | No | Yes | One per active quote cycle per thread | Customer approval, customer question, non-commitment acknowledgment, state change, stronger workflow, override, closure | quote_sent | 1 |
| quote_followup_final | Final quote follow-up (3 days after quote delivered) | No | Yes | One per active quote cycle per thread | Same as quote_followup_1 | quote_sent | 1 |
| appointment_reminder_24h | Next-day reminder with bundled attendance/access request | No | Yes | One per appointment per reminder window | Appointment change request at accepted_from_customer or later, appointment record change, stronger workflow, thread state blocks reminders | booked, tech_assigned | 1 per appointment |
| appointment_reminder_3h | Same-day reminder (3h before appointment) | No | Yes | One per appointment per reminder window | Same as appointment_reminder_24h | booked, tech_assigned, en_route | 1 per appointment |
| closeout | Single post-job closeout: thank-you + Google review link + business phone number | No | Yes | One per completed job | Any active override state, human_takeover_active, negative_service_signal tag, do_not_contact tag, closeout_blocked tag. Additionally, any state change away from job_completed before send time cancels the queued closeout. | job_completed | 1 per job, ever |
| booking_confirmation | Confirmed appointment details after admin sets the appointment | No | Yes | One per appointment booking event | State change before send, appointment record change | booked (just entered) | 1 per booking event |
| reschedule_confirmation | Confirmed replacement appointment after admin reschedules | No | Yes | One per reschedule completion event | State change before send | booked (re-entered after reschedule) | 1 per reschedule event |
| cancellation_confirmation | Confirmation that cancellation request has been received and sent to team | No | Yes | One per cancellation acceptance | None (immediate send on acceptance) | Any active-service state during cancellation flow | 1 per cancellation |
| dispatch_notice | On-the-way notification based on confirmed dispatch status | Yes (operational) | No (operationally required) | One per dispatch event | Dispatch status change, state change | en_route | 1 per dispatch event |
| delay_notice | Confirmed delay update from staff/system | Yes (operational) | No (operationally required) | One per delay event | Subsequent dispatch update, state change | en_route, tech_assigned | 1 per delay event |
| schedule_change_notice | Confirmed schedule change communicated to customer | Yes (operational) | No (operationally required) | One per schedule change event | None (confirmed operational data) | booked, tech_assigned | 1 per event |
| stale_waiting_customer_update | Customer reassurance during staff-owned waiting (6h, 12h, then every 12h) | No | Yes | One per cadence step per active dependency | Blocking dependency resolved, replaced, suppressed, or state changed | waiting_on_admin_quote, waiting_on_admin_scheduling, waiting_on_approval, waiting_on_parts_confirmation | Per cadence rules |
| stale_waiting_customer_update_parts | Parts-specific customer update (6h and 24h only, then stops) | No | Yes | One per cadence step per parts dependency | Parts answer/ETA/status confirmed, or control changes | waiting_on_parts_confirmation | 2 max (6h + 24h) |
| handoff_response | Initial policy-safe response when override opens (includes business phone number for high-risk) | No | No (immediate on override trigger) | One per override entry per thread | None (fires once at override entry) | Any override state at entry | 1 per override entry |
| quote_delivery | Approved quote/pricing relayed to customer | No | Yes | One per approved quote version | State change, newer quote supersedes | quote_sent (just entered) | 1 per quote approval |
| admin_response_relay | Relaying any admin-provided answer back to customer | No | Yes | One per admin response event | State change before send | Any state where admin response is pending | 1 per response |
| recurring_reminder | Upcoming recurring service visit reminder | No | Yes | One per recurring visit per reminder window | Recurring change request at accepted_from_customer or later for that visit, service cancellation | Active recurring service | Per reminder rules |

## 1.2 Internal message purposes

| Purpose code | Description | Urgent? | Delivery method | Dedupe scope | Cancellation triggers |
|---|---|---|---|---|---|
| stale_waiting_internal_ping | Internal alert that a staff-owned action is unresolved (immediate, 6h, 12h, then every 12h) | Yes at entry, then standard cadence | Dashboard always + text/email for urgent | One per cadence step per active dependency | Dependency resolved, replaced, suppressed, or state changed |
| escalation_alert | Urgent internal alert for complaints, legal, safety, hostility, liability, etc. | Yes | Dashboard + text/email | One per escalation event per thread | None (must always deliver) |
| new_quote_request | Internal notification that a new quote request is ready for review | No | Dashboard. Text/email only if business configures it. | One per quote request created | None |
| new_scheduling_request | Internal notification that a full job package is ready for scheduling review | No | Dashboard. Text/email only if business configures it. | One per scheduling package sent | None |
| new_approval_request | Internal notification that an approval-gated item needs review | No | Dashboard. Text/email only if business configures it. | One per approval request | None |
| parts_request | Internal notification that a parts question needs staff answer | No | Dashboard. Text/email only if business configures it. | One per parts inquiry | None |
| payment_management_ready | Internal record prepared for owner payment follow-up after job completion | No | Dashboard only | One per completed job | None |
| human_takeover_summary | Summary delivered to admin/owner when they take over a thread | Yes | Dashboard + text/email | One per takeover event | None |
| schedule_change_admin_notice | Admin notification that AI communicated a schedule change to customer (per Rules §1.9) | No | Dashboard | One per schedule change communicated | None |
| urgent_service_request | High-priority admin alert for urgent non-safety service needs (e.g., no heat, no AC) | Yes | Dashboard + text/email | One per urgent service event | Admin acknowledges or schedules response |

## 1.3 Message-purpose rules

- Every outbound_queue row must carry exactly one purpose from the lists above.
- The `dedupe_key` must be constructed from the purpose code plus the scope identifiers listed (e.g., `closeout:{job_id}`, `appointment_reminder_24h:{appointment_id}`, `stale_waiting_internal_ping:{dependency_id}:{cadence_step}`).
- No two queue rows with the same dedupe_key may exist in non-terminal status simultaneously.
- Customer-facing purposes marked "quiet-hours restricted = yes" must respect the business's configured quiet hours (default 10 PM – 6 AM) and the weird-hours deferral system.
- The rolling 24-hour cap of 2 non-urgent customer-facing messages applies across all purposes. Urgent/operational messages (dispatch_notice, delay_notice, schedule_change_notice) are exempt from the cap but must still avoid duplicate or contradictory messaging.

### 1.3.1 Stale-waiting dependency ID construction

For stale-waiting message purposes, the dependency_id portion of the dedupe_key is constructed per waiting state:

| Primary State | dependency_type | dependency_id source | Example dedupe_key |
|---|---|---|---|
| waiting_on_admin_quote | quote | quotes.id for the active quote | stale_waiting_internal_ping:quote:{quote_id}:6h |
| waiting_on_admin_scheduling | scheduling | conversations.id | stale_waiting_internal_ping:scheduling:{conversation_id}:immediate |
| waiting_on_approval | approval | approval_requests.id | stale_waiting_internal_ping:approval:{approval_request_id}:12h |
| waiting_on_parts_confirmation | parts | parts_inquiries.id | stale_waiting_customer_update_parts:parts:{parts_inquiry_id}:6h |

Cadence step values for normal stale waiting: immediate, 6h, 12h, 24h, 36h, 48h, etc. (every 12h after the first 12h). For parts subtype: 6h, 24h (then stops).

When the dependency is resolved, ALL outbound_queue rows matching the dependency_type:dependency_id prefix in the dedupe_key are canceled, regardless of cadence step.

---

# PART 2 — Admin Action Contract

Every admin/owner action that changes system state is defined here. This is the logic contract, not UI layout.

## 2.1 Scheduling and appointments

### Place Appointment
- **Who may click:** Admin, owner
- **Valid from states:** waiting_on_admin_scheduling, reschedule_in_progress
- **Required input:** Customer/conversation ID, appointment date, appointment time, service type, assigned technician (optional), notes (optional)
- **Records created/updated:** Appointment record created with status = booked. If conversations.collected_service_address is present and admin did not manually enter a different address, copy into appointments.address. Conversation primary_state → booked.
- **Notifications triggered:** booking_confirmation queued to customer. schedule_change_admin_notice logged if this replaces a prior time discussed with customer.
- **Queue effects:** Any pending stale_waiting_internal_ping for scheduling dependency canceled. Any pending routine_followup messages for this thread canceled.
- **Audit:** Event logged: appointment_marked_booked.

### Reschedule Appointment
- **Who may click:** Admin, owner
- **Required input:** Appointment ID, new date, new time, reason (optional)
- **Records created/updated:** Appointment record updated with new time. appointment_change_request updated to admin_approved then completed. Conversation primary_state → booked (with new time).
- **Notifications triggered:** reschedule_confirmation queued to customer.
- **Queue effects:** Old appointment_reminder rows for previous time canceled. New reminder rows created for new time.
- **Audit:** Event logged: appointment_marked_rescheduled.

### Cancel Appointment
- **Who may click:** Admin, owner
- **Required input:** Appointment ID, cancellation reason (optional from admin side)
- **Records created/updated:** Appointment record updated to status = canceled. appointment_change_request (if exists) updated to completed.
- **Notifications triggered:** cancellation_confirmation to customer if not already sent.
- **Queue effects:** All appointment reminders for this appointment canceled.
- **Audit:** Event logged: appointment_marked_canceled.

### Assign Technician
- **Who may click:** Admin, owner
- **Required input:** Appointment ID, technician name/ID
- **Records created/updated:** Appointment record updated with technician assignment. Conversation primary_state → tech_assigned (if currently booked).
- **Notifications triggered:** None to customer unless business configures technician-assignment notices.
- **Audit:** Event logged: technician_assigned.

### Mark En Route
- **Who may click:** Admin, owner, or system integration
- **Required input:** Appointment ID
- **Records created/updated:** Dispatch status → en_route. Conversation primary_state → en_route.
- **Notifications triggered:** dispatch_notice queued to customer.
- **Queue effects:** None additional.
- **Audit:** Event logged: dispatch_marked_en_route.

### Mark Delayed
- **Who may click:** Admin, owner
- **Required input:** Appointment ID, delay reason (optional), updated ETA (optional)
- **Records created/updated:** Dispatch status → delayed.
- **Notifications triggered:** delay_notice queued to customer with confirmed info only.
- **Queue effects:** None additional.
- **Audit:** Event logged: dispatch_marked_delayed.

## 2.2 Job lifecycle

### Mark Job In Progress
- **Who may click:** Admin, owner, or system integration
- **Required input:** Appointment/job ID
- **Records created/updated:** Conversation primary_state → job_in_progress.
- **Notifications triggered:** None to customer unless business configures arrival notices.
- **Queue effects:** Lead-generation and post-job automation paused.
- **Audit:** Event logged: job_marked_in_progress.

### Mark Job Paused
- **Who may click:** Admin, owner
- **Required input:** Job ID, pause reason
- **Records created/updated:** Conversation primary_state → job_paused.
- **Notifications triggered:** None to customer (admin communicates directly if needed).
- **Queue effects:** Automation stays paused.
- **Audit:** Event logged: job_marked_paused.

### Mark Job Complete
- **Who may click:** Admin, owner only
- **Required input:** Job/appointment ID
- **Records created/updated:** Official completion record created. Conversation primary_state → job_completed.
- **Notifications triggered:** If no closeout-blocking condition exists: one closeout message queued (thank-you + Google review link + business phone number). payment_management_ready record created in dashboard for owner.
- **Queue effects:** All active-service automation for this job stops. No review_requested state is created. No reminder chain is created.
- **Closeout blockers that prevent the closeout message:** Any active override state, human_takeover_active, negative_service_signal tag, do_not_contact tag, closeout_blocked tag. If the thread moves to any override state before the closeout sends, state-change cancellation kills the queued closeout.
- **Audit:** Event logged: job_marked_complete.

## 2.3 Quoting and pricing

### Approve Quote
- **Who may click:** Admin, owner
- **Required input:** Quote ID, approved pricing/terms, notes (optional)
- **Records created/updated:** Quote record updated to status = approved_to_send. Conversation primary_state → quote_sent after delivery.
- **Notifications triggered:** quote_delivery queued to customer.
- **Queue effects:** Stale_waiting_internal_ping for quote dependency canceled. Quote follow-up ladder starts after delivery. ALL pending quote_followup_1 and quote_followup_final rows for any prior quote on this conversation are canceled immediately.
- **Audit:** Event logged: admin_quote_approved.

### Revise Quote (Withdraw and Replace)
- **Who may click:** Admin, owner
- **Required input:** Old quote ID, new approved amount, new terms (optional), revision reason (optional)
- **Records created/updated:** Old quote: status → superseded, superseded_by → new quote ID. New quote created: approved_amount, approved_terms, status = approved_to_send, approved_by = acting user, approved_at = now().
- **Notifications triggered:** quote_delivery queued for new quote. AI naturally explains the pricing update to the customer.
- **Queue effects:** ALL pending outbound_queue rows where conversation_id matches AND message_purpose IN (quote_followup_1, quote_followup_final) AND status IN (pending, deferred) are canceled immediately. New follow-up ladder starts fresh for the new quote.
- **Audit:** Event logged: quote_revised. Old quote ID stored in metadata.

### Confirm Parts Availability / Pricing
- **Who may click:** Admin, owner
- **Required input:** Parts inquiry ID, confirmed status/price/ETA
- **Records created/updated:** Parts record updated with confirmed info.
- **Notifications triggered:** admin_response_relay queued to customer with confirmed parts info.
- **Queue effects:** stale_waiting_internal_ping and stale_waiting_customer_update_parts for this dependency canceled.
- **Audit:** Event logged: parts_confirmed.

## 2.4 Approvals

### Approve Request
- **Who may click:** Admin, owner (or designated approver)
- **Required input:** Approval record ID, decision = approved, notes (optional)
- **Records created/updated:** Approval record updated to status = approved. Conversation primary_state returns to the blocked routine or active-service state.
- **Notifications triggered:** admin_response_relay queued to customer confirming approval outcome.
- **Queue effects:** stale_waiting_internal_ping for approval dependency canceled.
- **Audit:** Event logged: approval_record_approved.

### Deny Request
- **Who may click:** Admin, owner
- **Required input:** Approval record ID, decision = denied, reason
- **Records created/updated:** Approval record updated to status = denied. Conversation primary_state → closed_unqualified (or back to prior state if partial denial with alternative path).
- **Notifications triggered:** admin_response_relay queued to customer explaining outcome within approved language.
- **Queue effects:** stale_waiting_internal_ping for approval dependency canceled.
- **Audit:** Event logged: approval_record_denied.

## 2.5 Thread control

### Take Over Conversation
- **Who may click:** Admin, owner
- **Required input:** Conversation ID
- **Records created/updated:** Conversation primary_state → human_takeover_active. prior_state preserved. current_owner → human_takeover. human_takeover_enabled_at → now().
- **Notifications triggered:** human_takeover_summary delivered to admin/owner with full context.
- **Queue effects:** ALL pending AI-generated outbound messages for this thread canceled immediately. All timers and automation for this thread paused.
- **Audit:** Event logged: human_takeover_enabled.

### Return Conversation to AI
- **Who may click:** Admin, owner
- **Required input:** Conversation ID, return-to state (optional — defaults to prior_state)
- **Records created/updated:** Conversation primary_state → prior_state (or admin-specified state). current_owner → ai. human_takeover_disabled_at → now(). See Part 3 for full restoration rules.
- **Notifications triggered:** None to customer (AI resumes naturally on next customer contact or timer).
- **Queue effects:** See Part 3 §3.2 for timer and queue restoration.
- **Audit:** Event logged: human_takeover_disabled.

### Resolve / Close Conversation
- **Who may click:** Admin, owner
- **Required input:** Conversation ID, resolution note (optional)
- **Records created/updated:** Conversation primary_state → resolved (or closed_completed if post-job path is done).
- **Notifications triggered:** None to customer.
- **Queue effects:** All pending outbound messages for this thread canceled.
- **Audit:** Event logged: conversation_resolved.

## 2.6 Escalation handling

### Resolve Escalation
- **Who may click:** Admin, owner
- **Required input:** Escalation record ID, resolution note, next-state decision (resolved, return to prior service state, or human_takeover_active to keep manual control)
- **Records created/updated:** Escalation record updated to resolved. Conversation primary_state → admin's chosen next state. See Part 3 for restoration logic.
- **Notifications triggered:** None to customer unless admin explicitly sends a message.
- **Queue effects:** Override-suppressed automation may resume per Part 3 rules.
- **Audit:** Event logged: escalation_resolved.

## 2.7 No-show and job lifecycle

### Mark No-Show
- **Who may click:** Admin, owner
- **Valid from states:** booked, tech_assigned, en_route
- **Required input:** Appointment ID
- **Records created/updated:** Appointment record: status = no_show. Conversation: is_no_show = true. Conversation primary_state → resolved.
- **Notifications triggered:** None to customer. AI sends zero messages for this job going forward.
- **Queue effects:** ALL pending outbound messages for this conversation canceled.
- **Audit:** Event logged: appointment_marked_no_show.

## 2.8 Business pause

### Pause Business
- **Who may click:** Owner only
- **Required input:** None (optional: custom pause message)
- **Records created/updated:** businesses.is_paused = true. businesses.pause_message updated if provided.
- **Notifications triggered:** None to customers. All inbound receives pause_message only. Admin notified.
- **Queue effects:** ALL pending non-urgent outbound messages across ALL conversations canceled.
- **Audit:** Event logged: business_paused.

### Unpause Business
- **Who may click:** Owner only
- **Required input:** None
- **Records created/updated:** businesses.is_paused = false.
- **Notifications triggered:** None to customers. AI resumes normally.
- **Queue effects:** No old rows resurrected. Fresh timers on new events only.
- **Audit:** Event logged: business_unpaused.

## 2.8a Team and role management

### Change User Role
- **Who may click:** Owner only
- **Required input:** Target user ID, new role ('owner' or 'admin')
- **Safety constraint:** Cannot demote the last remaining owner. If the target user is the only user with role = 'owner' for this business, the action is blocked with an error: "Cannot change role — at least one owner must exist." An owner may demote themselves to admin if at least one other owner exists — the last-owner constraint still applies.
- **Records created/updated:** users.role updated to new value. users.updated_at = now().
- **Notifications triggered:** None to customers. Target user sees updated permissions immediately on next page load or app refresh.
- **Queue effects:** None. Role changes do not affect conversations, automation, or pending messages.
- **Audit:** Event logged: user_role_changed. Metadata includes: target_user_id, old_role, new_role, changed_by.

### Remove User
- **Who may click:** Owner only
- **Required input:** Target user ID
- **Safety constraint:** Cannot remove the last remaining owner. Cannot remove yourself (owner must demote themselves first, then another owner removes them — or they just stay).
- **Records created/updated:** users.business_id → null. users.role stays unchanged (orphaned but no longer linked to the business).
- **Notifications triggered:** None to customers. Removed user loses access immediately.
- **Queue effects:** Any conversations the removed user had taken over are transferred to the acting owner (human_takeover remains active, but the responsible user changes).
- **Audit:** Event logged: user_removed. Metadata includes: target_user_id, removed_by.

## 2.9 Recurring services

### Create Recurring Service (Admin)
- **Who may click:** Admin, owner
- **Required input:** Customer ID, service type, frequency, preferred day, preferred time, address, start date, end date (optional)
- **Records created/updated:** recurring_services record created (status = active, created_by = 'admin'). First recurring appointment generated (is_recurring = true, recurring_service_id linked).
- **Notifications triggered:** Admin confirmation notification. booking_confirmation to customer for first visit.
- **Queue effects:** Reminders (24h + 3h) scheduled for first visit.
- **Audit:** Event logged: recurring_service_created.

### Create Recurring Service (AI-triggered)
- **Triggered by:** Customer conversation requesting regular service
- **Records created/updated:** recurring_services record created (status = active, created_by = 'ai'). First recurring appointment generated (is_recurring = true, pending admin time confirmation).
- **Notifications triggered:** Immediate admin notification: "AI set up a recurring [service] for [customer] — [frequency] starting [date]. Review and confirm."
- **Queue effects:** Reminders scheduled after admin confirms first visit.
- **Audit:** Event logged: recurring_service_created.

### Skip Recurring Visit
- **Who may click:** Admin, owner, or AI on customer request
- **Required input:** Recurring appointment ID (appointment where is_recurring = true)
- **Records created/updated:** Appointment status → canceled (skip). recurring_service_change_request created if customer-initiated.
- **Notifications triggered:** If customer-initiated: cancellation_confirmation. If admin-initiated: none unless admin sends message.
- **Queue effects:** All reminders for skipped visit canceled.
- **Audit:** Event logged: recurring_visit_skipped.

### Reschedule Recurring Visit
- **Who may click:** Admin, owner, or AI on customer request
- **Required input:** Recurring appointment ID (appointment where is_recurring = true), new date, new time
- **Records created/updated:** Appointment date/time updated (or old → rescheduled, new appointment created per Patch v6 §2.2). recurring_service_change_request created if customer-initiated.
- **Notifications triggered:** reschedule_confirmation to customer.
- **Queue effects:** Old reminders canceled, new reminders scheduled.
- **Audit:** Event logged: recurring_visit_rescheduled.

### Change Recurring Frequency
- **Who may click:** Admin, owner, or AI on customer request
- **Required input:** Recurring service ID, new frequency
- **Records created/updated:** recurring_services.frequency updated. Future visits regenerated. recurring_service_change_request created if customer-initiated.
- **Notifications triggered:** admin_response_relay confirming change.
- **Queue effects:** Old future reminders canceled. New reminders for new schedule.
- **Audit:** Event logged: recurring_frequency_changed.

### Cancel Recurring Service
- **Who may click:** Admin, owner, or AI on customer request
- **Required input:** Recurring service ID, reason (optional)
- **Records created/updated:** recurring_services.status = canceled. All future visits and linked appointments canceled. recurring_service_change_request created if customer-initiated.
- **Notifications triggered:** If customer-initiated: confirmation. If admin-initiated: none unless admin sends message.
- **Queue effects:** All future reminders canceled.
- **Audit:** Event logged: recurring_service_canceled.

## 2.10 Approvals

### Approve Request
- **Who may click:** Admin, owner
- **Valid from states:** waiting_on_approval
- **Required input:** Approval request ID, decision = approved, notes (optional)
- **Records created/updated:** approval_requests.status = approved. Conversation primary_state returns to blocked routine/active-service state.
- **Notifications triggered:** admin_response_relay to customer. stale_waiting_internal_ping canceled.
- **Audit:** Event logged: approval_record_approved.

### Deny Request
- **Who may click:** Admin, owner
- **Valid from states:** waiting_on_approval
- **Required input:** Approval request ID, decision = denied, reason
- **Records created/updated:** approval_requests.status = denied. Conversation primary_state → closed_unqualified or alternative.
- **Notifications triggered:** admin_response_relay to customer. stale_waiting_internal_ping canceled.
- **Audit:** Event logged: approval_record_denied.

## 2.11 Queue and closeout control

### Cancel Closeout Message
- **Who may click:** Admin, owner
- **Valid when:** Closeout in pending/deferred status in outbound_queue
- **Required input:** Queue row ID or appointment ID
- **Records created/updated:** outbound_queue: status = canceled. post_job_closeouts: eligibility_status = skipped.
- **Notifications triggered:** None.
- **Audit:** Event logged: closeout_canceled.

### Cancel Pending Outbound Message
- **Who may click:** Admin, owner
- **Valid when:** Any outbound_queue row in pending or deferred status
- **Required input:** Queue row ID
- **Records created/updated:** outbound_queue: status = canceled.
- **Notifications triggered:** None.
- **Audit:** Event logged: outbound_message_canceled_by_admin.

---

# PART 3 — Resume / Restoration Authority

This section defines exactly what happens when an override state or human takeover ends and the thread returns to normal operation.

## 3.1 Core restoration rules

### Rule 1: prior_state is the default return target
When an override or human takeover ends, the conversation returns to the `prior_state` that was stored when the override began, UNLESS:
- The admin explicitly selects a different return state.
- The prior_state is no longer valid (e.g., the appointment that drove the prior state was canceled during the override).
- The override resolution naturally moves to a closed state (resolved, closed_completed).

### Rule 2: prior_state validity check
Before restoring to prior_state, the system must verify:
- If prior_state was an active-service state (booked, tech_assigned, en_route, job_in_progress): check that the underlying appointment/job record still supports that state. If the appointment was canceled or completed during the override, do NOT restore to the old active-service state. Default to resolved instead.
- If prior_state was a waiting state: check that the dependency still exists. If admin already resolved it during the override, move to the natural next state instead.
- If prior_state was a routine state: safe to restore.

### Rule 3: closed states never restore
If the thread was moved to resolved, closed_unqualified, closed_lost, or closed_completed during the override, it stays there. No automatic restoration to a prior active state.

## 3.2 Timer and queue restoration

### Silence-based timers (routine follow-up, quote follow-up)
- **Do NOT auto-restart on resume.** The old silence window is dead.
- New timers begin only if a new qualifying event occurs after restoration (e.g., AI asks a new question and customer goes quiet again).
- Rationale: The customer was in an override/takeover situation. Resuming a stale nudge from before the override would feel jarring and out of context.

### Appointment reminders
- **Recalculate from current time.** If the thread returns to booked and the appointment is still in the future, regenerate reminders based on current time vs appointment time. Do not resurrect old reminder queue rows.
- If the appointment is now in the past, do not generate reminders. Let the job lifecycle take over.

### Stale-waiting timers (staff-owned dependencies)
- **Restart fresh if the dependency still exists.** If the thread returns to a waiting state and the dependency is still unresolved, restart the stale cadence from the beginning (immediate internal ping, then 6h, 12h, etc.).
- If the dependency was resolved during the override, no stale timers needed.

### Old queue rows
- **All queue rows from before the override are permanently dead.** Never resurrect a canceled queue row. If automation needs to resume, create new queue rows based on current state and current time.

## 3.3 Override-specific restoration behavior

### complaint_open → resolved
- Return to prior_state if prior state is still valid.
- All routine automation may resume.
- Closeout becomes eligible again (if job_completed and no other blocker exists).

### billing_dispute_open → resolved
- Return to prior_state if still valid.
- Routine automation resumes.
- If the billing dispute was about a completed job, check if closeout was blocked by it. If so and no other blocker exists, closeout becomes eligible.

### safety_issue_open → resolved
- Return to prior_state if still valid.
- All automation resumes.

### legal_threat_open → resolved
- Return to prior_state if still valid.
- All automation resumes.
- Note: legal resolutions often result in resolved or closed rather than returning to active service. Admin should explicitly choose the return state.

### incident_liability_open → resolved
- Same as legal_threat_open. Admin should explicitly choose.

### insurance_review_open → resolved
- Return to prior_state if still valid.
- Routine automation resumes.

### permits_regulatory_review_open → resolved
- Return to prior_state if still valid.
- Routine automation resumes.

### vendor_dispute_open → resolved
- Return to prior_state if still valid.
- Routine automation resumes.

### restricted_topic_open → resolved or waiting_on_approval
- If the restriction was resolved with an answer, return to prior_state.
- If the restriction requires ongoing approval gating, move to waiting_on_approval instead of prior_state.

### hostile_customer_open → resolved or human_takeover_active
- Admin decides. Hostile situations frequently result in human_takeover_active or resolved rather than AI resumption.
- If admin returns to AI, all routine automation resumes.

### human_takeover_active → prior_state
- **Primary resume mechanism:** Takeover timer expiration (default 7 days, configurable globally and per-conversation, can be set to "never").
- **Secondary resume mechanism:** Owner/admin manually taps "Turn AI Back On."
- Return to prior_state after validity check (§3.1 Rule 2).
- AI resumes naturally. No customer-facing "AI is back" message is sent.
- If there is a pending action or reason to proactively reach out, AI does so. Otherwise AI waits for the customer's next message.
- New timers start fresh per §3.2 rules.
- All old queue rows are permanently dead. Fresh automations created based on current state and time.

## 3.4 Restoration lock

- The system must never auto-resume to a state that no longer has a valid backing record.
- The system must never resurrect old queue rows. Always create fresh ones.
- The system must never restart a stale timer mid-cadence. Always restart from the beginning of the cadence if the dependency still exists.
- Admin always has the option to override the default restoration target and pick a different state.

---

# Authority statement

This supplement is binding alongside the core authority documents, Blueprint Patch v5, and Blueprint Patch v6. If implementation requires a decision not covered here, the answer should be derived from the existing authorities in this order: Blueprint Patch v6 → Patch v5 Addendum → Patch v5 → this supplement → Dashboard App Specification → Unified State Authority → Merged Trigger Authority → Communications Rules → Source of Truth → Neutral/Ambiguous Authority → Capabilities → Prohibitions → Onboarding Questionnaire.
