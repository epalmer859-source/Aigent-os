"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";

// ── Types & constants ──────────────────────────────────────────────────────

type ViewType = "pending" | "approved" | "denied" | "all";

const VIEW_TABS: { value: ViewType; label: string }[] = [
  { value: "pending",  label: "Pending"  },
  { value: "approved", label: "Approved" },
  { value: "denied",   label: "Denied"   },
  { value: "all",      label: "All"      },
];

const STATUS_BADGE: Record<string, { bg: string; text: string }> = {
  pending:  { bg: "rgba(234,179,8,0.12)",  text: "#facc15" },
  approved: { bg: "rgba(34,197,94,0.12)",  text: "#4ade80" },
  denied:   { bg: "rgba(239,68,68,0.12)",  text: "#f87171" },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(date: Date | string): string {
  const ms = Date.now() - new Date(date).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.round(hr / 24)}d`;
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
      className="animate-pulse space-y-2 rounded-2xl p-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
    >
      <div className="h-3.5 w-1/3 rounded-md" style={{ background: "var(--skeleton)" }} />
      <div className="h-3 w-2/3 rounded-md" style={{ background: "var(--skeleton)" }} />
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

export default function ApprovalsPage() {
  const router = useRouter();
  const [view, setView] = useState<ViewType>("pending");

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    api.approvals.list.useInfiniteQuery(
      { status: view, limit: 25 },
      { getNextPageParam: (last) => last.nextCursor, refetchInterval: 15_000 },
    );

  const allItems = data?.pages.flatMap((p) => p.items) ?? [];

  const observerRef = useRef<IntersectionObserver | null>(null);
  const setupSentinel = (el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!el) return;
    observerRef.current = new IntersectionObserver(
      (e) => { if (e[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage(); },
      { threshold: 0.1 },
    );
    observerRef.current.observe(el);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold" style={{ color: "var(--t1)" }}>Approvals</h1>
        <p className="mt-0.5 text-xs" style={{ color: "var(--t3)" }}>Requests awaiting review</p>
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
            No approval requests found
          </div>
        ) : (
          <>
            {allItems.map((item) => {
              const _dn = item.conversations?.contact_display_name;
              const _ph = item.conversations?.contact_handle;
              const name = _dn && _ph ? `${_dn} · ${_ph}` : _dn ?? _ph ?? "Untitled";
              const badgeStyle = STATUS_BADGE[item.status] ?? { bg: "rgba(113,113,122,0.12)", text: "#a1a1aa" };
              const isPending = item.status === "pending";

              return (
                <button
                  key={item.id}
                  onClick={() => router.push(`/dashboard/approvals/${item.id}`)}
                  className="flex w-full flex-col gap-2 rounded-2xl p-4 text-left transition-all duration-150"
                  style={{
                    background: "var(--bg-surface)",
                    border: `1px solid ${isPending ? "rgba(234,179,8,0.2)" : "var(--border)"}`,
                    borderLeft: isPending ? "3px solid #eab308" : "1px solid var(--border)",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"; }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold" style={{ color: "var(--t1)" }}>{name}</span>
                    <span
                      className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize"
                      style={{ background: badgeStyle.bg, color: badgeStyle.text }}
                    >
                      {item.status}
                    </span>
                  </div>

                  <p className="text-xs font-medium capitalize" style={{ color: "var(--t2)" }}>
                    {item.request_type.replace(/_/g, " ")}
                  </p>

                  {item.ai_summary && (
                    <p className="line-clamp-2 text-xs leading-relaxed" style={{ color: "var(--t3)" }}>
                      {item.ai_summary}
                    </p>
                  )}

                  <p className="text-xs" style={{ color: "var(--t3)" }}>{timeAgo(item.created_at)}</p>
                </button>
              );
            })}
            <div ref={setupSentinel} className="h-4" />
            {isFetchingNextPage && (
              <p className="py-3 text-center text-xs" style={{ color: "var(--t3)" }}>Loading more…</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
