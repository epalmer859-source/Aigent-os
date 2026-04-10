// ============================================================
// src/engine/web-chat/index.ts
//
// WEB CHAT ENDPOINT — IMPLEMENTATION
//
// All DB access would go through Prisma in production.
// This module maintains in-memory stores so the test suite
// runs without a real DB.
//
// Production Prisma patterns:
//   const biz = await db.businesses.findUnique({ where: { id: businessId } });
//   const session = await db.web_chat_sessions.findUnique({ where: { session_token: sessionToken } });
//   await db.web_chat_sessions.create({ data: { ... } });
// ============================================================

import { z } from "zod";
import {
  SESSION_DURATION_HOURS,
  RATE_LIMIT_PER_HOUR,
  WEB_CHAT_CHANNEL,
  WEB_CHAT_MAX_CONTENT_LENGTH,
  type WebChatRequest,
  type WebChatResponse,
  type WebChatInboundHandlerFn,
} from "./contract";

// ── Zod schema ────────────────────────────────────────────────

const WebChatRequestSchema = z.object({
  businessId: z.string().min(1),
  content: z.string().min(1).max(WEB_CHAT_MAX_CONTENT_LENGTH),
  sessionToken: z.string().optional(),
});

// ── In-memory record types ────────────────────────────────────

interface SessionRecord {
  id: string;
  businessId: string;
  conversationId: string | null;
  customerId: string | null;
  messageCount: number;
  createdAt: Date;
  expiresAt: Date;
}

interface BusinessRecord {
  id: string;
  deletedAt: Date | null;
}

// ── In-memory stores ──────────────────────────────────────────

const _sessions = new Map<string, SessionRecord>();
const _businesses = new Map<string, BusinessRecord>();

// ── Production rate limit counts (no message_count column in DB) ──

const _prodRateLimitCounts = new Map<string, number>();

// ── Injectable inbound handler ────────────────────────────────

const _defaultHandler: WebChatInboundHandlerFn = async () => ({
  success: false,
  error: "No inbound handler configured",
});

let _inboundHandler: WebChatInboundHandlerFn = _defaultHandler;

// ── ID generator ──────────────────────────────────────────────

