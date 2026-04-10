  -----------------------------------------------------------------------
  **Document use**      This single document replaces the separate
                        Trigger Logic and Trigger Timing authority files.
                        It preserves their surviving rules, retires
                        superseded trigger language, and serves as the
                        trigger source of truth for engineering,
                        automations, and dashboard behavior.
  --------------------- -------------------------------------------------
  **Alignment rule**    This authority must remain consistent with the
                        canonical states, state-transition authority,
                        final state logic, source-of-truth map,
                        communications rules, neutral-response authority,
                        and onboarding answers. Triggers remain triggers;
                        side records remain side records; exactly one
                        primary state controls a thread at a time.

  **Supersession note** Earlier open items around routine second/final
                        timing, review reminders, stale internal cadence,
                        and reactivation are now resolved here.
                        Reactivation is disabled in this version. Review
                        flow is replaced by one post-job closeout message
                        only.
  -----------------------------------------------------------------------

# 1. Core trigger authority rules

**•** Trigger logic is state-driven. The current primary state, plus any
controlling side records, must be checked before any timer fires or any
queued message is allowed to send.

**•** Trigger logic answers when the system acts, when it waits, when it
alerts, when it pauses, when it suppresses, and when it stops.

**•** Customer preference is not appointment confirmation. Appointment
timing, booked status, completion, dispatch, and assignment must come
from the official app record or approved sync path, not from customer
wording alone.

**•** Only one active customer-facing workflow may control non-urgent
outbound messaging on a thread at a time. If a stronger workflow starts,
weaker queued messages must be suppressed, merged, or deferred.

**•** Override triggers outrank routine triggers. Human takeover and
override states interrupt routine automation immediately unless a
narrower higher-priority operational message is separately authorized.

**•** Routine triggers should feel professional, not robotic or spammy.
Quiet-hours protections apply to AI-initiated non-urgent outbound
reach-back, while live replies and live call answering may still happen
at any hour.

**•** The trigger engine should always read the current state first,
then apply trigger timing, then check for override conditions before
sending any outbound communication.

# 2. Trigger families

  -----------------------------------------------------------------------
  **Family**           **Meaning**
  -------------------- --------------------------------------------------
  Routine workflow     Intake, follow-up, reminders, notifications, and
  triggers             normal workflow progression.

  Waiting-state        Rules that keep the system paused until customer
  triggers             info, staff input, approval, or operational data
                       arrives.

  Active-service       Scheduling, reminders, dispatch, assignment,
  triggers             on-the-way notices, live-job coordination, and
                       post-job closeout.

  Override /           Complaints, hostility, legal threats, safety
  escalation triggers  issues, billing disputes, restricted topics,
                       liability, insurance or regulatory review, vendor
                       disputes, and human takeover.

  Control triggers     Pause, suppression, resume, duplicate prevention,
                       reset logic, state-change cancellation,
                       quiet-hours deferral, and owner-controlled
                       toggles.
  -----------------------------------------------------------------------

