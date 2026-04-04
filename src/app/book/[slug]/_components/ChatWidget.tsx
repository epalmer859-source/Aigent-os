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
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
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

  // Auto-resize textarea
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
    <div
      className="flex flex-col overflow-hidden rounded-3xl"
      style={{
        background: "rgba(12, 13, 18, 0.85)",
        backdropFilter: "blur(32px)",
        WebkitBackdropFilter: "blur(32px)",
        border: "1px solid rgba(255,255,255,0.07)",
        boxShadow:
          "0 0 0 1px rgba(59,130,246,0.06), 0 32px 80px rgba(0,0,0,0.6), 0 8px 32px rgba(0,0,0,0.4)",
        minHeight: "520px",
      }}
    >
      {/* ── Header ── */}
      <div
        className="relative flex items-center gap-3.5 overflow-hidden px-5 py-4"
        style={{
          background:
            "linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(99,102,241,0.08) 100%)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {/* Header background glow */}
        <div
          className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-30"
          style={{
            background: "radial-gradient(circle, #6366f1, transparent 70%)",
            filter: "blur(20px)",
          }}
        />

        {/* Avatar */}
        <div
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold"
          style={{
            background: "linear-gradient(135deg, #3b82f6, #6366f1)",
            color: "#fff",
            boxShadow: "0 0 16px rgba(99,102,241,0.5)",
          }}
        >
          {initials}
          {/* Online dot */}
          <span
            className="animate-dot-pulse absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full"
            style={{
              background: "#22c55e",
              border: "2px solid #0c0d12",
            }}
          />
        </div>

        <div className="min-w-0">
          <p className="text-sm font-semibold" style={{ color: "#f4f4f5" }}>
            {businessName}
          </p>
          <p className="text-xs" style={{ color: "#52525b" }}>
            AI assistant &middot; replies instantly
          </p>
        </div>

        {/* Header tag */}
        <div
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium"
          style={{
            background: "rgba(34,197,94,0.1)",
            border: "1px solid rgba(34,197,94,0.2)",
            color: "#4ade80",
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
          Online
        </div>
      </div>

      {/* ── Message list ── */}
      <div
        className="chat-scroll flex-1 space-y-4 overflow-y-auto px-4 py-5"
        style={{ minHeight: "340px", maxHeight: "420px" }}
      >
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-10">
            {/* Icon */}
            <div
              className="flex h-12 w-12 items-center justify-center rounded-2xl"
              style={{
                background: "rgba(59,130,246,0.1)",
                border: "1px solid rgba(59,130,246,0.15)",
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
              </svg>
            </div>
            <div className="text-center">
              <p className="text-sm font-medium" style={{ color: "#a1a1aa" }}>
                How can we help?
              </p>
              <p className="mt-1 text-xs" style={{ color: "#3f3f46" }}>
                Ask about services, pricing, or availability.
              </p>
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={`animate-msg-in flex items-end gap-2.5 ${
              msg.role === "user" ? "flex-row-reverse" : "flex-row"
            }`}
          >
            {/* Avatar for assistant */}
            {msg.role === "assistant" && (
              <div
                className="mb-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
                style={{
                  background: "linear-gradient(135deg, #3b82f6, #6366f1)",
                  color: "#fff",
                  boxShadow: "0 0 8px rgba(99,102,241,0.4)",
                }}
              >
                {initials[0]}
              </div>
            )}

            <div
              className="max-w-[78%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
              style={
                msg.role === "user"
                  ? {
                      background: "linear-gradient(135deg, #3b82f6, #6366f1)",
                      color: "#fff",
                      borderBottomRightRadius: "4px",
                      boxShadow: "0 4px 16px rgba(99,102,241,0.3)",
                    }
                  : {
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.07)",
                      color: "#d4d4d8",
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
              className="mb-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold"
              style={{
                background: "linear-gradient(135deg, #3b82f6, #6366f1)",
                color: "#fff",
                boxShadow: "0 0 8px rgba(99,102,241,0.4)",
              }}
            >
              {initials[0]}
            </div>
            <div
              className="flex items-center gap-1 rounded-2xl px-4 py-3"
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

        <div ref={bottomRef} />
      </div>

      {/* ── Input area ── */}
      <div
        className="px-4 pb-4 pt-3"
        style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
      >
        <div
          className="flex items-end gap-2.5 rounded-2xl p-2 transition-all duration-200"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
          onFocus={(e) => {
            (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(99,102,241,0.4)";
            (e.currentTarget as HTMLDivElement).style.boxShadow = "0 0 0 3px rgba(99,102,241,0.08)";
          }}
          onBlur={(e) => {
            (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.07)";
            (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
          }}
        >
          <textarea
            ref={textareaRef}
            className="flex-1 resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed focus:outline-none"
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
            style={{ boxShadow: "0 2px 12px rgba(99,102,241,0.3)" }}
          >
            <SendIcon />
          </button>
        </div>

        <p className="mt-2 text-center text-[10px]" style={{ color: "#3f3f46" }}>
          Powered by AIgent OS &middot; Replies are AI-generated
        </p>
      </div>
    </div>
  );
}
