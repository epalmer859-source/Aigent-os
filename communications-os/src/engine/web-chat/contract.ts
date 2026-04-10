// ============================================================
// src/engine/web-chat/contract.ts
//
// WEB CHAT ENDPOINT — CONTRACT
//
// Exports ONLY types and constants. Zero logic.
//
// The web chat widget is embedded on the business's website.
// Customers POST messages to this endpoint via the widget JS.
// The endpoint manages sessions (no Twilio, no phone numbers)
// and hands off to the inbound message handler with
// channel = 'web_chat'.
//
// Blueprint source: Doc 14 §3.14
// ============================================================

// ── Request / response shapes ─────────────────────────────────

export interface WebChatRequest {
  businessId: string;
  content: string;
  /** Omit on first message. Include on subsequent messages to resume session. */
  sessionToken?: string;
}

export interface WebChatResponse {
  success: boolean;
  /** Return to client for all subsequent messages in this session. */
  sessionToken: string;
  /** ID of the message_log row created, present on success. */
  messageId?: string;
  /** Human-readable error code on failure. */
  error?: string;
  /**
   * The AI-generated reply text, present on success for web_chat channel.
   * Generated synchronously so the widget can display it immediately.
   */
  aiReplyText?: string;
  /**
   * True when the AI wants the widget to render an inline address form.
   */
  showAddressForm?: boolean;
}

// ── Session shape ─────────────────────────────────────────────

export interface WebChatSession {
  /** UUID — also serves as the session token. */
  id: string;
  businessId: string;
  /** Set after first message creates or resolves a conversation. */
  conversationId: string | null;
  /** Set after first message resolves or creates a customer. */
  customerId: string | null;
  /** Total messages sent in this session (used for rate limiting). */
  messageCount: number;
  createdAt: Date;
  /** createdAt + SESSION_DURATION_HOURS. */
  expiresAt: Date;
}

// ── Injectable inbound handler ────────────────────────────────

export interface WebChatInboundParams {
  businessId: string;
  /** Session ID acts as the contact identifier for web chat. */
  fromContact: string;
  contactType: string;
  channel: string;
  content: string;
}

export interface WebChatInboundResult {
  success: boolean;
  customerId?: string;
  conversationId?: string;
  messageId?: string;
  error?: string;
  aiReplyText?: string;
  showAddressForm?: boolean;
}

/**
 * Injectable for testing — replaces the real handleInboundMessage call.
 * Production: calls handleInboundMessage() from engine/inbound/index.ts.
 */
export type WebChatInboundHandlerFn = (
  params: WebChatInboundParams,
) => Promise<WebChatInboundResult>;

// ── Function signature ────────────────────────────────────────

/**
 * Handle a single inbound web chat message.
 *
 * 1. Validate request (businessId required, content max 2000 chars).
 * 2. Verify business exists and is not deleted.
 * 3. Create or resume a session.
 * 4. Rate-limit check (RATE_LIMIT_PER_HOUR per session).
 * 5. Increment session.messageCount.
 * 6. Hand off to inbound message handler with channel = 'web_chat'.
 * 7. Update session with conversationId / customerId on first message.
 * 8. Return sessionToken and messageId.
 *
 * Production: this is a Next.js API route handler (NOT tRPC).
 */
export type HandleWebChatMessageFn = (
  request: WebChatRequest,
) => Promise<WebChatResponse>;

// ── Constants ─────────────────────────────────────────────────

/** How long a web chat session stays valid, in hours. */
export const SESSION_DURATION_HOURS = 24;

/** Maximum messages per session per hour before rate-limiting. */
export const RATE_LIMIT_PER_HOUR = 30;

/** Channel identifier passed to the inbound message handler. */
export const WEB_CHAT_CHANNEL = "web_chat";

/** Maximum allowed content length in characters. */
export const WEB_CHAT_MAX_CONTENT_LENGTH = 2000;