# 3. Master timing summary

  -----------------------------------------------------------------------------------------------------------------
  **Workflow /   **Start / trigger**             **Customer-facing       **Internal    **Stop / cancel condition**
  timer**                                        sends**                 alerts**      
  -------------- ------------------------------- ----------------------- ------------- ----------------------------
  Missed-call    Missed call when live AI call   Fallback send at 2      None unless   Cancel once fallback sends,
  fallback       answering is off                minutes; if voicemail   business      the thread changes, or a
                                                 arrives in that window, config        human/live reply resolves
                                                 use voicemail           separately    the event
                                                 understanding/context   logs          
                                                                         missed-call   
                                                                         events        

  Routine        AI asked a customer-answerable  1st at 8 hours; final   None          Cancel on customer reply,
  silence        question and customer went      at 24 hours after the                 state change, stronger
  follow-up      quiet                           first; max 2 total;                   workflow, human takeover,
                                                 both quiet-hours safe                 do-not-contact, or closure

  Quote          Approved quote delivered and    1st at 24 hours after   None          Cancel on customer approval,
  follow-up      customer goes quiet             quote sent; final at 3                customer question,
  after                                          days after quote sent;                non-commitment
  quote_sent                                     max 2 total                           acknowledgment, state
                                                                                       change, stronger workflow,
                                                                                       override, or closure

  Appointment    Official booked appointment     24-hour reminder with   None          Suppress immediately when
  reminders      exists                          attendance/access                     appointment_change_request
                                                 request bundled in;                   is accepted and routed,
                                                 3-hour same-day                       appointment changes,
                                                 reminder                              stronger workflow takes
                                                                                       over, or thread state blocks
                                                                                       reminders

  Post-job       Official completion record      One closeout text only: None          Blocked by closeout-blocking
  closeout       exists                          thank-you or completion               states or human takeover; no
                                                 confirmation + Google                 reminder chain
                                                 review link + business                
                                                 preferred phone number                

  Staff-owned    Next required action belongs to 6-hour customer update, Immediate     Cancel immediately once
  stale waiting  internal owner / team /         then every 12 hours     internal ping blocker resolves, is
  (normal)       dashboard department            while unresolved        at entry; 6h; replaced, is suppressed, or
                                                                         12h; then     thread state changes
                                                                         every 12h     
                                                                         while         
                                                                         unresolved    

  Staff-owned    waiting_on_parts_confirmation   6-hour update; 24-hour  Immediate     Cancel immediately once
  stale waiting  or equivalent parts-owned       update; no automatic    internal ping parts answer / ETA / status
  (parts         dependency                      repeating customer      at entry; 6h; is confirmed or control
  subtype)                                       cadence after that      12h; then     changes
                                                                         every 12h     
                                                                         while         
                                                                         unresolved    
                                                                         unless        
                                                                         business      
                                                                         narrows it    
                                                                         later         

  Photo / info   AI requests photos or details   Event-based only:       Package sends No hard max; timing is
  collection     for quote, issue, complaint,    customer sends info and to            completion-based, not
                 damage review, or similar       later sends DONE        responsible   timer-based
                 admin-reviewed need                                     team only     
                                                                         after DONE;   
                                                                         if more info  
                                                                         later, wait   
                                                                         for DONE      
                                                                         again and     
                                                                         resend        
  -----------------------------------------------------------------------------------------------------------------

# 4. Call-answering and missed-call trigger logic

**•** Default operating mode is live AI call answering. Normal
missed-call fallback exists only when the business has manually turned
live AI call answering off.

**•** The owner/admin must have a manual control to turn AI call
answering off at any time.

**•** If live AI call answering is off and a call is missed, hold for 2
minutes, then send the missed-call fallback.

**•** If the caller leaves a voicemail during that 2-minute hold window,
the fallback must use the voicemail content as response context instead
of acting like no context exists.

**•** The delay exists to let voicemail finish, let voicemail
transcription or summary arrive first if available, and avoid instantly
texting while the customer is still leaving a message.

# 5. General routine follow-up trigger logic

**•** This ladder applies only when the AI asked a question the customer
can answer themselves and the customer went silent. It is not quote
silence, not staff delay, and not a substitute for internal stale
waiting.

**•** First routine follow-up: 8 hours after the AI asked the question.

**•** Final routine follow-up: 24 hours after the first routine
follow-up.

**•** Max routine follow-ups: 2 total.

**•** After the final routine follow-up, stop unless the customer
replies or a different legal workflow takes over.

**•** If the message that created the waiting period was sent within
the 6 hours before the business's configured quiet_hours_start, the
next routine follow-up waits until 1 hour after opening time on the
next business day. (Default quiet_hours_start = 10:00 PM, so the
default weird-hours window begins at 4:00 PM. Configurable per
business in Settings > AI Behavior.)

**•** No non-urgent routine follow-up may send during the business's
configured quiet hours (default 10:00 PM – 6:00 AM local business
time, configurable per business, minimum 6-hour window required).

# 6. Quote follow-up trigger logic

**•** This ladder applies only after an approved quote has already been
delivered and the thread is in the quote_sent family.

**•** First quote follow-up: 24 hours after quote sent.

**•** Second and final quote follow-up: 3 days after quote sent.

**•** Max quote follow-ups: 2 total. No third quote follow-up in the
active quote cycle.

**•** If a quote follow-up would land in the weird-hours window, wait
until 1 hour after opening time on the next business day.

**•** If the customer replies with approval, booking intent, or normal
questions, continue the deal normally under the appropriate next
workflow.

**•** If the customer replies with non-commitment acknowledgment such as
still thinking, waiting on spouse/family approval, I will check, or got
it thanks, the quote follow-up ladder stops permanently and the thread
is left alone until the customer says something new.

**•** If pricing, owner approval, quote build, or internal pricing
confirmation is still pending and the quote has not yet been sent, the
thread stays in staff-owned waiting and follows stale timing for the
responsible internal owner or department.

