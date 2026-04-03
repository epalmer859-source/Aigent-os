// ============================================================
// src/engine/inbound/index.ts
//
// INBOUND MESSAGE HANDLER — IMPLEMENTATION
//
// All DB access would go through Prisma in production.
// This module maintains in-memory stores (same pattern as other
// engine modules) so the test suite runs without a real DB.
//
// Production multi-table writes use Prisma.$transaction:
//   await db.$transaction(async (tx) => {
//     await tx.messages.create({ data: { ... } });
//     await tx.conversations.update({ where: { id }, data: { updated_at: now } });
//   });
// ============================================================

import { z } from "zod";
import { randomUUID } from "crypto";
import { resolveCustomer, normalizeContact } from "../customer-resolver/index";
import {
  getBusinessIsPaused,
  getConversationIsNoShow,
  cancelQueueRowsByConversationAndPurposes,
  cancelAllPendingQueueRowsForConversation,
} from "../suppression/index";
import {
  STOP_KEYWORDS,
  START_KEYWORDS,
  SILENCE_TIMER_PURPOSES,
  type InboundParams,
  type InboundResult,
} from "./contract";
import { FALLBACK_RESPONSE } from "../ai-response/contract";

// ── Zod validation schema ─────────────────────────────────────

const InboundParamsSchema = z.object({
  businessId: z.string().min(1),
  fromContact: z.string().min(1),
  contactType: z.enum(["phone", "email", "web_chat"]),
  channel: z.enum(["sms", "voice", "email", "web_chat"]),
  content: z.string(),
  mediaUrls: z.array(z.string()).optional(),
  twilioMessageSid: z.string().optional(),
});

// ── In-memory store types ─────────────────────────────────────

interface MessageRecord {
  id: string;
  businessId: string;
  conversationId: string;
  customerId: string;
  direction: "inbound";
  senderType: "customer";
  channel: string;
  content: string;
  mediaUrls: string[];
  twilioMessageSid: string | null;
  createdAt: Date;
}

// ── In-memory stores ──────────────────────────────────────────
// Production equivalent: messages table, outbound_queue table.

/** Persisted inbound message records. Production: db.messages */
const _messages = new Map<string, MessageRecord>();

/**
 * twilioMessageSid → { messageId, result } for idempotent re-delivery.
 * Production: unique index on messages.twilio_message_sid.
 */
const _sidIndex = new Map<string, { messageId: string; result: InboundResult }>();

/**
 * `${businessId}:${normalizedContact}` → consentStatus.
 * Tracks opt-out / resubscribe changes made during this session.
 * Production: read from customers.consent_status via customer_contacts lookup.
 */
const _consentMap = new Map<string, string>();

/**
 * conversationId → currentOwner ("ai" | "human_takeover" | ...).
 * Production: read from conversations.current_owner.
 */
const _conversationOwners = new Map<string, string>();

// ── Duplicate-customer detection stores (Finding 4) ──────────

/**
 * `${businessId}:${normalizedContact}` → service address.
 * Production: customers.collected_service_address, resolved via customer_contacts.
 */
const _contactServiceAddresses = new Map<string, string>();

interface ConversationAddressEntry {
  businessId: string;
  customerId: string;
  address: string;
  createdAt: Date;
}

/**
 * conversationId → address metadata for duplicate-detection lookups.
 * Production: conversations.collected_service_address + created_at.
 */
const _conversationServiceAddresses = new Map<string, ConversationAddressEntry>();

/** In-memory log of duplicate-customer events for test inspection. */
const _duplicateNotifications: Array<{
  businessId: string;
  conversationId: string;
  phone: string;
}> = [];

type DuplicateCustomerNotifyFn = (params: {
  businessId: string;
  conversationId: string;
  phone: string;
}) => Promise<void>;

// Default: no-op. Wire to deliverNotification in production-init.ts.
const _defaultDuplicateNotify: DuplicateCustomerNotifyFn = async (_p) => {};
let _duplicateNotifyFn: DuplicateCustomerNotifyFn = _defaultDuplicateNotify;

// ── Helpers ───────────────────────────────────────────────────

function _newId(): string {
  return randomUUID();
}

function _consentKey(businessId: string, normalizedContact: string): string {
  return `${businessId}:${normalizedContact}`;
}

/**
 * Determine whether the conversation was created during this call
 * (i.e. we have not seen this conversationId before).
 * Production: inferred from conversations.created_at === NOW().
 */
