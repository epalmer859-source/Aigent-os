**Communications OS**

**Neutral and Ambiguous Customer Response Authority**

Implementation document aligned to the current live state, trigger,
source-of-truth, and communications authorities.

  -----------------------------------------------------------------------
  **Document use**  This document defines how the AI must handle neutral,
                    ambiguous, non-committal, or partial customer
                    responses without creating false confirmation, false
                    approval, or false workflow progress.
  ----------------- -----------------------------------------------------
  **Alignment       This document must remain consistent with the Unified
  rule**            State Authority, Merged Trigger Authority, Source of
                    Truth map, Communications Rules, and approved
                    onboarding answers / business configuration. It does
                    not create new primary states, new trigger families,
                    or new source-of-truth categories. When any older
                    state, timing, or post-job wording conflicts with the
                    live merged authorities, the live merged authorities
                    win.

  -----------------------------------------------------------------------

# 1. Core authority rule

-   A neutral, ambiguous, partial, or non-committal customer response
    does not by itself satisfy a required input, approve a quote,
    confirm a booking, confirm appointment access readiness, finalize a
    cancellation, finalize a reschedule, or resolve a waiting state.

-   Customer wording remains evidence, not final business truth. If an
    operational change requires official app truth, admin approval,
    appointment record change, quote approval, or another stored side
    record, the AI must not treat neutral wording as completion or
    confirmation.

-   This authority governs what the AI should do next: either ask one
    immediate clarification question when the missing answer is required
    now, or remain in the correct current state and let the normal
    timing/check-back system handle later follow-up.

# 2. Definitions

-   Neutral acknowledgment: a customer reply that shows receipt or
    courtesy but does not answer the needed question or make a business
    decision. Examples: "got it," "okay," "thanks," "sounds good,"
    "alright," "cool."

-   Non-commitment acknowledgment: a customer reply that shows they are
    not ready to approve, confirm, or proceed yet. Examples: "still
    thinking," "I'll check," "let me ask my spouse," "I'll get back to
    you," "not sure yet."

-   Ambiguous response: a customer reply that may relate to the workflow
    but is too unclear to safely classify as approval, decline,
    confirmation, or completed answer. Examples: "maybe," "probably,"
    "later," "I guess so," "we'll see."

-   Partial response: a customer reply that answers only part of a
    blocked question set while required data is still missing.

# 3. Global decision ladder

-   Step 1 --- Check the current primary state and the exact missing
    decision or missing input.

-   Step 2 --- Determine whether the neutral or ambiguous reply actually
    resolves that specific missing item. If not, treat it as unresolved.

-   Step 3 --- If the missing answer is required to safely continue
    right now, the AI may ask one immediate clarification question
    focused only on the unresolved item.

-   Step 4 --- If the missing answer is not required for immediate legal
    progression, the AI should remain in the correct current state and
    allow the normal timing authority to control later check-back
    behavior.

-   Step 5 --- Neutral language never creates false confirmation. The
    system may not promote the thread to a stronger state, mark a side
    record resolved, or imply that the customer approved something
    unless the customer clearly did so or official app truth exists.

# 4. Immediate clarification vs later check-back

# If a customer gives a neutral, ambiguous, or non-committal response that does not validly answer the required question, the AI may send one immediate clarification attempt focused only on the missing item.

# If the customer still does not provide a valid answer, the requirement remains unconfirmed, the workflow does not advance, and the thread remains in its current controlling workflow or waiting state. Later check-back follows the normal timing rules of that existing workflow, unless a stronger rule already controls. This rule does not override quote non-commitment stop behavior, high-risk manual-only override behavior, or appointment-change confirmation requirements.

  ------------------------------------------------------------------------------
  **Rule path**           **When it applies**     **Examples**
  ----------------------- ----------------------- ------------------------------
  Ask one immediate       Use when the AI is      waiting_on_customer_details,
  clarification now       blocked on a            waiting_on_photos customer
                          customer-answerable     completion wording,
                          requirement needed for  appointment access-readiness
                          legal next-step         confirmation when the customer
                          progress right now.     replied but did not actually
                                                  answer,
                                                  cancellation/reschedule intake
                                                  that still lacks required
                                                  reason or preference detail.

  Do not force another    Use when the customer   quote_sent after
  live push now; wait and has acknowledged the    non-commitment acknowledgment;
  let normal timing       message but did not     waiting_on_admin_quote;
  authority handle later  make a commitment and   waiting_on_admin_scheduling;
  follow-up               the workflow does not   waiting_on_approval; other
                          require an immediate    staff-owned waiting where the
                          live clarification to   next action belongs to the
                          stay safe.              business, not the customer.

  Stop active follow-up   Use when the current    quote_sent after "still
  and leave the thread    workflow specifically   thinking," "let me ask my
  alone until the         says non-commitment     spouse," "got it thanks," or
  customer says something should stop the ladder  similar non-confirmation.
  new                     rather than keep        
                          nudging.                
  ------------------------------------------------------------------------------