# 7. Appointment reminder and appointment-change trigger logic

**•** Next-day reminder: 24 hours before appointment.

**•** Attendance/access confirmation request is bundled inside the
24-hour reminder.

**•** Same-day reminder: 3 hours before appointment.

**•** No separate access-readiness message may send if that ask is
already inside the 24-hour reminder.

**•** Once an accepted cancellation or reschedule request is created and
routed to the business, all reminders tied to the existing appointment
suppress immediately, even if staff has not yet updated the calendar.

**•** If staff fails to update the calendar, booking record, or
requested-bookings/dashboard workflow after a valid appointment-change
request has been routed, that is an internal operations responsibility
and does not revive the old appointment timeline messages.

**•** Recommended operational ceiling retained from the earlier trigger
document: do not exceed the bundled 24-hour ask plus the 3-hour same-day
final nudge for appointment-confirmation behavior in this version.

# 8. Post-job closeout trigger logic

**•** There is one closeout message only. No review reminder chain, no
3-day review reminder, and no post-job drip sequence.

**•** Trigger: the official completion record must show the job or
appointment as completed in the app or approved completion sync path.
Customer wording alone cannot trigger closeout.

**•** Message content: short thank-you or completion confirmation,
Google review link from onboarding, and the company preferred phone
number from onboarding for any future questions or issues about that
completed job.

**•** After that message, all routine ties on that completed job are
done unless the customer reaches back out with a new service request or
a new legally valid issue opens a new workflow.

**•** If the job is not officially marked complete, the AI must remain
silent rather than continue post-appointment messaging.

**•** Closeout-blocking states still suppress closeout if an open
complaint, unresolved issue, billing dispute, safety issue,
incident-liability issue, or comparable negative service signal is open
on the thread. Any active override state blocks closeout.

# 9. Staff-owned stale waiting authority

**•** Staff-owned stale waiting applies whenever the next required
action belongs to the business rather than the customer.

**•** This includes scheduling review, owner approval, pricing review,
quote build, special request review, policy answer review, complaints or
escalations review, billing review, permit or regulatory review, parts
confirmation, and any other internal queue that must act before the AI
can continue.

**•** Stale alerts route to the specific dashboard department, queue, or
closest matching internal owner responsible for the next required
action. They do not default to a fake generic admin bucket unless admin
is actually the responsible owner.

**•** At entry: immediate internal ping to the responsible dashboard
department, queue, or internal owner.

**•** Normal staff-owned cadence: at 6 hours unresolved, internal ping
plus short customer confirmation; at 12 hours unresolved, internal ping
plus short customer confirmation; after 12 hours unresolved, repeat
internal ping plus short customer confirmation every 12 hours until
resolved, canceled, suppressed, or state-changed.

**•** Customer reassurance exists to acknowledge that the business is
checking internally without making false promises or fake ETAs. Messages
must stay short and non-promissory.

**•** High-risk override waiting does not use the customer-facing stale
reassurance ladder when the thread is controlled by legal_threat_open,
safety_issue_open, incident_liability_open, or hostile_customer_open.

**•** On those high-risk threads, the AI may send the initial
policy-safe handoff response when the override opens, including the
preferred phone number from onboarding, and then further unresolved
customer communication becomes owner/admin/manual unless a narrower
policy-approved operational message is separately authorized.

**•** Parts subtype: customer updates at 6 hours unresolved and 24 hours
unresolved, then no automatic repeating customer reassurance cadence
after that unless a real parts update, confirmed ETA, or state change
occurs.

**•** The moment the blocking dependency is resolved, all stale
reminders tied to that exact dependency cancel immediately, including
internal pings, customer reassurance updates, subtype-specific stale
timers, and any future queued reminders tied to the same unresolved
dependency.

# 10. Photo and information collection trigger logic

**•** There is no hard maximum on customer photos, files, or added text
for quotes, complaints, incident review, damage review, or similar
staff-reviewed workflows.

**•** The AI should ask clearly for whatever photos or information are
needed and explain what helps the business move faster or review the
issue properly.

**•** The customer may send as many photos, files, and text details as
needed.

**•** The controlling trigger is completion confirmation, not a timer or
a file-count cap.

**•** The AI should explicitly tell the customer: Send everything you
would like to include, and just let me know when you are done so I
can get it all over to the team.

