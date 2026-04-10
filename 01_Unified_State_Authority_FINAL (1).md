Communications OS\
Unified State Authority

Merged and corrected state catalog, operating logic, transitions,
precedence, post-job closeout rules, and implementation-sync notes.

Document use: This single authority replaces the separate State
Transition Authority and Final State Logic documents.

Alignment rule: It must remain consistent with the source-of-truth map,
communications rules, neutral ambiguity authority, onboarding answers,
the merged trigger authority, and official app records.

Change note: review_requested is retired as a primary state. Post-job
handling is one closeout message only, triggered only after the official
appointment/job completion record exists.

  -----------------------------------------------------------------------
  **What this doc locks** **What it retires**     **What downstream docs
                                                  must mirror**
  ----------------------- ----------------------- -----------------------
  Canonical states,       review_requested as a   Engineering enum/state
  meanings, allowed       state; separate         lists, queue
  actions, legal exits,   review-flow state       message_purpose naming,
  blocked transitions,    behavior; stale review  post-job suppression
  precedence, pause       reminder wording that   wording, and any
  rules, and required     conflicts with one      review-era schema
  metadata.               closeout only.          examples.

  -----------------------------------------------------------------------

# 1. Authority use and hard alignment rules

-   Exactly one primary conversation state controls a thread at a time.

-   Only the canonical conversation states listed in this document may
    be stored as conversation.primary_state.

-   Triggers such as human_requested, human_requested_repeat,
    negative_job_mention, and customer_done_sending are not states.

-   Appointment change requests, cancellations, appointment statuses,
    quote statuses, dispatch statuses, approval statuses, escalation
    categories, and thread ownership remain on their own objects and
    registries.

-   Customer preference is not booking confirmation. Customer wording is
    evidence, not final business truth. Official appointment timing,
    dispatch, assignment, and completion come from the app record or
    another approved sync path.

-   Human takeover is an absolute thread-specific pause. When
    human_takeover_active controls the thread, AI stops replies,
    reminders, follow-ups, closeout messages, and other automation on
    that exact thread until human control is removed.

-   One active customer-facing workflow may control a thread at a time.
    Stronger or later-stage workflows suppress weaker ones on the same
    thread.

-   Queued outbound messages tied to a previous state must be canceled
    when the primary state changes before send time.

-   A customer reply resets silence-based timers and cancels queued
    nudges tied to the old silence window.

-   The system must not send two customer-facing messages on the same
    thread that serve the same purpose in the same active workflow step.

-   No more than two non-urgent outbound AI messages may send on the
    same thread in any rolling 24-hour period, except for operationally
    required notices and staff-only override alerts.

# 2. What changed in this unified revision

-   State Transition Authority and Final State Logic are merged here and
    should no longer exist as separate authority sources.

-   review_requested is retired as a primary conversation state because
    the blueprint now uses one post-job closeout message only, not a
    separate review-flow state or reminder chain.

-   job_completed remains a valid active-service state, but its
    downstream post-job path is now: official completion record -\>
    optional single closeout if legally allowed -\> closed_completed or
    resolved.

-   Older review-era wording such as review flow, review reminder, or
    review_requested should be treated as stale unless it explicitly
    refers to the content of the single closeout message.

-   If a dedicated suppression flag is still needed in code, replace
    review_blocked with closeout_blocked or a broader
    post_job_closeout_blocked flag. Do not keep review-era names as if a
    separate review workflow still exists.

# 3. Canonical primary conversation states

These are the only values that may control the main conversation state.

  --------------------------------------------------------------------------------
  **Code**                         **Family**              **Meaning / when used**
  -------------------------------- ----------------------- -----------------------
  new_lead                         Routine                 Brand-new inquiry that
                                                           has not yet been fully
                                                           classified or
                                                           qualified.

  lead_qualified                   Routine                 Lead fits services,
                                                           service area, and
                                                           general business rules
                                                           well enough to move
                                                           forward.

  booking_in_progress              Routine                 AI is collecting
                                                           scheduling preference
                                                           and the full job
                                                           package for admin
                                                           review.

  quote_sent                       Routine                 Approved quote or
                                                           pricing response has
                                                           been delivered and the
                                                           customer is deciding.

  lead_followup_active             Routine                 Valid lead has gone
                                                           quiet and approved
                                                           routine follow-up is
                                                           active.

  waiting_on_customer_details      Waiting                 Required customer
                                                           information is missing
                                                           before the workflow can
                                                           continue.

  waiting_on_photos                Waiting                 Photos or other media
                                                           are required before
                                                           clean continuation.

  waiting_on_admin_quote           Waiting                 Quote intake is
                                                           complete but staff must
                                                           review and provide the
                                                           pricing response.

  waiting_on_admin_scheduling      Waiting                 Full job package has
                                                           been sent to admin and
                                                           the scheduling decision
                                                           is pending.

  waiting_on_parts_confirmation    Waiting                 Active-job answer
                                                           depends on
                                                           staff-confirmed parts
                                                           status, compatibility,
                                                           pricing, or ETA.

  waiting_on_approval              Waiting                 Request cannot be
                                                           finalized without
                                                           explicit human
                                                           approval.

  booked                           Active service          Appointment exists and
                                                           the customer has been
                                                           told it is on the
                                                           schedule.

  reschedule_in_progress           Active service          An existing appointment
                                                           is being moved to a new
                                                           date/time.

  tech_assigned                    Active service          Company has confirmed
                                                           who is taking the job,
                                                           but they are not yet en
                                                           route.

  en_route                         Active service          Technician or crew is
                                                           confirmed to be on the
                                                           way.

  job_in_progress                  Active service          Work is live and active
                                                           mid-visit.

  job_paused                       Active service          Active job cannot
                                                           continue until a
                                                           dependency clears.

  job_completed                    Active service          Admin or owner manually
                                                           marked the job complete
                                                           in the app or approved
                                                           completion sync path.

  complaint_open                   Override                Dissatisfaction, poor
                                                           workmanship, incomplete
                                                           work, damage, or
                                                           another complaint now
                                                           controls the thread.

  billing_dispute_open             Override                Conversation centers on
                                                           a fee dispute, refund
                                                           issue, or billing
                                                           conflict.

  safety_issue_open                Override                Dangerous-condition
                                                           language controls the
                                                           thread.

  legal_threat_open                Override                Customer threatens
                                                           legal action or
                                                           equivalent legal
                                                           escalation.

  incident_liability_open          Override                Conversation concerns
                                                           post-service damage or
                                                           liability.

  insurance_review_open            Override                Insurance question,
                                                           claim context, or
                                                           adjuster coordination
                                                           is involved.

  permits_regulatory_review_open   Override                Permits, code,
                                                           licensing, inspections,
                                                           or regulatory status
                                                           now controls the
                                                           thread.

  vendor_dispute_open              Override                Vendor, subcontractor,
                                                           supplier, or
                                                           outside-party dispute
                                                           is involved.

  restricted_topic_open            Override                Request falls into
                                                           admin-only or otherwise
                                                           restricted-topic
                                                           handling.

  hostile_customer_open            Override                Hostility/aggression
                                                           pattern now controls
                                                           the thread.

  human_takeover_active            Override                Human owns the thread
                                                           and AI must stop
                                                           communicating on it.

  resolved                         Closed                  Conversation or issue
                                                           has been fully handled
                                                           and no active workflow
                                                           remains.

  closed_unqualified               Closed                  Request does not fit
                                                           the company and will
                                                           not proceed.

  closed_lost                      Closed                  Valid lead did not
                                                           convert or withdrew.

  closed_completed                 Closed                  Service and closeout
                                                           path are fully complete
                                                           with no open issue.
  --------------------------------------------------------------------------------

