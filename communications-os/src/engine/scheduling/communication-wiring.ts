// ============================================================
// src/engine/scheduling/communication-wiring.ts
//
// COMMUNICATION WIRING — SCHEDULING ↔ OUTBOUND QUEUE BRIDGE
//
// Deterministic routing logic only. AI generates message TEXT,
// not message DECISIONS. This module decides WHICH message to
// queue and WHEN. It does NOT own the send pipeline — it writes
// to outbound_queue and the existing queue worker handles delivery.
//
// Rules enforced:
//   - 4 texts per clean job (confirm, reminder, en_route, completion)
//   - Morning reminder tiers by queue position (window/soft/none)
//   - AI text preferred, canned template fallback always available
//   - Dedupe via dedupeKey (no duplicate pending messages)
//   - Quiet-hours: some purposes restricted, others exempt
//   - Rate limits: 10/hr hard, 2/24h non-urgent daily cap
//   - Cancellation on state change (only obsolete messages)
//   - Gap-fill texts are pre-booking, outside 4-text sequence
//   - Tech-facing messages go to technician phone
//   - No tech name in customer-facing messages
//
// Injectable: db, clock, AI text generator.
// ============================================================

import {
  isInQuietHoursLocal,
  computeQuietHoursEndLocal,
  toUtcDate,
  toBusinessMinutes,
} from "./timezone";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SchedulingMessagePurpose =
  | "scheduling_confirmation"
  | "scheduling_morning_reminder"
  | "scheduling_en_route"
  | "scheduling_arrival"
  | "scheduling_completion"
  | "scheduling_delay_notice"
  | "scheduling_window_change"
  | "scheduling_rebook_notice"
  | "scheduling_pull_forward_offer"
  | "scheduling_pull_forward_accepted"
  | "scheduling_tech_estimate_prompt"
  | "scheduling_tech_estimate_reminder"
  | "scheduling_completion_note_prompt"
  | "scheduling_review_request"
  | "scheduling_followup_outreach"
  | "scheduling_sick_tech_notice";

export type MessageChannel = "sms" | "email" | "web_chat";
export type MessageAudience = "customer" | "technician" | "owner";

export interface SchedulingOutboundMessage {
  messageId: string;
  businessId: string;
  conversationId: string | null;
  schedulingJobId: string;
  purpose: SchedulingMessagePurpose;
  audience: MessageAudience;
  channel: MessageChannel;
  recipientPhone: string | null;
  recipientEmail: string | null;
  content: string;
  dedupeKey: string;
  isUrgent: boolean;
  quietHoursRestricted: boolean;
  scheduledSendAt: Date | null;
  status: "pending" | "deferred";
}

export type MorningReminderTier =
  | { tier: "window"; windowStart: string; windowEnd: string }
  | { tier: "soft"; estimate: string }
  | { tier: "none" };

export interface TextGenerationRequest {
  purpose: SchedulingMessagePurpose;
  businessName: string;
  customerName: string | null;
  serviceType: string;
  technicianName: string | null;
  date: Date;
  windowInfo: MorningReminderTier | null;
  additionalContext: Record<string, unknown>;
}

export type TextGenerationResult =
  | { outcome: "generated"; content: string }
  | { outcome: "ai_unavailable"; content: string; usedFallback: true };

export interface CannedTemplate {
  purpose: SchedulingMessagePurpose;
  template: string;
  variables: string[];
}

export interface SchedulingJobWithContext {
  jobId: string;
  businessId: string;
  technicianId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  serviceType: string;
  scheduledDate: Date;
  status: string;
}

export interface CommunicationWiringDb {
  getSchedulingJob(jobId: string): Promise<SchedulingJobWithContext | null>;
  getConversationForJob(jobId: string): Promise<{
    conversationId: string;
    channel: MessageChannel;
    customerPhone: string | null;
    customerEmail: string | null;
  } | null>;
  getBusinessInfo(businessId: string): Promise<{
    businessName: string;
    quietHoursStart: string;
    quietHoursEnd: string;
    timezone: string;
    preferredPhone: string | null;
    openTime?: string | null;
  } | null>;
  getTechnicianInfo(technicianId: string): Promise<{
    name: string;
    phone: string;
  } | null>;
  getQueuePositionContext(jobId: string): Promise<{
    position: number;
    totalJobs: number;
    estimatedWindowStart: string | null;
    estimatedWindowEnd: string | null;
    softEstimate: string | null;
  } | null>;

  enqueueOutboundMessage(message: SchedulingOutboundMessage): Promise<void>;
  /**
   * Returns an existing pending/deferred message with this dedupeKey, or null.
   * Production DB must enforce unique pending/deferred dedupeKey semantics.
   */
  getPendingOrDeferredByDedupeKey(dedupeKey: string): Promise<SchedulingOutboundMessage | null>;
  getMessageCountForRecipientSince(recipientPhone: string, sinceDate: Date): Promise<number>;
  getNonUrgentMessageCountForConversationSince(conversationId: string, sinceDate: Date): Promise<number>;
  getPendingMessagesForJob(jobId: string, purpose: SchedulingMessagePurpose): Promise<SchedulingOutboundMessage[]>;
  cancelPendingMessages(jobId: string, purpose: SchedulingMessagePurpose): Promise<number>;

  transaction<T>(fn: (tx: CommunicationWiringDb) => Promise<T>): Promise<T>;
}

export interface AiTextGenerator {
  generateText(request: TextGenerationRequest): Promise<TextGenerationResult>;
}

