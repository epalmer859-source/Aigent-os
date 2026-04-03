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
//   const session = await db.web_chat_sessions.findUnique({ where: { id: sessionToken } });
//   await db.web_chat_sessions.create({ data: { ... } });
//   await db.web_chat_sessions.update({ where: { id }, data: { message_count: { increment: 1 } } });
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
  // Production: db.businesses.findUnique({ where: { id: businessId } })
  const business = _businesses.get(businessId);
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
    session = {
      id: _genId(),
      businessId,
      conversationId: null,
      customerId: null,
      messageCount: 0,
      createdAt: now,
      expiresAt,
    };
    // Production: db.web_chat_sessions.create({ data: { ... } })
    _sessions.set(session.id, session);
  } else {
    // Resume existing session
    // Production: db.web_chat_sessions.findUnique({ where: { id: sessionToken } })
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
  }

  // 4. Rate limit check
  if (session.messageCount >= RATE_LIMIT_PER_HOUR) {
    return { success: false, sessionToken: session.id, error: "rate_limited" };
  }

  // 5. Increment message count
  // Production: db.web_chat_sessions.update({ where: { id }, data: { message_count: { increment: 1 } } })
  session.messageCount++;

  // 6. Hand off to inbound handler
  const result = await _inboundHandler({
    businessId,
    fromContact: session.id,
    contactType: "phone",
    channel: WEB_CHAT_CHANNEL,
    content,
  });

  if (!result.success) {
    // Roll back count increment on handler failure
    session.messageCount--;
    return {
      success: false,
      sessionToken: session.id,
      error: result.error ?? "handler_error",
    };
  }

  // 7. Update session with resolved IDs (first message)
  if (!session.conversationId && result.conversationId) {
    // Production: db.web_chat_sessions.update({ where: { id }, data: { conversation_id, customer_id } })
    session.conversationId = result.conversationId;
  }
  if (!session.customerId && result.customerId) {
    session.customerId = result.customerId;
  }

  // 8. Return
  return {
    success: true,
    sessionToken: session.id,
    messageId: result.messageId,
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
