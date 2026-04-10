*Internal architecture reference for what wins when systems disagree.*

**Purpose.** This document defines the official source of truth for each
major data category in the app, what role each source plays, and what
the AI is allowed to rely on. Business-specific truth lives in the app
database. Platform-wide law starts in the master documents and is later
translated into code/config/runtime logic.

**Core principle.** If two systems disagree, the source listed here
wins. AI-generated summaries and extracted fields are helpers only
unless a category below explicitly says otherwise.

# Quick architecture split

-   Business-specific truth: stored in the app database/Supabase and
    changes per company.

-   Platform-wide truth: coded into the system or stored in
    platform-controlled config and applies to every business.

-   Operational tools like calendar can sync with the app, but they do
    not automatically outrank the app's official records unless this
    document says so.

# Source-of-truth table

  -------------------------------------------------------------------------------------------------
  **\#**     **Data category**   **Source of truth**    **AI may speak from **Notes / conflict
                                                        it?**               rule**
  ---------- ------------------- ---------------------- ------------------- -----------------------
  1          Onboarding          App database /         Yes                 Covers company setup
             answers + business  Supabase                                   entered at onboarding:
             details                                                        business name,
                                                                            contacts, hours,
                                                                            service area, business
                                                                            rules, onboarding
                                                                            answers, and later
                                                                            settings edits.

  2          Fixed pricing and   Separate pricing table Yes, if marked      Dedicated price/fee
             fees                in the same database   shareable           records win over old
                                                                            messages, notes, or
                                                                            memory.

  3          Custom quotes       Latest admin-approved  Yes, after approval Old quote versions and
                                 quote record in the                        message fragments do
                                 app                                        not win once a newer
                                                                            approved record exists.

  4          Customer time       Customer intake record Yes, as preference  Preference is not
             preference          in the app             only                confirmation. It
                                                                            informs scheduling but
                                                                            does not equal a booked
                                                                            time.

  5          Final appointment   Appointment record /   Yes                 Final status values
             status              calendar-linked                            such as booked,
                                 booking record in the                      canceled, rescheduled,
                                 app after admin                            completed, or no-show
                                 processing                                 are controlled by the
                                                                            appointment record.
                                                                            Customer messages
                                                                            remain evidence, but
                                                                            they do not by
                                                                            themselves finalize the
                                                                            booking state.

  6          Calendar            Synced operational     Indirectly          Useful for ops and
                                 scheduling tool /                          sync, but not top-level
                                 mirror                                     business truth. The
                                                                            app's booked
                                                                            appointment record
                                                                            remains the official
                                                                            internal record.

  7          Appointment change  Appointment change     Yes, as request     Once this record
             request / reminder  request record created receipt and         reaches
             suppression         in the app when the AI workflow status     accepted_from_customer
                                 accepts a customer                         or later, all
                                 cancellation or                            appointment-related
                                 reschedule request                         reminders,
                                                                            attendance/access
                                                                            reminders, and timeline
                                                                            reminders tied to the
                                                                            existing appointment
                                                                            are suppressed
                                                                            immediately. The
                                                                            accepted request
                                                                            controls suppression
                                                                            behavior even if admin
                                                                            has not yet updated the
                                                                            calendar or final
                                                                            appointment record.

  8          Recurring service / Recurring service      Yes                 Recurring service
             recurring visit     record and the linked                      remains operationally
             status              recurring visit record                     active based on the
                                 in the app                                 current recurring
                                                                            service and visit
                                                                            status unless a
                                                                            cancellation request
                                                                            has been completed
                                                                            through the approved
                                                                            workflow. Casual
                                                                            customer wording or
                                                                            ambiguous messages do
                                                                            not stop recurring
                                                                            reminders or change
                                                                            recurring status by
                                                                            themselves. Only after
                                                                            the customer asks to
                                                                            cancel, gives a reason,
                                                                            confirms it, and the AI
                                                                            sends the confirmed
                                                                            request to admin do
                                                                            reminders and timeline
                                                                            messaging for that
                                                                            recurring appointment
                                                                            get suppressed
                                                                            immediately. Until that
                                                                            accepted request
                                                                            exists, recurring
                                                                            reminders continue
                                                                            normally.

  9          Conversation        Full raw message log   Yes                 Raw logs win over
             history             in the app/dashboard                       summaries for what was
                                                                            actually said.
                                                                            Owner/admin can view
                                                                            them in dashboard logs.

  10         Conversation        Conversation control   Yes, behaviorally   AI owns customer
             control / thread    state in the app for                       communication by
             ownership           that specific customer                     default. If the owner
                                 thread                                     turns AI off for that
                                                                            specific customer
                                                                            thread, human takeover
                                                                            becomes the active
                                                                            control state for that
                                                                            thread only. Once human
                                                                            takeover is active, AI
                                                                            must pause immediately
                                                                            for that thread and may
                                                                            not send replies,
                                                                            reminders, follow-ups,
                                                                            or other automation on
                                                                            it until AI is turned
                                                                            back on for that same
                                                                            thread. The owner may
                                                                            then contact the
                                                                            customer directly using
                                                                            the phone number or
                                                                            contact details visible
                                                                            in the logs. Raw logs
                                                                            remain the evidence of
                                                                            what was said, but the
                                                                            conversation control
                                                                            state determines who is
                                                                            currently allowed to
                                                                            communicate.

  11         Urgent escalations  Formal escalation      Yes, behaviorally   Raw message logs remain
                                 record in the Urgent /                     the evidence for what
                                 Escalations department                     was said. The
                                 inside the app, with a                     escalation record
                                 required typed                             controls operational
                                 category and linked                        handling, priority,
                                 override state                             routing, suppression
                                                                            behavior, and current
                                                                            status. Each urgent
                                                                            record must include a
                                                                            typed category from the
                                                                            canonical list:
                                                                            complaint, legal_threat,
                                                                            safety_issue,
                                                                            billing_dispute,
                                                                            insurance_issue,
                                                                            permit_regulatory_issue,
                                                                            hostile_customer,
                                                                            damage_liability_incident,
                                                                            vendor_dispute,
                                                                            restricted_topic,
                                                                            scope_dispute,
                                                                            contract_interpretation,
                                                                            blame_fault, or
                                                                            internal_staff_issue.

  12         Job completion      Admin-completed job    Yes, after          Post-job closeout
                                 record in the app.     completion is       workflows become
                                 Calendar sync may      recorded            eligible only after
                                 support it, but admin                      admin marks the job
                                 completion in the app                      complete in the app. If
                                 is the official usable                     admin does not mark the
                                 system truth.                              job complete, AI should
                                                                            still remain silent on
                                                                            that completed service
                                                                            thread rather than
                                                                            continuing
                                                                            post-appointment
                                                                            messaging. Missing
                                                                            completion may prevent
                                                                            closeout flow, but it
                                                                            does not justify
                                                                            further customer
                                                                            outreach.

  13         Payment management  Payment management     No, not for payment After each completed
             / owner payment     record in the app,     collection or       job, the system creates
             follow-up readiness populated from the     reminder outreach   or updates a Payment
                                 completed job record                       Management entry
                                 and linked                                 containing: customer
                                 customer/job details                       name, phone number,
                                                                            email if available, job
                                                                            description, job date,
                                                                            service address if
                                                                            relevant, amount due if
                                                                            tracked, payment
                                                                            status, completion
                                                                            date, and linked
                                                                            conversation or job
                                                                            record. This is what
                                                                            appears in the Payment
                                                                            Management tab for the
                                                                            owner. The owner
                                                                            handles payment
                                                                            requests and payment
                                                                            reminders manually from
                                                                            the dashboard. The AI
                                                                            does not request
                                                                            payment, send payment
                                                                            reminders, or collect
                                                                            payment. Raw logs
                                                                            remain evidence, but
                                                                            the payment management
                                                                            record is the
                                                                            operational source of
                                                                            truth for whether a
                                                                            completed job is
                                                                            waiting for owner
                                                                            payment follow-up.

  14         Dispatch / en route Status update clicked  Yes, after status   AI may not invent
             / delayed / arrived by staff/admin inside  update              same-day movement or
                                 the app                                    ETA. Staff/app status
                                                                            wins.

  15         Technician          Admin-entered          Yes, only when      The AI may name the
             assignment /        technician assignment  explicitly present  technician only if the
             technician identity on the calendar                            admin explicitly
                                 booking record, or the                     entered the technician
                                 synced                                     name in the booking
                                 booking-assignment                         record. If no
                                 field in the app if                        technician name is
                                 the calendar data is                       present, the AI may not
                                 mirrored into the app                      guess, infer, or imply
                                                                            an assignment. Old
                                                                            messages, summaries,
                                                                            prior jobs, or internal
                                                                            notes do not override
                                                                            the current booking
                                                                            assignment.

  16         Parts availability  Admin-confirmed        Yes, after admin    If no admin answer
             / parts ETA / parts response entered in    answer              exists, AI must say the
             pricing             the Parts section of                       team is checking.
                                 the app                                    ETA/timeline is
                                                                            required if part is not
                                                                            available yet.

  17         Customer identity / Channel-based identity Yes, with           Examples: phone number
             returning contact   key tied to            confirmation if     for SMS/calls, email
             history             logs/history in the    ambiguous           for email, captured
                                 app                                        identifier for
                                                                            web/chat. Matching
                                                                            identifier means
                                                                            returning-history
                                                                            context unless
                                                                            ambiguity requires
                                                                            confirmation.

  18         Services offered /  Business config in the Yes                 Onboarding/config truth
             exclusions / scope  app database                               wins. Website-connected
                                                                            service data may
                                                                            support it; if the AI
                                                                            is unsure, it routes to
                                                                            the Services
                                                                            department.

  19         Emergency rules /   Business config +      Yes                 If the business did not
             after-hours         emergency settings in                      provide enough detail,
             handling            the app DB                                 coded platform
                                                                            defaults/fallback rules
                                                                            apply.

  20         Warranty / callback Stored warranty /      Yes, if stored;     If a stored policy
             / satisfaction      callback /             otherwise only      exists, AI may speak
             policy              satisfaction policy in after admin         from it. If no
                                 the app DB. If none is response            warranty, callback, or
                                 stored, the fallback                       satisfaction policy is
                                 source of truth is the                     listed in onboarding or
                                 admin response                             stored settings, AI
                                 requested through the                      must not invent one. It
                                 dashboard.                                 must immediately notify
                                                                            admin, tell the
                                                                            customer it will gather
                                                                            information and get
                                                                            back to them as soon as
                                                                            possible, and wait for
                                                                            the admin-owned answer
                                                                            before stating the
                                                                            policy.

  21         Post-job closeout   Post-job workflow      Yes, when eligible  Post-job closeout flow
             link + instructions record/process in the                      becomes eligible only
                                 app DB, triggered                          after admin marks the
                                 after admin-completed                      job complete in the app
                                 job status is recorded                     and no blocking issue
                                                                            state exists. If
                                                                            completion is never
                                                                            recorded, AI stays
                                                                            silent rather than
                                                                            continuing post-job
                                                                            outreach.

  22         Tone / always-say / Prompt context /       Yes                 Stored communication
             never-say /         business config in the                     rules win. AI should
             language rules      app DB                                     not improvise outside
                                                                            them.

  23         Platform guardrails Platform-level rules   Always enforced     Universal and
             / general AI safety in system config /                         trade-specific
             instructions        codebase / runtime                         guardrails override
                                 logic                                      business preferences if
                                                                            there is a conflict.

  24         Industry-specific   Industry-specific      Yes                 Business-specific
             intake logic        onboarding answers                         industry answers win
                                 stored in the app DB                       first, then stored
                                                                            intake pack logic, then
                                                                            universal fallback if
                                                                            needed.

  25         Universal rules /   Master platform        System-controlled   Applies to every
             platform            documents now; later                       business and cannot be
             prohibitions /      translated into                            overridden by
             trigger definitions platform                                   company-specific
             / state definitions code/config/database                       preferences.
                                 logic                                      

  26         Admin approvals     Explicit approval      Yes, after approval If approval is
                                 record inside the app                      required, no approval
                                                                            record means no
                                                                            booking/confirmation.
                                                                            AI may explain pending
                                                                            review but cannot
                                                                            pretend approval
                                                                            happened.

  27         AI-generated        Never the ultimate     Use as helpers only If there is a conflict:
             summaries /         source of truth by                         raw thread wins for
             extracted           themselves                                 what was said, approved
             structured fields                                              record wins for
                                                                            business decisions, and
                                                                            staff action wins for
                                                                            live ops changes.

  28         AI disclosure and   Platform-level rule    Always enforced     AI must disclose
             automation          enforced in every                          automation status in
             transparency        first outbound                             the first message to
                                 message. Not                               every new customer.
                                 overridable by                             Business tone settings
                                 business config.                           control wording style
                                                                            but cannot remove the
                                                                            disclosure. Includes
                                                                            STOP opt-out note.

  29         Consent status      customers table and    System-controlled   Inbound customer
                                 customer_contacts                          contact = implied
                                 table in the app DB.                       consent. STOP
                                 Twilio enforces at                         processing is automatic
                                 carrier level.                             via Twilio. System
                                                                            tracks consent_status
                                                                            on customer record.
                                                                            Auto-resubscribe on
                                                                            new inbound after
                                                                            opt-out.

  30         Calendar sync       calendar_sync_log in   System-controlled   Sync log is the source
             history             the app DB                                 of truth for what was
                                                                            synced, when, and
                                                                            whether a destructive
                                                                            sync was undone.
                                                                            Before/after snapshots
                                                                            provide audit trail.

  31         Conversation merge  conversation_merges    System-controlled   Merge record is the
             history             record in the app DB                       source of truth for
                                                                            which conversation
                                                                            absorbed which and
                                                                            why. No admin writes.

  32         AI prompt/response  prompt_log in the      Debugging only      Never source of truth
             logs                app DB                                     for business decisions.
                                                                            30-day retention.
                                                                            System-only writes.

  33         Collected service   conversations          Yes, as collected   Not canonical until
             address             .collected_service     data                copied into
                                 _address in the                            appointment.address.
                                 app DB                                     Appointment address
                                                                            wins if both exist.
  -------------------------------------------------------------------------------------------------

# Implementation notes

-   Business-specific truth. Store company rules, onboarding answers,
    emergency settings, pricing, tone, services, intake answers,
    workflow config, recurring-service records, conversation-control
    state, and payment-management records in the app DB.

-   **Platform-wide truth.** Keep universal rules, capabilities,
    triggers, state definitions, and trade-specific guardrails under
    platform control. These start in the master documents and are later
    coded into the system.

-   **Approval discipline.** Whenever a flow requires human approval,
    the absence of an approval record means the AI cannot confirm,
    promise, or book.

-   **Evidence vs helpers.** Logs are evidence. Summaries are helpers.
    Extracted fields can speed workflows but never overrule the
    source-of-truth category assigned above.

# Recommended next step

**Turn this map directly into schema and workflow rules.** The clean
build path is to map each row above into actual tables, enums, workflow
checks, and prompt-loading logic so the AI always knows what wins when
systems disagree.
