// ============================================================
// Communication Wiring — Tests
//
// Every test traces to a rule in unified-scheduling-spec.md.
// Uses stateful in-memory DB fakes with real dedupe + cancellation.
//
// Assumptions:
//   - AI text generator is mocked (returns generated or ai_unavailable).
//   - ClockProvider is faked for deterministic time.
//   - All DB operations use stateful in-memory fakes.
//   - Quiet hours use UTC for deterministic testing.
// ============================================================

import { describe, it, expect, vi } from "vitest";
import {
  onJobBooked,
  onMorningReminderDue,
  onTechEnRoute,
  onJobCompleted,
  onDriftCommunicationTriggered,
  onJobRebooked,
  onPullForwardOffer,
  onPullForwardAccepted,
  onTechArrived,
  onSickTechNotice,
  onJobCanceled,
  onReviewRequested,
  onFollowUpCreated,
  sendEstimatePrompt,
  sendEstimateReminder,
  buildCannedTemplate,
  checkRateLimits,
  determineMorningReminderTier,
  type CommunicationWiringDb,
  type AiTextGenerator,
  type ClockProvider,
  type SchedulingOutboundMessage,
  type SchedulingMessagePurpose,
  type SchedulingJobWithContext,
} from "../communication-wiring";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TODAY = new Date("2026-04-09");
const NOW = new Date("2026-04-09T14:00:00Z"); // 2pm UTC, outside quiet hours

function makeClock(now = NOW): ClockProvider {
  return {
    now: () => now,
    today: () => TODAY,
  };
}

function makeAiGenerator(available = true): AiTextGenerator {
  return {
    generateText: vi.fn().mockResolvedValue(
      available
        ? { outcome: "generated" as const, content: "AI-generated message text" }
        : { outcome: "ai_unavailable" as const, content: "Canned fallback text", usedFallback: true as const },
    ),
  };
}

function makeJob(overrides: Partial<SchedulingJobWithContext> = {}): SchedulingJobWithContext {
  return {
    jobId: "job-1",
    businessId: "biz-1",
    technicianId: "tech-a",
    customerName: "Jane Doe",
    customerPhone: "+15551234567",
    customerEmail: "jane@example.com",
    serviceType: "HVAC Repair",
    scheduledDate: TODAY,
    status: "NOT_STARTED",
    ...overrides,
  };
}

// ── Stateful In-memory CommunicationWiringDb ────────────────────────────────

interface InMemoryCommState {
  jobs: Map<string, SchedulingJobWithContext>;
  messages: SchedulingOutboundMessage[];
  hourlyMessageCounts: Map<string, number>;
  dailyNonUrgentCounts: Map<string, number>;
  queuePositions: Map<string, { position: number; totalJobs: number; estimatedWindowStart: string | null; estimatedWindowEnd: string | null; softEstimate: string | null }>;
}

function freshCommState(): InMemoryCommState {
  return {
    jobs: new Map(),
    messages: [],
    hourlyMessageCounts: new Map(),
    dailyNonUrgentCounts: new Map(),
    queuePositions: new Map(),
  };
}

function createInMemoryCommDb(state: InMemoryCommState): CommunicationWiringDb {
  const db: CommunicationWiringDb = {
    async getSchedulingJob(jobId) {
      return state.jobs.get(jobId) ?? null;
    },

    async getConversationForJob(jobId) {
      const job = state.jobs.get(jobId);
      if (!job) return null;
      return {
        conversationId: `conv-${jobId}`,
        channel: "sms" as const,
        customerPhone: job.customerPhone,
        customerEmail: job.customerEmail,
      };
    },

    async getBusinessInfo() {
      return {
        businessName: "Cool Air Co",
        quietHoursStart: "21:00",
        quietHoursEnd: "07:00",
        timezone: "America/New_York",
        preferredPhone: "+15559876543",
        openTime: "08:00",
      };
    },

    async getTechnicianInfo(techId) {
      return { name: `Tech ${techId}`, phone: `+1555${techId.replace(/\D/g, "")}0000` };
    },

    async getQueuePositionContext(jobId) {
      return state.queuePositions.get(jobId) ?? {
        position: 1,
        totalJobs: 5,
        estimatedWindowStart: "09:00",
        estimatedWindowEnd: "10:30",
        softEstimate: "mid-morning",
      };
    },

    async enqueueOutboundMessage(message) {
      state.messages.push(message);
    },

    async getPendingOrDeferredByDedupeKey(dedupeKey) {
      return state.messages.find(
        (m) => m.dedupeKey === dedupeKey && (m.status === "pending" || m.status === "deferred"),
      ) ?? null;
    },

    async getMessageCountForRecipientSince(recipientPhone) {
      return state.hourlyMessageCounts.get(recipientPhone) ?? 0;
    },

    async getNonUrgentMessageCountForConversationSince(conversationId) {
      return state.dailyNonUrgentCounts.get(conversationId) ?? 0;
    },

    async getPendingMessagesForJob(jobId, purpose) {
      return state.messages.filter(
        (m) => m.schedulingJobId === jobId && m.purpose === purpose && (m.status === "pending" || m.status === "deferred"),
      );
    },

    async cancelPendingMessages(jobId, purpose) {
      let count = 0;
      for (const m of state.messages) {
        if (m.schedulingJobId === jobId && m.purpose === purpose && (m.status === "pending" || m.status === "deferred")) {
          (m as { status: string }).status = "canceled";
          count++;
        }
      }
      return count;
    },

    async transaction<T>(fn: (tx: CommunicationWiringDb) => Promise<T>): Promise<T> {
      return fn(db);
    },
  };

  return db;
}

