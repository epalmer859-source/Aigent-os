"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";

// ── Constants ──────────────────────────────────────────────────────────────
type ViewType = "needs_action" | "sent" | "closed" | "all";

const VIEW_TABS: { value: ViewType; label: string }[] = [
  { value: "needs_action", label: "Needs Action" },
  { value: "sent", label: "Sent" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

const STATUS_COLORS: Record<string, string> = {
  intake_open: "bg-gray-100 text-gray-700",
  under_review: "bg-yellow-100 text-yellow-800",
  approved_to_send: "bg-blue-100 text-blue-800",
  sent: "bg-blue-100 text-blue-800",
  accepted: "bg-green-100 text-green-800",
  declined: "bg-red-100 text-red-800",
  withdrawn: "bg-gray-100 text-gray-600",
  expired: "bg-orange-100 text-orange-800",
  superseded: "bg-gray-100 text-gray-600",
};

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtCurrency(amount: unknown): string {
  const n = Number(amount);
  if (isNaN(n)) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
}

function timeAgo(date: Date | string): string {
  const ms = Date.now() - new Date(date).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function expiresLabel(expires: Date | string | null | undefined): {
  text: string;
  red: boolean;
} | null {
  if (!expires) return null;
  const diff = new Date(expires).getTime() - Date.now();
  if (diff < 0) return { text: "Expired", red: true };
  const days = Math.ceil(diff / 86_400_000);
  return {
    text: days === 1 ? "Expires tomorrow" : `Expires in ${days}d`,
    red: days <= 2,
  };
}

// ── Skeleton ───────────────────────────────────────────────────────────────
function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-gray-100 bg-gray-50 p-4">
      <div className="mb-2 h-4 w-1/3 rounded bg-gray-200" />
      <div className="h-3 w-1/2 rounded bg-gray-200" />
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function QuotesPage() {
  const router = useRouter();
  const [view, setView] = useState<ViewType>("needs_action");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(searchInput), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    api.quotes.list.useInfiniteQuery(
      { view, limit: 25, search: search || undefined },
      {
        getNextPageParam: (last) => last.nextCursor,
        refetchInterval: 15_000,
      },
    );

  const allItems = data?.pages.flatMap((p) => p.items) ?? [];

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
    <div className="flex flex-col gap-4">
      {/* View tabs */}
      <div className="flex gap-1 rounded-xl border border-gray-200 bg-white p-1">
        {VIEW_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setView(tab.value)}
            className={[
              "flex-1 rounded-lg py-2 text-sm font-medium transition",
              view === tab.value
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-500 hover:text-gray-700",
            ].join(" ")}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        type="search"
        placeholder="Search by customer name…"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
      />

      {/* Cards */}
      <div className="space-y-3">
        {isLoading ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : allItems.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
            No quotes found
          </div>
        ) : (
          <>
            {allItems.map((q) => {
              const customerName =
                q.conversations?.contact_display_name ??
                q.conversations?.contact_handle ??
                "Unknown customer";
              const statusColor =
                STATUS_COLORS[q.status] ?? "bg-gray-100 text-gray-700";
              const exp = expiresLabel(q.expires_at);

              return (
                <button
                  key={q.id}
                  onClick={() => router.push(`/dashboard/quotes/${q.id}`)}
                  className="flex w-full flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:border-blue-200 hover:shadow-sm"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900">
                      {customerName}
                    </p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusColor}`}
                    >
                      {q.status.replace(/_/g, " ")}
                    </span>
                  </div>

                  {q.requested_service && (
                    <p className="text-sm text-gray-600">{q.requested_service}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-3 text-xs text-gray-400">
                    {q.approved_amount != null && (
                      <span className="font-semibold text-gray-700">
                        {fmtCurrency(q.approved_amount)}
                      </span>
                    )}
                    <span>{timeAgo(q.sent_at ?? q.created_at)}</span>
                    {exp && (
                      <span className={exp.red ? "font-medium text-red-600" : ""}>
                        {exp.text}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
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
