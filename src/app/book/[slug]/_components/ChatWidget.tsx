"use client";

import { useEffect, useRef, useState } from "react";

interface Message {
  role: "user" | "assistant";
  text: string;
}

interface WebChatApiResponse {
  success: boolean;
  sessionToken: string;
  aiReplyText?: string;
  error?: string;
}

interface ChatWidgetProps {
  businessId: string;
  businessName: string;
}

function SendIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export default function ChatWidget({ businessId, businessName }: ChatWidgetProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionToken, setSessionToken] = useState<string | undefined>();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setLoading(true);

    try {
      const res = await fetch("/api/web-chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, content: text, sessionToken }),
      });

      const data = (await res.json()) as WebChatApiResponse;

      if (data.sessionToken) setSessionToken(data.sessionToken);

      if (data.success && data.aiReplyText) {
        setMessages((prev) => [...prev, { role: "assistant", text: data.aiReplyText! }]);
      } else if (!data.success) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: "Something went wrong. Please try again." },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Connection error. Please try again." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const initials = businessName
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div className="flex h-full min-h-[520px] flex-col lg:min-h-dvh">

      {/* ── Header ───────────────────────────────────────────── */}
      <div
        className="shrink-0 px-6 py-5"
        style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            {/* Avatar */}
            <div
              className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
              style={{
                background: "linear-gradient(135deg, #3b82f6, #6366f1)",
                boxShadow: "0 0 20px rgba(99,102,241,0.35)",
              }}
            >
              {initials}
              <span
                className="animate-dot-pulse absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full"
                style={{ background: "#22c55e", border: "2px solid #0a0b10" }}
              />
            </div>

            <div>
              <p className="text-sm font-semibold" style={{ color: "#f4f4f5" }}>
                {businessName}
              </p>
              <p className="text-xs" style={{ color: "#71717a" }}>
                AI assistant &middot; replies in seconds
              </p>
            </div>
          </div>

          {/* Online pill */}
          <div
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold"
            style={{
              background: "rgba(34,197,94,0.08)",
              border: "1px solid rgba(34,197,94,0.18)",
              color: "#4ade80",
            }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
            Online
          </div>
        </div>
      </div>

      {/* ── Message list ─────────────────────────────────────── */}
      <div className="chat-scroll flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center py-16 text-center">
            <div
              className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{
                background: "rgba(59,130,246,0.08)",
                border: "1px solid rgba(59,130,246,0.14)",
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
              </svg>
            </div>
            <p className="text-sm font-semibold" style={{ color: "#d4d4d8" }}>
              How can we help?
            </p>
            <p className="mt-1.5 max-w-[220px] text-xs leading-relaxed" style={{ color: "#52525b" }}>
              Ask about services, pricing, scheduling, or anything else.
            </p>
          </div>
        )}

        <div className="space-y-5">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`animate-msg-in flex items-end gap-2.5 ${
                msg.role === "user" ? "flex-row-reverse" : "flex-row"
              }`}
            >
              {/* AI avatar */}
              {msg.role === "assistant" && (
                <div
                  className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{
                    background: "linear-gradient(135deg, #3b82f6, #6366f1)",
                    boxShadow: "0 0 10px rgba(99,102,241,0.3)",
                  }}
                >
                  {initials[0]}
                </div>
              )}

              <div
                className="max-w-[76%] rounded-2xl px-4 py-3 text-sm leading-relaxed"
                style={
                  msg.role === "user"
                    ? {
                        background: "linear-gradient(135deg, #3b82f6, #6366f1)",
                        color: "#ffffff",
                        borderBottomRightRadius: "4px",
                        boxShadow: "0 4px 20px rgba(99,102,241,0.25)",
                      }
                    : {
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.07)",
                        color: "#e4e4e7",
                        borderBottomLeftRadius: "4px",
                      }
                }
              >
                {msg.text}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {loading && (
            <div className="animate-msg-in flex items-end gap-2.5">
              <div
                className="mb-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{
                  background: "linear-gradient(135deg, #3b82f6, #6366f1)",
                  boxShadow: "0 0 10px rgba(99,102,241,0.3)",
                }}
              >
                {initials[0]}
              </div>
              <div
                className="flex items-center gap-1.5 rounded-2xl px-4 py-3.5"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.07)",
                  borderBottomLeftRadius: "4px",
                }}
              >
                <span className="typing-dot h-1.5 w-1.5 rounded-full" style={{ background: "#52525b" }} />
                <span className="typing-dot h-1.5 w-1.5 rounded-full" style={{ background: "#52525b" }} />
                <span className="typing-dot h-1.5 w-1.5 rounded-full" style={{ background: "#52525b" }} />
              </div>
            </div>
          )}
        </div>

        <div ref={bottomRef} />
      </div>

      {/* ── Input ────────────────────────────────────────────── */}
      <div
        className="shrink-0 px-5 pb-5 pt-4"
        style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
      >
        <div
          className="flex items-end gap-3 rounded-2xl p-3 transition-all duration-200 focus-within:ring-1 focus-within:ring-indigo-500/30"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          <textarea
            ref={textareaRef}
            className="flex-1 resize-none bg-transparent px-1 py-1 text-sm leading-relaxed focus:outline-none"
            style={{
              color: "#e4e4e7",
              caretColor: "#6366f1",
              minHeight: "36px",
              maxHeight: "120px",
            }}
            placeholder="Type a message..."
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={loading}
          />
          <button
            onClick={() => void send()}
            disabled={loading || !input.trim()}
            className="btn-send flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white disabled:opacity-25 disabled:cursor-not-allowed"
          >
            <SendIcon />
          </button>
        </div>

        <p className="mt-3 text-center text-[10px]" style={{ color: "#3f3f46" }}>
          Enter to send &middot; Shift + Enter for new line
        </p>
      </div>
    </div>
  );
}