/** Helper: count messages still pending/deferred (not canceled) */
function activeMsgs(state: InMemoryCommState): SchedulingOutboundMessage[] {
  return state.messages.filter((m) => m.status === "pending" || m.status === "deferred");
}

/** Helper: count messages by purpose that are still active */
function activeByPurpose(state: InMemoryCommState, purpose: SchedulingMessagePurpose): SchedulingOutboundMessage[] {
  return activeMsgs(state).filter((m) => m.purpose === purpose);
}

// ── onJobBooked ──────────────────────────────────────────────────────────────

describe("onJobBooked", () => {
  it("enqueues scheduling_confirmation with correct dedupeKey", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onJobBooked("job-1", db, makeClock(), makeAiGenerator());

    expect(msg.purpose).toBe("scheduling_confirmation");
    expect(msg.dedupeKey).toBe("scheduling_confirmation:job-1");
    expect(msg.audience).toBe("customer");
    expect(activeMsgs(state)).toHaveLength(1);
  });

  it("uses AI text when available", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onJobBooked("job-1", db, makeClock(), makeAiGenerator(true));

    expect(msg.content).toBe("AI-generated message text");
  });

  it("falls back to canned template when AI unavailable", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onJobBooked("job-1", db, makeClock(), makeAiGenerator(false));

    expect(msg.content).toContain("confirmed");
    expect(msg.content).toContain("Cool Air Co");
  });

  it("not quiet-hours restricted", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onJobBooked("job-1", db, makeClock(), makeAiGenerator());

    expect(msg.quietHoursRestricted).toBe(false);
  });
});

// ── onMorningReminderDue ─────────────────────────────────────────────────────

describe("onMorningReminderDue", () => {
  it("position 1-2 -> window tier", () => {
    const tier = determineMorningReminderTier(1, "09:00", "10:30", "mid-morning");
    expect(tier.tier).toBe("window");
    if (tier.tier === "window") {
      expect(tier.windowStart).toBe("09:00");
      expect(tier.windowEnd).toBe("10:30");
    }
  });

  it("position 2 -> window tier", () => {
    const tier = determineMorningReminderTier(2, "10:00", "11:00", null);
    expect(tier.tier).toBe("window");
  });

  it("position 3 -> soft tier", () => {
    const tier = determineMorningReminderTier(3, "09:00", "10:30", "mid-morning");
    expect(tier.tier).toBe("soft");
    if (tier.tier === "soft") {
      expect(tier.estimate).toBe("mid-morning");
    }
  });

  it("position 4+ -> none tier", () => {
    const tier = determineMorningReminderTier(4, "09:00", "10:30", "mid-morning");
    expect(tier.tier).toBe("none");
  });

  it("position 5 -> none tier", () => {
    const tier = determineMorningReminderTier(5, null, null, null);
    expect(tier.tier).toBe("none");
  });

  it("dedupeKey includes date", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onMorningReminderDue("job-1", db, makeClock(), makeAiGenerator());

    expect(msg.dedupeKey).toBe(`scheduling_morning_reminder:job-1:${TODAY.toISOString().split("T")[0]}`);
  });

  it("deferred when in quiet hours", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);
    // 5am UTC = inside quiet hours (21:00-07:00)
    const clock = makeClock(new Date("2026-04-09T05:00:00Z"));

    const msg = await onMorningReminderDue("job-1", db, clock, makeAiGenerator());

    expect(msg.quietHoursRestricted).toBe(true);
    expect(msg.scheduledSendAt).not.toBeNull();
    expect(msg.status).toBe("deferred");
  });

  it("quiet-hours restricted flag is set", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onMorningReminderDue("job-1", db, makeClock(), makeAiGenerator());

    expect(msg.quietHoursRestricted).toBe(true);
  });
});

// ── onTechEnRoute ────────────────────────────────────────────────────────────

describe("onTechEnRoute", () => {
  it("enqueues urgent scheduling_en_route", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onTechEnRoute("job-1", db, makeClock(), makeAiGenerator());

    expect(msg.purpose).toBe("scheduling_en_route");
    expect(msg.isUrgent).toBe(true);
  });

  it("cancels pending delay_notice and window_change", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    // Pre-seed a delay notice
    await onDriftCommunicationTriggered(
      "job-1",
      { action: "communicate_customer", reason: "variance_exceeded_45min" },
      db, makeClock(), makeAiGenerator(),
    );
    expect(activeByPurpose(state, "scheduling_delay_notice")).toHaveLength(1);

    await onTechEnRoute("job-1", db, makeClock(), makeAiGenerator());

    // Old delay notice should be canceled
    expect(activeByPurpose(state, "scheduling_delay_notice")).toHaveLength(0);
    // en_route should exist
    expect(activeByPurpose(state, "scheduling_en_route")).toHaveLength(1);
  });

  it("not quiet-hours restricted", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onTechEnRoute("job-1", db, makeClock(), makeAiGenerator());

    expect(msg.quietHoursRestricted).toBe(false);
  });
});

