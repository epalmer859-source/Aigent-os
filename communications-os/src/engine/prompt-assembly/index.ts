// ============================================================
// src/engine/prompt-assembly/index.ts
//
// PROMPT ASSEMBLY ENGINE — IMPLEMENTATION
//
// All DB access would go through Prisma in production.
// This module maintains in-memory stores (same pattern as other
// engine modules) so the test suite runs without a real DB.
//
// Production Prisma query pattern:
//   const biz = await db.businesses.findUniqueOrThrow({ where: { id: context.businessId } });
//   const conv = await db.conversations.findUniqueOrThrow({ where: { id: context.conversationId } });
//   const customer = await db.customers.findUniqueOrThrow({ where: { id: context.customerId } });
//   const msgs = await db.messages.findMany({
//     where: { conversation_id: context.conversationId },
//     orderBy: { created_at: 'asc' },
//     take: MAX_HISTORY_MESSAGES,
//   });
// ============================================================

import { z } from "zod";
import {
  MAX_HISTORY_MESSAGES,
  AI_DISCLOSURE_TEMPLATE,
  RESPONSE_FORMAT_INSTRUCTION,
  type PromptContext,
  type AssembledPrompt,
  type ConversationMessage,
  type PromptMetadata,
} from "./contract";

// ── Zod validation ────────────────────────────────────────────

const PromptContextSchema = z.object({
  businessId: z.string().min(1),
  conversationId: z.string().min(1),
  customerId: z.string().min(1),
  inboundMessageId: z.string().min(1),
});

// ── In-memory record types ────────────────────────────────────

interface BusinessConfigRecord {
  id: string;
  name: string;
  industry: string;
  phone: string;
  signoffName: string;
  hours: string;
  servicesOffered: string[];
  servicesNotOffered: string[];
  serviceArea: string;
  cancellationPolicy: string | null;
  warrantyPolicy: string | null;
  paymentMethods: string[];
  customerPhilosophy: string | null;
  customInstructions: string | null;
}

interface ConversationDataRecord {
  id: string;
  businessId: string;
  customerId: string;
  primaryState: string;
  currentOwner: string;
  cachedSummary: string | null;
  tags: string[];
  workflowStep: string | null;
  requestedDataFields: string[] | null;
}

interface CustomerDataRecord {
  id: string;
  businessId: string;
  displayName: string | null;
  aiDisclosureSentAt: Date | null;
}

interface MessageRecord {
  id: string;
  conversationId: string;
  businessId: string;
  direction: "inbound" | "outbound";
  senderType: string;
  content: string;
  createdAt: Date;
}

// ── In-memory stores ──────────────────────────────────────────

const _businessConfigs = new Map<string, BusinessConfigRecord>();
const _conversationData = new Map<string, ConversationDataRecord>();
const _customerData = new Map<string, CustomerDataRecord>();
const _allMessages = new Map<string, MessageRecord>();

// ── Industry rules ────────────────────────────────────────────

const CAPABILITIES: Record<string, string[]> = {
  plumbing: [
    "Provide quotes and pricing information for standard plumbing services.",
    "Schedule service appointments and coordinate availability with the team.",
    "Collect customer details including service description, address, and photos.",
    "Answer questions about services offered and explain what is not in scope.",
    "Follow up on pending quotes and confirm upcoming scheduled jobs.",
    "Process warranty claims and coordinate return visits for covered work.",
    "Provide estimated arrival windows and communicate technician dispatch status.",
  ],
  hvac: [
    "Schedule maintenance, repair, and installation appointments.",
    "Provide quotes for standard HVAC services and equipment.",
    "Collect system details (make, model, age) to prepare technicians.",
    "Follow up on pending estimates and seasonal maintenance reminders.",
    "Answer questions about energy efficiency and maintenance schedules.",
  ],
  landscaping: [
    "Schedule lawn care, landscaping, and seasonal cleanup appointments.",
    "Provide quotes for recurring and one-time landscaping services.",
    "Collect property details and service preferences.",
    "Follow up on pending proposals and seasonal service renewals.",
    "Answer questions about service frequency and plant care.",
  ],
};

const GENERIC_CAPABILITIES: string[] = [
  "Schedule appointments and coordinate service delivery.",
  "Provide quotes and pricing information for offered services.",
  "Collect customer details needed to fulfill service requests.",
  "Follow up on pending quotes and confirm upcoming jobs.",
  "Answer questions about services offered and business policies.",
];