## Retired or remapped labels

-   review_requested - retired as a primary conversation state. The
    single post-job closeout message is a trigger/message-purpose
    outcome, not its own state.

-   appointment_confirmation_pending - not a primary state; keep it in
    appointment/reminder logic only.

-   reschedule_requested - retired as a primary state; use
    reschedule_in_progress for the thread and keep the request itself on
    appointment_change_request.

-   cancellation_requested - not a primary state; keep it on
    appointment_change_request instead.

-   job_scheduled - retired as a duplicate of booked unless a future
    blueprint creates a truly separate meaning.

-   waiting_on_customer_response - too vague; use a specific waiting
    state instead.

-   waiting_on_admin_decision - too vague; split into
    waiting_on_admin_quote, waiting_on_admin_scheduling, or
    waiting_on_approval.

# 4. Global precedence order

  --------------------------------------------------------------------------------
  **Rank**                **State(s)**                     **Effect**
  ----------------------- -------------------------------- -----------------------
  **1**                   human_takeover_active            All AI communication
                                                           stops on the thread.

  **2**                   legal_threat_open                Outranks everything
                                                           except human takeover.

  **3**                   safety_issue_open                Outranks liability,
                                                           complaint, billing,
                                                           hostile, vendor,
                                                           active-service,
                                                           waiting, and routine
                                                           states.

  **4**                   incident_liability_open          Outranks complaint,
                                                           billing, hostile,
                                                           vendor, active-service,
                                                           waiting, and routine
                                                           states.

  **5**                   complaint_open /                 Outrank all
                          billing_dispute_open /           active-service,
                          hostile_customer_open /          waiting, and routine
                          vendor_dispute_open              states.

  **6**                   restricted_topic_open /          Outrank active-service,
                          insurance_review_open /          waiting, and routine
                          permits_regulatory_review_open   flow when triggered.

  **7**                   waiting_on_approval              Approval gating
                                                           outranks routine flow
                                                           but is itself outranked
                                                           by restricted-topic and
                                                           all override states.

  **8**                   Active-service states            Outrank waiting and
                                                           routine states.

  **9**                   Waiting states                   Outrank routine states.

  **10**                  Routine states                   Default operating
                                                           family.

  **11**                  Closed / post-job states         Terminal or archival
                                                           endpoints.
  --------------------------------------------------------------------------------

Correction note: blame/fault remains an escalation category, not a
primary conversation state and not a precedence row.

## 4.1 Intra-rank tie-breaking

When two override states at the same precedence rank trigger
simultaneously, the first one detected wins. The other is recorded as
an escalation_category on the escalation record and as a conversation
tag. Both conditions are surfaced to admin in the handoff summary.
Admin can manually change the primary override state if they determine
the other condition is more important. This tie-breaking rule applies
only within the same rank. Cross-rank priority always follows the
precedence table above.

# 5. Universal rules, triggers, and side records

## Universal rules that apply before any state block

-   Universal override interrupt rule: Any valid override trigger may
    move the thread immediately from any non-override state into the
    matching override state, even if that exit is not individually
    restated inside a state block.

-   Human-request rule: human_requested is a trigger, not a state. The
    AI may attempt the one policy-approved retention step once. If the
    customer refuses, create the required handoff and move to
    human_takeover_active when human control begins.

-   Repeat human-request rule: human_requested_repeat skips retention
    entirely and forces immediate handoff behavior.

-   Cancellation-state rule: a customer cancellation request does not
    create a separate conversation state. The thread stays in its
    current active-service state while appointment_change_request
    controls suppression behavior. Once appointment_change_request
    reaches accepted_from_customer or later, appointment reminders
    and related timeline messaging for that appointment suppress
    immediately even before admin finalizes the booking record.