// ── onJobCompleted ───────────────────────────────────────────────────────────

describe("onJobCompleted", () => {
  it("enqueues customer completion message", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const messages = await onJobCompleted("job-1", db, makeClock(), makeAiGenerator());

    const custMsg = messages.find((m) => m.purpose === "scheduling_completion");
    expect(custMsg).toBeDefined();
    expect(custMsg!.audience).toBe("customer");
  });

  it("does NOT enqueue tech completion_note_prompt (moved to UI buttons)", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const messages = await onJobCompleted("job-1", db, makeClock(), makeAiGenerator());

    const techMsg = messages.find((m) => m.purpose === "scheduling_completion_note_prompt");
    expect(techMsg).toBeUndefined();
    expect(messages).toHaveLength(1);
  });

  it("cancels obsolete pending scheduling messages before enqueueing new ones", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    // Pre-seed some messages that should be canceled on completion
    await onMorningReminderDue("job-1", db, makeClock(), makeAiGenerator());
    expect(activeByPurpose(state, "scheduling_morning_reminder")).toHaveLength(1);

    await onJobCompleted("job-1", db, makeClock(), makeAiGenerator());

    // Morning reminder should be canceled
    expect(activeByPurpose(state, "scheduling_morning_reminder")).toHaveLength(0);
    // Completion message should exist (no more completion_note_prompt)
    expect(activeByPurpose(state, "scheduling_completion")).toHaveLength(1);
  });

  it("customer completion obeys quiet-hours rule", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const messages = await onJobCompleted("job-1", db, makeClock(), makeAiGenerator());
    const custMsg = messages.find((m) => m.purpose === "scheduling_completion");

    expect(custMsg!.quietHoursRestricted).toBe(true);
  });
});

// ── onDriftCommunicationTriggered ────────────────────────────────────────────

describe("onDriftCommunicationTriggered", () => {
  it("sends scheduling_delay_notice when late", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onDriftCommunicationTriggered(
      "job-1",
      { action: "communicate_customer", reason: "variance_exceeded_45min" },
      db, makeClock(), makeAiGenerator(),
    );

    expect(msg.purpose).toBe("scheduling_delay_notice");
  });

  it("sends scheduling_window_change when window crossed", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onDriftCommunicationTriggered(
      "job-1",
      { windowCrossed: true, newWindowStart: "14:00", newWindowEnd: "15:30" },
      db, makeClock(), makeAiGenerator(),
    );

    expect(msg.purpose).toBe("scheduling_window_change");
  });

  it("cancels older pending drift-related messages", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    // Send first delay notice
    await onDriftCommunicationTriggered(
      "job-1",
      { action: "communicate_customer", reason: "variance_exceeded_45min" },
      db, makeClock(), makeAiGenerator(),
    );
    expect(activeByPurpose(state, "scheduling_delay_notice")).toHaveLength(1);

    // Send second one — should cancel the first
    await onDriftCommunicationTriggered(
      "job-1",
      { action: "communicate_customer", reason: "variance_exceeded_45min" },
      db, makeClock(), makeAiGenerator(),
    );

    // Only the latest should be active (first was canceled, but dedupe blocks the second since dedupeKey is same)
    // Actually, the first was canceled, then the new one has same dedupeKey but old one is now "canceled" so dedupe allows it
    expect(activeByPurpose(state, "scheduling_delay_notice")).toHaveLength(1);
  });
});

// ── onJobRebooked ────────────────────────────────────────────────────────────

describe("onJobRebooked", () => {
  it("cancels obsolete pending messages for old schedule", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    // Pre-seed a morning reminder
    await onMorningReminderDue("job-1", db, makeClock(), makeAiGenerator());
    expect(activeByPurpose(state, "scheduling_morning_reminder")).toHaveLength(1);

    await onJobRebooked("job-1", TODAY, new Date("2026-04-11"), db, makeClock(), makeAiGenerator());

    // Old morning reminder should be canceled
    const activeReminders = activeByPurpose(state, "scheduling_morning_reminder");
    // The new one for the new date should exist
    expect(activeReminders.length).toBe(1);
    expect(activeReminders[0]!.dedupeKey).toContain("2026-04-11");
  });

  it("enqueues rebook_notice", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const messages = await onJobRebooked("job-1", TODAY, new Date("2026-04-11"), db, makeClock(), makeAiGenerator());

    expect(messages.some((m) => m.purpose === "scheduling_rebook_notice")).toBe(true);
  });

  it("enqueues morning reminder for the new date", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const messages = await onJobRebooked("job-1", TODAY, new Date("2026-04-11"), db, makeClock(), makeAiGenerator());

    const reminder = messages.find((m) => m.purpose === "scheduling_morning_reminder");
    expect(reminder).toBeDefined();
    expect(reminder!.dedupeKey).toBe("scheduling_morning_reminder:job-1:2026-04-11");
    expect(reminder!.scheduledSendAt).not.toBeNull();
  });

  it("new morning reminder dedupeKey uses new date, not old date", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const messages = await onJobRebooked("job-1", TODAY, new Date("2026-04-11"), db, makeClock(), makeAiGenerator());

    const reminder = messages.find((m) => m.purpose === "scheduling_morning_reminder");
    expect(reminder!.dedupeKey).not.toContain(TODAY.toISOString().split("T")[0]);
    expect(reminder!.dedupeKey).toContain("2026-04-11");
  });

  it("throws when business has no timezone configured", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);
    // Override getBusinessInfo to return null (no business found)
    db.getBusinessInfo = async () => null;

    await expect(
      onJobRebooked("job-1", TODAY, new Date("2026-04-11"), db, makeClock(), makeAiGenerator()),
    ).rejects.toThrow("has no timezone configured");
  });
});