const PROHIBITIONS: Record<string, string[]> = {
  plumbing: [
    "Never guarantee a specific price without a site inspection or formal estimate.",
    "Never advise customers to perform plumbing repairs that require a licensed plumber.",
    "Never diagnose issues that require an engineer's structural assessment.",
    "Never commit to same-day service without confirming with the team first.",
  ],
  hvac: [
    "Never guarantee equipment performance without a site assessment.",
    "Never advise customers to perform repairs on pressurized refrigerant systems.",
    "Never commit to same-day service without dispatcher confirmation.",
  ],
  landscaping: [
    "Never guarantee results for plant health without an on-site evaluation.",
    "Never confirm scheduling without checking crew availability.",
    "Never quote tree removal prices without an on-site assessment.",
  ],
};

const GENERIC_PROHIBITIONS: string[] = [
  "Never make promises the business cannot keep without team confirmation.",
  "Never provide legal, medical, or licensed professional advice.",
  "Never share other customers' information.",
];

// ── Scheduling availability rule ─────────────────────────────

const SCHEDULING_AVAILABILITY_RULE = `-- SCHEDULING AVAILABILITY RULE (mandatory) --
Whenever scheduling or availability comes up — whether you are starting to book, confirming timing, or the customer asks when you can come — you MUST present this exact list every time, word for word, before asking anything else about timing:

"What availability works best for you?
• Soonest available
• Mornings only
• Afternoons only
• No preference
• Anything specific we should know about your availability?"

Do not paraphrase, shorten, or skip this list. Do not ask a vague question like "when works for you?" — always show the full list above.`;

// ── Universal AI behavior rules ───────────────────────────────

const UNIVERSAL_RULES = [
  "Always be warm, professional, and concise. Match the customer's tone.",
  "Never greet the customer more than once. If there is already a message in the conversation history, do not open your reply with 'Hey', 'Hi', 'Hello', or any greeting — jump straight into helping them.",
  "CRITICAL — COLLECT NAME AND PHONE FIRST: Before discussing services, pricing, scheduling, or anything else, you must have the customer's full name and a number we can reach them at later. Ask for both together in one message. Frame the phone number as 'a number we can reach you at' — not as a callback or callback number. Once collected, do not ask for them again.",
  "Never impersonate a human team member by name.",
  "If a conversation escalates (complaint, legal threat, safety issue), immediately flag for human review and do not attempt to resolve it yourself.",
  "Do not provide legal, medical, or structural engineering advice under any circumstances.",
  "Never promise a specific technician, arrival time, or price without team confirmation.",
  "Always confirm the customer's address before scheduling.",
  "If you are uncertain about any detail, tell the customer you will check with the team.",
  "Respect STOP opt-out requests immediately and do not send further messages.",
  "Keep messages concise — no walls of text. Use plain, friendly language.",
  "Never use emojis in any response under any circumstances.",
];

// ── State-specific instructions ───────────────────────────────

const STATE_INSTRUCTIONS: Record<string, string> = {
  new_lead:
    "You are in intake mode. Follow this exact collection order: (1) full name and a number we can reach them at — ask for both together in one message if not already provided; (2) what service they need; (3) their address — set show_address_form to true in your JSON response when asking for the address. Do not move to the next step until the current one is complete. When it is time to ask about scheduling, follow the SCHEDULING AVAILABILITY RULE exactly.",
  lead_qualified:
    "The lead is qualified. Continue gathering any missing details and move toward booking. If the customer's address has not been collected yet, ask for it now and set show_address_form to true in your JSON response so a form appears for them to fill in. When timing comes up, follow the SCHEDULING AVAILABILITY RULE exactly.",
  booking_in_progress:
    "You are helping schedule an appointment. If the address has not been collected yet, ask for it and set show_address_form to true in your JSON response. Follow the SCHEDULING AVAILABILITY RULE to ask about timing. Do NOT recap anything mid-conversation. Once you have all five: name, phone, service, address, and availability preference — (1) Confirm everything back to the customer in one clean summary so they can review it. (2) Ask if there is anything else or any changes. If they say no or confirm everything looks good, set bookingConfirmed to true and propose a state change to 'booked'. The AI dispatching layer will handle scheduling from here. Do not ask again or confirm again after closing.",
  quote_sent:
    "A quote has been sent to the customer. Follow up on their decision. Answer questions about the quote. Do not pressure — be helpful and let the quote speak for itself.",
  lead_followup_active:
    "This is a follow-up conversation. Check in warmly, reference prior context if available, and offer to help move forward.",
  booked:
    "The appointment is booked. Confirm the date, time, and address. Provide the business phone for day-of questions.",
  job_completed:
    "The job is complete. Send a closeout message: thank the customer for their business, ask about their satisfaction, mention your review link, and provide the business phone for any future questions.",
};