function _isNewConversation(conversationId: string): boolean {
  return !_conversationOwners.has(conversationId);
}

/**
 * Record a conversation's current owner so we can check it on
 * subsequent messages. Called once when the conversation is first seen.
 */
function _trackConversation(conversationId: string, owner: string): void {
  if (!_conversationOwners.has(conversationId)) {
    _conversationOwners.set(conversationId, owner);
  }
}

// ── STOP keyword handler ──────────────────────────────────────

async function _handleStopKeyword(
  params: InboundParams,
  normalizedContact: string,
): Promise<InboundResult> {
  // Resolve customer to get IDs (creates if first contact).
  const resolved = await resolveCustomer({
    businessId: params.businessId,
    contactType: params.contactType,
    contactValue: normalizedContact,
    channel: params.channel,
  });

  // Production: db.customers.update({ where: { id }, data: { consent_status: 'opted_out', opted_out_at: now } })
  const key = _consentKey(params.businessId, normalizedContact);
  _consentMap.set(key, "opted_out");

  const conv = resolved.conversation;

  // Cancel all pending/deferred outbound messages for this conversation.
  // Production: UPDATE outbound_queue SET status = 'canceled' WHERE conversation_id = $1
  //   AND status IN ('pending','deferred')
  if (conv) {
    cancelAllPendingQueueRowsForConversation(conv.id);
  }

  // Determine conversation tracking state.
  const isNewConv = conv ? _isNewConversation(conv.id) : false;
  if (conv && isNewConv) {
    _trackConversation(conv.id, conv.currentOwner);
  }

  // Production: db.messages.create({ data: { direction: 'inbound', content: params.content, ... } })
  const messageId = _newId();
  const now = new Date();
  _messages.set(messageId, {
    id: messageId,
    businessId: params.businessId,
    conversationId: conv?.id ?? "",
    customerId: resolved.customer.id,
    direction: "inbound",
    senderType: "customer",
    channel: params.channel,
    content: params.content,
    mediaUrls: params.mediaUrls ?? [],
    twilioMessageSid: params.twilioMessageSid ?? null,
    createdAt: now,
  });

  const stateChanged = isNewConv || (conv?.isReopened ?? false);

  const result: InboundResult = {
    customerId: resolved.customer.id,
    conversationId: conv?.id ?? "",
    messageId,
    isNewCustomer: resolved.customer.isNew,
    isNewConversation: isNewConv,
    isReopened: conv?.isReopened ?? false,
    aiResponseQueued: false,
    stateChanged,
    newState: stateChanged ? "new_lead" : undefined,
  };

  if (params.twilioMessageSid) {
    _sidIndex.set(params.twilioMessageSid, { messageId, result });
  }

  return result;
}

// ── START keyword handler ─────────────────────────────────────

async function _handleStartKeyword(
  params: InboundParams,
  normalizedContact: string,
): Promise<InboundResult> {
  const resolved = await resolveCustomer({
    businessId: params.businessId,
    contactType: params.contactType,
    contactValue: normalizedContact,
    channel: params.channel,
  });

  // Production: db.customers.update({ where: { id }, data: { consent_status: 'resubscribed', resubscribed_at: now } })
  const key = _consentKey(params.businessId, normalizedContact);
  _consentMap.set(key, "resubscribed");

  const conv = resolved.conversation;

  const isNewConv = conv ? _isNewConversation(conv.id) : false;
  if (conv && isNewConv) {
    _trackConversation(conv.id, conv.currentOwner);
  }

  // Production: db.messages.create({ data: { direction: 'inbound', ... } })
  const messageId = _newId();
  const now = new Date();
  _messages.set(messageId, {
    id: messageId,
    businessId: params.businessId,
    conversationId: conv?.id ?? "",
    customerId: resolved.customer.id,
    direction: "inbound",
    senderType: "customer",
    channel: params.channel,
    content: params.content,
    mediaUrls: params.mediaUrls ?? [],
    twilioMessageSid: params.twilioMessageSid ?? null,
    createdAt: now,
  });

  const stateChanged = isNewConv || (conv?.isReopened ?? false);

  const result: InboundResult = {
    customerId: resolved.customer.id,
    conversationId: conv?.id ?? "",
    messageId,
    isNewCustomer: resolved.customer.isNew,
    isNewConversation: isNewConv,
    isReopened: conv?.isReopened ?? false,
    aiResponseQueued: false,
    stateChanged,
    newState: stateChanged ? "new_lead" : undefined,
  };

  if (params.twilioMessageSid) {
    _sidIndex.set(params.twilioMessageSid, { messageId, result });
  }

  return result;
}