// ── onPullForwardOffer ───────────────────────────────────────────────────────

describe("onPullForwardOffer", () => {
  it("enqueues offer with YES CTA in canned fallback", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onPullForwardOffer(
      "job-1", "gap-1", "10:00 AM", new Date("2026-04-09T10:20:00Z"),
      db, makeClock(), makeAiGenerator(false),
    );

    expect(msg.content).toContain("Reply YES");
    expect(msg.content).toContain("10:00 AM");
  });

  it("dedupeKey includes gapId", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onPullForwardOffer(
      "job-1", "gap-42", "10:00 AM", new Date("2026-04-09T10:20:00Z"),
      db, makeClock(), makeAiGenerator(),
    );

    expect(msg.dedupeKey).toBe("scheduling_pull_forward_offer:job-1:gap-42");
  });

  it("quiet-hours restricted", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onPullForwardOffer(
      "job-1", "gap-1", "10:00 AM", new Date("2026-04-09T10:20:00Z"),
      db, makeClock(), makeAiGenerator(),
    );

    expect(msg.quietHoursRestricted).toBe(true);
  });
});

// ── onPullForwardAccepted ────────────────────────────────────────────────────

describe("onPullForwardAccepted", () => {
  it("enqueues earlier-time confirmation", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onPullForwardAccepted("job-1", "10:00 AM", db, makeClock(), makeAiGenerator(false));

    expect(msg.purpose).toBe("scheduling_pull_forward_accepted");
    expect(msg.content).toContain("10:00 AM");
  });

  it("not quiet-hours restricted", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onPullForwardAccepted("job-1", "10:00 AM", db, makeClock(), makeAiGenerator());

    expect(msg.quietHoursRestricted).toBe(false);
  });
});

// ── onTechArrived ────────────────────────────────────────────────────────────

describe("onTechArrived", () => {
  it("enqueues customer arrival notification", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onTechArrived("job-1", db, makeClock(), makeAiGenerator());

    expect(msg.purpose).toBe("scheduling_arrival");
    expect(msg.audience).toBe("customer");
  });

  it("includes service type in fallback", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onTechArrived("job-1", db, makeClock(), makeAiGenerator(false));

    expect(msg.content).toContain("HVAC Repair");
  });

  it("is urgent (not quiet-hours restricted)", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onTechArrived("job-1", db, makeClock(), makeAiGenerator());

    expect(msg.isUrgent).toBe(true);
    expect(msg.quietHoursRestricted).toBe(false);
  });

  it("does NOT send tech estimate prompt (moved to worker checkpoints)", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    await onTechArrived("job-1", db, makeClock(), makeAiGenerator());

    const techMsgs = activeMsgs(state).filter((m) => m.audience === "technician");
    expect(techMsgs).toHaveLength(0);
  });
});

// ── sendEstimatePrompt / sendEstimateReminder ────────────────────────────────

describe("sendEstimatePrompt", () => {
  it("enqueues tech estimate prompt with 30-min dedupeKey", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await sendEstimatePrompt("job-1", db, makeClock(), makeAiGenerator());

    expect(msg.purpose).toBe("scheduling_tech_estimate_prompt");
    expect(msg.audience).toBe("technician");
    expect(msg.dedupeKey).toBe("scheduling_tech_estimate_prompt:job-1:estimate_prompt_30");
  });

  it("includes service type in fallback", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await sendEstimatePrompt("job-1", db, makeClock(), makeAiGenerator(false));

    expect(msg.content).toContain("HVAC Repair");
  });
});

describe("sendEstimateReminder", () => {
  it("enqueues tech estimate reminder with 60-min dedupeKey", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await sendEstimateReminder("job-1", db, makeClock(), makeAiGenerator());

    expect(msg.purpose).toBe("scheduling_tech_estimate_reminder");
    expect(msg.audience).toBe("technician");
    expect(msg.dedupeKey).toBe("scheduling_tech_estimate_prompt:job-1:estimate_prompt_60");
  });

  it("uses canned fallback when AI unavailable", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await sendEstimateReminder("job-1", db, makeClock(), makeAiGenerator(false));

    expect(msg.content).toContain("quick update");
  });
});

// ── onReviewRequested ────────────────────────────────────────────────────────