# 5. Workflow-specific authority

## 5.1 waiting_on_customer_details and other customer-answerable blocked states

-   If the customer gives a neutral or ambiguous reply that does not
    answer the required missing question, the state remains
    waiting_on_customer_details or the equivalent blocked routine state.
    The AI may not act as though the required information exists.

-   The AI may ask one immediate clarification question targeted only at
    the missing item. That clarification should be narrow, not a full
    workflow restart.

-   If the customer still does not answer after the clarification, the
    thread remains blocked and the routine follow-up ladder applies from
    the latest unanswered AI question under the timing authority.

-   A partial answer resolves only the part actually answered. Any
    still-missing required input keeps the thread blocked.

## 5.2 waiting_on_photos and customer_done_sending collection flows

-   Neutral acknowledgments such as "okay," "got it," or "thanks" do not
    count as customer_done_sending.

-   If the AI needs explicit completion confirmation before packaging
    and sending the information to admin, it may ask one immediate
    clarification such as asking whether the customer is finished
    sending everything.

-   Until the customer clearly confirms completion, the system must not
    treat the package as final and must not act as though media
    collection is complete.

## 5.3 quote_sent

-   A neutral or non-commitment acknowledgment after an approved quote
    has been sent does not count as approval, booking, decline, or scope
    confirmation.

-   If the reply is a non-commitment acknowledgment --- for example
    "still thinking," "let me ask my spouse," "I'll check," "got it
    thanks," or similar non-confirmation --- the quote follow-up ladder
    stops permanently and the thread is left alone until the customer
    says something new.

-   The AI may answer normal quote questions immediately if the customer
    asks them, but it may not turn neutral wording into quote acceptance
    or booking intent.

## 5.4 booking_in_progress

-   If the customer responds neutrally while the AI is collecting
    scheduling preference and job-package details, the system must check
    whether the required intake item was actually answered.

-   If the neutral reply did not provide the required scheduling
    preference or other mandatory detail, the AI may ask one immediate
    clarification question for that exact missing item.

-   Neutral wording never counts as appointment confirmation. Customer
    preference is not booking confirmation even when the preference
    itself is clear.

## 5.5 waiting_on_admin_scheduling

-   Once the full job package is already with admin, a neutral customer
    acknowledgment does not change the state and does not trigger
    another live clarification unless the customer adds new information
    that matters.

-   The correct response is usually a short acknowledgment if needed,
    then remain in waiting_on_admin_scheduling and let the staff-owned
    waiting logic govern later check-back behavior.

-   The AI may not interpret "okay," "sounds good," or similar wording
    as a booked appointment or as permission to imply a final time.

## 5.6 waiting_on_admin_quote, waiting_on_approval, waiting_on_parts_confirmation

-   In staff-owned waiting states, neutral customer responses do not
    restart or override the internal waiting cadence unless the customer
    actually gives new relevant information.

-   If the customer asks a real follow-up question, the AI may answer
    only within approved source-of-truth limits or relay that the team
    is checking. If the customer gives only neutral acknowledgment,
    remain in the same waiting state.

-   For waiting_on_parts_confirmation specifically, neutral wording does
    not count as confirmed parts understanding, confirmed ETA, or
    confirmed price acceptance.

## 5.7 appointment reminders, attendance, and access readiness

-   A neutral reply to the 24-hour reminder such as "okay" or "thanks"
    does not count as confirmed attendance/access readiness unless the
    customer clearly answered the bundled access/availability question.

-   If the customer responded but did not actually confirm whether
    someone will be onsite or whether access details are ready, the AI
    may ask one immediate clarification focused only on that missing
    readiness point.

-   If the customer then goes quiet, the system does not create a
    separate extra access-readiness campaign beyond what the timing
    authority already allows. The normal reminder structure remains in
    control.