export interface ClockProvider {
  now(): Date;
  today(): Date;
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: "hourly_limit" | "daily_cap";
  defer?: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HOURLY_LIMIT = 10;
const DAILY_NON_URGENT_CAP = 2;

const QUIET_HOURS_RESTRICTED: Set<SchedulingMessagePurpose> = new Set([
  "scheduling_morning_reminder",
  "scheduling_completion",
  "scheduling_rebook_notice",
  "scheduling_pull_forward_offer",
  "scheduling_review_request",
  "scheduling_followup_outreach",
]);

const URGENT_PURPOSES: Set<SchedulingMessagePurpose> = new Set([
  "scheduling_confirmation",
  "scheduling_en_route",
  "scheduling_arrival",
  "scheduling_delay_notice",
  "scheduling_window_change",
  "scheduling_pull_forward_accepted",
  "scheduling_tech_estimate_prompt",
  "scheduling_tech_estimate_reminder",
  "scheduling_completion_note_prompt",
  "scheduling_sick_tech_notice",
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateMessageId(): string {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function parseHHMM(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h! * 60 + m!;
}

function isInQuietHours(now: Date, quietStart: string, quietEnd: string, timezone: string): boolean {
  return isInQuietHoursLocal(now, quietStart, quietEnd, timezone);
}

function computeQuietHoursEnd(serviceDate: Date, quietEnd: string, timezone: string): Date {
  return computeQuietHoursEndLocal(serviceDate, quietEnd, timezone);
}

function computeMorningReminderSendAt(serviceDate: Date, openTime: string | null | undefined, timezone: string): Date {
  const open = openTime ?? "08:00";
  const openMinutes = parseHHMM(open);
  // 1 hour before open in business-local time
  const reminderMinutes = openMinutes - 60;
  return toUtcDate(reminderMinutes, serviceDate, timezone);
}

function substituteTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  return result;
}

function dateStr(d: Date): string {
  return d.toISOString().split("T")[0]!;
}

// ── 12. buildCannedTemplate ──────────────────────────────────────────────────

export function buildCannedTemplate(purpose: SchedulingMessagePurpose): CannedTemplate {
  switch (purpose) {
    case "scheduling_confirmation":
      return {
        purpose,
        template: "Your appointment with {businessName} for {serviceType} is confirmed for {date}. We'll send a reminder before your appointment and let you know when your technician is on the way.",
        variables: ["businessName", "serviceType", "date"],
      };
    case "scheduling_morning_reminder":
      // Default none tier; callers should use tier-specific helpers
      return {
        purpose,
        template: "{businessName} here — your {serviceType} service is on the schedule for today. We'll text you when your technician is headed your way.",
        variables: ["businessName", "serviceType"],
      };
    case "scheduling_en_route":
      return {
        purpose,
        template: "Your technician is on the way! Estimated arrival in about {etaMinutes} minutes.",
        variables: ["etaMinutes"],
      };
    case "scheduling_arrival":
      return {
        purpose,
        template: "Your technician has arrived and is getting started on your {serviceType} service.",
        variables: ["serviceType"],
      };
    case "scheduling_completion":
      return {
        purpose,
        template: "Your {serviceType} service is complete. Thanks for choosing {businessName}! If you need anything, call or text {businessPhone}.",
        variables: ["serviceType", "businessName", "businessPhone"],
      };
    case "scheduling_delay_notice":
      return {
        purpose,
        template: "{businessName} here — your {serviceType} appointment is running behind. We'll keep you updated.",
        variables: ["businessName", "serviceType"],
      };
    case "scheduling_window_change":
      return {
        purpose,
        template: "{businessName} here — the expected arrival window for your {serviceType} appointment has changed to {windowStart}–{windowEnd}.",
        variables: ["businessName", "serviceType", "windowStart", "windowEnd"],
      };
    case "scheduling_rebook_notice":
      return {
        purpose,
        template: "We need to reschedule your {serviceType} appointment. Your new date is {newDate}. We apologize for the inconvenience.",
        variables: ["serviceType", "newDate"],
      };
    case "scheduling_pull_forward_offer":
      return {
        purpose,
        template: "Good news — we can get to you earlier than expected, {newWindow}. Reply YES within 20 minutes to confirm the earlier time.",
        variables: ["newWindow"],
      };
    case "scheduling_pull_forward_accepted":
      return {
        purpose,
        template: "You're confirmed for the earlier time — {newWindow}. We'll let you know when your technician is on the way.",
        variables: ["newWindow"],
      };
    case "scheduling_tech_estimate_prompt":
      return {
        purpose,
        template: "What did you find? How long do you think the fix will take for {serviceType}?",
        variables: ["serviceType"],
      };
    case "scheduling_tech_estimate_reminder":
      return {
        purpose,
        template: "Hey just need a quick update on this job so I can keep the schedule on track.",
        variables: [],
      };
    case "scheduling_completion_note_prompt":
      return {
        purpose,
        template: "Please send the completion note: fixed, needs follow-up, or customer declined.",
        variables: [],
      };
    case "scheduling_review_request":
      return {
        purpose,
        template: "Thanks for choosing {businessName}! If you were happy with the service, we'd really appreciate a quick review: {reviewLink}",
        variables: ["businessName", "reviewLink"],
      };
    case "scheduling_followup_outreach":
      return {
        purpose,
        template: "{businessName} here — your technician noted a follow-up is needed for your {serviceType} service. We'll be reaching out soon to get that scheduled for you.",
        variables: ["businessName", "serviceType"],
      };
    case "scheduling_sick_tech_notice":
      return {
        purpose,
        template: "We need to reschedule your {serviceType} appointment originally set for {originalDate}. Our team will reach out shortly with a new time.",
        variables: ["serviceType", "originalDate"],
      };
  }
}

export function buildMorningReminderTemplate(tier: MorningReminderTier): CannedTemplate {
  switch (tier.tier) {
    case "window":
      return {
        purpose: "scheduling_morning_reminder",
        template: "{businessName} here — your {serviceType} service is scheduled for today between {windowStart} and {windowEnd}. We'll text you when your technician is headed your way.",
        variables: ["businessName", "serviceType", "windowStart", "windowEnd"],
      };
    case "soft":
      return {
        purpose: "scheduling_morning_reminder",
        template: "{businessName} here — your {serviceType} service is scheduled for today, likely {estimate}. We'll text you when your technician is headed your way.",
        variables: ["businessName", "serviceType", "estimate"],
      };
    case "none":
      return {
        purpose: "scheduling_morning_reminder",
        template: "{businessName} here — your {serviceType} service is on the schedule for today. We'll text you when your technician is headed your way.",
        variables: ["businessName", "serviceType"],
      };
  }
}

// ── 13. checkRateLimits ──────────────────────────────────────────────────────

export async function checkRateLimits(
  recipientPhone: string | null,
  conversationId: string | null,
  isUrgent: boolean,
  clock: ClockProvider,
  db: CommunicationWiringDb,
): Promise<RateLimitResult> {
  const now = clock.now();

  // Hourly limit: 10/hr per recipient phone (applies to ALL messages)
  if (recipientPhone) {
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const hourlyCount = await db.getMessageCountForRecipientSince(recipientPhone, oneHourAgo);
    if (hourlyCount >= HOURLY_LIMIT) {
      return { allowed: false, reason: "hourly_limit", defer: true };
    }
  }

  // Daily cap: 2 non-urgent per 24h per conversation (urgent exempt)
  if (!isUrgent && conversationId) {
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const dailyCount = await db.getNonUrgentMessageCountForConversationSince(conversationId, oneDayAgo);
    if (dailyCount >= DAILY_NON_URGENT_CAP) {
      return { allowed: false, reason: "daily_cap", defer: true };
    }
  }

  return { allowed: true };
}

// ── Text generation helper ───────────────────────────────────────────────────

async function generateOrFallback(
  purpose: SchedulingMessagePurpose,
  aiGenerator: AiTextGenerator,
  request: TextGenerationRequest,
  fallbackVars: Record<string, string>,
  tierTemplate?: CannedTemplate,
): Promise<string> {
  const result = await aiGenerator.generateText(request);
  if (result.outcome === "generated") {
    return result.content;
  }
  // AI unavailable — use canned template
  const template = tierTemplate ?? buildCannedTemplate(purpose);
  return substituteTemplate(template.template, fallbackVars);
}

// ── Message builder helper ───────────────────────────────────────────────────

function buildMessage(params: {
  businessId: string;
  conversationId: string | null;
  jobId: string;
  purpose: SchedulingMessagePurpose;
  audience: MessageAudience;
  channel: MessageChannel;
  recipientPhone: string | null;
  recipientEmail: string | null;
  content: string;
  dedupeKey: string;
  scheduledSendAt: Date | null;
  status: "pending" | "deferred";
}): SchedulingOutboundMessage {
  const isUrgent = URGENT_PURPOSES.has(params.purpose);
  const quietHoursRestricted = QUIET_HOURS_RESTRICTED.has(params.purpose);

  return {
    messageId: generateMessageId(),
    businessId: params.businessId,
    conversationId: params.conversationId,
    schedulingJobId: params.jobId,
    purpose: params.purpose,
    audience: params.audience,
    channel: params.channel,
    recipientPhone: params.recipientPhone,
    recipientEmail: params.recipientEmail,
    content: params.content,
    dedupeKey: params.dedupeKey,
    isUrgent,
    quietHoursRestricted,
    scheduledSendAt: params.scheduledSendAt,
    status: params.status,
  };
}

// ── Quiet hours + rate limit determination ───────────────────────────────────

async function determineStatusAndSchedule(
  purpose: SchedulingMessagePurpose,
  recipientPhone: string | null,
  conversationId: string | null,
  clock: ClockProvider,
  db: CommunicationWiringDb,
  businessQuietStart?: string,
  businessQuietEnd?: string,
  timezone?: string,
  serviceDate?: Date,
): Promise<{ status: "pending" | "deferred"; scheduledSendAt: Date | null }> {
  const isUrgent = URGENT_PURPOSES.has(purpose);
  const isRestricted = QUIET_HOURS_RESTRICTED.has(purpose);

  let scheduledSendAt: Date | null = null;

  // Quiet hours check
  if (isRestricted && businessQuietStart && businessQuietEnd && timezone) {
    const inQuiet = isInQuietHours(clock.now(), businessQuietStart, businessQuietEnd, timezone);
    if (inQuiet && serviceDate) {
      scheduledSendAt = computeQuietHoursEnd(serviceDate, businessQuietEnd, timezone);
    }
  }

  // Rate limit check
  const rateResult = await checkRateLimits(recipientPhone, conversationId, isUrgent, clock, db);

  if (!rateResult.allowed) {
    // Deferred by rate limit — preserve any scheduledSendAt from quiet-hours
    return { status: "deferred", scheduledSendAt };
  }

  if (scheduledSendAt) {
    // Quiet-hours deferred — mark as deferred with the scheduled send time
    return { status: "deferred", scheduledSendAt };
  }

  return { status: "pending", scheduledSendAt: null };
}

// ── Dedupe guard ────────────────────────────────────────────────────────────

async function enqueueWithDedupe(
  message: SchedulingOutboundMessage,
  db: CommunicationWiringDb,
): Promise<void> {
  const existing = await db.getPendingOrDeferredByDedupeKey(message.dedupeKey);
  if (existing) {
    // Already a pending/deferred message with this key — skip
    return;
  }
  await db.enqueueOutboundMessage(message);
}

// ── 1. onJobBooked ───────────────────────────────────────────────────────────

export async function onJobBooked(
  jobId: string,
  db: CommunicationWiringDb,
  clock: ClockProvider,
  aiGenerator: AiTextGenerator,
): Promise<SchedulingOutboundMessage> {
  const job = await db.getSchedulingJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const conv = await db.getConversationForJob(jobId);
  const biz = await db.getBusinessInfo(job.businessId);

  const content = await generateOrFallback(
    "scheduling_confirmation",
    aiGenerator,
    {
      purpose: "scheduling_confirmation",
      businessName: biz?.businessName ?? "Our team",
      customerName: job.customerName,
      serviceType: job.serviceType,
      technicianName: null,
      date: job.scheduledDate,
      windowInfo: null,
      additionalContext: {},
    },
    {
      businessName: biz?.businessName ?? "Our team",
      serviceType: job.serviceType,
      date: dateStr(job.scheduledDate),
    },
  );

  const { status, scheduledSendAt } = await determineStatusAndSchedule(
    "scheduling_confirmation",
    conv?.customerPhone ?? job.customerPhone,
    conv?.conversationId ?? null,
    clock, db,
  );

  const message = buildMessage({
    businessId: job.businessId,
    conversationId: conv?.conversationId ?? null,
    jobId,
    purpose: "scheduling_confirmation",
    audience: "customer",
    channel: conv?.channel ?? "sms",
    recipientPhone: conv?.customerPhone ?? job.customerPhone,
    recipientEmail: conv?.customerEmail ?? job.customerEmail,
    content,
    dedupeKey: `scheduling_confirmation:${jobId}`,
    scheduledSendAt,
    status,
  });

  await enqueueWithDedupe(message, db);
  return message;
}

// ── 2. onMorningReminderDue ──────────────────────────────────────────────────

export function determineMorningReminderTier(
  position: number,
  windowStart: string | null,
  windowEnd: string | null,
  softEstimate: string | null,
): MorningReminderTier {
  if (position <= 2 && windowStart && windowEnd) {
    return { tier: "window", windowStart, windowEnd };
  }
  if (position === 3 && softEstimate) {
    return { tier: "soft", estimate: softEstimate };
  }
  return { tier: "none" };
}

export async function onMorningReminderDue(
  jobId: string,
  db: CommunicationWiringDb,
  clock: ClockProvider,
  aiGenerator: AiTextGenerator,
): Promise<SchedulingOutboundMessage> {
  const job = await db.getSchedulingJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const conv = await db.getConversationForJob(jobId);
  const biz = await db.getBusinessInfo(job.businessId);
  const queueCtx = await db.getQueuePositionContext(jobId);

  const tier = determineMorningReminderTier(
    queueCtx?.position ?? 99,
    queueCtx?.estimatedWindowStart ?? null,
    queueCtx?.estimatedWindowEnd ?? null,
    queueCtx?.softEstimate ?? null,
  );

  const tierTemplate = buildMorningReminderTemplate(tier);

  const fallbackVars: Record<string, string> = {
    businessName: biz?.businessName ?? "Our team",
    serviceType: job.serviceType,
  };
  if (tier.tier === "window") {
    fallbackVars.windowStart = tier.windowStart;
    fallbackVars.windowEnd = tier.windowEnd;
  } else if (tier.tier === "soft") {
    fallbackVars.estimate = tier.estimate;
  }

  const content = await generateOrFallback(
    "scheduling_morning_reminder",
    aiGenerator,
    {
      purpose: "scheduling_morning_reminder",
      businessName: biz?.businessName ?? "Our team",
      customerName: job.customerName,
      serviceType: job.serviceType,
      technicianName: null,
      date: job.scheduledDate,
      windowInfo: tier,
      additionalContext: {},
    },
    fallbackVars,
    tierTemplate,
  );

  const { status, scheduledSendAt } = await determineStatusAndSchedule(
    "scheduling_morning_reminder",
    conv?.customerPhone ?? job.customerPhone,
    conv?.conversationId ?? null,
    clock, db,
    biz?.quietHoursStart, biz?.quietHoursEnd, biz?.timezone,
    job.scheduledDate,
  );

  const message = buildMessage({
    businessId: job.businessId,
    conversationId: conv?.conversationId ?? null,
    jobId,
    purpose: "scheduling_morning_reminder",
    audience: "customer",
    channel: conv?.channel ?? "sms",
    recipientPhone: conv?.customerPhone ?? job.customerPhone,
    recipientEmail: conv?.customerEmail ?? job.customerEmail,
    content,
    dedupeKey: `scheduling_morning_reminder:${jobId}:${dateStr(job.scheduledDate)}`,
    scheduledSendAt,
    status,
  });

  await enqueueWithDedupe(message, db);
  return message;
}

// ── 3. onTechEnRoute ─────────────────────────────────────────────────────────

export async function onTechEnRoute(
  jobId: string,
  db: CommunicationWiringDb,
  clock: ClockProvider,
  aiGenerator: AiTextGenerator,
  etaMinutes?: number,
): Promise<SchedulingOutboundMessage> {
  const job = await db.getSchedulingJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const conv = await db.getConversationForJob(jobId);

  // Cancel pending delay/window-change messages
  await db.cancelPendingMessages(jobId, "scheduling_delay_notice");
  await db.cancelPendingMessages(jobId, "scheduling_window_change");

  const content = await generateOrFallback(
    "scheduling_en_route",
    aiGenerator,
    {
      purpose: "scheduling_en_route",
      businessName: "",
      customerName: job.customerName,
      serviceType: job.serviceType,
      technicianName: null,
      date: job.scheduledDate,
      windowInfo: null,
      additionalContext: { etaMinutes: etaMinutes ?? 0 },
    },
    { etaMinutes: String(etaMinutes ?? 15) },
  );

  const { status, scheduledSendAt } = await determineStatusAndSchedule(
    "scheduling_en_route",
    conv?.customerPhone ?? job.customerPhone,
    conv?.conversationId ?? null,
    clock, db,
  );

  const message = buildMessage({
    businessId: job.businessId,
    conversationId: conv?.conversationId ?? null,
    jobId,
    purpose: "scheduling_en_route",
    audience: "customer",
    channel: conv?.channel ?? "sms",
    recipientPhone: conv?.customerPhone ?? job.customerPhone,
    recipientEmail: conv?.customerEmail ?? job.customerEmail,
    content,
    dedupeKey: `scheduling_en_route:${jobId}`,
    scheduledSendAt,
    status,
  });

  await enqueueWithDedupe(message, db);
  return message;
}

// ── 4. onJobCompleted ────────────────────────────────────────────────────────

export async function onJobCompleted(
  jobId: string,
  db: CommunicationWiringDb,
  clock: ClockProvider,
  aiGenerator: AiTextGenerator,
): Promise<SchedulingOutboundMessage[]> {
  const job = await db.getSchedulingJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const conv = await db.getConversationForJob(jobId);
  const biz = await db.getBusinessInfo(job.businessId);

  // Cancel obsolete pending messages
  await db.cancelPendingMessages(jobId, "scheduling_morning_reminder");
  await db.cancelPendingMessages(jobId, "scheduling_en_route");
  await db.cancelPendingMessages(jobId, "scheduling_delay_notice");
  await db.cancelPendingMessages(jobId, "scheduling_window_change");

  const messages: SchedulingOutboundMessage[] = [];

  // Customer completion
  const customerContent = await generateOrFallback(
    "scheduling_completion",
    aiGenerator,
    {
      purpose: "scheduling_completion",
      businessName: biz?.businessName ?? "Our team",
      customerName: job.customerName,
      serviceType: job.serviceType,
      technicianName: null,
      date: job.scheduledDate,
      windowInfo: null,
      additionalContext: {},
    },
    {
      serviceType: job.serviceType,
      businessName: biz?.businessName ?? "Our team",
      businessPhone: biz?.preferredPhone ?? "",
    },
  );

  const custStatus = await determineStatusAndSchedule(
    "scheduling_completion",
    conv?.customerPhone ?? job.customerPhone,
    conv?.conversationId ?? null,
    clock, db,
    biz?.quietHoursStart, biz?.quietHoursEnd, biz?.timezone,
    job.scheduledDate,
  );

  const custMessage = buildMessage({
    businessId: job.businessId,
    conversationId: conv?.conversationId ?? null,
    jobId,
    purpose: "scheduling_completion",
    audience: "customer",
    channel: conv?.channel ?? "sms",
    recipientPhone: conv?.customerPhone ?? job.customerPhone,
    recipientEmail: conv?.customerEmail ?? job.customerEmail,
    content: customerContent,
    dedupeKey: `scheduling_completion:${jobId}`,
    scheduledSendAt: custStatus.scheduledSendAt,
    status: custStatus.status,
  });
  await enqueueWithDedupe(custMessage, db);
  messages.push(custMessage);

  // Tech completion note prompt removed — tech now uses context-aware
  // completion buttons in the UI instead of receiving an SMS prompt.

  return messages;
}

// ── 4b. onReviewRequested ────────────────────────────────────────────────────

/**
 * Queue a review request message to the customer after a FIXED completion.
 * Uses the business's google_review_link from business_config.
 */
export async function onReviewRequested(
  jobId: string,
  reviewLink: string,
  db: CommunicationWiringDb,
  clock: ClockProvider,
  aiGenerator: AiTextGenerator,
): Promise<SchedulingOutboundMessage | null> {
  const job = await db.getSchedulingJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const conv = await db.getConversationForJob(jobId);
  const biz = await db.getBusinessInfo(job.businessId);

  if (!reviewLink) return null;

  const content = await generateOrFallback(
    "scheduling_review_request",
    aiGenerator,
    {
      purpose: "scheduling_review_request",
      businessName: biz?.businessName ?? "Our team",
      customerName: job.customerName,
      serviceType: job.serviceType,
      technicianName: null,
      date: job.scheduledDate,
      windowInfo: null,
      additionalContext: { reviewLink },
    },
    {
      businessName: biz?.businessName ?? "Our team",
      reviewLink,
    },
  );

  const status = await determineStatusAndSchedule(
    "scheduling_review_request",
    conv?.customerPhone ?? job.customerPhone,
    conv?.conversationId ?? null,
    clock, db,
    biz?.quietHoursStart, biz?.quietHoursEnd, biz?.timezone,
    job.scheduledDate,
  );

  const msg = buildMessage({
    businessId: job.businessId,
    conversationId: conv?.conversationId ?? null,
    jobId,
    purpose: "scheduling_review_request",
    audience: "customer",
    channel: conv?.channel ?? "sms",
    recipientPhone: conv?.customerPhone ?? job.customerPhone,
    recipientEmail: conv?.customerEmail ?? job.customerEmail,
    content,
    dedupeKey: `scheduling_review_request:${jobId}`,
    scheduledSendAt: status.scheduledSendAt,
    status: status.status,
  });
  await enqueueWithDedupe(msg, db);
  return msg;
}

// ── 4c. onFollowUpCreated ────────────────────────────────────────────────────

/**
 * Queue a follow-up outreach message to the customer after a NEEDS_FOLLOWUP
 * completion. Lets the customer know the tech noted a return visit is needed
 * and they'll be contacted to schedule it.
 */
export async function onFollowUpCreated(
  jobId: string,
  db: CommunicationWiringDb,
  clock: ClockProvider,
  aiGenerator: AiTextGenerator,
): Promise<SchedulingOutboundMessage> {
  const job = await db.getSchedulingJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const conv = await db.getConversationForJob(jobId);
  const biz = await db.getBusinessInfo(job.businessId);

  const content = await generateOrFallback(
    "scheduling_followup_outreach",
    aiGenerator,
    {
      purpose: "scheduling_followup_outreach",
      businessName: biz?.businessName ?? "Our team",
      customerName: job.customerName,
      serviceType: job.serviceType,
      technicianName: null,
      date: job.scheduledDate,
      windowInfo: null,
      additionalContext: {},
    },
    {
      businessName: biz?.businessName ?? "Our team",
      serviceType: job.serviceType,
    },
  );

  const status = await determineStatusAndSchedule(
    "scheduling_followup_outreach",
    conv?.customerPhone ?? job.customerPhone,
    conv?.conversationId ?? null,
    clock, db,
    biz?.quietHoursStart, biz?.quietHoursEnd, biz?.timezone,
    job.scheduledDate,
  );

  const msg = buildMessage({
    businessId: job.businessId,
    conversationId: conv?.conversationId ?? null,
    jobId,
    purpose: "scheduling_followup_outreach",
    audience: "customer",
    channel: conv?.channel ?? "sms",
    recipientPhone: conv?.customerPhone ?? job.customerPhone,
    recipientEmail: conv?.customerEmail ?? job.customerEmail,
    content,
    dedupeKey: `scheduling_followup_outreach:${jobId}`,
    scheduledSendAt: status.scheduledSendAt,
    status: status.status,
  });
  await enqueueWithDedupe(msg, db);
  return msg;
}

// ── 5. onDriftCommunicationTriggered ─────────────────────────────────────────

export async function onDriftCommunicationTriggered(
  jobId: string,
  driftInfo: { action: "communicate_customer"; reason: string } | { windowCrossed: boolean; newWindowStart?: string; newWindowEnd?: string },
  db: CommunicationWiringDb,
  clock: ClockProvider,
  aiGenerator: AiTextGenerator,
): Promise<SchedulingOutboundMessage> {
  const job = await db.getSchedulingJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const conv = await db.getConversationForJob(jobId);
  const biz = await db.getBusinessInfo(job.businessId);

  const isWindowChange = "windowCrossed" in driftInfo && driftInfo.windowCrossed;
  const purpose: SchedulingMessagePurpose = isWindowChange
    ? "scheduling_window_change"
    : "scheduling_delay_notice";

  // Cancel previous pending drift messages
  await db.cancelPendingMessages(jobId, "scheduling_delay_notice");
  await db.cancelPendingMessages(jobId, "scheduling_window_change");

  const fallbackVars: Record<string, string> = {
    businessName: biz?.businessName ?? "Our team",
    serviceType: job.serviceType,
  };
  if (isWindowChange && "newWindowStart" in driftInfo && "newWindowEnd" in driftInfo) {
    fallbackVars.windowStart = driftInfo.newWindowStart!;
    fallbackVars.windowEnd = driftInfo.newWindowEnd!;
  }

  const content = await generateOrFallback(
    purpose,
    aiGenerator,
    {
      purpose,
      businessName: biz?.businessName ?? "Our team",
      customerName: job.customerName,
      serviceType: job.serviceType,
      technicianName: null,
      date: job.scheduledDate,
      windowInfo: null,
      additionalContext: driftInfo,
    },
    fallbackVars,
  );

  const { status, scheduledSendAt } = await determineStatusAndSchedule(
    purpose,
    conv?.customerPhone ?? job.customerPhone,
    conv?.conversationId ?? null,
    clock, db,
  );

  const message = buildMessage({
    businessId: job.businessId,
    conversationId: conv?.conversationId ?? null,
    jobId,
    purpose,
    audience: "customer",
    channel: conv?.channel ?? "sms",
    recipientPhone: conv?.customerPhone ?? job.customerPhone,
    recipientEmail: conv?.customerEmail ?? job.customerEmail,
    content,
    dedupeKey: `${purpose}:${jobId}`,
    scheduledSendAt,
    status,
  });

  await enqueueWithDedupe(message, db);
  return message;
}

// ── 6. onJobRebooked ─────────────────────────────────────────────────────────

export async function onJobRebooked(
  jobId: string,
  originalDate: Date,
  newDate: Date,
  db: CommunicationWiringDb,
  clock: ClockProvider,
  aiGenerator: AiTextGenerator,
): Promise<SchedulingOutboundMessage[]> {
  const job = await db.getSchedulingJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const conv = await db.getConversationForJob(jobId);
  const biz = await db.getBusinessInfo(job.businessId);

  // Cancel obsolete pending messages for old schedule
  await db.cancelPendingMessages(jobId, "scheduling_morning_reminder");
  await db.cancelPendingMessages(jobId, "scheduling_en_route");
  await db.cancelPendingMessages(jobId, "scheduling_delay_notice");
  await db.cancelPendingMessages(jobId, "scheduling_window_change");

  const messages: SchedulingOutboundMessage[] = [];

  // Rebook notice
  const rebookContent = await generateOrFallback(
    "scheduling_rebook_notice",
    aiGenerator,
    {
      purpose: "scheduling_rebook_notice",
      businessName: biz?.businessName ?? "Our team",
      customerName: job.customerName,
      serviceType: job.serviceType,
      technicianName: null,
      date: newDate,
      windowInfo: null,
      additionalContext: { originalDate: dateStr(originalDate), newDate: dateStr(newDate) },
    },
    {
      serviceType: job.serviceType,
      newDate: dateStr(newDate),
    },
  );

  const rebookStatus = await determineStatusAndSchedule(
    "scheduling_rebook_notice",
    conv?.customerPhone ?? job.customerPhone,
    conv?.conversationId ?? null,
    clock, db,
    biz?.quietHoursStart, biz?.quietHoursEnd, biz?.timezone,
    newDate,
  );

  const rebookMsg = buildMessage({
    businessId: job.businessId,
    conversationId: conv?.conversationId ?? null,
    jobId,
    purpose: "scheduling_rebook_notice",
    audience: "customer",
    channel: conv?.channel ?? "sms",
    recipientPhone: conv?.customerPhone ?? job.customerPhone,
    recipientEmail: conv?.customerEmail ?? job.customerEmail,
    content: rebookContent,
    dedupeKey: `scheduling_rebook_notice:${jobId}`,
    scheduledSendAt: rebookStatus.scheduledSendAt,
    status: rebookStatus.status,
  });
  await enqueueWithDedupe(rebookMsg, db);
  messages.push(rebookMsg);

  // Enqueue a morning reminder for the NEW date
  const reminderContent = await generateOrFallback(
    "scheduling_morning_reminder",
    aiGenerator,
    {
      purpose: "scheduling_morning_reminder",
      businessName: biz?.businessName ?? "Our team",
      customerName: job.customerName,
      serviceType: job.serviceType,
      technicianName: null,
      date: newDate,
      windowInfo: null,
      additionalContext: {},
    },
    {
      businessName: biz?.businessName ?? "Our team",
      serviceType: job.serviceType,
    },
  );

  const bizTimezone = biz?.timezone;
  if (!bizTimezone) {
    throw new Error(`Business ${job.businessId} has no timezone configured — cannot compute morning reminder time.`);
  }
  const reminderSendAt = computeMorningReminderSendAt(newDate, biz?.openTime, bizTimezone);

  const reminderMsg = buildMessage({
    businessId: job.businessId,
    conversationId: conv?.conversationId ?? null,
    jobId,
    purpose: "scheduling_morning_reminder",
    audience: "customer",
    channel: conv?.channel ?? "sms",
    recipientPhone: conv?.customerPhone ?? job.customerPhone,
    recipientEmail: conv?.customerEmail ?? job.customerEmail,
    content: reminderContent,
    dedupeKey: `scheduling_morning_reminder:${jobId}:${dateStr(newDate)}`,
    scheduledSendAt: reminderSendAt,
    status: "pending",
  });
  await enqueueWithDedupe(reminderMsg, db);
  messages.push(reminderMsg);

  return messages;
}

// ── 7. onPullForwardOffer ────────────────────────────────────────────────────

export async function onPullForwardOffer(
  jobId: string,
  gapId: string,
  newWindow: string,
  expiresAt: Date,
  db: CommunicationWiringDb,
  clock: ClockProvider,
  aiGenerator: AiTextGenerator,
): Promise<SchedulingOutboundMessage> {
  const job = await db.getSchedulingJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const conv = await db.getConversationForJob(jobId);
  const biz = await db.getBusinessInfo(job.businessId);

  const content = await generateOrFallback(
    "scheduling_pull_forward_offer",
    aiGenerator,
    {
      purpose: "scheduling_pull_forward_offer",
      businessName: biz?.businessName ?? "Our team",
      customerName: job.customerName,
      serviceType: job.serviceType,
      technicianName: null,
      date: job.scheduledDate,
      windowInfo: null,
      additionalContext: { newWindow, expiresAt: expiresAt.toISOString(), gapId },
    },
    { newWindow },
  );

  const { status, scheduledSendAt } = await determineStatusAndSchedule(
    "scheduling_pull_forward_offer",
    conv?.customerPhone ?? job.customerPhone,
    conv?.conversationId ?? null,
    clock, db,
    biz?.quietHoursStart, biz?.quietHoursEnd, biz?.timezone,
    job.scheduledDate,
  );

  const message = buildMessage({
    businessId: job.businessId,
    conversationId: conv?.conversationId ?? null,
    jobId,
    purpose: "scheduling_pull_forward_offer",
    audience: "customer",
    channel: conv?.channel ?? "sms",
    recipientPhone: conv?.customerPhone ?? job.customerPhone,
    recipientEmail: conv?.customerEmail ?? job.customerEmail,
    content,
    dedupeKey: `scheduling_pull_forward_offer:${jobId}:${gapId}`,
    scheduledSendAt,
    status,
  });

  await enqueueWithDedupe(message, db);
  return message;
}

// ── 8. onPullForwardAccepted ─────────────────────────────────────────────────

export async function onPullForwardAccepted(
  jobId: string,
  newWindow: string,
  db: CommunicationWiringDb,
  clock: ClockProvider,
  aiGenerator: AiTextGenerator,
): Promise<SchedulingOutboundMessage> {
  const job = await db.getSchedulingJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const conv = await db.getConversationForJob(jobId);

  const content = await generateOrFallback(
    "scheduling_pull_forward_accepted",
    aiGenerator,
    {
      purpose: "scheduling_pull_forward_accepted",
      businessName: "",
      customerName: job.customerName,
      serviceType: job.serviceType,
      technicianName: null,
      date: job.scheduledDate,
      windowInfo: null,
      additionalContext: { newWindow },
    },
    { newWindow },
  );

  const { status, scheduledSendAt } = await determineStatusAndSchedule(
    "scheduling_pull_forward_accepted",
    conv?.customerPhone ?? job.customerPhone,
    conv?.conversationId ?? null,
    clock, db,
  );

  const message = buildMessage({
    businessId: job.businessId,
    conversationId: conv?.conversationId ?? null,
    jobId,
    purpose: "scheduling_pull_forward_accepted",
    audience: "customer",
    channel: conv?.channel ?? "sms",
    recipientPhone: conv?.customerPhone ?? job.customerPhone,
    recipientEmail: conv?.customerEmail ?? job.customerEmail,
    content,
    dedupeKey: `scheduling_pull_forward_accepted:${jobId}`,
    scheduledSendAt,
    status,
  });

  await enqueueWithDedupe(message, db);
  return message;
}

// ── 9. onTechArrived ─────────────────────────────────────────────────────────
// Sends a customer-facing "your tech has arrived" notification.
// NOTE: No longer sends an immediate estimate prompt on arrival.
// The tech needs time to diagnose before giving a time estimate.
// Estimate prompts now fire from the estimateTimeoutWorker at
// 30 minutes (first prompt) and 60 minutes (reminder) post-arrival.

export async function onTechArrived(
  jobId: string,
  db: CommunicationWiringDb,
  clock: ClockProvider,
  aiGenerator: AiTextGenerator,
): Promise<SchedulingOutboundMessage> {
  const job = await db.getSchedulingJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const conv = await db.getConversationForJob(jobId);

  const content = await generateOrFallback(
    "scheduling_arrival",
    aiGenerator,
    {
      purpose: "scheduling_arrival",
      businessName: "",
      customerName: job.customerName,
      serviceType: job.serviceType,
      technicianName: null,
      date: job.scheduledDate,
      windowInfo: null,
      additionalContext: {},
    },
    { serviceType: job.serviceType },
  );

  const { status, scheduledSendAt } = await determineStatusAndSchedule(
    "scheduling_arrival",
    conv?.customerPhone ?? job.customerPhone,
    conv?.conversationId ?? null,
    clock, db,
  );

  const message = buildMessage({
    businessId: job.businessId,
    conversationId: conv?.conversationId ?? null,
    jobId,
    purpose: "scheduling_arrival",
    audience: "customer",
    channel: conv?.channel ?? "sms",
    recipientPhone: conv?.customerPhone ?? job.customerPhone,
    recipientEmail: conv?.customerEmail ?? job.customerEmail,
    content,
    dedupeKey: `scheduling_arrival:${jobId}`,
    scheduledSendAt,
    status,
  });

  await enqueueWithDedupe(message, db);
  return message;
}

// ── 9b. sendEstimatePrompt / sendEstimateReminder ────────────────────────────
// Called by the estimateTimeoutWorker at the 30-min and 60-min checkpoints.

export async function sendEstimatePrompt(
  jobId: string,
  db: CommunicationWiringDb,
  clock: ClockProvider,
  aiGenerator: AiTextGenerator,
): Promise<SchedulingOutboundMessage> {
  const job = await db.getSchedulingJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const techInfo = job.technicianId
    ? await db.getTechnicianInfo(job.technicianId)
    : null;

  const content = await generateOrFallback(
    "scheduling_tech_estimate_prompt",
    aiGenerator,
    {
      purpose: "scheduling_tech_estimate_prompt",
      businessName: "",
      customerName: null,
      serviceType: job.serviceType,
      technicianName: techInfo?.name ?? null,
      date: job.scheduledDate,
      windowInfo: null,
      additionalContext: {},
    },
    { serviceType: job.serviceType },
  );

  const message = buildMessage({
    businessId: job.businessId,
    conversationId: null,
    jobId,
    purpose: "scheduling_tech_estimate_prompt",
    audience: "technician",
    channel: "sms",
    recipientPhone: techInfo?.phone ?? null,
    recipientEmail: null,
    content,
    dedupeKey: `scheduling_tech_estimate_prompt:${jobId}:estimate_prompt_30`,
    scheduledSendAt: null,
    status: "pending",
  });

  await enqueueWithDedupe(message, db);
  return message;
}

export async function sendEstimateReminder(
  jobId: string,
  db: CommunicationWiringDb,
  clock: ClockProvider,
  aiGenerator: AiTextGenerator,
): Promise<SchedulingOutboundMessage> {
  const job = await db.getSchedulingJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  const techInfo = job.technicianId
    ? await db.getTechnicianInfo(job.technicianId)
    : null;

  const content = await generateOrFallback(
    "scheduling_tech_estimate_reminder",
    aiGenerator,
    {
      purpose: "scheduling_tech_estimate_reminder",
      businessName: "",
      customerName: null,
      serviceType: job.serviceType,
      technicianName: techInfo?.name ?? null,
      date: job.scheduledDate,
      windowInfo: null,
      additionalContext: {},
    },
    {},
  );

  const message = buildMessage({
    businessId: job.businessId,
    conversationId: null,
    jobId,
    purpose: "scheduling_tech_estimate_reminder",
    audience: "technician",
    channel: "sms",
    recipientPhone: techInfo?.phone ?? null,
    recipientEmail: null,
    content,
    dedupeKey: `scheduling_tech_estimate_prompt:${jobId}:estimate_prompt_60`,
    scheduledSendAt: null,
    status: "pending",
  });

  await enqueueWithDedupe(message, db);
  return message;
}

// ── 10. onSickTechNotice ─────────────────────────────────────────────────────

export async function onSickTechNotice(
  affectedJobs: Array<{ jobId: string; outcome: "rebooked" | "needs_rebook"; newDate?: Date }>,
  db: CommunicationWiringDb,
  clock: ClockProvider,
  aiGenerator: AiTextGenerator,
): Promise<SchedulingOutboundMessage[]> {
  const messages: SchedulingOutboundMessage[] = [];

  for (const affected of affectedJobs) {
    const job = await db.getSchedulingJob(affected.jobId);
    if (!job) continue;

    const conv = await db.getConversationForJob(affected.jobId);
    const biz = await db.getBusinessInfo(job.businessId);

    // Cancel obsolete pending messages
    await db.cancelPendingMessages(affected.jobId, "scheduling_morning_reminder");
    await db.cancelPendingMessages(affected.jobId, "scheduling_en_route");
    await db.cancelPendingMessages(affected.jobId, "scheduling_delay_notice");
    await db.cancelPendingMessages(affected.jobId, "scheduling_window_change");

    if (affected.outcome === "rebooked" && affected.newDate) {
      const content = await generateOrFallback(
        "scheduling_rebook_notice",
        aiGenerator,
        {
          purpose: "scheduling_rebook_notice",
          businessName: biz?.businessName ?? "Our team",
          customerName: job.customerName,
          serviceType: job.serviceType,
          technicianName: null,
          date: affected.newDate,
          windowInfo: null,
          additionalContext: {},
        },
        { serviceType: job.serviceType, newDate: dateStr(affected.newDate) },
      );

      const msg = buildMessage({
        businessId: job.businessId,
        conversationId: conv?.conversationId ?? null,
        jobId: affected.jobId,
        purpose: "scheduling_rebook_notice",
        audience: "customer",
        channel: conv?.channel ?? "sms",
        recipientPhone: conv?.customerPhone ?? job.customerPhone,
        recipientEmail: conv?.customerEmail ?? job.customerEmail,
        content,
        dedupeKey: `scheduling_rebook_notice:${affected.jobId}`,
        scheduledSendAt: null,
        status: "pending",
      });
      await enqueueWithDedupe(msg, db);
      messages.push(msg);
    } else {
      const content = await generateOrFallback(
        "scheduling_sick_tech_notice",
        aiGenerator,
        {
          purpose: "scheduling_sick_tech_notice",
          businessName: biz?.businessName ?? "Our team",
          customerName: job.customerName,
          serviceType: job.serviceType,
          technicianName: null,
          date: job.scheduledDate,
          windowInfo: null,
          additionalContext: {},
        },
        { serviceType: job.serviceType, originalDate: dateStr(job.scheduledDate) },
      );

      const msg = buildMessage({
        businessId: job.businessId,
        conversationId: conv?.conversationId ?? null,
        jobId: affected.jobId,
        purpose: "scheduling_sick_tech_notice",
        audience: "customer",
        channel: conv?.channel ?? "sms",
        recipientPhone: conv?.customerPhone ?? job.customerPhone,
        recipientEmail: conv?.customerEmail ?? job.customerEmail,
        content,
        dedupeKey: `scheduling_sick_tech_notice:${affected.jobId}`,
        scheduledSendAt: null,
        status: "pending",
      });
      await enqueueWithDedupe(msg, db);
      messages.push(msg);
    }
  }

  return messages;
}

// ── 11. onJobCanceled ────────────────────────────────────────────────────────

const ALL_SCHEDULING_PURPOSES: SchedulingMessagePurpose[] = [
  "scheduling_confirmation",
  "scheduling_morning_reminder",
  "scheduling_en_route",
  "scheduling_arrival",
  "scheduling_completion",
  "scheduling_delay_notice",
  "scheduling_window_change",
  "scheduling_rebook_notice",
  "scheduling_pull_forward_offer",
  "scheduling_pull_forward_accepted",
  "scheduling_tech_estimate_prompt",
  "scheduling_tech_estimate_reminder",
  "scheduling_completion_note_prompt",
  "scheduling_review_request",
  "scheduling_followup_outreach",
  "scheduling_sick_tech_notice",
];

export async function onJobCanceled(
  jobId: string,
  db: CommunicationWiringDb,
): Promise<number> {
  let totalCanceled = 0;
  for (const purpose of ALL_SCHEDULING_PURPOSES) {
    totalCanceled += await db.cancelPendingMessages(jobId, purpose);
  }
  return totalCanceled;
}