**•** DONE detection is intent-based, not string-matching. The AI
classifies whether the customer's message indicates they are finished
sending materials. Examples that count as DONE: "DONE," "done,"
"that's everything," "that's all I have," "all set," "I'm done,"
"that's it," "nothing else to add." Examples that do NOT count:
"okay," "thanks," "got it," "sounds good," "alright," "cool." If the
response is ambiguous (e.g. "I think so," "probably"), the AI asks one
clarification: "Just to confirm — is that everything you'd like to
send, or do you have more to add?"

**•** Only after the customer clearly confirms completion may the
package be sent to the responsible team or department.

**•** If the customer adds more later, the AI accepts it, waits for DONE
again, then sends the updated package again and confirms the team will
review it.

# 11. Count thresholds and locked trigger ceilings

**•** Aggressive or highly emotional messages in a row before immediate
handoff: 2.

**•** Allowed de-escalation attempts before routing: 1.

**•** Second real-person request: immediate transfer / handoff behavior.

**•** Max quote follow-ups: 2 total.

**•** Max incomplete-intake follow-ups in this version: default ceiling
2, aligned to the routine-silence ladder rather than an open-ended drip.

**•** Appointment-confirmation nudges should remain limited to the
bundled 24-hour reminder plus the 3-hour same-day final nudge when that
behavior is legally allowed.

**•** Max photo requests as a strict hard count is not used for customer
submission workflows because the system uses completion-confirmation
logic instead.

**•** Reactivation reminders are disabled in this version. No
reactivation start timing, ladder, or dormant-customer nudge may run
unless the blueprint is intentionally amended later.

# 12. Owner takeover and override trigger behavior

**•** Owner or admin takeover is thread-scoped only, not company-scoped.

**•** When the owner/admin takes over a conversation, only that exact
conversation thread pauses AI replies, pending AI messages, and
thread-linked automation.

**•** Other customers, other threads, other jobs, and the rest of the
company system continue operating normally.

**•** AI resumes when the takeover timer expires (default 7 days,
configurable globally and per-conversation) or when the owner/admin
manually re-enables AI. On resume, AI picks up naturally — proactively
reaching out if there is a pending action, otherwise waiting for the
customer's next message. No "AI is back" notification is sent to the
customer.

**•** Override triggers that pause routine logic immediately include
complaints and negative job mentions, legal threats, safety-critical or
dangerous situations, billing disputes and hostile payment
conversations, incident liability after service, restricted or
admin-only topics, out-of-radius or owner-approval-only requests,
insurance or permit/regulatory review, vendor disputes, and human
takeover.

# 13. Reset, cancellation, suppression, and anti-spam control logic

**•** Only one primary customer-facing workflow should actively control
non-urgent outbound routine messaging on a thread at a time.

**•** If a stronger or later-stage workflow becomes active, weaker or
older routine workflows on that same thread must be canceled or
suppressed.

**•** When multiple workflow candidates exist on the same thread,
precedence runs from strongest to weakest as: human takeover; override
or escalation flow; active-service communication; quote follow-up;
general routine follow-up; post-job closeout; reactivation (disabled in
this version).

**•** Any queued outbound message tied to a previous state must be
canceled if the primary state changes before that message sends.

**•** When the customer replies, any queued silence-based nudge tied to
the old silence window cancels and the timeline recalculates from the
new message and current controlling state.

**•** The system may not send two customer-facing messages on the same
thread that serve the same purpose in the same active workflow step.

**•** No quote follow-up and general silence follow-up for the same
unresolved quote decision.

**•** No separate access-readiness message if that ask is already inside
the 24-hour reminder.

**•** No review-related send if the customer already reviewed,
acknowledged, complained, or reopened the issue.

**•** No stale-waiting customer nudge if a stronger customer-facing
workflow message already covered that same need.

**•** No thread may receive more than 2 non-urgent outbound AI messages
in any rolling 24-hour period, regardless of how many separate workflows
are technically eligible. Bundled content counts as one message.

**•** The rolling 24-hour cap does not block truly urgent or
operationally necessary messages such as confirmed schedule-change
notifications, confirmed dispatch notices, owner-approved live-job
updates, or legally required notices, but even those exceptions should
still avoid duplicate or contradictory messaging.

# 14. Quiet-hours authority

**•** Quiet-hours restrictions apply only to AI-initiated non-urgent
outbound messages.

**•** No non-urgent reminder, follow-up, closeout ask, stale reassurance
nudge, or similar AI-initiated reach-back message may send during the
business's configured quiet hours (default 10:00 PM – 6:00 AM local
business time, configurable per business in Settings > AI Behavior,
minimum 6-hour window required).