describe("onReviewRequested", () => {
  it("enqueues review request with review link", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onReviewRequested("job-1", "https://g.page/review/test", db, makeClock(), makeAiGenerator());

    expect(msg).not.toBeNull();
    expect(msg!.purpose).toBe("scheduling_review_request");
    expect(msg!.audience).toBe("customer");
  });

  it("uses review link in canned fallback", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onReviewRequested("job-1", "https://g.page/review/test", db, makeClock(), makeAiGenerator(false));

    expect(msg!.content).toContain("https://g.page/review/test");
    expect(msg!.content).toContain("Cool Air Co");
  });

  it("returns null when review link is empty", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onReviewRequested("job-1", "", db, makeClock(), makeAiGenerator());

    expect(msg).toBeNull();
  });

  it("is quiet-hours restricted", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onReviewRequested("job-1", "https://g.page/review/test", db, makeClock(), makeAiGenerator());

    expect(msg!.quietHoursRestricted).toBe(true);
  });
});

// ── onFollowUpCreated ────────────────────────────────────────────────────────

describe("onFollowUpCreated", () => {
  it("enqueues follow-up outreach to customer", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onFollowUpCreated("job-1", db, makeClock(), makeAiGenerator());

    expect(msg.purpose).toBe("scheduling_followup_outreach");
    expect(msg.audience).toBe("customer");
  });

  it("includes service type and business name in fallback", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onFollowUpCreated("job-1", db, makeClock(), makeAiGenerator(false));

    expect(msg.content).toContain("HVAC Repair");
    expect(msg.content).toContain("Cool Air Co");
  });

  it("is quiet-hours restricted", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onFollowUpCreated("job-1", db, makeClock(), makeAiGenerator());

    expect(msg.quietHoursRestricted).toBe(true);
  });
});

// ── onSickTechNotice ─────────────────────────────────────────────────────────

describe("onSickTechNotice", () => {
  it("sends rebook_notice for rebooked jobs", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const messages = await onSickTechNotice(
      [{ jobId: "job-1", outcome: "rebooked", newDate: new Date("2026-04-11") }],
      db, makeClock(), makeAiGenerator(),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]!.purpose).toBe("scheduling_rebook_notice");
  });

  it("sends sick_tech_notice for needs_rebook jobs", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const messages = await onSickTechNotice(
      [{ jobId: "job-1", outcome: "needs_rebook" }],
      db, makeClock(), makeAiGenerator(),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]!.purpose).toBe("scheduling_sick_tech_notice");
  });

  it("cancels obsolete pending messages for original schedule", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    // Pre-seed a morning reminder
    await onMorningReminderDue("job-1", db, makeClock(), makeAiGenerator());
    expect(activeByPurpose(state, "scheduling_morning_reminder")).toHaveLength(1);

    await onSickTechNotice(
      [{ jobId: "job-1", outcome: "needs_rebook" }],
      db, makeClock(), makeAiGenerator(),
    );

    // Morning reminder should be canceled
    expect(activeByPurpose(state, "scheduling_morning_reminder")).toHaveLength(0);
    // Sick tech notice should exist
    expect(activeByPurpose(state, "scheduling_sick_tech_notice")).toHaveLength(1);
  });
});

// ── onJobCanceled ────────────────────────────────────────────────────────────

describe("onJobCanceled", () => {
  it("cancels all active pending scheduling messages", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    // Pre-seed some messages
    await onJobBooked("job-1", db, makeClock(), makeAiGenerator());
    await onMorningReminderDue("job-1", db, makeClock(), makeAiGenerator());
    expect(activeMsgs(state).length).toBeGreaterThanOrEqual(2);

    await onJobCanceled("job-1", db);

    // All should be canceled
    expect(activeMsgs(state)).toHaveLength(0);
  });

  it("returns count and enqueues nothing new", async () => {
    const state = freshCommState();
    const db = createInMemoryCommDb(state);

    await onJobCanceled("job-1", db);

    // No new active messages
    expect(activeMsgs(state)).toHaveLength(0);
  });
});

// ── buildCannedTemplate ──────────────────────────────────────────────────────