-   Warranty / callback / guarantee fallback rule: if the policy is not
    present in onboarding or stored settings, treat it as unconfirmed,
    create the admin handoff, tell the customer the team is gathering
    the answer, and route to restricted_topic_open until the approved
    answer exists or human takeover occurs.

## Triggers that force movement but are not states

-   negative_job_mention - immediately forces complaint_open unless a
    stronger override already outranks it.

-   human_requested - customer asks for a real person or manager for the
    first time. One-time retention step may be attempted.

-   human_requested_repeat - customer asks again for a human after
    hearing the one-time retention message. Immediate handoff is
    required.

-   customer_done_sending - customer confirms they are finished sending
    photos or details. This controls when the package may be sent to
    admin/team.

## Side records that matter but do not replace the primary state

-   thread_owner tracks whether AI, admin/team, owner, or human takeover
    currently owns communication.

-   appointment_status tracks booked, canceled, rescheduled, completed,
    or no-show.

-   dispatch_status tracks en_route, delayed, arrived, or on_site.

-   quote_status tracks intake_open, under_review, approved_to_send,
    sent, accepted, declined, superseded, or withdrawn.

-   approval_status tracks pending, approved, or denied.

-   appointment_change_request controls accepted cancellation/reschedule
    workflow status and reminder suppression.

-   escalation_category and escalation_status control urgent-issue
    handling, queueing, and audit history.

# 6. Routine states

## new_lead

**Family:** Routine

**Meaning:** A brand-new conversation starts and the request has not yet
been classified or qualified.

**AI may do:** Greet, identify intent, collect name/contact/service
basics, and determine whether the request is routine, estimate-first,
restricted, or risky.

**AI may not do:** Assume service type, promise availability, jump
straight to pricing, or ignore early risk signals.

**Typical entry triggers:** New inbound SMS, call, email, chat,
missed-call response, or a returning customer with a genuinely new
request.

**Legal exits / transitions:** lead_qualified;
waiting_on_customer_details; closed_unqualified; or any valid override
through the universal override interrupt rule.

**Blocked transitions:** May not jump directly to booked, quote_sent,
job_in_progress, job_completed, or closed_completed.

**Automation posture:** Active intake allowed.

**Primary source connection:** Capabilities first; immediately defer to
override rules if the content triggers them.

## lead_qualified

**Family:** Routine

**Meaning:** Enough intake is complete to confirm the lead fits the
business.

**AI may do:** Explain next steps, move toward booking or quote flow,
ask only remaining required questions, and keep momentum.

**AI may not do:** Generate unapproved pricing, skip owner-approval
gates, or keep re-qualifying the same lead unnecessarily.

**Typical entry triggers:** Contact, service, location, and fit are
clear enough to move forward.

**Legal exits / transitions:** booking_in_progress;
waiting_on_admin_quote; waiting_on_photos; waiting_on_customer_details;
waiting_on_approval; closed_unqualified; closed_lost; or a valid
override.

**Blocked transitions:** May not skip to booked without
booking_in_progress then waiting_on_admin_scheduling; may not skip to
quote_sent without waiting_on_admin_quote.

**Automation posture:** Routine progression active.

**Primary source connection:** Capabilities for qualification,
service-area fit, and process explanation.

## booking_in_progress

**Family:** Routine

**Meaning:** The AI is collecting scheduling preference and the full job
package for admin review.

**AI may do:** Ask for preferred day, preferred window, flexibility,
address, urgency, access notes, and other required job-package details;
send the full package to admin.

**AI may not do:** Promise a time, treat preference as confirmation,
invent availability, or bypass admin-mediated scheduling.

**Typical entry triggers:** Lead is qualified and the next correct step
is to collect scheduling preference plus the full package.

**Legal exits / transitions:** waiting_on_admin_scheduling;
waiting_on_customer_details; waiting_on_photos; waiting_on_approval;
closed_lost; or a valid override.

**Blocked transitions:** May not jump to booked; customer preference is
not confirmation.

**Automation posture:** No pause by default.

**Primary source connection:** Capabilities scheduling section,
constrained by the rules document and source-of-truth map.

## quote_sent

**Family:** Routine

**Meaning:** An approved quote or pricing response has already been
delivered and the customer is deciding.

**AI may do:** Answer routine follow-up questions inside approved
information, clarify process, and move toward acceptance if the customer
is ready.

**AI may not do:** Renegotiate, modify pricing, guess additional scope
cost, or act like approval exists when it does not.

**Typical entry triggers:** An admin-approved quote was delivered and
quote_status = sent.

**Legal exits / transitions:** booking_in_progress;
lead_followup_active; waiting_on_admin_quote if scope changed
materially; closed_lost; or a valid override.

**Blocked transitions:** May not jump to booked without
booking_in_progress then waiting_on_admin_scheduling; may not jump to
job_completed.

**Automation posture:** Quote follow-up rules remain active under
trigger limits.

**Primary source connection:** Approved quote record, quote status, and
trigger authority.

## lead_followup_active

**Family:** Routine

**Meaning:** A valid lead has gone quiet and approved routine follow-up
is active.

**AI may do:** Send only the legal routine follow-up ladder, continue
intake if the customer re-engages, and preserve the prior qualification
context.

**AI may not do:** Ignore quiet-hours, exceed count caps, or keep
chasing after closure or stronger workflow takeover.

**Typical entry triggers:** A valid lead has gone quiet after
quote_sent, incomplete intake, or missed booking response.

**Legal exits / transitions:** lead_qualified; booking_in_progress;
quote_sent; closed_lost; or any valid override.

**Blocked transitions:** May not jump to booked, job_in_progress, or
job_completed.