function _getStateInstruction(state: string): string {
  return (
    STATE_INSTRUCTIONS[state] ??
    `Current state: ${state}. Follow standard conversation flow and respond helpfully to whatever the customer says.`
  );
}

// ── AIDecision schema (Layer 4) ───────────────────────────────

const AI_DECISION_SCHEMA = `
{
  "response_text": "string — the message to send to the customer",
  "proposed_state_change": "string | null — proposed conversation state transition, or null if no change",
  "requested_data_fields": "string[] — fields you still need from the customer, or []",
  "confidence": "number — 0.0 to 1.0, how confident you are in this response",
  "handoff_required": "boolean — true if a human should take over this conversation",
  "handoff_reason": "string | null — why handoff is needed, or null",
  "message_purpose": "string — purpose label for this message, e.g. 'new_lead_response', 'booking_confirmation', 'general_reply'",
  "detected_intent": "string — your classification of what the customer is asking for",
  "is_first_message": "boolean — true if this is the very first message sent to this customer",
  "rule_flags": "string[] — active rule flags. Use [] if none apply. Known values: 'human_requested', 'aggressive_message', 'out_of_area', 'booking_confirmed'. Set 'booking_confirmed' when the customer has confirmed all details and there is nothing else.",
  "bookingConfirmed": "boolean — set to true ONLY when the customer has explicitly confirmed everything and there is nothing else. Do not set prematurely.",
  "collected_name": "string | null — the customer's full name if provided this turn, otherwise null",
  "collected_phone": "string | null — the customer's phone number if provided this turn, otherwise null",
  "availability_preference": "string | null — scheduling preference if collected this turn (e.g. 'Soonest available', 'Mornings only'), otherwise null",
  "show_address_form": "boolean — set to true ONLY when you are asking the customer to provide their address. The web chat will display a structured form. Set to false at all other times."
}`;

// ── Layer builders ────────────────────────────────────────────

function _buildLayer1(biz: BusinessConfigRecord): string {
  const lines: string[] = [
    "=== BUSINESS IDENTITY ===",
    `You are ${biz.signoffName}, the AI assistant for ${biz.name}, a ${biz.industry} business.`,
    `Business phone: ${biz.phone}`,
    `Business hours: ${biz.hours}`,
    `Services offered: ${biz.servicesOffered.join(", ")}`,
  ];
  if (biz.servicesNotOffered.length > 0) {
    lines.push(`Services NOT offered: ${biz.servicesNotOffered.join(", ")}`);
  }
  lines.push(`Service area: ${biz.serviceArea}`);
  if (biz.cancellationPolicy) lines.push(`Cancellation policy: ${biz.cancellationPolicy}`);
  if (biz.warrantyPolicy) lines.push(`Warranty policy: ${biz.warrantyPolicy}`);
  if (biz.paymentMethods.length > 0) {
    lines.push(`Payment methods: ${biz.paymentMethods.join(", ")}`);
  }
  if (biz.customerPhilosophy) lines.push(`Customer philosophy: ${biz.customerPhilosophy}`);
  if (biz.customInstructions) lines.push(`Special instructions: ${biz.customInstructions}`);
  return lines.join("\n");
}

function _buildLayer2(
  conv: ConversationDataRecord,
  customer: CustomerDataRecord,
  biz: BusinessConfigRecord,
  channel: string | undefined,
): string {
  const lines: string[] = [
    "\n=== CONVERSATION CONTEXT ===",
    `Current conversation state: ${conv.primaryState}`,
    `Current owner: ${conv.currentOwner}`,
    `Customer name: ${customer.displayName ?? "Unknown"}`,
  ];
  if (conv.cachedSummary) {
    lines.push(`Conversation summary: ${conv.cachedSummary}`);
  }
  if (conv.tags.length > 0) {
    lines.push(`Active tags: ${conv.tags.join(", ")}`);
  }
  if (conv.workflowStep) {
    lines.push(`Current workflow step: ${conv.workflowStep}`);
  }
  if (conv.requestedDataFields && conv.requestedDataFields.length > 0) {
    lines.push(`Still waiting for: ${conv.requestedDataFields.join(", ")}`);
  }

  // AI disclosure required for SMS; not required for web_chat.
  if (channel !== "web_chat" && customer.aiDisclosureSentAt === null) {
    const disclosure = AI_DISCLOSURE_TEMPLATE
      .replace("{signoff_name}", biz.signoffName)
      .replace("{business_name}", biz.name);
    lines.push(
      `\nIMPORTANT: This is your first message to this customer. You MUST include the AI disclosure in your response: "${disclosure}"`,
    );
  }

  return lines.join("\n");
}