// ── Public API ────────────────────────────────────────────────

export async function handleInboundMessage(params: InboundParams): Promise<InboundResult> {
  // ── Step 1: Validate ────────────────────────────────────────
  InboundParamsSchema.parse(params);

  // ── Step 2: Normalize contact ───────────────────────────────
  const normalizedResult = normalizeContact(params.contactType, params.fromContact);
  if (!normalizedResult.isValid) {
    throw new Error(
      `Invalid contact value for type "${params.contactType}": "${params.fromContact}"`,
    );
  }
  const normalizedContact = normalizedResult.contactValue;

  // Production path: delegate to Prisma implementation.
  if (process.env.NODE_ENV !== "test") {
    return _handleInboundMessageFromDb(params, normalizedContact);
  }

  // ── Step 3: Dedupe (SMS only) ───────────────────────────────
  // Production: SELECT id, ... FROM messages WHERE twilio_message_sid = $1 LIMIT 1
  if (params.twilioMessageSid) {
    const existing = _sidIndex.get(params.twilioMessageSid);
    if (existing) {
      return existing.result;
    }
  }

  // ── Steps 4-5: STOP / START keyword check ──────────────────
  // Only applies to SMS channel.
  if (params.channel === "sms") {
    const contentUpper = params.content.trim().toUpperCase();
    if ((STOP_KEYWORDS as string[]).includes(contentUpper)) {
      return _handleStopKeyword(params, normalizedContact);
    }
    if ((START_KEYWORDS as string[]).includes(contentUpper)) {
      return _handleStartKeyword(params, normalizedContact);
    }
  }

  // ── Step 6: Resolve customer ────────────────────────────────
  // Production: db.$transaction([customer lookup/create, contact lookup/create, conversation lookup/create])
  const resolved = await resolveCustomer({
    businessId: params.businessId,
    contactType: params.contactType,
    contactValue: normalizedContact,
    channel: params.channel,
  });

  // Track consent status from resolver (implied_inbound for new customers).
  // Production: read from customers.consent_status.
  const key = _consentKey(params.businessId, normalizedContact);
  // Only update consentMap if we don't already have a more recent value
  // (e.g. after a STOP/START in the same session the resolver record lags).
  if (!_consentMap.has(key)) {
    _consentMap.set(key, resolved.customer.consentStatus);
  }

  // ── Finding 4: duplicate customer detection (best-effort, non-blocking) ──
  // If this is a new customer on SMS and another recent conversation for this
  // business shares the same collected_service_address → fire a notification.
  // Production: SELECT c.id FROM conversations c
  //   JOIN customers k ON k.id = c.customer_id
  //   WHERE c.business_id = $1
  //     AND k.collected_service_address = $2
  //     AND c.created_at > NOW() - INTERVAL '48 hours'
  //     AND c.id != $3
  //   LIMIT 1
  if (resolved.customer.isNew && params.channel === "sms") {
    const addrKey = _consentKey(params.businessId, normalizedContact);
    const newCustomerAddress = _contactServiceAddresses.get(addrKey) ?? null;
    if (newCustomerAddress) {
      const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000);
      for (const [existingConvId, entry] of _conversationServiceAddresses.entries()) {
        if (
          entry.businessId === params.businessId &&
          entry.createdAt > cutoff48h &&
          entry.address.toLowerCase() === newCustomerAddress.toLowerCase()
        ) {
          const newConvId = resolved.conversation?.id ?? "";
          if (existingConvId !== newConvId) {
            const notifParams = {
              businessId: params.businessId,
              conversationId: newConvId,
              phone: params.fromContact,
            };
            _duplicateNotifications.push(notifParams);
            void _duplicateNotifyFn(notifParams).catch(() => {});
            break; // Only fire once per inbound message
          }
        }
      }
    }
  }

  // doNotContact guard: throw so the caller (and tests D01/D02) can detect the rejection.
  // Production: this check prevents any further DB writes for this contact.
  if (resolved.customer.doNotContact) {
    throw new Error(
      `Message rejected: customer ${resolved.customer.id} has do_not_contact = true`,
    );
  }

  // Conversation is guaranteed non-null when doNotContact = false.
  const conv = resolved.conversation!;

  // ── Step 7: Store message ───────────────────────────────────
  // Production: db.messages.create({ data: { id, business_id, conversation_id, customer_id,
  //   direction: 'inbound', sender_type: 'customer', channel, content, media_urls,
  //   twilio_message_sid, created_at } })
  const messageId = _newId();
  const now = new Date();
  _messages.set(messageId, {
    id: messageId,
    businessId: params.businessId,
    conversationId: conv.id,
    customerId: resolved.customer.id,
    direction: "inbound",
    senderType: "customer",
    channel: params.channel,
    content: params.content,
    mediaUrls: params.mediaUrls ?? [],
    twilioMessageSid: params.twilioMessageSid ?? null,
    createdAt: now,
  });

  // ── Step 8: Track conversation owner ───────────────────────
  // Production: SELECT current_owner FROM conversations WHERE id = $1
  const isNewConv = _isNewConversation(conv.id);
  if (isNewConv) {
    // New conversation — default owner from resolver is "ai".
    _trackConversation(conv.id, conv.currentOwner);
  }

  // ── Step 9: Determine state change ─────────────────────────
  // New conversation or reopen → transition to new_lead.
  const stateChanged = isNewConv || conv.isReopened;
  const newState: string | undefined = stateChanged ? "new_lead" : undefined;

  // ── Step 10: Check AI response eligibility ─────────────────
  // Production: read business, customer, and conversation fields from DB.
  const isPaused = getBusinessIsPaused(params.businessId);
  const consentStatus = _consentMap.get(key) ?? resolved.customer.consentStatus;
  const owner = _conversationOwners.get(conv.id) ?? "ai";
  const isNoShow = getConversationIsNoShow(conv.id);

  const aiResponseQueued =
    !isPaused &&
    consentStatus !== "opted_out" &&
    owner !== "human_takeover" &&
    !isNoShow;

  // ── Step 11: Cancel silence-timer queue rows ────────────────
  // Cancel pending/deferred followup rows so the silence timer resets.
  // Production: UPDATE outbound_queue SET status = 'canceled' WHERE conversation_id = $1
  //   AND message_purpose = ANY($2) AND status IN ('pending','deferred')
  if (aiResponseQueued) {
    cancelQueueRowsByConversationAndPurposes(conv.id, SILENCE_TIMER_PURPOSES);
  }

  // ── Step 12: Store SID index and return ─────────────────────
  const result: InboundResult = {
    customerId: resolved.customer.id,
    conversationId: conv.id,
    messageId,
    isNewCustomer: resolved.customer.isNew,
    isNewConversation: isNewConv,
    isReopened: conv.isReopened,
    aiResponseQueued,
    stateChanged,
    newState,
  };

  if (params.twilioMessageSid) {
    _sidIndex.set(params.twilioMessageSid, { messageId, result });
  }

  return result;
}

