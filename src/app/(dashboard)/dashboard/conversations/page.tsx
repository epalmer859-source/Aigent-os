"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";

// ── Types ──────────────────────────────────────────────────────────────────
const STATE_OPTIONS = [
  { value: "", label: "All" },
  { value: "new_lead", label: "New Lead" },
  { value: "booking_in_progress", label: "Booking" },
  { value: "quote_sent", label: "Quote Sent" },
  { value: "job_in_progress", label: "Job In Progress" },
  { value: "human_takeover_active", label: "Human Takeover" },
  { value: "resolved", label: "Resolved" },
  { value: "closed_completed", label: "Closed" },
] as const;

const CHANNEL_ICONS: Record<string, string> = {
  sms: "💬",
  email: "📧",
  voice: "📞",
  webchat: "🌐",
  whatsapp: "📱",
};

const STATE_COLORS: Record<string, string> = {
  new_lead: "bg-blue-100 text-blue-800",
  booking_in_progress: "bg-indigo-100 text-indigo-800",
  quote_sent: "bg-yellow-100 text-yellow-800",
  job_in_progress: "bg-orange-100 text-orange-800",
  human_takeover_active: "bg-purple-100 text-purple-800",
  resolved: "bg-green-100 text-green-800",
  closed_completed: "bg-gray-100 text-gray-700",
};

function stateBadge(state: string) {
  const color = STATE_COLORS[state] ?? "bg-gray-100 text-gray-700";
  const label = state.replace(/_/g, " ");
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium capitalize ${color}`}
    >
      {label}
    </span>
  );
}

function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return "";
  const ms = Date.now() - new Date(date).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

// ── Skeleton ───────────────────────────────────────────────────────────────
function RowSkeleton() {
  return (
    <div className="animate-pulse flex gap-3 border-b border-gray-100 p-4">
      <div className="mt-1 h-8 w-8 rounded-full bg-gray-200" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-1/3 rounded bg-gray-200" />
        <div className="h-3 w-2/3 rounded bg-gray-200" />
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

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(searchInput), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    api.conversations.list.useInfiniteQuery(
      { limit: 25, search: search || undefined, status: status || undefined },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        refetchInterval: 10_000,
      },
    );

  const allItems = data?.pages.flatMap((p) => p.items) ?? [];

  // Infinite scroll sentinel
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col rounded-xl border border-gray-200 bg-white">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 border-b border-gray-100 p-3 sm:flex-row">
        <input
          type="search"
          placeholder="Search by name or contact…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
        >
          {STATE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <>
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </>
        ) : allItems.length === 0 ? (
          <p className="p-8 text-center text-sm text-gray-400">
            No conversations found
          </p>
        ) : (
          <>
            {allItems.map((conv) => {
              const name =
                conv.contact_display_name ?? conv.contact_handle ?? "Unknown";
              const icon = CHANNEL_ICONS[conv.channel] ?? "💬";
              return (
                <button
                  key={conv.id}
                  onClick={() =>
                    router.push(`/dashboard/conversations/${conv.id}`)
                  }
                  className="flex w-full items-start gap-3 border-b border-gray-100 p-4 text-left transition hover:bg-gray-50 active:bg-gray-100"
                >
                  {/* Avatar / channel icon */}
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 text-lg">
                    {icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-gray-900">
                        {name}
                      </span>
                      <span className="shrink-0 text-xs text-gray-400">
                        {timeAgo(conv.last_customer_message_at ?? conv.updated_at)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      {stateBadge(conv.primary_state)}
                      <span className="text-xs capitalize text-gray-400">
                        {conv.current_owner}
                      </span>
                    </div>
                    {conv.preview && (
                      <p className="mt-1 truncate text-xs text-gray-500">
                        {conv.preview}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="h-4" />
            {isFetchingNextPage && (
              <p className="py-3 text-center text-xs text-gray-400">
                Loading more…
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