**Automation posture:** No pause, but outreach must stay inside trigger
limits and anti-spam rules.

**Primary source connection:** Trigger authority plus state-driven
routine workflow rules.

# 7. Waiting states

## waiting_on_customer_details

**Family:** Waiting

**Meaning:** Required customer information is missing before the
workflow can continue.

**AI may do:** Ask narrow clarifying questions, wait legally, and return
to the blocked routine flow once the missing item is provided.

**AI may not do:** Act as though required information exists or advance
booking/quote flow while the missing data is still absent.

**Typical entry triggers:** Required address, service type, timing
preference, contact detail, property type, or another mandatory input is
missing.

**Legal exits / transitions:** Return to the blocked routine state;
lead_followup_active if customer goes quiet; plus any valid override.

**Blocked transitions:** May not advance to booked, quote_sent, or
job_completed while required data is missing.

**Automation posture:** Yes. Dependent booking and quoting actions
pause.

**Primary source connection:** Intake requirements, neutral-ambiguity
authority, and trigger timing rules.

## waiting_on_photos

**Family:** Waiting

**Meaning:** Photos or other media are required before clean
continuation.

**AI may do:** Request only the needed media, explain what helps the
team review faster, and wait for customer_done_sending before treating
the package as complete.

**AI may not do:** Treat neutral acknowledgments as completion or
advance to quote or booking flow while required media is still missing
unless the business rules explicitly remove the requirement.

**Typical entry triggers:** Media is required before quote flow, booking
flow, or issue-review flow can continue.

**Legal exits / transitions:** Return to the blocked flow once media is
complete; plus any valid override.

**Blocked transitions:** May not advance to quote_sent or booked while
required media is missing unless business rules explicitly remove the
requirement.

**Automation posture:** Yes.

**Primary source connection:** Photo/info collection authority,
neutral-ambiguity authority, and state machine rules.

## waiting_on_admin_quote

**Family:** Waiting

**Meaning:** Quote intake is complete but staff must review and provide
the pricing response.

**AI may do:** Acknowledge that the team is reviewing, relay only
confirmed admin responses, and let stale internal timing chase the
responsible owner.

**AI may not do:** Generate, guess, or relay price before staff provides
it; may not jump to booked.

**Typical entry triggers:** All required quote details are gathered and
staff review is pending.

**Legal exits / transitions:** quote_sent; booking_in_progress if scope
changed; closed_lost; plus any valid override.

**Blocked transitions:** AI may not generate, guess, or relay price
before staff provides it; may not jump to booked.

**Automation posture:** Yes. Price-specific automation pauses and
stale-admin reminders may fire.

**Primary source connection:** Quote source of truth plus stale waiting
rules.

## waiting_on_admin_scheduling

**Family:** Waiting

**Meaning:** Full job package has been sent to admin and the scheduling
decision is pending.

**AI may do:** Tell the customer the request is with the team and relay
only the officially approved appointment details once staff places the
appointment.

**AI may not do:** Promise, suggest, or imply a time; customer
preference is not a booking.

**Typical entry triggers:** AI has collected customer preference and
sent the full job package to admin; scheduling decision is pending.

**Legal exits / transitions:** booked; waiting_on_approval; plus any
valid override.

**Blocked transitions:** AI may not promise, suggest, or imply a time.
No booking confirmation or appointment reminders until admin actually
sets the appointment.

**Automation posture:** Yes.

**Primary source connection:** Appointment source-of-truth rule and
admin scheduling workflow.

## waiting_on_parts_confirmation

**Family:** Waiting

**Meaning:** Active-job answer depends on staff-confirmed parts status,
compatibility, pricing, or ETA.

**AI may do:** Acknowledge the hold, collect relevant context, and relay
only confirmed parts information from staff.

**AI may not do:** Promise stock, compatibility, supplier timing, or
job-related parts cost without live confirmation.

**Typical entry triggers:** Customer asks about parts status,
compatibility, availability, pricing, or ETA on an active job and live
staff confirmation is required.

**Legal exits / transitions:** job_in_progress; job_paused; plus any
valid override.

**Blocked transitions:** AI may not promise stock, compatibility,
supplier timing, or job-related parts cost without live confirmation.

**Automation posture:** Yes.

**Primary source connection:** Parts source-of-truth rule and parts
stale subtype timing.

## waiting_on_approval

**Family:** Waiting

**Meaning:** The request cannot be finalized without explicit human
approval.

**AI may do:** Collect only the information needed for the approval
request, acknowledge that approval is pending, and route the matter to
the correct approver.

**AI may not do:** Act as though approval exists or finalize the outcome
while approval is still pending.

**Typical entry triggers:** Out-of-radius request, owner-only slot,
restricted job type, courtesy exception, or another approval-gated
scenario.

**Legal exits / transitions:** Return to the blocked routine or
active-service state after approval; closed_unqualified if denied; plus
any valid override or restricted_topic_open if the matter is actually
restricted rather than merely approval-gated.

**Blocked transitions:** May not finalize the request while approval is
pending.

**Automation posture:** Yes.

**Primary source connection:** Approval gates, onboarding rules, and
precedence order.

# 8. Active-service states

## booked

**Family:** Active service

**Meaning:** An official appointment exists and the customer has been
told it is on the schedule.

**AI may do:** Relay confirmed appointment details, send approved
reminders, and continue normal pre-visit coordination.

**AI may not do:** Treat customer preference alone as booking truth or
continue the old appointment timeline after an accepted
appointment-change request has been routed.

**Typical entry triggers:** Admin places the appointment in the official
app record or another approved sync path and the customer is told the
confirmed time.

**Legal exits / transitions:** reschedule_in_progress; tech_assigned;
en_route; job_in_progress; job_completed through explicit operational
correction only; plus any valid override.