describe("buildCannedTemplate", () => {
  const ALL_PURPOSES: SchedulingMessagePurpose[] = [
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

  it("returns correct template for every SchedulingMessagePurpose", () => {
    for (const purpose of ALL_PURPOSES) {
      const template = buildCannedTemplate(purpose);
      expect(template.purpose).toBe(purpose);
      expect(template.template.length).toBeGreaterThan(0);
    }
  });

  it("variable lists match expected substitution keys", () => {
    const confirm = buildCannedTemplate("scheduling_confirmation");
    expect(confirm.variables).toContain("businessName");
    expect(confirm.variables).toContain("serviceType");
    expect(confirm.variables).toContain("date");

    const enRoute = buildCannedTemplate("scheduling_en_route");
    expect(enRoute.variables).toContain("etaMinutes");

    const arrival = buildCannedTemplate("scheduling_arrival");
    expect(arrival.variables).toContain("serviceType");

    const completion = buildCannedTemplate("scheduling_completion");
    expect(completion.variables).toContain("businessPhone");

    const rebook = buildCannedTemplate("scheduling_rebook_notice");
    expect(rebook.variables).toContain("newDate");

    const offer = buildCannedTemplate("scheduling_pull_forward_offer");
    expect(offer.variables).toContain("newWindow");

    const sickTech = buildCannedTemplate("scheduling_sick_tech_notice");
    expect(sickTech.variables).toContain("originalDate");

    const review = buildCannedTemplate("scheduling_review_request");
    expect(review.variables).toContain("reviewLink");
    expect(review.variables).toContain("businessName");

    const followup = buildCannedTemplate("scheduling_followup_outreach");
    expect(followup.variables).toContain("businessName");
    expect(followup.variables).toContain("serviceType");
  });
});

// ── checkRateLimits ──────────────────────────────────────────────────────────

describe("checkRateLimits", () => {
  it("allows under limits", async () => {
    const state = freshCommState();
    const db = createInMemoryCommDb(state);

    const result = await checkRateLimits("+15551234567", "conv-1", false, makeClock(), db);

    expect(result.allowed).toBe(true);
  });

  it("defers on hourly limit", async () => {
    const state = freshCommState();
    state.hourlyMessageCounts.set("+15551234567", 10);
    const db = createInMemoryCommDb(state);

    const result = await checkRateLimits("+15551234567", "conv-1", false, makeClock(), db);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("hourly_limit");
    expect(result.defer).toBe(true);
  });

  it("defers on daily cap for non-urgent", async () => {
    const state = freshCommState();
    state.dailyNonUrgentCounts.set("conv-1", 2);
    const db = createInMemoryCommDb(state);

    const result = await checkRateLimits("+15551234567", "conv-1", false, makeClock(), db);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("daily_cap");
  });

  it("allows urgent when only daily cap exceeded", async () => {
    const state = freshCommState();
    state.dailyNonUrgentCounts.set("conv-1", 2);
    const db = createInMemoryCommDb(state);

    const result = await checkRateLimits("+15551234567", "conv-1", true, makeClock(), db);

    expect(result.allowed).toBe(true);
  });

  it("hourly limit still applies to urgent", async () => {
    const state = freshCommState();
    state.hourlyMessageCounts.set("+15551234567", 10);
    const db = createInMemoryCommDb(state);

    const result = await checkRateLimits("+15551234567", "conv-1", true, makeClock(), db);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("hourly_limit");
  });
});

// ── Dedupe Tests ─────────────────────────────────────────────────────────────

describe("dedupe enforcement", () => {
  it("calling onJobBooked twice does not create duplicate confirmation", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    await onJobBooked("job-1", db, makeClock(), makeAiGenerator());
    await onJobBooked("job-1", db, makeClock(), makeAiGenerator());

    expect(activeByPurpose(state, "scheduling_confirmation")).toHaveLength(1);
  });

  it("calling onMorningReminderDue twice for same date does not duplicate", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    await onMorningReminderDue("job-1", db, makeClock(), makeAiGenerator());
    await onMorningReminderDue("job-1", db, makeClock(), makeAiGenerator());

    expect(activeByPurpose(state, "scheduling_morning_reminder")).toHaveLength(1);
  });

  it("calling onPullForwardOffer twice with same gapId does not create duplicate offers", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    await onPullForwardOffer("job-1", "gap-1", "10:00 AM", new Date("2026-04-09T10:20:00Z"), db, makeClock(), makeAiGenerator());
    await onPullForwardOffer("job-1", "gap-1", "10:00 AM", new Date("2026-04-09T10:20:00Z"), db, makeClock(), makeAiGenerator());

    expect(activeByPurpose(state, "scheduling_pull_forward_offer")).toHaveLength(1);
  });

  it("onTechEnRoute twice does not duplicate", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    await onTechEnRoute("job-1", db, makeClock(), makeAiGenerator());
    await onTechEnRoute("job-1", db, makeClock(), makeAiGenerator());

    expect(activeByPurpose(state, "scheduling_en_route")).toHaveLength(1);
  });

  it("different dedupeKeys allow separate messages (different gaps)", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    await onPullForwardOffer("job-1", "gap-1", "10:00 AM", new Date("2026-04-09T10:20:00Z"), db, makeClock(), makeAiGenerator());
    await onPullForwardOffer("job-1", "gap-2", "11:00 AM", new Date("2026-04-09T11:20:00Z"), db, makeClock(), makeAiGenerator());

    expect(activeByPurpose(state, "scheduling_pull_forward_offer")).toHaveLength(2);
  });

  it("after cancellation, same dedupeKey can be re-enqueued", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    await onJobBooked("job-1", db, makeClock(), makeAiGenerator());
    expect(activeByPurpose(state, "scheduling_confirmation")).toHaveLength(1);

    // Cancel it
    await db.cancelPendingMessages("job-1", "scheduling_confirmation");
    expect(activeByPurpose(state, "scheduling_confirmation")).toHaveLength(0);

    // Re-enqueue should work since old one is canceled
    await onJobBooked("job-1", db, makeClock(), makeAiGenerator());
    expect(activeByPurpose(state, "scheduling_confirmation")).toHaveLength(1);
  });
});

// ── Quiet-hours + Rate-limit Combo Tests ─────────────────────────────────────