function _buildLayer3(
  biz: BusinessConfigRecord,
  conv: ConversationDataRecord,
  channel: string | undefined,
): { text: string; capCount: number; probCount: number } {
  const capabilities = CAPABILITIES[biz.industry] ?? GENERIC_CAPABILITIES;
  const prohibitions = PROHIBITIONS[biz.industry] ?? GENERIC_PROHIBITIONS;

  const identityRule = channel === "web_chat"
    ? "Never volunteer that you are an AI or a bot. If the customer directly asks whether they are speaking to a person or a bot, deflect naturally — say something like \"I'm here to help\" or \"Let me take care of that for you\" — and redirect the conversation back to their needs."
    : "Always identify yourself as an AI assistant if the customer directly asks.";

  const lines: string[] = [
    "\n=== RULES, CAPABILITIES, AND INSTRUCTIONS ===",
    "\n-- Universal AI Behavior Rules --",
    ...UNIVERSAL_RULES.map((r) => `• ${r}`),
    `• ${identityRule}`,
    `\n${SCHEDULING_AVAILABILITY_RULE}`,
    "\n-- Industry Capabilities --",
    ...capabilities.map((c) => `• ${c}`),
    "\n-- Industry Prohibitions --",
    ...prohibitions.map((p) => `• ${p}`),
    "\n-- State-Specific Instructions --",
    _getStateInstruction(conv.primaryState),
  ];

  return {
    text: lines.join("\n"),
    capCount: capabilities.length,
    probCount: prohibitions.length,
  };
}

function _buildLayer4(): string {
  return [
    "\n=== RESPONSE FORMAT ===",
    "You MUST respond with a JSON object matching this exact schema:",
    AI_DECISION_SCHEMA,
    RESPONSE_FORMAT_INSTRUCTION,
  ].join("\n");
}

// ── Public API ────────────────────────────────────────────────