**Blocked transitions:** May not jump directly to job_completed without
passing through job_in_progress unless admin uses a separate explicit
operational correction process outside normal workflow logic.

**Automation posture:** Reminder and access-readiness flows are active
until suppressed by appointment_change_request or a stronger state.

**Primary source connection:** Appointment booking record and reminder
authority.

## reschedule_in_progress

**Family:** Active service

**Meaning:** An existing appointment is being moved to a new date/time.

**AI may do:** Collect the customer's preferred replacement details and
relay them to the team.

**AI may not do:** Offer specific replacement windows, invent
availability, or confirm a new time before admin sets it.

**Typical entry triggers:** Customer requests to move an existing
appointment and the booking record has been found.

**Legal exits / transitions:** booked with replacement time; booked with
original time if reschedule is abandoned; plus any valid override.

**Blocked transitions:** AI may not offer specific replacement windows,
invent availability, or confirm a new time before admin sets it.

**Automation posture:** Yes. Original appointment reminders suppress
once the change request reaches accepted_from_customer or later.

**Primary source connection:** Appointment change request record and
booking source of truth.

## tech_assigned

**Family:** Active service

**Meaning:** The company has confirmed who is taking the job, but they
are not yet en route.

**AI may do:** Relay confirmed technician assignment and operational
updates tied to that assignment.

**AI may not do:** Guess the assigned technician or speculate about who
caused a prior problem.

**Typical entry triggers:** Staff or the scheduling system assigns a
technician or crew to the appointment.

**Legal exits / transitions:** en_route; job_in_progress;
reschedule_in_progress; or any valid override.

**Blocked transitions:** AI may not guess the assigned technician or
speculate about who caused a prior problem.

**Automation posture:** No automation pause by default.

**Primary source connection:** Technician assignment must come from
confirmed admin-entered data.

## en_route

**Family:** Active service

**Meaning:** Technician or crew is confirmed to be on the way.

**AI may do:** Relay approved on-the-way notices or delay updates tied
to real operational data.

**AI may not do:** Invent movement, fake location, or promise
minute-level ETA without supported operational data.

**Typical entry triggers:** Staff marks the technician or crew en route
and dispatch_status = en_route.

**Legal exits / transitions:** job_in_progress; reschedule_in_progress;
job_paused through a valid delay/hold path; or any valid override.

**Blocked transitions:** AI may not invent movement, fake location, or
promise minute-level ETA without supported operational data.

**Automation posture:** No automation pause by default.

**Primary source connection:** Dispatch status and ETA rules.

## job_in_progress

**Family:** Active service

**Meaning:** Work is live and active mid-visit.

**AI may do:** Act as a controlled relay, collect relevant updates, help
with ordinary logistics, and preserve context for the active job.

**AI may not do:** Diagnose root cause, promise parts or timing without
confirmation, or skip directly into post-job closure.

**Typical entry triggers:** Staff marks on-site/in-progress or workflow
indicates active work is underway.

**Legal exits / transitions:** job_paused;
waiting_on_parts_confirmation; job_completed; or any valid override.

**Blocked transitions:** AI may not diagnose root cause, promise parts
or timing without confirmation, or skip directly to closed_completed.

**Automation posture:** Lead-generation and post-job closeout automation
pause while active work is open.

**Primary source connection:** Capabilities for live-job relay plus
rules for diagnosis, parts, and complaints during service.

## job_paused

**Family:** Active service

**Meaning:** An active job cannot continue until a dependency clears,
such as parts, access, weather, staff decision, or internal hold.

**AI may do:** Acknowledge the pause, preserve context, collect relevant
updates, and relay confirmed information from staff.

**AI may not do:** Invent restart timing or continue acting as though
normal progress is happening.

**Typical entry triggers:** Team marks work paused, parts delay occurs,
customer access blocks the job, weather stops work, or staff places the
job on hold.

**Legal exits / transitions:** job_in_progress;
waiting_on_parts_confirmation; job_completed; or any valid override.

**Blocked transitions:** AI may not invent restart timing or continue
acting as though normal progress is happening.

**Automation posture:** Automation stays paused while the active hold
exists.

**Primary source connection:** Active-service control plus
parts/access/weather hold logic.

## job_completed

**Family:** Active service

**Meaning:** The admin or owner manually marked the job complete in the
app or approved completion sync path. Customer wording alone cannot
create this state.

**AI may do:** Acknowledge completion-state context, keep the thread
clean, and allow only the downstream actions explicitly permitted by the
blueprint. The only routine post-job customer-facing automation that may
stem from this state is one closeout message.

**AI may not do:** Treat customer statements alone as completion truth,
request payment, send payment reminders, collect payment, create a
separate review-flow state, or send any reminder chain.

**Typical entry triggers:** Admin or owner manually marks the job
complete in the app, or an approved completion sync path writes the
official completion record. This is the only valid entry trigger.

**Legal exits / transitions:** closed_completed after the single legal
closeout path or direct manual close; resolved when staff closes the
matter with no remaining active workflow; complaint_open;
incident_liability_open; human_takeover_active.

**Blocked transitions:** AI may not send post-job closeout if any
active override state is present, human_takeover_active is present,
negative_service_signal tag exists, do_not_contact tag exists, or a
dedicated closeout_blocked/post_job_closeout_blocked flag is present.
Additionally, any state change away from job_completed before send time
cancels the queued closeout. AI may not request payment, send payment
reminders, or collect payment.

**Automation posture:** If admin has not marked complete, all post-job
automations remain paused. Once officially marked complete, one closeout
message becomes eligible only if no blocker exists. No review reminder
chain exists.

**Primary source connection:** Job-completion source-of-truth rule,
merged trigger authority, and owner-only payment workflow.