describe("quiet-hours + rate-limit interaction", () => {
  it("quiet-hours deferred message gets deferred status, not pending", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);
    // 5am UTC = inside quiet hours (21:00-07:00)
    const clock = makeClock(new Date("2026-04-09T05:00:00Z"));

    const msg = await onMorningReminderDue("job-1", db, clock, makeAiGenerator());

    expect(msg.status).toBe("deferred");
    expect(msg.scheduledSendAt).not.toBeNull();
  });

  it("rate-limited + quiet-hours: status=deferred, scheduledSendAt preserved from quiet-hours", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    // Trip the daily cap
    state.dailyNonUrgentCounts.set("conv-job-1", 2);
    const db = createInMemoryCommDb(state);
    // Inside quiet hours
    const clock = makeClock(new Date("2026-04-09T05:00:00Z"));

    const msg = await onMorningReminderDue("job-1", db, clock, makeAiGenerator());

    expect(msg.status).toBe("deferred");
    // scheduledSendAt should be the quiet-hours end time, not null
    expect(msg.scheduledSendAt).not.toBeNull();
  });

  it("quiet-hours restricted + hourly limit exceeded -> deferred with scheduledSendAt preserved", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    // Trip hourly limit
    state.hourlyMessageCounts.set("+15551234567", 10);
    const db = createInMemoryCommDb(state);
    // Inside quiet hours
    const clock = makeClock(new Date("2026-04-09T05:00:00Z"));

    const msg = await onMorningReminderDue("job-1", db, clock, makeAiGenerator());

    expect(msg.status).toBe("deferred");
    // scheduledSendAt should still be set from quiet-hours, not wiped by rate limit
    expect(msg.scheduledSendAt).not.toBeNull();
  });

  it("rate-limited outside quiet-hours: deferred with no scheduledSendAt", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    // Trip hourly limit
    state.hourlyMessageCounts.set("+15551234567", 10);
    const db = createInMemoryCommDb(state);

    const msg = await onJobBooked("job-1", db, makeClock(), makeAiGenerator());

    expect(msg.status).toBe("deferred");
    expect(msg.scheduledSendAt).toBeNull();
  });
});

// ── Cancellation Realism Tests ──────────────────────────────────────────────

describe("cancellation realism", () => {
  it("onJobCanceled cancels real pre-seeded messages", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    // Seed confirmation + morning reminder
    await onJobBooked("job-1", db, makeClock(), makeAiGenerator());
    await onMorningReminderDue("job-1", db, makeClock(), makeAiGenerator());
    expect(activeMsgs(state).length).toBe(2);

    const count = await onJobCanceled("job-1", db);

    expect(count).toBe(2);
    expect(activeMsgs(state)).toHaveLength(0);
  });

  it("cancellation only affects the specified job", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    state.jobs.set("job-2", makeJob({ jobId: "job-2" }));
    const db = createInMemoryCommDb(state);

    await onJobBooked("job-1", db, makeClock(), makeAiGenerator());
    await onJobBooked("job-2", db, makeClock(), makeAiGenerator());
    expect(activeMsgs(state)).toHaveLength(2);

    await onJobCanceled("job-1", db);

    // job-2's message should still be active
    expect(activeMsgs(state)).toHaveLength(1);
    expect(activeMsgs(state)[0]!.schedulingJobId).toBe("job-2");
  });
});

// ── Customer-message Safety Tests ───────────────────────────────────────────

describe("customer-message safety", () => {
  it("no customer-facing message contains tech name in canned fallback", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onJobBooked("job-1", db, makeClock(), makeAiGenerator(false));
    expect(msg.content).not.toContain("Tech tech-a");
    expect(msg.audience).toBe("customer");

    const enRouteMsg = await onTechEnRoute("job-1", db, makeClock(), makeAiGenerator(false));
    expect(enRouteMsg.content).not.toContain("Tech tech-a");
  });

  it("tech-facing sendEstimatePrompt has audience=technician", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await sendEstimatePrompt("job-1", db, makeClock(), makeAiGenerator());

    expect(msg.audience).toBe("technician");
    expect(msg.purpose).toBe("scheduling_tech_estimate_prompt");
  });

  it("onTechArrived sends customer-facing message (not tech-facing)", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const msg = await onTechArrived("job-1", db, makeClock(), makeAiGenerator());

    expect(msg.audience).toBe("customer");
    expect(msg.purpose).toBe("scheduling_arrival");
  });
});

