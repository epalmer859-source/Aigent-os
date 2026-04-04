"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";

// ── Types & constants ──────────────────────────────────────────────────────

type ViewType = "today" | "upcoming" | "past" | "all";

const VIEW_TABS: { value: ViewType; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
  { value: "all", label: "All" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All" },
  { value: "booked", label: "Booked" },
  { value: "rescheduled", label: "Rescheduled" },
  { value: "canceled", label: "Canceled" },
  { value: "completed", label: "Completed" },
  { value: "no_show", label: "No Show" },
];

const STATUS_BADGE: Record<string, { bg: string; text: string }> = {
  booked:      { bg: "rgba(59,130,246,0.12)",  text: "#60a5fa"  },
  rescheduled: { bg: "rgba(234,179,8,0.12)",   text: "#facc15"  },
  canceled:    { bg: "rgba(239,68,68,0.12)",   text: "#f87171"  },
  completed:   { bg: "rgba(34,197,94,0.12)",   text: "#4ade80"  },
  no_show:     { bg: "rgba(249,115,22,0.12)",  text: "#fb923c"  },
};

const DISPATCH_BADGE: Record<string, { bg: string; text: string }> = {
  en_route: { bg: "rgba(59,130,246,0.12)",  text: "#60a5fa" },
  delayed:  { bg: "rgba(249,115,22,0.12)",  text: "#fb923c" },
  arrived:  { bg: "rgba(34,197,94,0.12)",   text: "#4ade80" },
  on_site:  { bg: "rgba(168,85,247,0.12)",  text: "#c084fc" },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtTime(time: Date | string): string {
  return new Date(time).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function Badge({ label, style }: { label: string; style: { bg: string; text: string } }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize"
      style={{ background: style.bg, color: style.text }}
    >
      {label.replace(/_/g, " ")}
    </span>
  );
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
      className="flex animate-pulse items-center gap-4 rounded-2xl p-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
    >
      <div className="h-14 w-12 shrink-0 rounded-xl" style={{ background: "var(--skeleton)" }} />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-1/3 rounded-md" style={{ background: "var(--skeleton)" }} />
        <div className="h-3 w-1/2 rounded-md" style={{ background: "var(--skeleton)" }} />
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

export default function AppointmentsPage() {
  const router = useRouter();
  const [view, setView] = useState<ViewType>("today");
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
    api.appointments.list.useInfiniteQuery(
      { view, limit: 25, search: search || undefined, status: status || undefined },
      { getNextPageParam: (last) => last.nextCursor, refetchInterval: 30_000 },
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
          <h1 className="text-xl font-bold" style={{ color: "var(--t1)" }}>Appointments</h1>
          <p className="mt-0.5 text-xs" style={{ color: "var(--t3)" }}>Scheduled service visits</p>
        </div>
        <div className="flex gap-2">
          <input
            type="search"
            placeholder="Search customer…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-44 px-3 py-2 text-xs"
            style={inputStyle}
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="px-3 py-2 text-xs"
            style={inputStyle}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
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
            No appointments found
          </div>
        ) : (
          <>
            {allItems.map((appt) => {
              const name = appt.conversations?.contact_display_name ?? appt.conversations?.contact_handle ?? "Unknown";
              const statusStyle = STATUS_BADGE[appt.status] ?? { bg: "rgba(113,113,122,0.12)", text: "#a1a1aa" };
              const d = new Date(appt.appointment_date);

              return (
                <button
                  key={appt.id}
                  onClick={() => router.push(`/dashboard/appointments/${appt.id}`)}
                  className="flex w-full items-center gap-4 rounded-2xl p-4 text-left transition-all duration-150"
                  style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)"; (e.currentTarget as HTMLElement).style.background = "var(--bg-elevated)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLElement).style.background = "var(--bg-surface)"; }}
                >
                  {/* Date block */}
                  <div
                    className="flex w-12 shrink-0 flex-col items-center rounded-xl py-2.5"
                    style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
                  >
                    <span className="text-[10px] font-medium uppercase" style={{ color: "var(--t3)" }}>
                      {d.toLocaleDateString(undefined, { month: "short" })}
                    </span>
                    <span className="text-xl font-bold leading-tight" style={{ color: "var(--t1)" }}>
                      {d.getDate()}
                    </span>
                    <span className="text-[10px]" style={{ color: "var(--t3)" }}>
                      {d.toLocaleDateString(undefined, { weekday: "short" })}
                    </span>
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold" style={{ color: "var(--t1)" }}>{name}</span>
                      <Badge label={appt.status} style={statusStyle} />
                      {appt.dispatch_status && (
                        <Badge
                          label={appt.dispatch_status}
                          style={DISPATCH_BADGE[appt.dispatch_status] ?? { bg: "rgba(113,113,122,0.12)", text: "#a1a1aa" }}
                        />
                      )}
                    </div>
                    <p className="mt-1 text-xs" style={{ color: "var(--t2)" }}>
                      {fmtTime(appt.appointment_time)}
                      {appt.duration_minutes ? ` · ${appt.duration_minutes} min` : ""}
                      {appt.service_type ? ` · ${appt.service_type}` : ""}
                    </p>
                    {appt.technician_name && (
                      <p className="mt-0.5 text-xs" style={{ color: "var(--t3)" }}>
                        Tech: {appt.technician_name}
                      </p>
                    )}
                  </div>

                  {/* Arrow */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--t3)", flexShrink: 0 }}>
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
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