export async function assemblePrompt(context: PromptContext): Promise<AssembledPrompt> {
  // Validate input
  PromptContextSchema.parse(context);

  if (process.env.NODE_ENV !== "test") {
    return _assemblePromptFromDb(context);
  }

  // Production: db.businesses.findUniqueOrThrow({ where: { id: context.businessId } })
  const biz = _businessConfigs.get(context.businessId);
  if (!biz) throw new Error(`Business not found: ${context.businessId}`);

  // Production: db.conversations.findUniqueOrThrow({ where: { id: context.conversationId } })
  const conv = _conversationData.get(context.conversationId);
  if (!conv) throw new Error(`Conversation not found: ${context.conversationId}`);

  // Production: db.customers.findUniqueOrThrow({ where: { id: context.customerId } })
  const customer = _customerData.get(context.customerId);
  if (!customer) throw new Error(`Customer not found: ${context.customerId}`);

  // Build all 4 layers
  const layer1 = _buildLayer1(biz);
  const layer2 = _buildLayer2(conv, customer, biz, context.channel);
  const layer3Result = _buildLayer3(biz, conv, context.channel);
  const layer4 = _buildLayer4();

  const systemPrompt = [layer1, layer2, layer3Result.text, layer4].join("\n");

  // Build conversation history
  // Production: db.messages.findMany({
  //   where: { conversation_id: context.conversationId },
  //   orderBy: { created_at: 'asc' },
  // })
  const allConvMsgs = [..._allMessages.values()]
    .filter((m) => m.conversationId === context.conversationId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const historyMsgs = allConvMsgs.slice(-MAX_HISTORY_MESSAGES);

  const conversationHistory: ConversationMessage[] = historyMsgs.map((m) => ({
    role: m.direction === "inbound" ? "user" : "assistant",
    content: m.content,
    timestamp: m.createdAt,
  }));

  const metadata: PromptMetadata = {
    businessName: biz.name,
    industry: biz.industry,
    conversationState: conv.primaryState,
    customerName: customer.displayName,
    messageCount: conversationHistory.length,
    promptTokenEstimate: Math.ceil(systemPrompt.length / 4),
    capabilitiesIncluded: layer3Result.capCount,
    prohibitionsIncluded: layer3Result.probCount,
  };

  return { systemPrompt, conversationHistory, metadata };
}

// ── Utility: safely coerce unknown DB values to string[] ─────
// Postgres JSON columns may come back as a string (if stored as a JSON string)
// or as a native JS array (if stored as a jsonb array).  Either way we need
// a plain string[] before calling .join().

function ensureArray(val: unknown): string[] {
  if (Array.isArray(val)) return val as string[];
  if (typeof val === "string") {
    try { return JSON.parse(val) as string[]; } catch { return [val]; }
  }
  return [];
}

// ── Production Prisma implementation ─────────────────────────

async function _assemblePromptFromDb(context: PromptContext): Promise<AssembledPrompt> {
  const { db } = await import("~/server/db");

  // Fetch business + config together.
  const bizRow = await db.businesses.findUniqueOrThrow({
    where: { id: context.businessId },
    include: { business_config: true },
  });

  const cfg = bizRow.business_config;
  const servicesOffered = cfg ? ensureArray(cfg.services_offered) : [];
  const servicesNotOffered = cfg ? ensureArray(cfg.services_not_offered) : [];

  // Build service area string.
  let serviceArea = "Service area not configured";
  if (cfg) {
    if (cfg.service_area_type === "radius" && cfg.service_area_radius_miles && cfg.service_area_center_address) {
      serviceArea = `${cfg.service_area_radius_miles}-mile radius from ${cfg.service_area_center_address}`;
    } else if (cfg.service_area_list) {
      const list = cfg.service_area_list as string[];
      serviceArea = Array.isArray(list) ? list.join(", ") : String(cfg.service_area_list);
    }
  }

  // Build hours string from JSON.
  let hoursStr = "Hours not configured";
  if (cfg?.business_hours) {
    try {
      const h = cfg.business_hours as Record<string, string>;
      hoursStr = Object.entries(h).map(([day, hours]) => `${day}: ${hours}`).join(", ");
    } catch {
      hoursStr = String(cfg.business_hours);
    }
  }

  const paymentMethods = ensureArray(
    bizRow.payment_methods
      ? bizRow.payment_methods.split(",").map((s) => s.trim())
      : [],
  );

  const biz: BusinessConfigRecord = {
    id: bizRow.id,
    name: bizRow.business_name,
    industry: bizRow.industry as string,
    phone: bizRow.preferred_phone_number ?? "",
    signoffName: bizRow.ai_signoff_name ?? bizRow.business_name,
    hours: hoursStr,
    servicesOffered,
    servicesNotOffered,
    serviceArea,
    cancellationPolicy: bizRow.cancellation_policy ?? null,
    warrantyPolicy: bizRow.warranty_policy ?? null,
    paymentMethods,
    customerPhilosophy: bizRow.customer_philosophy ?? null,
    customInstructions: bizRow.important_details ?? null,
  };

  // Fetch conversation + tags.
  const convRow = await db.conversations.findUniqueOrThrow({
    where: { id: context.conversationId },
    include: { conversation_tags: { where: { is_active: true }, select: { tag_code: true } } },
  });

  const conv: ConversationDataRecord = {
    id: convRow.id,
    businessId: convRow.business_id,
    customerId: convRow.customer_id,
    primaryState: convRow.primary_state as string,
    currentOwner: convRow.current_owner,
    cachedSummary: convRow.cached_summary ?? null,
    tags: ensureArray(convRow.conversation_tags.map((t) => t.tag_code)),
    workflowStep: convRow.current_workflow_step ?? null,
    requestedDataFields: null,
  };

  // Fetch customer.
  const customerRow = await db.customers.findUniqueOrThrow({
    where: { id: context.customerId },
    select: { id: true, business_id: true, display_name: true, ai_disclosure_sent_at: true },
  });

  const customer: CustomerDataRecord = {
    id: customerRow.id,
    businessId: customerRow.business_id,
    displayName: customerRow.display_name ?? null,
    aiDisclosureSentAt: customerRow.ai_disclosure_sent_at ?? null,
  };

  // Build all 4 layers.
  const layer1 = _buildLayer1(biz);
  const layer2 = _buildLayer2(conv, customer, biz, context.channel);
  const layer3Result = _buildLayer3(biz, conv, context.channel);
  const layer4 = _buildLayer4();
  const systemPrompt = [layer1, layer2, layer3Result.text, layer4].join("\n");

  // Fetch conversation messages.
  const dbMessages = await db.message_log.findMany({
    where: { conversation_id: context.conversationId },
    orderBy: { created_at: "asc" },
    take: MAX_HISTORY_MESSAGES,
    select: { direction: true, content: true, created_at: true },
  });

  const conversationHistory: ConversationMessage[] = dbMessages.map((m) => ({
    role: m.direction === "inbound" ? "user" : "assistant",
    content: m.content ?? "",
    timestamp: m.created_at,
  }));

  const metadata: PromptMetadata = {
    businessName: biz.name,
    industry: biz.industry,
    conversationState: conv.primaryState,
    customerName: customer.displayName,
    messageCount: conversationHistory.length,
    promptTokenEstimate: Math.ceil(systemPrompt.length / 4),
    capabilitiesIncluded: layer3Result.capCount,
    prohibitionsIncluded: layer3Result.probCount,
  };

  return { systemPrompt, conversationHistory, metadata };
}

// ── Test helpers ──────────────────────────────────────────────

export function _resetPromptAssemblyStoreForTest(): void {
  _businessConfigs.clear();
  _conversationData.clear();
  _customerData.clear();
  _allMessages.clear();
}

export function _seedBusinessConfigForTest(data: Record<string, unknown>): void {
  // Production: db.businesses.upsert({ ... })
  _businessConfigs.set(data["id"] as string, data as unknown as BusinessConfigRecord);
}

export function _seedConversationDataForTest(data: Record<string, unknown>): void {
  // Production: db.conversations.upsert({ ... })
  _conversationData.set(data["id"] as string, data as unknown as ConversationDataRecord);
}

export function _seedCustomerDataForTest(data: Record<string, unknown>): void {
  // Production: db.customers.upsert({ ... })
  _customerData.set(data["id"] as string, data as unknown as CustomerDataRecord);
}

export function _seedMessageForTest(data: Record<string, unknown>): void {
  // Production: db.messages.create({ ... })
  _allMessages.set(data["id"] as string, data as unknown as MessageRecord);
}

// ── Cross-module getters (used by ai-response engine) ─────────

export function getConversationCustomerId(conversationId: string): string | null {
  // Test path only (production path uses Prisma directly in ai-response module).
  // Production: db.conversations.findUnique({ where: { id: conversationId }, select: { customer_id: true } })
  return _conversationData.get(conversationId)?.customerId ?? null;
}

export function getConversationState(conversationId: string): string | null {
  // Test path only (production path uses Prisma directly in ai-response module).
  // Production: db.conversations.findUnique({ where: { id: conversationId }, select: { primary_state: true } })
  return _conversationData.get(conversationId)?.primaryState ?? null;
}

export function updateConversationState(conversationId: string, newState: string): void {
  // Test path only (production path uses Prisma directly in ai-response module).
  // Production: db.conversations.update({ where: { id: conversationId }, data: { primary_state: newState } })
  const conv = _conversationData.get(conversationId);
  if (conv) conv.primaryState = newState;
}

export function updateConversationSummary(conversationId: string, summary: string): void {
  // Test path only (production path uses Prisma directly in ai-response module).
  // Production: db.conversations.update({ where: { id: conversationId }, data: { cached_summary: summary } })
  const conv = _conversationData.get(conversationId);
  if (conv) conv.cachedSummary = summary;
}

export function getConversationSummary(conversationId: string): string | null {
  // Test path only (production path uses Prisma directly in ai-response module).
  // Production: db.conversations.findUnique({ where: { id: conversationId }, select: { cached_summary: true } })
  return _conversationData.get(conversationId)?.cachedSummary ?? null;
}

export function getConversationMessages(conversationId: string): MessageRecord[] {
  // Test path only (production path uses Prisma directly in ai-response module).
  // Production: db.message_log.findMany({ where: { conversation_id: conversationId }, orderBy: { created_at: 'asc' } })
  return [..._allMessages.values()]
    .filter((m) => m.conversationId === conversationId)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}