function _genId(): string {
  // Production: crypto.randomUUID()
  return `wc_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── handleWebChatMessage ──────────────────────────────────────

export async function handleWebChatMessage(
  request: WebChatRequest,
): Promise<WebChatResponse> {
  // 1. Validate request
  const parsed = WebChatRequestSchema.safeParse(request);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const msg =
      issue?.path[0] === "content" && issue.code === "too_big"
        ? "content_too_long"
        : "invalid_request";
    return { success: false, sessionToken: "", error: msg };
  }

  const { businessId, content, sessionToken } = parsed.data;

  // 2. Validate business
  let business: BusinessRecord | null | undefined;
  if (process.env.NODE_ENV === "test") {
    business = _businesses.get(businessId);
  } else {
    const { db } = await import("~/server/db");
    const dbBusiness = await db.businesses.findUnique({
      where: { id: businessId },
      select: { id: true, deleted_at: true },
    });
    if (dbBusiness) {
      business = { id: dbBusiness.id, deletedAt: dbBusiness.deleted_at };
    }
  }
  if (!business || business.deletedAt !== null) {
    return { success: false, sessionToken: "", error: "business_not_found" };
  }

  // 3. Session handling
  let session: SessionRecord;

  if (!sessionToken) {
    // Create new session
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + SESSION_DURATION_HOURS * 60 * 60 * 1000,
    );

    if (process.env.NODE_ENV !== "test") {
      // In production, generate a UUID token; the session record will be
      // inserted after we have a conversationId (required field in DB).
      const generatedToken = crypto.randomUUID();
      // Use an in-request object; DB insert happens after inbound handler
      session = {
        id: generatedToken,
        businessId,
        conversationId: null,
        customerId: null,
        messageCount: 0,
        createdAt: now,
        expiresAt,
      };
      // Track rate limit count in prod map
      _prodRateLimitCounts.set(generatedToken, 0);
    } else {
      session = {
        id: _genId(),
        businessId,
        conversationId: null,
        customerId: null,
        messageCount: 0,
        createdAt: now,
        expiresAt,
      };
      _sessions.set(session.id, session);
    }
  } else {
    // Resume existing session
    if (process.env.NODE_ENV === "test") {
      const existing = _sessions.get(sessionToken);
      if (!existing) {
        return { success: false, sessionToken: "", error: "session_expired" };
      }
      if (existing.expiresAt <= new Date()) {
        return { success: false, sessionToken: "", error: "session_expired" };
      }
      if (existing.businessId !== businessId) {
        return { success: false, sessionToken: "", error: "session_mismatch" };
      }
      session = existing;
    } else {
      const { db } = await import("~/server/db");
      const dbSession = await db.web_chat_sessions.findUnique({
        where: { session_token: sessionToken },
      });
      if (!dbSession) {
        return { success: false, sessionToken: "", error: "session_expired" };
      }
      if (dbSession.expires_at <= new Date()) {
        return { success: false, sessionToken: "", error: "session_expired" };
      }
      if (dbSession.business_id !== businessId) {
        return { success: false, sessionToken: "", error: "session_mismatch" };
      }
      const currentCount = _prodRateLimitCounts.get(sessionToken) ?? 0;
      session = {
        id: sessionToken,
        businessId: dbSession.business_id,
        conversationId: dbSession.conversation_id,
        customerId: null,
        messageCount: currentCount,
        createdAt: dbSession.created_at,
        expiresAt: dbSession.expires_at,
      };
    }
  }

  // 4. Rate limit check
  if (session.messageCount >= RATE_LIMIT_PER_HOUR) {
    return { success: false, sessionToken: session.id, error: "rate_limited" };
  }

  // 5. Increment message count
  session.messageCount++;
  if (process.env.NODE_ENV !== "test") {
    _prodRateLimitCounts.set(session.id, session.messageCount);
  }

  // 6. Hand off to inbound handler
  let result;
  if (process.env.NODE_ENV === "test") {
    result = await _inboundHandler({
      businessId,
      fromContact: session.id,
      contactType: "web_chat",
      channel: WEB_CHAT_CHANNEL,
      content,
    });
  } else {
    const { handleInboundMessage } = await import("~/engine/inbound/index");
    const inboundResult = await handleInboundMessage({
      businessId,
      fromContact: session.id,
      contactType: "web_chat",
      channel: WEB_CHAT_CHANNEL,
      content,
    });
    result = {
      success: true,
      customerId: inboundResult.customerId,
      conversationId: inboundResult.conversationId,
      messageId: inboundResult.messageId,
      aiReplyText: inboundResult.aiReplyText,
      showAddressForm: inboundResult.showAddressForm,
    };
  }

  if (!result.success) {
    // Roll back count increment on handler failure
    session.messageCount--;
    if (process.env.NODE_ENV !== "test") {
      _prodRateLimitCounts.set(session.id, session.messageCount);
    }
    return {
      success: false,
      sessionToken: session.id,
      error: result.error ?? "handler_error",
    };
  }

  // 7. Update session with resolved IDs (first message)
  if (!session.conversationId && result.conversationId) {
    session.conversationId = result.conversationId;
    if (process.env.NODE_ENV !== "test") {
      // Now we have a conversationId — insert the DB record
      const { db } = await import("~/server/db");
      await db.web_chat_sessions.create({
        data: {
          business_id: businessId,
          conversation_id: result.conversationId,
          session_token: session.id,
          expires_at: session.expiresAt,
        },
      });
    }
  }
  if (!session.customerId && result.customerId) {
    session.customerId = result.customerId;
  }

  // 8. Return
  return {
    success: true,
    sessionToken: session.id,
    messageId: result.messageId,
    aiReplyText: result.aiReplyText,
    showAddressForm: result.showAddressForm,
  };
}

// ── Test helpers ──────────────────────────────────────────────

export function _resetWebChatStoreForTest(): void {
  _sessions.clear();
  _businesses.clear();
  _inboundHandler = _defaultHandler;
}

export function _seedSessionForTest(data: Record<string, unknown>): void {
  // Production: db.web_chat_sessions.upsert({ ... })
  _sessions.set(data["id"] as string, data as unknown as SessionRecord);
}

export function _seedBusinessForTest(data: Record<string, unknown>): void {
  // Production: db.businesses.upsert({ ... })
  _businesses.set(data["id"] as string, data as unknown as BusinessRecord);
}

export function _setInboundHandlerForTest(fn: WebChatInboundHandlerFn): void {
  _inboundHandler = fn;
}

export function _getSessionForTest(id: string): SessionRecord | undefined {
  return _sessions.get(id);
}
