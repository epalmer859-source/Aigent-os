"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "~/trpc/react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function TechAssistantPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Hey! I'm your scheduling assistant. I can help you check your schedule, update job statuses, add notes, or request schedule changes. What do you need?",
    },
  ]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const chat = api.techAssistant.chat.useMutation({
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
    },
    onError: (err) => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Sorry, something went wrong: ${err.message}`,
        },
      ]);
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, chat.isPending]);

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || chat.isPending) return;

    const newMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");

    // Send full conversation history (excluding the initial greeting)
    const history = newMessages
      .slice(1) // skip the initial assistant greeting
      .map((m) => ({ role: m.role, content: m.content }));

    chat.mutate({ messages: history });
  }

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      {/* Header */}
      <div className="mb-4 shrink-0">
        <h1 className="text-2xl font-bold" style={{ color: "var(--t1)" }}>
          Assistant
        </h1>
        <p className="text-sm" style={{ color: "var(--t3)" }}>
          Chat about your schedule, request changes, or get help
        </p>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto pb-4"
        style={{ minHeight: 0 }}
      >
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed"
              style={
                msg.role === "user"
                  ? {
                      background: "#22c55e",
                      color: "#fff",
                      borderBottomRightRadius: "4px",
                    }
                  : {
                      background: "var(--bg-elevated)",
                      color: "var(--t1)",
                      border: "1px solid var(--border)",
                      borderBottomLeftRadius: "4px",
                    }
              }
            >
              <MessageContent content={msg.content} />
            </div>
          </div>
        ))}

        {/* Typing indicator */}
        {chat.isPending && (
          <div className="flex justify-start">
            <div
              className="flex items-center gap-1.5 rounded-2xl px-4 py-3"
              style={{
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderBottomLeftRadius: "4px",
              }}
            >
              <span
                className="h-2 w-2 animate-bounce rounded-full"
                style={{ background: "var(--t3)", animationDelay: "0ms" }}
              />
              <span
                className="h-2 w-2 animate-bounce rounded-full"
                style={{ background: "var(--t3)", animationDelay: "150ms" }}
              />
              <span
                className="h-2 w-2 animate-bounce rounded-full"
                style={{ background: "var(--t3)", animationDelay: "300ms" }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={handleSend}
        className="shrink-0 pt-2"
        style={{ borderTop: "1px solid var(--border)" }}
      >
        <div className="flex gap-2 pt-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your schedule..."
            disabled={chat.isPending}
            className="flex-1 rounded-xl border px-4 py-2.5 text-sm outline-none transition focus:ring-2 focus:ring-green-200 disabled:opacity-60"
            style={{
              background: "var(--bg-elevated)",
              borderColor: "var(--border)",
              color: "var(--t1)",
            }}
          />
          <button
            type="submit"
            disabled={chat.isPending || !input.trim()}
            className="shrink-0 rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-green-700 disabled:opacity-60"
          >
            Send
          </button>
        </div>

        {/* Quick actions */}
        <div className="mt-2 flex flex-wrap gap-1.5 pb-1">
          {[
            "What's my schedule today?",
            "What jobs do I have tomorrow?",
            "I need to leave early Friday",
          ].map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => {
                setInput(suggestion);
              }}
              disabled={chat.isPending}
              className="rounded-lg border px-3 py-1.5 text-xs transition hover:shadow-sm disabled:opacity-60"
              style={{
                background: "var(--bg)",
                borderColor: "var(--border)",
                color: "var(--t3)",
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}

/** Renders message content with basic markdown-like formatting */
function MessageContent({ content }: { content: string }) {
  // Split by newlines and render paragraphs
  const paragraphs = content.split("\n").filter((line) => line.length > 0);

  return (
    <div className="space-y-1.5">
      {paragraphs.map((p, i) => {
        // Bold text: **text**
        const parts = p.split(/(\*\*[^*]+\*\*)/g);
        return (
          <p key={i}>
            {parts.map((part, j) => {
              if (part.startsWith("**") && part.endsWith("**")) {
                return (
                  <strong key={j} className="font-semibold">
                    {part.slice(2, -2)}
                  </strong>
                );
              }
              return <span key={j}>{part}</span>;
            })}
          </p>
        );
      })}
    </div>
  );
}
