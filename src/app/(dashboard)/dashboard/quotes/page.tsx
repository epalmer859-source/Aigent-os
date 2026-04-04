"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";

// ── Types & constants ──────────────────────────────────────────────────────

type ViewType = "needs_action" | "sent" | "closed" | "all";

const VIEW_TABS: { value: ViewType; label: string }[] = [
  { value: "needs_action", label: "Needs Action" },
  { value: "sent", label: "Sent" },
  { value: "closed", label: "Closed" },
  { value: "all", label: "All" },
];

const STATUS_BADGE: Record<string, { bg: string; text: string }> = {
  intake_open:     { bg: "rgba(113,113,122,0.12)", text: "#a1a1aa" },
  under_review:    { bg: "rgba(234,179,8,0.12)",   text: "#facc15" },
  approved_to_send:{ bg: "rgba(59,130,246,0.12)",  text: "#60a5fa" },
  sent:            { bg: "rgba(59,130,246,0.12)",  text: "#60a5fa" },
  accepted:        { bg: "rgba(34,197,94,0.12)",   text: "#4ade80" },
  declined:        { bg: "rgba(239,68,68,0.12)",   text: "#f87171" },
  withdrawn:       { bg: "rgba(113,113,122,0.12)", text: "#71717a" },
  expired:         { bg: "rgba(249,115,22,0.12)",  text: "#fb923c" },
  superseded:      { bg: "rgba(113,113,122,0.12)", text: "#71717a" },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtCurrency(amount: unknown): string {
  const n = Number(amount);
  if (isNaN(n)) return "";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function timeAgo(date: Date | string): string {
  const ms = Date.now() - new Date(date).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
}

function expiresLabel(expires: Date | string | null | undefined): { text: string; warn: boolean } | null {
  if (!expires) return null;
  const diff = new Date(expires).getTime() - Date.now();
  if (diff < 0) return { text: "Expired", warn: true };
  const days = Math.ceil(diff / 86_400_000);
  return { text: days === 1 ? "Expires tomorrow" : `Expires in ${days}d`, warn: days <= 2 };
}

// ── Shared UI ─────────────────────────────────────────────────────────────

function SegTabs<T extends string>({
  tabs, value, onChange,
}: {
  tabs: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      className="flex gap-1 rounded-xl p-1"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
    >
      {tabs.map((tab) => {
        const active = value === tab.value;
        return (
          <button
            key={tab.value}
            onClick={() => onChange(tab.value)}
            className="flex-1 rounded-lg py-2 text-xs font-medium transition-all duration-150"
            style={{
              background: active ? "var(--bg-surface)" : "transparent",
              color: active ? "var(--t1)" : "var(--t3)",
              border: active ? "1px solid var(--border)" : "1px solid transparent",
              boxShadow: active ? "0 1px 4px rgba(0,0,0,0.25)" : "none",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div
      className="animate-pulse rounded-2xl p-4 space-y-2"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
    >
      <div className="h-3.5 w-1/3 rounded-md" style={{ background: "var(--skeleton)" }} />
      <div className="h-3 w-1/2 rounded-md" style={{ background: "var(--skeleton)" }} />
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
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchInput]);

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    api.quotes.list.useInfiniteQuery(
      { view, limit: 25, search: search || undefined },
      { getNextPageParam: (last) => last.nextCursor, refetchInterval: 15_000 },
    );

  const allItems = data?.pages.flatMap((p) => p.items) ?? [];

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (e) => { if (e[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage(); },
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const inputStyle = {
    background: "var(--input-bg)", border: "1px solid var(--input-border)",
    color: "var(--t1)", outline: "none", borderRadius: "10px",
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--t1)" }}>Quotes</h1>
          <p className="mt-0.5 text-xs" style={{ color: "var(--t3)" }}>Estimates and proposals</p>
        </div>
        <input
          type="search"
          placeholder="Search customer…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="w-48 px-3 py-2 text-xs"
          style={inputStyle}
        />
      </div>

      {/* Segment tabs */}
      <SegTabs tabs={VIEW_TABS} value={view} onChange={setView} />

      {/* List */}
      <div className="space-y-2">
        {isLoading ? (
          <><CardSkeleton /><CardSkeleton /><CardSkeleton /></>
        ) : allItems.length === 0 ? (
          <div
            className="rounded-2xl p-10 text-center text-sm"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--t3)" }}
          >
            No quotes found
          </div>
        ) : (
          <>
            {allItems.map((q) => {
              const name = q.conversations?.contact_display_name ?? q.conversations?.contact_handle ?? "Unknown";
              const badgeStyle = STATUS_BADGE[q.status] ?? { bg: "rgba(113,113,122,0.12)", text: "#a1a1aa" };
              const exp = expiresLabel(q.expires_at);

              return (
                <button
                  key={q.id}
                  onClick={() => router.push(`/dashboard/quotes/${q.id}`)}
                  className="flex w-full flex-col gap-2.5 rounded-2xl p-4 text-left transition-all duration-150"
                  style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"; }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-sm font-semibold" style={{ color: "var(--t1)" }}>{name}</span>
                    <span
                      className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize"
                      style={{ background: badgeStyle.bg, color: badgeStyle.text }}
                    >
                      {q.status.replace(/_/g, " ")}
                    </span>
                  </div>

                  {q.requested_service && (
                    <p className="text-xs leading-relaxed" style={{ color: "var(--t2)" }}>
                      {q.requested_service}
                    </p>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    {q.approved_amount != null && (
                      <span className="text-sm font-bold tabular-nums" style={{ color: "var(--accent-text)" }}>
                        {fmtCurrency(q.approved_amount)}
                      </span>
                    )}
                    <span className="text-xs" style={{ color: "var(--t3)" }}>
                      {timeAgo(q.sent_at ?? q.created_at)}
                    </span>
                    {exp && (
                      <span
                        className="text-xs font-medium"
                        style={{ color: exp.warn ? "#f87171" : "var(--t3)" }}
                      >
                        {exp.text}
                      </span>
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
