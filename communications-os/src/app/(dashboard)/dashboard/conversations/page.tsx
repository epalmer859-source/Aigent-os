"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";

// ── Constants ──────────────────────────────────────────────────────────────

const STATE_OPTIONS = [
  { value: "", label: "All states" },
  { value: "new_lead", label: "New Lead" },
  { value: "booking_in_progress", label: "Booking" },
  { value: "quote_sent", label: "Quote Sent" },
  { value: "job_in_progress", label: "Job In Progress" },
  { value: "human_takeover_active", label: "Human Takeover" },
  { value: "resolved", label: "Resolved" },
  { value: "closed_completed", label: "Closed" },
] as const;

const CHANNEL_INITIALS: Record<string, string> = {
  sms: "SM",
  email: "EM",
  voice: "VC",
  web_chat: "WC",
  whatsapp: "WA",
};

// State badge colors — semantic, same in both modes
const STATE_BADGE: Record<string, { bg: string; text: string }> = {
  new_lead:             { bg: "rgba(59,130,246,0.12)",  text: "#60a5fa"  },
  booking_in_progress:  { bg: "rgba(99,102,241,0.12)",  text: "#818cf8"  },
  quote_sent:           { bg: "rgba(234,179,8,0.12)",   text: "#facc15"  },
  job_in_progress:      { bg: "rgba(249,115,22,0.12)",  text: "#fb923c"  },
  human_takeover_active:{ bg: "rgba(168,85,247,0.12)",  text: "#c084fc"  },
  resolved:             { bg: "rgba(34,197,94,0.12)",   text: "#4ade80"  },
  closed_completed:     { bg: "rgba(113,113,122,0.12)", text: "#a1a1aa"  },
};

function StateBadge({ state }: { state: string }) {
  const style = STATE_BADGE[state] ?? { bg: "rgba(113,113,122,0.12)", text: "#a1a1aa" };
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize"
      style={{ background: style.bg, color: style.text }}
    >
      {state.replace(/_/g, " ")}
    </span>
  );
}

function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return "";
  const ms = Date.now() - new Date(date).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

// ── Skeleton ───────────────────────────────────────────────────────────────

function RowSkeleton() {
  return (
    <div
      className="flex animate-pulse gap-3 px-4 py-3.5"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      <div className="mt-0.5 h-9 w-9 rounded-full shrink-0" style={{ background: "var(--skeleton)" }} />
      <div className="flex-1 space-y-2 py-0.5">
        <div className="h-3.5 w-1/3 rounded-md" style={{ background: "var(--skeleton)" }} />
        <div className="h-3 w-2/3 rounded-md" style={{ background: "var(--skeleton)" }} />
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function ConversationsPage() {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(searchInput), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchInput]);

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    api.conversations.list.useInfiniteQuery(
      { limit: 25, search: search || undefined, status: status || undefined },
      { getNextPageParam: (lastPage) => lastPage.nextCursor, refetchInterval: 10_000 },
    );

  const allItems = data?.pages.flatMap((p) => p.items) ?? [];

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage();
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const inputStyle = {
    background: "var(--input-bg)",
    border: "1px solid var(--input-border)",
    color: "var(--t1)",
    outline: "none",
  };

  return (
    <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-3xl flex-col overflow-hidden rounded-2xl"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
    >
      {/* Page heading */}
      <div
        className="shrink-0 px-5 py-4"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <h1 className="text-base font-semibold" style={{ color: "var(--t1)" }}>
          Conversations
        </h1>
      </div>

      {/* Toolbar */}
      <div
        className="flex shrink-0 flex-col gap-2 px-4 py-3 sm:flex-row"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <input
          type="search"
          placeholder="Search by name or contact…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="flex-1 rounded-lg px-3 py-2 text-sm"
          style={inputStyle}
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg px-3 py-2 text-sm"
          style={{ ...inputStyle, minWidth: "140px" }}
        >
          {STATE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* List */}
      <div className="content-scroll flex-1 overflow-y-auto">
        {isLoading ? (
          <>
            <RowSkeleton /><RowSkeleton /><RowSkeleton /><RowSkeleton />
          </>
        ) : allItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-sm" style={{ color: "var(--t3)" }}>No conversations found</p>
          </div>
        ) : (
          <>
            {allItems.map((conv) => {
              const displayName = conv.contact_display_name;
              const phone = conv.contact_handle;
              const name = displayName && phone
                ? `${displayName} · ${phone}`
                : displayName ?? phone ?? "Untitled";
              const initials = CHANNEL_INITIALS[conv.channel] ?? "??";
              return (
                <button
                  key={conv.id}
                  onClick={() => router.push(`/dashboard/conversations/${conv.id}`)}
                  className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors duration-100"
                  style={{ borderBottom: "1px solid var(--border)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  {/* Avatar */}
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)" }}
                  >
                    {initials}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium" style={{ color: "var(--t1)" }}>
                        {name}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums" style={{ color: "var(--t3)" }}>
                        {timeAgo(conv.last_customer_message_at ?? conv.updated_at)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <StateBadge state={conv.primary_state} />
                      <span className="text-xs capitalize" style={{ color: "var(--t3)" }}>
                        {conv.current_owner}
                      </span>
                    </div>
                    {conv.preview && (
                      <p className="mt-1 truncate text-xs" style={{ color: "var(--t3)" }}>
                        {conv.preview}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
            <div ref={sentinelRef} className="h-4" />
            {isFetchingNextPage && (
              <p className="py-3 text-center text-xs" style={{ color: "var(--t3)" }}>Loading more…</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