# 9. Override / escalation states

## complaint_open

**Family:** Override

**Meaning:** A complaint or negative service outcome now controls the
thread.

**AI may do:** Acknowledge the concern, collect only relevant details,
generate the required internal summary, and route urgently to staff.

**AI may not do:** Argue, minimize, blame, admit fault, or let routine
automation continue.

**Typical entry triggers:** Dissatisfaction, poor workmanship,
incomplete work, damage, or negative_job_mention unless a stronger
override outranks it.

**Legal exits / transitions:** human_takeover_active; resolved;
legal_threat_open; safety_issue_open; incident_liability_open;
hostile_customer_open.

**Blocked transitions:** May not return to routine or post-job closeout
flow while complaint is open.

**Automation posture:** Quote follow-up, reminders, closeout, and other
nonessential automation stop immediately.

**Primary source connection:** Complaint policy, negative job mention
trigger, and override rules.

## billing_dispute_open

**Family:** Override

**Meaning:** A fee dispute, refund issue, or billing conflict now
controls the thread.

**AI may do:** Stay calm, gather relevant facts, and hand off cleanly.

**AI may not do:** Resolve the dispute on the spot, promise credits,
refunds, or adjustments, or keep normal pursuit automation running.

**Typical entry triggers:** Refund issue, fee dispute, amount conflict,
cancellation-fee dispute, or billing challenge.

**Legal exits / transitions:** human_takeover_active; resolved;
hostile_customer_open; legal_threat_open.

**Blocked transitions:** May not return to routine flow while the
dispute is open.

**Automation posture:** Routine automation pauses.

**Primary source connection:** Billing-dispute policy and escalation
workflow.

## safety_issue_open

**Family:** Override

**Meaning:** Dangerous-condition language or emergency risk now controls
the thread.

**AI may do:** Acknowledge urgency, collect only essential details, and
route immediately.

**AI may not do:** Diagnose, give technical repair advice, or let normal
automation continue.

**Typical entry triggers:** Dangerous-condition language such as fire
risk, gas smell, exposed wiring, smoke, flooding, structural danger, or
equivalent.

**Legal exits / transitions:** human_takeover_active; resolved.

**Blocked transitions:** May not return to routine or active-service
flow while safety controls the thread.

**Automation posture:** Everything nonessential pauses and urgent human
handling is required.

**Primary source connection:** Safety and emergency handling rules.

## legal_threat_open

**Family:** Override

**Meaning:** Threats of legal action or equivalent legal escalation now
control the thread.

**AI may do:** Acknowledge receipt in the policy-safe way, route
immediately, and otherwise preserve evidence and history.

**AI may not do:** Debate, defend, admit fault, or offer settlement.

**Typical entry triggers:** Threats of legal action, lawyer references,
small claims, reporting, or equivalent legal escalation.

**Legal exits / transitions:** human_takeover_active; resolved.

**Blocked transitions:** May not return to routine, waiting, or
active-service flow while legal threat is open.

**Automation posture:** All nonessential communication pauses
immediately.

**Primary source connection:** Legal-escalation rules and override
precedence.

## incident_liability_open

**Family:** Override

**Meaning:** Post-service damage, property harm, unsafe outcome, or
liability language now controls the thread.

**AI may do:** Acknowledge the issue, gather only relevant facts, route
urgently, and preserve evidence.

**AI may not do:** Admit fault, explain causation, or promise repair or
compensation.

**Typical entry triggers:** Post-service damage, property harm, unsafe
outcome, or liability language.

**Legal exits / transitions:** human_takeover_active; legal_threat_open;
resolved.

**Blocked transitions:** May not return to routine flow while liability
is open.

**Automation posture:** Yes. Nonessential automation pauses.

**Primary source connection:** Liability rules and override precedence.

## insurance_review_open

**Family:** Override

**Meaning:** Insurance question, claim context, reimbursement context,
or adjuster coordination now controls the thread.

**AI may do:** Collect the minimum necessary context and hand off
cleanly.

**AI may not do:** Explain coverage, predict approval, discuss liability
on behalf of the insurer, or promise reimbursement.

**Typical entry triggers:** Insurance question, reimbursement question,
claim context, carrier/adjuster coordination, or insurance paperwork.

**Legal exits / transitions:** human_takeover_active; resolved;
complaint_open; legal_threat_open.

**Blocked transitions:** AI may not explain coverage, predict approval,
discuss liability on behalf of the insurer, or promise reimbursement.

**Automation posture:** Yes.

**Primary source connection:** Insurance/reimbursement restrictions.

## permits_regulatory_review_open

**Family:** Override

**Meaning:** Permit, code, licensing, inspection, or regulatory-status
issues now control the thread.

**AI may do:** Acknowledge the question and route it to the responsible
team.

**AI may not do:** Promise permit status, code compliance, license
validity, or inspection outcome.

**Typical entry triggers:** Permit, code, licensing, inspection, or
regulatory-status questions.

**Legal exits / transitions:** human_takeover_active; resolved;
complaint_open; legal_threat_open.

**Blocked transitions:** AI may not promise permit status, code
compliance, license validity, or inspection outcome.

**Automation posture:** Yes.

**Primary source connection:** Permit/regulatory restriction rules.

## vendor_dispute_open

**Family:** Override

**Meaning:** A vendor, subcontractor, supplier, or outside-party dispute
now controls the thread.

**AI may do:** Acknowledge the concern, preserve neutrality, and hand
off.

**AI may not do:** Mediate, pick a side, or speak on behalf of the
outside party.

**Typical entry triggers:** A vendor, subcontractor, supplier, or
outside-party dispute is raised.

**Legal exits / transitions:** human_takeover_active; resolved;
legal_threat_open; incident_liability_open.

