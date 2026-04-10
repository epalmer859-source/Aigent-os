# Communications OS — Dashboard & App Specification

## Complete Admin, Owner, and Team Experience Contract

**Date:** March 30, 2026
**Status:** Binding specification for app layout, dashboard structure, role permissions, configurable settings, and operational workflows.

---

**Document use:** This is the single UI/UX authority for the app. It defines what the owner and admin see, what they can do, where everything lives, and what is configurable. Implementation details (colors, component library, animations) are not covered — this is the functional contract.

**Design philosophy:** Extremely simple. Clean tabs, easy to read, no clutter. Every blue-collar business owner should understand this app in minutes without training. Ethan walks each business through onboarding personally.

**Platform:** Web app, mobile web, and native app (App Store target). Must work well on all three from day one.

---

# PART 1 — Authentication and Access

## 1.1 Roles

| Role | Who | Access |
|---|---|---|
| Owner | The business owner who created the account, plus any admin promoted to owner. Multiple owners allowed. | Full access to everything: all tabs, all actions, all settings, team management, join code, role management. |
| Admin | Trusted team member(s) invited via join code. | Full operational access: can manage conversations, appointments, quotes, escalations, take over threads. CANNOT access settings, team management, or join code. |

There are no other roles. No "team member" or "read-only" tier. Any owner can promote an admin to owner or demote another owner to admin at any time in Settings > Team Management. The system prevents demotion of the last remaining owner.

## 1.2 Sign-up and login flow

1. User opens the app and creates an account (email + password or equivalent auth).
2. After account creation, user sees two options: **Owner** or **Admin**.
3. **If Owner:** User starts the full onboarding flow (25–26 questions). Onboarding must be completed before the dashboard is accessible. During onboarding, the owner creates a **join code** — a code that admins will use to join this business.
4. **If Admin:** User enters the join code for an existing business. Unlimited attempts to enter the code. Once the correct code is entered, admin joins that business and sees the operational dashboard (no settings access).

## 1.3 Join code system

- The founding owner creates the join code during onboarding.
- Any owner can change the join code (in settings).
- Any owner can remove an admin or demote another owner from the business.
- Anyone can sign up for the app, but without the correct join code they cannot access any business data.
- **Platform safety net:** If the founding owner gets locked out, the system sends the owner's business name, phone number, and join code directly to the platform operator (Ethan) via a secure channel so they can be helped back in.

## 1.4 Onboarding flow

- Owner completes the 25–26 question onboarding questionnaire inside the app.
- Step-by-step walkthrough: one question at a time, clear labels, open text fields.
- Questions follow the exact order from the Master Onboarding Questionnaire: 23 universal questions first, then the 2–3 industry-specific questions based on the selected industry.
- Owner selects their industry from the 21 supported industries before starting industry-specific questions.
- Onboarding must be fully completed before the dashboard activates. No partial-onboarding access.
- All onboarding answers are editable later in settings.

---

# PART 2 — App Structure

## 2.1 Main navigation

The owner/admin sees these tabs in the main navigation:

| Tab | What it is |
|---|---|
| **Urgent** | Home screen. Everything that needs attention right now. |
| **Conversations** | All customer conversation threads, searchable by name and phone. |
| **Appointments** | Schedule management: Requests, Scheduled, and Recurring sub-sections. |
| **Quotes** | Pricing requests: pending quotes + sent quotes. |
| **Approvals** | Pending approval requests (out-of-radius, owner-approval-required). |
| **Escalations** | Complaints, legal threats, safety issues — everything flagged as a problem. |
| **Settings** | (Owner only) All configuration, customer list, payment management, analytics. |

Both owner and admin see the first six tabs. Settings tab is hidden for admin.

**Profile icon** (top corner, visible to both roles): personal notification preferences, delivery method toggles, account info, sign out. This is separate from the owner-only Settings tab so admin can configure their own notifications.

## 2.2 Tab details

### URGENT (Home Screen)

This is the first thing the owner sees when they open the app. It shows a single combined list of everything that needs action, sorted by urgency.

**What shows up here:**
- Safety issues (flagged by AI)
- Legal threats (flagged by AI)
- Complaints needing response (flagged by AI)
- Scheduling requests waiting for admin to place an appointment
- Stale items: any conversation that has been in a stale-eligible state for longer than 24 hours without admin action (see stale-eligible states below)
- Any other item the owner has configured as "urgent" in settings