## 5.8 cancellation and reschedule intake

-   Neutral wording does not finalize a cancellation or reschedule
    request. The AI must still collect the required reason and any
    required preference details according to the approved workflow.

-   If the customer's reply is ambiguous or partial, the AI may ask one
    immediate clarification question to complete the request intake.

-   Only after the request details are complete and accepted may the
    system create the official appointment_change_request or
    recurring_service_change_request side-record status needed for
    suppression behavior.

## 5.9 override and high-risk states

-   In legal_threat_open, safety_issue_open, incident_liability_open,
    and hostile_customer_open, neutral replies do not reopen routine
    dialogue or restart customer-facing stale reassurance.

-   The AI should follow the high-risk handoff rule already defined
    elsewhere: one policy-safe handoff response with the company phone
    number if required by the applicable authority, then manual-only
    customer-facing follow-up until admin handles it.

-   Neutral wording inside these states does not downgrade the override
    or restore routine automation.

# 6. Examples that must classify as neutral or non-commitment unless clearer context exists

  -----------------------------------------------------------------------
  **Response pattern**                **Default treatment**
  ----------------------------------- -----------------------------------
  "okay"                              Do not treat as approval, booking
                                      confirmation, completed answer, or
                                      resolved waiting state unless
                                      surrounding context clearly
                                      supplies that meaning.

  "got it"                            Do not treat as approval, booking
                                      confirmation, completed answer, or
                                      resolved waiting state unless
                                      surrounding context clearly
                                      supplies that meaning.

  "thanks"                            Do not treat as approval, booking
                                      confirmation, completed answer, or
                                      resolved waiting state unless
                                      surrounding context clearly
                                      supplies that meaning.

  "sounds good"                       Do not treat as approval, booking
                                      confirmation, completed answer, or
                                      resolved waiting state unless
                                      surrounding context clearly
                                      supplies that meaning.

  "cool"                              Do not treat as approval, booking
                                      confirmation, completed answer, or
                                      resolved waiting state unless
                                      surrounding context clearly
                                      supplies that meaning.

  "alright"                           Do not treat as approval, booking
                                      confirmation, completed answer, or
                                      resolved waiting state unless
                                      surrounding context clearly
                                      supplies that meaning.

  "I'll check"                        Do not treat as approval, booking
                                      confirmation, completed answer, or
                                      resolved waiting state unless
                                      surrounding context clearly
                                      supplies that meaning.

  "let me think about it"             Do not treat as approval, booking
                                      confirmation, completed answer, or
                                      resolved waiting state unless
                                      surrounding context clearly
                                      supplies that meaning.

  "I'll ask my wife / husband /       Do not treat as approval, booking
  family"                             confirmation, completed answer, or
                                      resolved waiting state unless
                                      surrounding context clearly
                                      supplies that meaning.

  "maybe"                             Do not treat as approval, booking
                                      confirmation, completed answer, or
                                      resolved waiting state unless
                                      surrounding context clearly
                                      supplies that meaning.

  "probably"                          Do not treat as approval, booking
                                      confirmation, completed answer, or
                                      resolved waiting state unless
                                      surrounding context clearly
                                      supplies that meaning.

  "later"                             Do not treat as approval, booking
                                      confirmation, completed answer, or
                                      resolved waiting state unless
                                      surrounding context clearly
                                      supplies that meaning.

  "I guess so"                        Do not treat as approval, booking
                                      confirmation, completed answer, or
                                      resolved waiting state unless
                                      surrounding context clearly
                                      supplies that meaning.
  -----------------------------------------------------------------------

# 7. Implementation note for AI and rules engine

-   The model may help classify the wording, but the final effect must
    be rules-based. The system should decide whether the response counts
    as confirmation by checking the current workflow, the exact missing
    item, and source-of-truth requirements.

-   When uncertain, the safe default is: do not promote the workflow, do
    not invent commitment, and either ask one narrow clarification now
    or remain in the current state and let the approved timing logic
    handle later follow-up.

-   This document does not create a new generic state such as
    waiting_on_customer_response. Existing specific waiting states and
    routine/quote/staff-owned timing rules remain in control.

# 8. Final lock sentence

**Authority lock.** Neutral, ambiguous, non-committal, and partial
customer responses must be interpreted conservatively. They do not
create approval, confirmation, completion, or state resolution unless
the customer clearly provided that result or official app truth already
exists.