**Blocked transitions:** AI may not mediate, pick a side, or speak on
behalf of the outside party.

**Automation posture:** Yes.

**Primary source connection:** Vendor-dispute restriction rules.

## restricted_topic_open

**Family:** Override

**Meaning:** An admin-only topic, prohibited handling area, or
unconfirmed policy fallback now controls the thread.

**AI may do:** Acknowledge the restriction, tell the customer the team
is gathering the answer, and hand off to the responsible owner.

**AI may not do:** Make decisions on restricted topics or act as though
AI is authorized to handle them.

**Typical entry triggers:** Restricted/admin-only topic detected,
manual-review requirement, or unknown warranty/callback/guarantee policy
requiring staff answer.

**Legal exits / transitions:** resolved; human_takeover_active;
waiting_on_approval only if the topic is no longer restricted and drops
into a pure approval hold.

**Blocked transitions:** AI may not make decisions on restricted topics
or act as if an unconfirmed policy has been established.

**Automation posture:** Override active; routine flow pauses.

**Primary source connection:** Restricted-topic policy plus the
warranty/callback fallback rule.

## hostile_customer_open

**Family:** Override

**Meaning:** Hostility or aggression now controls the thread.

**AI may do:** De-escalate once, stay neutral, log the behavior, and
hand off.

**AI may not do:** Argue, insult, keep engaging after the single allowed
de-escalation attempt, or continue normal automation.

**Typical entry triggers:** Two aggressive/highly emotional messages in
a row, hostility pattern, or hostile payment conversation.

**Legal exits / transitions:** human_takeover_active; resolved;
legal_threat_open.

**Blocked transitions:** May not return to routine flow while hostility
controls the thread; AI may de-escalate once, then route to team.

**Automation posture:** Override active; routine automation stops
immediately.

**Primary source connection:** Hostility and de-escalation rules.

## human_takeover_active

**Family:** Override

**Meaning:** Human now owns the thread and AI must stop communicating on
it. AI remains off for a configurable timer period (default 7 days),
then auto-resumes.

**AI may do:** Pause. Preserve history. Cancel pending AI-generated
messages for that thread. Log inbound customer messages during takeover.

**AI may not do:** Send any customer-facing reply, reminder, follow-up,
closeout message, or other automation on that thread while takeover is
active.

**Typical entry triggers:** Owner/admin turns AI off from the
dashboard, or the handoff sequence completes after a customer insists on
speaking with a human. Upon entry, customer receives one notification
that the team has paused AI communication and will reach out directly.

**Legal exits / transitions:** Any routine, waiting, active-service, or
closed state when the takeover timer expires or owner manually
re-enables AI; resolved when human closes the matter. AI resumes
silently with no customer-facing notification.

**Takeover timer:** Default 7 days, configurable globally in settings.
Owner can override per conversation. Can be set to any duration
including never (permanent takeover). Owner can turn AI back on early at
any time.

**During takeover:** Inbound customer messages are logged and owner is
notified (if notifications are on). Customer receives no auto-response.
Owner communicates directly through the app or via their own
phone/email.

**Blocked transitions:** AI may not send any outbound messages or
continue automation while this state is active.

**Automation posture:** Absolute pause. All pending AI-generated
messages and automations are canceled for the thread.

**Restoration:** When AI resumes, it picks up from the prior state
(validated per restoration rules). All old queue rows are dead — fresh
automations are created based on current state and current time. No
silence timers restart automatically. No AI is back message is sent.

**Primary source connection:** Conversation-control source-of-truth
rule and Dashboard App Specification takeover model.

# 10. Closed / terminal states

## resolved

**Family:** Closed

**Meaning:** The conversation or issue has been fully handled and no
active workflow remains.

**AI may do:** Archive outcome cleanly and remain silent until a
materially new matter begins.

**AI may not do:** Continue outreach or silently reopen without a new
trigger.

**Typical entry triggers:** Workflow finishes cleanly, or an
override/human-handled matter concludes with no pending dependency.

**Legal exits / transitions:** new_lead or another routine state only
when a materially new trigger starts a genuinely new matter.

**Blocked transitions:** May not continue outreach or silently reopen
without a new trigger.

**Automation posture:** Yes.

**Primary source connection:** Closed-state handling and archival logic.

## closed_unqualified

**Family:** Closed

**Meaning:** The request is not a fit for the company and will not
proceed.

**AI may do:** Close the matter cleanly and remain silent unless
materially new facts create a genuinely new lead.

**AI may not do:** Continue booking or quoting a rejected request.

**Typical entry triggers:** Request is out of scope, outside policy,
denied at approval, or otherwise not a fit.

**Legal exits / transitions:** new_lead only if materially new facts
later make the request valid.

**Blocked transitions:** May not continue booking or quoting a rejected
request.

**Automation posture:** Yes.

**Primary source connection:** Qualification rules and approval
outcomes.

## closed_lost

**Family:** Closed

**Meaning:** A valid lead did not convert, withdrew, chose another
company, or stopped responding after the allowed follow-up.

**AI may do:** End the matter cleanly and preserve history for future
genuinely new work.

**AI may not do:** Keep pursuing after closure or opt-out.

**Typical entry triggers:** Valid lead does not convert, withdraws,
chooses another company, or stops responding after allowed follow-up.

**Legal exits / transitions:** new_lead for a genuinely new inbound
matter.

**Blocked transitions:** May not keep pursuing after closure or opt-out.

**Automation posture:** Yes.

**Primary source connection:** Lead outcome tracking and trigger-count
limits.

## closed_completed

**Family:** Closed

**Meaning:** The service and closeout path are fully complete with no
open issue.