**•** Quiet-hours do not block live responses to customer-initiated
inbound contact. If a customer calls, texts, or otherwise reaches out
during quiet hours, the AI may respond normally during that same window.

**•** Urgent operational messages and genuine safety, legal, or override
handling may still send during quiet hours when required.

**•** If valid next opening time cannot be determined from onboarding
hours, closure settings, or business-hours configuration, non-urgent
deferred outbound messages release at the configured quiet_hours_end
on the next non-blocked day (default 6:00 AM).

## 14.1 Relationship between quiet hours and weird-hours deferral

**•** Quiet hours and weird-hours deferral are one combined timing
protection system, not competing rules. Both use the business's
configured quiet_hours_start and quiet_hours_end.

**•** Weird-hours deferral is the upstream prevention: if the AI's last
question or message that started a waiting period was sent within the
6 hours before the business's configured quiet_hours_start, the next
routine follow-up defers to 1 hour after opening time on the next
business day.

**•** Quiet hours is the hard backstop: no non-urgent AI-initiated
outbound message may send during the configured quiet hours window
regardless of any other rule.

**•** When both apply, use the later release time. The stricter
result always wins.

# 15. Implementation notes

**•** Capabilities answer what the AI may do in ordinary communication.
Rules answer what the AI may not do and what must be escalated, handed
off, logged, or restricted. State logic answers what stage the
conversation is in and what actions are legal. This document answers
what events cause action and when.

**•** Routine timing rules may become owner-adjustable later only if the
blueprint intentionally introduces configurable settings. High-risk
override triggers, legal/safety/liability handling, thread-only takeover
behavior, and current hard-locked cadences remain locked until formally
amended.

**•** The trigger source of truth in engineering should be a single
transactional pipeline: read current state and side records, evaluate
trigger family and precedence, cancel invalidated queue rows, create
only legal new queue rows, and then send only after a fresh pre-send
suppression check.

**•** Queued outbound messages tied to a previous state must be canceled
when the primary state changes before send time.

**•** Business hours and closures from onboarding define opening time
for quiet-hours deferral and next-business-day timing. Google review
link and preferred phone number come from onboarding. Booking,
appointment change, dispatch, parts status, and completion truth come
from the source-of-truth map and official app records.

# 16. Legacy items retired by this merged version

  -----------------------------------------------------------------------
  Retired / superseded items preserved for audit clarity: the earlier
  separate Trigger Logic file left the second/final routine timing open,
  contained a review reminder chain, treated reactivation as
  configurable, and used a simpler immediate / 12-hour / 24-hour
  stale-admin pattern. This merged authority intentionally replaces those
  points with the hard-locked rules above: routine silence = 8 hours then
  24 hours later, post-job closeout = one message only, reactivation =
  disabled, and staff-owned stale waiting = immediate internal ping with
  customer-facing cadence beginning at 6 hours unresolved.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

  -----------------------------------------------------------------------
  Authority note: this merged document should be treated as the single
  trigger source of truth. The former Trigger Logic and Trigger Timing
  files should be archived or marked superseded so no worker, dashboard
  action, or AI build process reads stale trigger language by mistake.
  -----------------------------------------------------------------------

  -----------------------------------------------------------------------

# 17. Auto-close timer

**•** Conversations in non-closed states with no customer or admin
activity for 30 days (configurable per business via auto_close_days)
are automatically closed to closed_lost.

**•** The auto-close timer resets on any inbound customer message,
outbound AI message, or admin action.

**•** Auto-close cancels all pending queue rows for the conversation.

**•** If the customer contacts again after auto-close, a new
conversation is created with a new matter_key and the repeat_customer
tag.

# 18. Additional suppression rules

**•** Global business pause (is_paused = true) suppresses ALL
non-pause outbound messages across all conversations for that business.

**•** is_no_show = true on a conversation suppresses ALL outbound
messages for that thread — no closeout, no follow-up, no automation.

**•** consent_status = opted_out on a customer suppresses ALL outbound
to that customer across all conversations until they re-subscribe via
new inbound contact.

**•** Hard safety rate limit: no more than 10 outbound messages per
phone number per hour regardless of purpose, to prevent bugs from
blasting a customer.

**•** Voice call max duration: 15 minutes. AI wraps up gracefully at
14 minutes and follows up via SMS with a summary and next steps.
