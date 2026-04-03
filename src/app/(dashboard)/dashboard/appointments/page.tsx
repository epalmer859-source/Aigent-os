"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";

// ── Constants ──────────────────────────────────────────────────────────────
type ViewType = "today" | "upcoming" | "past" | "all";

const VIEW_TABS: { value: ViewType; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
  { value: "all", label: "All" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All Statuses" },
  { value: "booked", label: "Booked" },
  { value: "rescheduled", label: "Rescheduled" },
  { value: "canceled", label: "Canceled" },
  { value: "completed", label: "Completed" },
  { value: "no_show", label: "No Show" },
];

const STATUS_COLORS: Record<string, string> = {
  booked: "bg-blue-100 text-blue-800",
  rescheduled: "bg-yellow-100 text-yellow-800",
  canceled: "bg-red-100 text-red-800",
  completed: "bg-green-100 text-green-800",
  no_show: "bg-orange-100 text-orange-800",
};

const DISPATCH_COLORS: Record<string, string> = {
  en_route: "bg-blue-100 text-blue-800",
  delayed: "bg-orange-100 text-orange-800",
  arrived: "bg-green-100 text-green-800",
  on_site: "bg-purple-100 text-purple-800",
};

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtTime(time: Date | string): string {
  return new Date(time).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
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
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    api.appointments.list.useInfiniteQuery(
      {
        view,
        limit: 25,
        search: search || undefined,
        status: status || undefined,
      },
      {
        getNextPageParam: (last) => last.nextCursor,
        refetchInterval: 30_000,
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

      {/* Filters */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          placeholder="Search by customer name…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

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
            No appointments found
          </div>
        ) : (
          <>
            {allItems.map((appt) => {
              const customerName =
                appt.conversations?.contact_display_name ??
                appt.conversations?.contact_handle ??
                "Unknown customer";
              const statusColor =
                STATUS_COLORS[appt.status] ?? "bg-gray-100 text-gray-700";
              return (
                <button
                  key={appt.id}
                  onClick={() =>
                    router.push(`/dashboard/appointments/${appt.id}`)
                  }
                  className="flex w-full items-start gap-4 rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:border-blue-200 hover:shadow-sm"
                >
                  {/* Date block */}
                  <div className="flex w-14 shrink-0 flex-col items-center rounded-lg bg-gray-50 py-2">
                    <span className="text-xs font-medium text-gray-500">
                      {new Date(appt.appointment_date).toLocaleDateString(
                        undefined,
                        { month: "short" },
                      )}
                    </span>
                    <span className="text-xl font-bold leading-none text-gray-900">
                      {new Date(appt.appointment_date).getDate()}
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(appt.appointment_date).toLocaleDateString(
                        undefined,
                        { weekday: "short" },
                      )}
                    </span>
                  </div>

                  {/* Main info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">
                        {customerName}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusColor}`}
                      >
                        {appt.status.replace(/_/g, " ")}
                      </span>
                      {appt.dispatch_status && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${DISPATCH_COLORS[appt.dispatch_status] ?? "bg-gray-100 text-gray-700"}`}
                        >
                          {appt.dispatch_status.replace(/_/g, " ")}
                        </span>
                      )}
                      {appt.is_recurring && (
                        <span className="text-xs text-gray-400" title="Recurring">
                          🔁
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-gray-600">
                      {fmtTime(appt.appointment_time)}
                      {appt.duration_minutes
                        ? ` · ${appt.duration_minutes} min`
                        : ""}
                      {appt.service_type ? ` · ${appt.service_type}` : ""}
                    </p>
                    {appt.technician_name && (
                      <p className="text-xs text-gray-400">
                        Tech: {appt.technician_name}
                      </p>
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