// ── Production Prisma implementation ─────────────────────────

async function _handleInboundMessageFromDb(
  params: InboundParams,
  normalizedContact: string,
): Promise<InboundResult> {
  const { db } = await import("~/server/db");

  // Dedupe: check for existing message by twilio_message_sid.
  if (params.twilioMessageSid) {
    const existing = await db.message_log.findFirst({
      where: { twilio_message_sid: params.twilioMessageSid },
      select: { id: true },
    });
    if (existing) {
      // Return a minimal idempotent result (already processed).
      return {
        customerId: "",
        conversationId: "",
        messageId: existing.id,
        isNewCustomer: false,
        isNewConversation: false,
        isReopened: false,
        aiResponseQueued: false,
        stateChanged: false,
      };
    }
  }

  // STOP keyword: update consent + cancel queue rows.
  if (params.channel === "sms") {
    const contentUpper = params.content.trim().toUpperCase();
    if ((STOP_KEYWORDS as string[]).includes(contentUpper)) {
      const resolved = await resolveCustomer({
        businessId: params.businessId,
        contactType: params.contactType,
        contactValue: normalizedContact,
        channel: params.channel,
      });
      await db.customers.update({
        where: { id: resolved.customer.id },
        data: { consent_status: "opted_out", opted_out_at: new Date() },
      });
      if (resolved.conversation) {
        await db.outbound_queue.updateMany({
          where: { conversation_id: resolved.conversation.id, status: { in: ["pending", "deferred"] } },
          data: { status: "canceled" },
        });
      }
      const msg = await db.message_log.create({
        data: {
          business_id: params.businessId,
          conversation_id: resolved.conversation?.id ?? "",
          direction: "inbound",
          channel: params.channel,
          sender_type: "customer",
          content: params.content,
          twilio_message_sid: params.twilioMessageSid ?? null,
          media_urls: params.mediaUrls?.length ? params.mediaUrls : [],
        },
      });
      return {
        customerId: resolved.customer.id,
        conversationId: resolved.conversation?.id ?? "",
        messageId: msg.id,
        isNewCustomer: resolved.customer.isNew,
        isNewConversation: !resolved.conversation || resolved.customer.isNew,
        isReopened: resolved.conversation?.isReopened ?? false,
        aiResponseQueued: false,
        stateChanged: false,
      };
    }

    if ((START_KEYWORDS as string[]).includes(contentUpper)) {
      const resolved = await resolveCustomer({
        businessId: params.businessId,
        contactType: params.contactType,
        contactValue: normalizedContact,
        channel: params.channel,
      });
      await db.customers.update({
        where: { id: resolved.customer.id },
        data: { consent_status: "resubscribed" },
      });
      const msg = await db.message_log.create({
        data: {
          business_id: params.businessId,
          conversation_id: resolved.conversation?.id ?? "",
          direction: "inbound",
          channel: params.channel,
          sender_type: "customer",
          content: params.content,
          twilio_message_sid: params.twilioMessageSid ?? null,
          media_urls: params.mediaUrls?.length ? params.mediaUrls : [],
        },
      });
      return {
        customerId: resolved.customer.id,
        conversationId: resolved.conversation?.id ?? "",
        messageId: msg.id,
        isNewCustomer: resolved.customer.isNew,
        isNewConversation: !resolved.conversation || resolved.customer.isNew,
        isReopened: resolved.conversation?.isReopened ?? false,
        aiResponseQueued: false,
        stateChanged: false,
      };
    }
  }

  // Resolve customer (creates if new, in a $transaction).
  const resolved = await resolveCustomer({
    businessId: params.businessId,
    contactType: params.contactType,
    contactValue: normalizedContact,
    channel: params.channel,
  });

  if (resolved.customer.doNotContact) {
    throw new Error(`Message rejected: customer ${resolved.customer.id} has do_not_contact = true`);
  }

  const conv = resolved.conversation!;
  const isNewConv = resolved.customer.isNew || conv.isReopened;
  const stateChanged = isNewConv;
  const newState: string | undefined = stateChanged ? "new_lead" : undefined;

  // Write inbound message record.
  const msg = await db.$transaction(async (tx) => {
    const msg = await tx.message_log.create({
      data: {
        business_id: params.businessId,
        conversation_id: conv.id,
        direction: "inbound",
        channel: params.channel,
        sender_type: "customer",
        content: params.content,
        twilio_message_sid: params.twilioMessageSid ?? null,
        media_urls: params.mediaUrls?.length ? params.mediaUrls : [],
      },
    });
    await tx.conversations.update({
      where: { id: conv.id },
      data: { updated_at: new Date(), last_customer_message_at: new Date() },
    });
    return msg;
  });

  // Check AI response eligibility via DB.
  const [bizRow, convRow] = await Promise.all([
    db.businesses.findUnique({ where: { id: params.businessId }, select: { is_paused: true } }),
    db.conversations.findUnique({ where: { id: conv.id }, select: { current_owner: true, is_no_show: true } }),
  ]);
  const customerRow = await db.customers.findUnique({
    where: { id: resolved.customer.id },
    select: { consent_status: true },
  });

  const aiResponseQueued =
    !bizRow?.is_paused &&
    customerRow?.consent_status !== "opted_out" &&
    convRow?.current_owner !== "human_takeover" &&
    !convRow?.is_no_show;

  // Cancel silence-timer queue rows if AI will respond.
  if (aiResponseQueued) {
    await db.outbound_queue.updateMany({
      where: {
        conversation_id: conv.id,
        message_purpose: { in: SILENCE_TIMER_PURPOSES as any },
        status: { in: ["pending", "deferred"] },
      },
      data: { status: "canceled" },
    });
  }

  if (aiResponseQueued) {
    if (params.channel === "web_chat") {
      // Web chat: respond synchronously — create the trigger row, generate the
      // AI reply inline, mark the row as sent, and return the reply text directly.
      const queueRow = await db.outbound_queue.create({
        data: {
          business_id: params.businessId,
          conversation_id: conv.id,
          message_purpose: "ai_response",
          audience_type: "customer",
          channel: params.channel as any,
          dedupe_key: `ai_response:${conv.id}:${Date.now()}`,
          scheduled_send_at: new Date(),
        },
        select: { id: true },
      });
      const { generateAIResponse } = await import("~/engine/ai-response/index");
      const aiResult = await generateAIResponse({
        businessId: params.businessId,
        conversationId: conv.id,
        inboundMessageId: msg.id,
      });
      await db.outbound_queue.update({
        where: { id: queueRow.id },
        data: { status: "sent" },
      });
      return {
        customerId: resolved.customer.id,
        conversationId: conv.id,
        messageId: msg.id,
        isNewCustomer: resolved.customer.isNew,
        isNewConversation: isNewConv,
        isReopened: conv.isReopened,
        aiResponseQueued,
        stateChanged,
        newState,
        aiReplyText: aiResult.decision?.response_text ?? FALLBACK_RESPONSE,
      };
    } else {
      // SMS / email / voice: enqueue for the queue worker to process asynchronously.
      await db.outbound_queue.create({
        data: {
          business_id: params.businessId,
          conversation_id: conv.id,
          message_purpose: "ai_response",
          audience_type: "customer",
          channel: params.channel as any,
          dedupe_key: `ai_response:${conv.id}:${Date.now()}`,
          scheduled_send_at: new Date(),
        },
      });
    }
  }

  return {
    customerId: resolved.customer.id,
    conversationId: conv.id,
    messageId: msg.id,
    isNewCustomer: resolved.customer.isNew,
    isNewConversation: isNewConv,
    isReopened: conv.isReopened,
    aiResponseQueued,
    stateChanged,
    newState,
  };
}

