"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";

// ── Types & constants ──────────────────────────────────────────────────────

type ViewType = "open" | "in_progress" | "resolved" | "all";
type UrgencyType = "" | "standard" | "high" | "critical";

const VIEW_TABS: { value: ViewType; label: string }[] = [
  { value: "open",        label: "Open"        },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved",    label: "Resolved"    },
  { value: "all",         label: "All"         },
];

const URGENCY_FILTERS: { value: UrgencyType; label: string }[] = [
  { value: "",         label: "All"      },
  { value: "critical", label: "Critical" },
  { value: "high",     label: "High"     },
  { value: "standard", label: "Standard" },
];

const STATUS_BADGE: Record<string, { bg: string; text: string }> = {
  open:        { bg: "rgba(239,68,68,0.12)",  text: "#f87171" },
  in_progress: { bg: "rgba(234,179,8,0.12)",  text: "#facc15" },
  resolved:    { bg: "rgba(34,197,94,0.12)",  text: "#4ade80" },
};

const URGENCY_BADGE: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: "rgba(239,68,68,0.15)", text: "#f87171", border: "rgba(239,68,68,0.4)" },
  high:     { bg: "rgba(249,115,22,0.12)", text: "#fb923c", border: "rgba(249,115,22,0.3)" },
  standard: { bg: "rgba(113,113,122,0.12)", text: "#a1a1aa", border: "rgba(113,113,122,0.2)" },
};

const LEFT_ACCENT: Record<string, string> = {
  critical: "#ef4444",
  high:     "#f97316",
  standard: "var(--border)",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function toTitleCase(s: string): string {
  return s.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
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

export default function EscalationsPage() {
  const router = useRouter();
  const [view, setView] = useState<ViewType>("open");
  const [urgency, setUrgency] = useState<UrgencyType>("");

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    api.escalations.list.useInfiniteQuery(
      { status: view, urgency: urgency || undefined, limit: 25 },
      { getNextPageParam: (last) => last.nextCursor, refetchInterval: 10_000 },
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
        <h1 className="text-xl font-bold" style={{ color: "var(--t1)" }}>Escalations</h1>
        <p className="mt-0.5 text-xs" style={{ color: "var(--t3)" }}>Issues requiring team review</p>
      </div>

      {/* Segment tabs */}
      <SegTabs tabs={VIEW_TABS} value={view} onChange={setView} />

      {/* Urgency filter pills */}
      <div className="flex flex-wrap gap-2">
        {URGENCY_FILTERS.map((opt) => {
          const active = urgency === opt.value;
          const badge = opt.value ? URGENCY_BADGE[opt.value] : null;
          return (
            <button
              key={opt.value}
              onClick={() => setUrgency(opt.value)}
              className="rounded-full px-3 py-1 text-xs font-medium transition-all duration-150"
              style={{
                background: active ? (badge?.bg ?? "var(--bg-elevated)") : "transparent",
                color: active ? (badge?.text ?? "var(--t1)") : "var(--t3)",
                border: `1px solid ${active ? (badge?.border ?? "var(--border-strong)") : "var(--border)"}`,
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="space-y-2">
        {isLoading ? (
          <><CardSkeleton /><CardSkeleton /><CardSkeleton /></>
        ) : allItems.length === 0 ? (
          <div
            className="rounded-2xl p-10 text-center text-sm"
            style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--t3)" }}
          >
            No escalations found
          </div>
        ) : (
          <>
            {allItems.map((esc) => {
              const _dn = esc.conversations?.contact_display_name;
              const _ph = esc.conversations?.contact_handle;
              const name = _dn && _ph ? `${_dn} · ${_ph}` : _dn ?? _ph ?? "Untitled";
              const statusStyle = STATUS_BADGE[esc.status] ?? { bg: "rgba(113,113,122,0.12)", text: "#a1a1aa" };
              const urgencyStyle = URGENCY_BADGE[esc.urgency] ?? { bg: "rgba(113,113,122,0.12)", text: "#a1a1aa", border: "transparent" };
              const accent = LEFT_ACCENT[esc.urgency] ?? "var(--border)";
              const isCritical = esc.urgency === "critical";

              return (
                <button
                  key={esc.id}
                  onClick={() => router.push(`/dashboard/escalations/${esc.id}`)}
                  className="flex w-full flex-col gap-2 rounded-2xl p-4 text-left transition-all duration-150"
                  style={{
                    background: "var(--bg-surface)",
                    border: "1px solid var(--border)",
                    borderLeft: `3px solid ${accent}`,
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"; }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold" style={{ color: "var(--t1)" }}>{name}</span>

                    {/* Urgency badge */}
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${isCritical ? "animate-pulse" : ""}`}
                      style={{ background: urgencyStyle.bg, color: urgencyStyle.text, border: `1px solid ${urgencyStyle.border}` }}
                    >
                      {esc.urgency}
                    </span>

                    {/* Status badge */}
                    <span
                      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize"
                      style={{ background: statusStyle.bg, color: statusStyle.text }}
                    >
                      {esc.status.replace(/_/g, " ")}
                    </span>
                  </div>

                  <p className="text-xs font-medium" style={{ color: "var(--t2)" }}>
                    {toTitleCase(esc.category)}
                  </p>

                  {esc.ai_summary && (
                    <p className="line-clamp-2 text-xs leading-relaxed" style={{ color: "var(--t3)" }}>
                      {esc.ai_summary}
                    </p>
                  )}

                  <p className="text-xs" style={{ color: "var(--t3)" }}>{timeAgo(esc.created_at)}</p>
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