// ── Edge Case Tests ─────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("onJobCompleted cancels only obsolete messages, completion remains", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    // Seed messages that should be canceled
    await onJobBooked("job-1", db, makeClock(), makeAiGenerator());
    await onMorningReminderDue("job-1", db, makeClock(), makeAiGenerator());
    await onTechEnRoute("job-1", db, makeClock(), makeAiGenerator());
    expect(activeMsgs(state).length).toBe(3);

    await onJobCompleted("job-1", db, makeClock(), makeAiGenerator());

    // morning_reminder and en_route canceled; confirmation survives (not in cancel list for completion)
    expect(activeByPurpose(state, "scheduling_morning_reminder")).toHaveLength(0);
    expect(activeByPurpose(state, "scheduling_en_route")).toHaveLength(0);
    // Customer completion present, no tech completion_note_prompt (removed)
    expect(activeByPurpose(state, "scheduling_completion")).toHaveLength(1);
    expect(activeByPurpose(state, "scheduling_completion_note_prompt")).toHaveLength(0);
  });

  it("onTechEnRoute replaces prior drift messages without duplicating", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    // Seed delay and window change messages
    await onDriftCommunicationTriggered(
      "job-1",
      { action: "communicate_customer", reason: "variance_exceeded_45min" },
      db, makeClock(), makeAiGenerator(),
    );
    await onDriftCommunicationTriggered(
      "job-1",
      { windowCrossed: true, newWindowStart: "14:00", newWindowEnd: "15:30" },
      db, makeClock(), makeAiGenerator(),
    );
    expect(activeByPurpose(state, "scheduling_delay_notice")).toHaveLength(0); // canceled by window change
    expect(activeByPurpose(state, "scheduling_window_change")).toHaveLength(1);

    await onTechEnRoute("job-1", db, makeClock(), makeAiGenerator());

    // Both drift types canceled, only en_route active
    expect(activeByPurpose(state, "scheduling_delay_notice")).toHaveLength(0);
    expect(activeByPurpose(state, "scheduling_window_change")).toHaveLength(0);
    expect(activeByPurpose(state, "scheduling_en_route")).toHaveLength(1);
  });

  it("missing conversation still allows customer message via job phone/email", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);
    // Override getConversationForJob to return null
    db.getConversationForJob = async () => null;

    const msg = await onJobBooked("job-1", db, makeClock(), makeAiGenerator());

    expect(msg.recipientPhone).toBe("+15551234567");
    expect(msg.recipientEmail).toBe("jane@example.com");
    expect(msg.channel).toBe("sms"); // fallback channel
  });

  it("missing technician info on sendEstimatePrompt: message still created with null phone", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob({ technicianId: "unknown-tech" }));
    const db = createInMemoryCommDb(state);
    // Override to return null for unknown tech
    db.getTechnicianInfo = async () => null;

    const msg = await sendEstimatePrompt("job-1", db, makeClock(), makeAiGenerator());

    expect(msg.audience).toBe("technician");
    expect(msg.recipientPhone).toBeNull();
    expect(msg.purpose).toBe("scheduling_tech_estimate_prompt");
  });

  it("missing business info fallback still produces canned content safely", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);
    // Override to return null business
    db.getBusinessInfo = async () => null;

    const msg = await onJobBooked("job-1", db, makeClock(), makeAiGenerator(false));

    // Should use "Our team" fallback
    expect(msg.content).toContain("Our team");
    expect(msg.content.length).toBeGreaterThan(0);
  });

  it("customer-facing canned fallback does not include technician name", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    // Canned fallback should say "technician" generically but never include the actual tech name
    const confirmMsg = await onJobBooked("job-1", db, makeClock(), makeAiGenerator(false));
    expect(confirmMsg.content).not.toContain("Tech tech-a");
    expect(confirmMsg.content).not.toContain("tech-a");

    const completionMsgs = await onJobCompleted("job-1", db, makeClock(), makeAiGenerator(false));
    const custCompletion = completionMsgs.find((m) => m.audience === "customer");
    expect(custCompletion!.content).not.toContain("Tech tech-a");
    expect(custCompletion!.content).not.toContain("tech-a");
  });

  it("onJobCompleted returns only customer message (no tech prompt)", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    const messages = await onJobCompleted("job-1", db, makeClock(), makeAiGenerator());

    expect(messages).toHaveLength(1);
    expect(messages[0]!.purpose).toBe("scheduling_completion");
  });

  it("onSickTechNotice handles mix of rebooked and needs_rebook", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    state.jobs.set("job-2", makeJob({ jobId: "job-2" }));
    const db = createInMemoryCommDb(state);

    const messages = await onSickTechNotice(
      [
        { jobId: "job-1", outcome: "rebooked", newDate: new Date("2026-04-11") },
        { jobId: "job-2", outcome: "needs_rebook" },
      ],
      db, makeClock(), makeAiGenerator(),
    );

    expect(messages).toHaveLength(2);
    expect(messages[0]!.purpose).toBe("scheduling_rebook_notice");
    expect(messages[1]!.purpose).toBe("scheduling_sick_tech_notice");
  });

  it("onJobBooked throws for nonexistent job", async () => {
    const state = freshCommState();
    const db = createInMemoryCommDb(state);

    await expect(onJobBooked("nonexistent", db, makeClock(), makeAiGenerator()))
      .rejects.toThrow("Job not found");
  });

  it("full lifecycle: book → remind → en_route → arrive → complete — correct message trail", async () => {
    const state = freshCommState();
    state.jobs.set("job-1", makeJob());
    const db = createInMemoryCommDb(state);

    await onJobBooked("job-1", db, makeClock(), makeAiGenerator());
    await onMorningReminderDue("job-1", db, makeClock(), makeAiGenerator());
    await onTechEnRoute("job-1", db, makeClock(), makeAiGenerator());
    await onTechArrived("job-1", db, makeClock(), makeAiGenerator());
    await onJobCompleted("job-1", db, makeClock(), makeAiGenerator());

    // After completion: confirmation active, morning reminder canceled, en_route canceled,
    // arrival active, completion active (no completion_note_prompt)
    expect(activeByPurpose(state, "scheduling_confirmation")).toHaveLength(1);
    expect(activeByPurpose(state, "scheduling_morning_reminder")).toHaveLength(0);
    expect(activeByPurpose(state, "scheduling_en_route")).toHaveLength(0);
    expect(activeByPurpose(state, "scheduling_arrival")).toHaveLength(1);
    expect(activeByPurpose(state, "scheduling_completion")).toHaveLength(1);
    expect(activeByPurpose(state, "scheduling_completion_note_prompt")).toHaveLength(0);
  });
});