**AI may do:** Archive the finished job cleanly and reopen only when the
customer returns with materially new work.

**AI may not do:** Behave as though the finished job is still active.

**Typical entry triggers:** Job is complete, any single legal closeout
path is complete or intentionally skipped by staff, no open problems
remain, and no separate review-flow state exists.

**Legal exits / transitions:** new_lead with repeat_customer tag when
the customer returns with genuinely new work.

**Blocked transitions:** May not behave as though the finished job is
still active.

**Automation posture:** Yes.

**Primary source connection:** Post-job closeout rule and
finished-service archival logic.

# 11. Post-job completion and closeout rule

-   There is one closeout message only. No review reminder chain, no
    three-day review reminder, and no separate review_requested state.

-   Trigger: the official completion record must show the job or
    appointment as completed in the app or another approved completion
    sync path. Customer wording alone cannot trigger closeout.

-   Message content: short thank-you or completion confirmation, Google
    review link from onboarding, and the company's preferred phone
    number from onboarding for future questions or issues about that
    completed job.

-   After that message, all routine ties on that completed job are done
    unless the customer reaches back out with a new service request or a
    new legally valid issue opens a new workflow.

-   If the job is not officially marked complete, the AI must remain
    silent rather than continue post-appointment messaging.

-   The natural state path is job_completed -\> closed_completed after
    the single legal closeout path or direct staff/manual close.
    resolved remains available when staff closes the matter without any
    remaining active workflow.

# 12. Required metadata on every conversation

  -----------------------------------------------------------------------
  **Field**                           **Why it matters**
  ----------------------------------- -----------------------------------
  **primary_state**                   Exactly one value from the
                                      canonical state catalog.

  **secondary_tags**                  Context flags such as urgent,
                                      repeat_customer, photos_received,
                                      commercial,
                                      owner_approval_required,
                                      hostility_detected, do_not_contact,
                                      negative_service_signal, and - if
                                      you keep a dedicated post-job
                                      blocker - closeout_blocked.

  **prior_state**                     Last eligible non-override state so
                                      the system can resume properly
                                      after escalation or human takeover.

  **current_owner**                   Who is acting now: AI, admin/team,
                                      owner, or human_takeover.

  **last_human_action_needed**        What the team is being asked to do,
                                      if anything.

  **last_outbound_automation_sent**   Duplicate-prevention memory of the
                                      last automation purpose fired on
                                      the thread.

  **open_issue_flags**                Issue context such as complaint,
                                      safety, legal, billing, liability,
                                      do_not_contact, and any dedicated
                                      closeout blocker.

  **timestamp_markers**               Last customer reply, last AI reply,
                                      last admin reply, last state
                                      change, and other timing anchors
                                      needed by trigger logic.

  **is_no_show**                      Boolean. When true, AI sends zero
                                      messages on this thread. Set when
                                      admin marks a no-show.

  **human_takeover_expires_at**       When the takeover timer will fire.
                                      Null if not in takeover or set to
                                      never.

  **auto_close_at**                   When the conversation will auto-
                                      close due to silence. Calculated
                                      from last activity plus configured
                                      auto_close_days.
  -----------------------------------------------------------------------

# 12.1. Post-job no-show rule

-   If the appointment is marked as no_show, no closeout message is
    sent. The conversation moves to resolved silently. AI sends zero
    messages for that job going forward — no closeout, no follow-up,
    no automation of any kind.

# 12.2. Auto-close rule

-   Conversations in non-closed states with no customer or admin
    activity for 30 days (configurable per business via auto_close_days)
    are automatically closed to closed_lost.

-   If the customer contacts again after auto-close, a new conversation
    is created with a new matter_key and the repeat_customer tag.

-   The auto-close timer resets on any inbound customer message, outbound
    AI message, or admin action.

-   Auto-close cancels all pending queue rows for the conversation.

# 12.3. Global business pause rule

-   When businesses.is_paused = true, the AI responds to all inbound
    customer messages with the configured pause_message only.

-   No other automation, follow-up, reminder, or workflow action fires
    while the business is paused.

-   All pending non-urgent outbound messages across all conversations
    are canceled when pause activates.

-   When unpaused, AI resumes fresh. No old queue rows are resurrected.
    New timers begin only on new qualifying events.

# 13. Required downstream engineering sync notes

-   conversation_state enum: remove review_requested and keep the
    canonical set at 33 primary states.

-   CLOSED_STATES lists in code and docs: use \[resolved,
    closed_unqualified, closed_lost, closed_completed\].

-   outbound_queue.message_purpose examples: replace review_request with
    closeout. Keep closeout as the single post-job message purpose.

-   Schema and suppression examples: replace review-era wording such as
    review flow, review reminder, or review_requested with closeout or
    post-job closeout wording.

-   If a dedicated blocker flag is still needed in code, replace
    review_blocked with closeout_blocked or a broader
    post_job_closeout_blocked flag. Do not keep review-era names as if a
    separate review workflow still exists.

-   Mark Job Complete dashboard action: queue one closeout message only
    when legally eligible, then move toward closed_completed; do not
    model a separate review_requested state.

-   Any older comment, test, or migration that still says
    review_requested, review_request, or review reminder should be
    treated as stale and patched before implementation continues.

# 14. Final implementation notes

-   Do not store state logic as one giant paragraph blob. Store a
    catalog where each state has a code, family, meaning, allowed
    actions, blocked actions, pause rules, and legal exits.

-   Use the state machine to retrieve only the relevant slices of the
    capabilities and rules documents. Do not dump the entire rulebook
    into context every turn.

-   Closed states should stay explicit. A finished conversation should
    not remain in a live operational state forever.

-   This document replaces the former state pair as the single state
    authority source. If any older state wording conflicts with this
    file, this file wins.