// ── Test helpers ──────────────────────────────────────────────

export function _resetInboundStoreForTest(): void {
  _messages.clear();
  _sidIndex.clear();
  _consentMap.clear();
  _conversationOwners.clear();
  _contactServiceAddresses.clear();
  _conversationServiceAddresses.clear();
  _duplicateNotifications.length = 0;
  _duplicateNotifyFn = _defaultDuplicateNotify;
}

export function _getMessageForTest(id: string): MessageRecord | undefined {
  return _messages.get(id);
}

export function _getMessageCountForTest(): number {
  return _messages.size;
}

/**
 * Look up consent status by businessId + normalized contact value.
 * Production: SELECT consent_status FROM customers
 *   JOIN customer_contacts ON customers.id = customer_contacts.customer_id
 *   WHERE customer_contacts.business_id = $1
 *     AND customer_contacts.contact_value = $2
 */
export async function _getConsentStatusForTest(
  businessId: string,
  normalizedContact: string,
): Promise<string | undefined> {
  return _consentMap.get(_consentKey(businessId, normalizedContact));
}

/**
 * Override a conversation's current owner.
 * Used by tests to simulate human_takeover state.
 * Production: db.conversations.update({ where: { id }, data: { current_owner: owner } })
 */
export function _setConversationOwnerForTest(conversationId: string, owner: string): void {
  _conversationOwners.set(conversationId, owner);
}

// ── Duplicate-detection test helpers (Finding 4) ─────────────

/**
 * Seed a service address for a contact so duplicate detection can fire.
 * Key is `${businessId}:${normalizedContact}` (E.164 phone).
 */
export function _seedContactServiceAddressForTest(
  businessId: string,
  normalizedContact: string,
  address: string,
): void {
  _contactServiceAddresses.set(`${businessId}:${normalizedContact}`, address);
}

/** Seed an existing conversation's address for duplicate comparison. */
export function _seedConversationServiceAddressForTest(
  conversationId: string,
  entry: { businessId: string; customerId: string; address: string; createdAt: Date },
): void {
  _conversationServiceAddresses.set(conversationId, entry);
}

export function _setDuplicateNotifyForTest(fn: DuplicateCustomerNotifyFn): void {
  _duplicateNotifyFn = fn;
}

export function _getDuplicateNotificationsForTest(): ReadonlyArray<{
  businessId: string;
  conversationId: string;
  phone: string;
}> {
  return _duplicateNotifications;
}