**Stale-eligible states (items that get a stale flag after 24h):**
- waiting_on_admin_quote, waiting_on_admin_scheduling, waiting_on_parts_confirmation, waiting_on_approval (admin hasn't acted on a routine task)
- complaint_open, billing_dispute_open, safety_issue_open, legal_threat_open, incident_liability_open, insurance_review_open, permits_regulatory_review_open, vendor_dispute_open, restricted_topic_open, hostile_customer_open (override/escalation unresolved for 24h+)

**Stale deduplication:** Override states already appear as escalation cards. When an override state also qualifies as stale (24h+), the existing escalation card receives a "Stale — 24h+" badge rather than creating a duplicate card. For waiting_on_admin_* states, the stale item is its own card.

**Stale query:** A conversation is stale when primary_state is in the stale-eligible set AND last_state_change_at is more than 24 hours ago AND the conversation is not archived and not a no-show.

**Each card shows:**
- Customer name and contact info
- AI-generated summary of the situation (short — 2-3 sentences)
- Urgency tag (safety / legal / complaint / scheduling / stale)
- Timestamp of when it became urgent
- Tap to expand: full conversation, photos, details, and action buttons

**Customizable:** The owner can adjust in settings what qualifies as "urgent" on this screen.

---

### CONVERSATIONS

Full list of all customer conversation threads, searchable by customer name and phone number. Available to both owner and admin.

**Each conversation shows:**
- Customer name and last message preview
- Simplified status: "AI Handling" / "Waiting on You" / "You Took Over" / "Closed"
- Timestamp of last activity
- Tap to open: full conversation history, AI summary, all messages, photos

**Canonical status label mapping (33 states → 4 labels):**

| Display Label | Primary States |
|---|---|
| **AI Handling** | new_lead, lead_qualified, booking_in_progress, quote_sent, lead_followup_active, waiting_on_customer_details, waiting_on_photos, booked, reschedule_in_progress, tech_assigned, en_route, job_in_progress, job_paused, job_completed |
| **Waiting on You** | waiting_on_admin_quote, waiting_on_admin_scheduling, waiting_on_parts_confirmation, waiting_on_approval, complaint_open, billing_dispute_open, safety_issue_open, legal_threat_open, incident_liability_open, insurance_review_open, permits_regulatory_review_open, vendor_dispute_open, restricted_topic_open, hostile_customer_open |
| **You Took Over** | human_takeover_active |
| **Closed** | resolved, closed_unqualified, closed_lost, closed_completed |

Override states (complaints, legal, safety, etc.) display as "Waiting on You" because they require admin action. The specific override type is visible on the Escalations tab and inside the conversation detail view.

**Actions available:**
- Take over conversation (turns AI off for that thread)
- Turn AI back on (if currently taken over)
- Message customer directly (during takeover)
- Cancel pending outbound messages (visible inside conversation view)

**Presence lock:** When an admin or owner opens a conversation and begins interacting, other admins see "Being handled by [name]" and cannot take actions until the first admin navigates away or 5 minutes of inactivity passes. The owner can force-break an admin's lock. Admin cannot break the owner's lock.

**Filtering:** Filter by "Include archived" to see conversations archived after 90 days.

---

### APPOINTMENTS

Three sub-sections:

**Requests** — Scheduling packages sent by the AI, waiting for admin to book the appointment.

Each request card shows:
- Customer name and phone number
- Service requested
- Customer's preferred day/time/flexibility
- AI summary of the job package
- Tap to expand: full conversation, photos, details
- Action: Book the appointment (either in-app or via Google Calendar)

**Scheduled** — Confirmed appointments synced with Google Calendar.

Each appointment card shows:
- Customer name
- Service type
- Date and time
- Assigned technician (if set)
- Status: booked / en route / in progress / completed / no-show
- Closeout status badge (on completed jobs): Closeout Sent / Closeout Blocked / Closeout Skipped / Closeout Pending
- Appointment change request indicator (if customer requested cancel/reschedule)

**Google Calendar sync:** Bidirectional. Last-write-wins. Owner can place appointments in the app (syncs to Google Calendar) or in Google Calendar (syncs to the app). Either direction works for booking, rescheduling, and marking complete. Any change synced from either direction generates an admin notification.

**Actions available on scheduled appointments:**
- Mark en route (sends dispatch notice to customer)
- Mark delayed (sends delay notice to customer)
- Mark in progress
- Mark complete (triggers closeout message if no blocking conditions)
- Mark no-show (AI sends zero messages for this job going forward)
- Reschedule
- Cancel
- Cancel closeout message (if closeout is pending)

**Appointment change requests:** When a customer requests to cancel or reschedule through the AI, the request appears as a sub-item on the relevant appointment AND as an urgent item on the Urgent tab. Shows customer name, what they're requesting, their reason, preferred new time (if reschedule). Actions: Approve the change, Deny the change, Take over conversation.

**Pending messages:** Inside each conversation view, a "Pending Messages" indicator shows the count of queued outbound messages for this thread. Tap to see the list with scheduled send times. Action: Cancel any pending message.

**Recurring** — All active recurring services.

Each recurring card shows:
- Customer name
- Service type and frequency (weekly / biweekly / monthly / custom)
- Next scheduled visit date
- Address
- Status: active / paused / canceled
- Tap to expand: full visit history, change history, upcoming visits

**Actions on recurring services:**
- Edit (change frequency, day, time, address)
- Skip next visit
- Reschedule next visit
- Pause service
- Cancel service
- View all upcoming visits

**Actions on individual recurring visits:**
- Reschedule this visit
- Skip this visit
- Mark complete (same as regular appointment)
- Mark no-show

**Conversation status labels (all tabs):** Conversations show simplified status — "AI Handling" / "Waiting on You" / "You Took Over" / "Closed." No technical state badges. Tags are internal only.

---

### QUOTES

Two sub-sections:

**Pending** — Quote requests waiting for the owner to provide pricing.

Each pending quote card shows:
- Customer name and contact info
- Service requested
- AI summary of what the customer needs
- Tap to expand: full conversation, photos, measurements, details
- Action: Enter approved price → AI delivers the quote to the customer
- Action: Message customer directly (opens conversation with AI paused)

**Sent** — Quotes that have been approved and delivered to the customer.

Each sent quote card shows:
- Customer name
- Price sent
- Date sent
- Status: waiting for response / accepted / declined / expired
- Tap to expand: full conversation and follow-up history

---

### ESCALATIONS

One flat list of all active complaints and escalations, sorted by urgency.

**Each escalation card shows:**
- Customer name and contact info
- Simplified urgency label: **Safety Issue** / **Legal Threat** / **Complaint** / **Billing Dispute** / **Hostile Customer** / **Liability** / **Insurance** / **Permits/Regulatory** / **Vendor Dispute** / **Restricted Topic** / **Other**
- AI summary of the situation (short — 2-3 sentences)
- Timestamp
- Tap to expand: full conversation history, photos, all details, AI summary, and the full canonical escalation category from the 13-value enum

**Actions available:**
- Take over conversation (turns AI off, owner communicates directly)
- Resolve (marks the escalation as handled, thread returns to normal per restoration rules)
- Escalate further (add notes, change urgency classification)

---

### APPROVALS

One flat list of all pending approval requests, sorted by date created.

**What shows up here:**
- Out-of-radius job requests
- Restricted job type requests
- Owner-approval-required items
- Any other approval-gated request

**Each approval card shows:**
- Customer name and contact info
- What needs approval (description of the request)
- AI summary of the request
- Timestamp
- Tap to expand: full conversation history, details

**Actions available:**
- Approve (AI relays outcome to customer, workflow resumes)
- Deny with reason (AI relays outcome, conversation moves to closed_unqualified or alternative)
- Take over conversation

---

### SETTINGS (Owner Only)

Settings is organized into clean sub-sections. Admin cannot see or access this tab.

**Sub-sections inside Settings:**

#### Customer List
- Simple list of all customers
- Each shows: name, phone number, email, how they first contacted (SMS / call / email / web chat)
- Tap to open: full history — all conversations, all jobs, all quotes, all escalations for that customer

#### Payment Management (Toggleable — owner can turn this off)
- List of completed jobs, each showing:
  - Customer name and phone number
  - Job description
  - Job price (as quoted/agreed)
  - Scheduled date/time
  - Completion date/time
- This is reference/proof only. Owner handles all payment follow-up outside the app.
- Toggle: Owner can turn this entire section on or off in settings.

#### Analytics
- Simple stats dashboard:
  - Leads this week / month
  - Jobs completed this week / month
  - Quotes sent
  - Average response time
  - Conversion rate (leads → booked jobs)
- Clean and simple — no complex charts. Just numbers.

#### Notification Settings
- Simple toggles for each notification type:
  - Safety issues: on/off
  - Legal threats: on/off
  - Complaints: on/off
  - Scheduling requests: on/off
  - Stale items (24h+): on/off
  - Quote requests: on/off
  - New customer messages: on/off
- Delivery method: SMS to phone, push notification (when native app), or both
- These toggles apply to the logged-in user (owner or admin can each set their own)

#### AI Takeover Timer
- Global default for how long AI stays off after owner takes over a conversation
- Default: 7 days
- Adjustable to any duration, including "never" (permanent takeover — AI never comes back)
- This is the default — owner can override per conversation when taking over

#### Urgent Tab Customization
- Checkboxes for what qualifies as "urgent" on the home screen
- Default: safety, legal, complaints, scheduling requests, 24h+ stale items
- Owner can add or remove categories

#### Business Configuration
Everything from onboarding is editable here. Organized into clear groups:

**Business Identity**
- Business name
- Owner name and role
- AI sign-off name
- Join code (change/view)
- Team management (view all team members, change roles between owner and admin, remove users). The system prevents demotion of the last remaining owner.

**Contact Info**
- Urgent alert phone number and email
- Secondary contacts for different issue types
- Preferred customer-facing phone number

**Hours and Availability**
- Business hours for each day of the week
- Holidays and seasonal closures
- Emergency and after-hours rules

**Services**
- Services offered (add/remove/edit)
- Work not offered / exclusions
- Service area (cities, zip codes, regions)
- Areas specifically excluded

**Pricing**
- Fixed prices, starting prices, package prices
- Trip fees, diagnostic fees, after-hours fees, disposal fees, emergency fees, minimum charges
- Whether each price is shareable by AI (toggle per price)
- Rough estimate mode on/off (and which services it applies to)
- Labor pricing method (by-the-hour or by-the-job)

**Scheduling and Policies**
- Appointment types and durations
- How far in advance customers can book
- Same-day booking allowed (yes/no)
- Owner-approval job types
- Cancellation and rescheduling policy
- Customer prep instructions before arrival

**AI Behavior**
- AI tone and personality description
- Always-say guidance
- Never-say guidance
- Languages supported
- Multilingual support toggle (on/off — when on, AI responds in customer's language if supported)
- Turn AI call answering on/off
- Quiet hours start (default 10:00 PM, editable, minimum 6-hour window)
- Quiet hours end (default 6:00 AM, editable)

**Post-Job**
- Google review link
- Preferred phone number for post-job customer contact
- Custom closeout message instructions
- Payment management on/off

**Policies**
- Warranty / callback / guarantee policy
- Payment methods and terms
- Any other business-specific policies

**Common Questions**
- FAQ answers the owner wants the AI to use
- Typical customer process description
- Important business details customers should know

---

# PART 3 — Takeover Model

This section defines exactly how the owner/admin takes control of a conversation.

## 3.1 Taking over

1. Owner/admin opens a conversation (from any tab — urgent, appointments, quotes, escalations, conversations in settings).
2. Owner/admin taps **"Turn AI Off"** button on the conversation.
3. System immediately:
   - Sets the conversation to `human_takeover_active`
   - Cancels all pending AI messages for this thread
   - Sends the customer one message: *"[Business name]'s team has temporarily paused AI communication for this conversation. They'll reach out to you directly."* (Wording customizable in settings.)
   - Starts the takeover timer (default 7 days, or per-conversation override)
4. Owner/admin can now:
   - Type messages to the customer directly through the app
   - Or reach out via their own phone/email using the customer's contact info visible in the conversation
   - Or both

## 3.2 During takeover

- AI sends zero messages on this thread. No replies, no reminders, no follow-ups, no closeout.
- If the customer texts the AI number, the message is logged and the owner/admin gets a notification (if notifications are on). The customer gets no auto-response.
- The conversation stays visible in the app with all new messages appearing in real time.

## 3.3 Ending takeover

**Automatic:** When the takeover timer expires (default 7 days), AI automatically resumes on that thread. No notification is sent to the customer — AI just starts handling normally again on the next customer contact or scheduled automation.

**Manual (early):** Owner can tap **"Turn AI Back On"** at any time to end takeover early. Same behavior — AI resumes silently.

**Permanent:** If the global timer or per-conversation override is set to "never," AI stays off indefinitely until the owner manually turns it back on.

## 3.4 Timer settings

- **Global default:** Set in Settings → AI Takeover Timer. Default is 7 days. Can be set to any duration or "never."
- **Per-conversation override:** When the owner taps "Turn AI Off," they can optionally set a custom timer for that specific conversation. If they don't, the global default applies.

## 3.5 Restoration after takeover

When AI resumes (either by timer or manual re-enable):
- AI picks up from the prior state before takeover, validated per the Resume/Restoration Authority rules.
- All old queue rows are dead. Fresh automations are created based on current state and current time.
- No silence timers restart automatically. New timers only begin on new qualifying events.
- No "AI is back" message is sent to the customer. AI resumes naturally.

---

# PART 4 — Action Reference

Quick reference for every action available to owner and admin across the app.

## 4.1 Actions available everywhere

| Action | Where | Who | What happens |
|---|---|---|---|
| Turn AI Off (takeover) | Any conversation | Owner, Admin | AI stops on thread. Customer notified. Timer starts. |
| Turn AI Back On | Any taken-over conversation | Owner, Admin | AI resumes. Timer canceled. |
| Message Customer Directly | Any conversation during takeover | Owner, Admin | Message sent from business number through app. |

## 4.2 Appointments actions

| Action | Who | What happens |
|---|---|---|
| Book appointment (from request) | Owner, Admin | Appointment created. Customer gets booking confirmation. Syncs to Google Calendar. |
| Reschedule | Owner, Admin | Appointment moved. Customer gets reschedule confirmation. Old reminders canceled, new ones created. |
| Cancel appointment | Owner, Admin | Appointment canceled. Customer gets cancellation confirmation. All reminders canceled. |
| Mark en route | Owner, Admin | Dispatch notice sent to customer. |
| Mark delayed | Owner, Admin | Delay notice sent to customer with confirmed info. |
| Mark in progress | Owner, Admin | Job state updated. Lead-gen and post-job automation paused. |
| Mark complete | Owner, Admin | Completion recorded. Closeout message queued (if no blockers). Payment management record created. |

## 4.3 Quotes actions

| Action | Who | What happens |
|---|---|---|
| Enter approved price | Owner, Admin | Quote delivered to customer. Follow-up ladder starts. |
| Revise quote | Owner, Admin | Old quote superseded. New corrected quote created and delivered. AI explains update. Old follow-ups canceled, new ladder starts. |
| Message customer from quote | Owner, Admin | Takeover triggered on that thread. Owner communicates directly. |

## 4.4 Escalation actions

| Action | Who | What happens |
|---|---|---|
| Take over thread | Owner, Admin | AI stops. Owner handles directly. |
| Resolve escalation | Owner, Admin | Escalation marked resolved. Thread returns to prior state (per restoration rules) or closed. |
| Change urgency tag | Owner, Admin | Reclassify the escalation type (e.g., complaint → legal threat). |

## 4.5 Settings actions (Owner only)

| Action | What happens |
|---|---|
| Edit any business configuration field | AI behavior updates immediately based on new config. |
| Change join code | All future admin sign-ups use new code. Existing admins stay connected. |
| Remove user | User loses access to the business immediately. Conversations they had taken over transfer to acting owner. Cannot remove the last remaining owner. |
| Change user role (promote to owner / demote to admin) | User's permissions update immediately. Cannot demote the last remaining owner. Event logged. |
| Toggle payment management on/off | Section appears or hides in settings. |
| Toggle AI call answering on/off | AI starts or stops answering inbound calls. Missed-call fallback activates when off. |
| Adjust takeover timer default | Applies to all future takeovers (existing ones keep their current timer). |
| Adjust urgent tab categories | Home screen updates immediately. |
| Adjust notification toggles | Notification delivery updates immediately. |

---

# PART 5 — What Admin CANNOT Do

To keep this simple and prevent confusion:

- Admin cannot access the Settings tab at all.
- Admin cannot change business hours, services, pricing, policies, AI behavior, or any configuration.
- Admin cannot change or view the join code.
- Admin cannot remove other users or change anyone's role.
- Admin cannot toggle payment management or AI call answering.
- Admin cannot change notification settings for anyone but themselves.
- Admin cannot access customer list, payment management, or analytics.
- Admin CAN do everything else: manage conversations, search/view all conversations, take over threads, book appointments, approve quotes, handle escalations, mark jobs complete, and message customers.

---

# PART 6 — Notification Delivery

## 6.1 How notifications reach the owner/admin

| Notification type | Dashboard alert | SMS | Push (native app) |
|---|---|---|---|
| Safety issue | Always | If toggled on | If toggled on |
| Legal threat | Always | If toggled on | If toggled on |
| Complaint | Always | If toggled on | If toggled on |
| Scheduling request | Always | If toggled on | If toggled on |
| Stale item (24h+) | Always | If toggled on | If toggled on |
| New quote request | Always | If toggled on | If toggled on |
| New customer message (during takeover) | Always | If toggled on | If toggled on |
| Job marked complete | Always | No | If toggled on |
| Customer message (normal AI handling) | Badge count only | No | No |

Dashboard alerts are always on and cannot be turned off. SMS and push are individually toggleable per notification type.

## 6.2 Notification badges

Each main tab shows a badge count of items needing attention:
- **Urgent:** Total urgent items
- **Conversations:** Unread customer messages (conversations where last_customer_message_at > last_ai_message_at and current_owner = ai)
- **Appointments:** Pending scheduling requests
- **Quotes:** Pending quote requests
- **Approvals:** Pending approval requests
- **Escalations:** Unresolved escalations

---

# PART 7 — Additional Features

## 7.1 Search and Filtering

**Search:** Owner/admin can search conversations by customer name and phone number.

**Appointment filtering:** Filter by status (booked, rescheduled, completed, canceled, no_show).

**Urgent tab filtering:** Filter by urgency type (safety, legal, complaint, scheduling, stale, etc.).

**Pagination:** Paginated pages (page 1, 2, 3...) for all long lists.

## 7.2 Photos and Media

Customer-sent photos displayed as thumbnails inline in conversation view. Tap to expand to full size.

## 7.3 Urgent Tab Item Lifecycle

- Items can be manually dismissed from the Urgent tab.
- All items auto-expire and disappear 30 days after creation.
- Items auto-dismiss when the underlying action is completed (e.g., appointment booked clears the scheduling request).

## 7.4 Dark Mode

Supported from day one.

## 7.5 Quote Management

Quotes auto-expire after the configurable period (default 30 days, adjustable in Settings). No manual withdraw — quotes expire automatically.

## 7.6 Global Business Pause

In Settings, owner can toggle "Pause All AI" on/off.

When paused: AI responds to ALL inbound customer messages with a configurable away message only. No other automation fires. Admin is notified of all inbound. Dashboard shows a banner: "AI is paused for all customers."

When unpaused: AI resumes normally. No "we're back" message. Fresh timers only.

## 7.7 Additional Settings Items

**Settings > AI Behavior (additions):**
- Message Templates: owner can customize wording for 13 message types (booking confirmation, reminders, dispatch, closeout, missed-call fallback, takeover notification, stale waiting update, business pause message, human request retention)
- Takeover notification message: edit the customer-facing "AI is paused" message

**Settings > Business Config (additions):**
- Quote auto-expiry days (default 30)
- Auto-close days (default 30)
- Global AI pause toggle with custom away message
- Business timezone (set during onboarding, editable)

**Industry:** Locked after onboarding. Owner must create a new account to change industry.

## 7.8 Platform

Web app + PWA + native app (iOS App Store target). All three from v1. Push notifications available on native app and PWA.

---

# Authority Statement

This document is binding for all app and dashboard implementation. It is consistent with and supplements the core authority documents, Blueprint Patch v5, and Blueprint Patch v6. Where this document defines UI behavior or takeover mechanics that differ from earlier authority documents (specifically the timer-based takeover model replacing the manual hand-back model), this document wins for app behavior and the Supplemental Engineering Contract's Resume/Restoration Authority §3.2 governs the technical restoration logic. Blueprint Patch v6 supersedes this document where conflicts exist.
