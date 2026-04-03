"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";

type ViewType = "open" | "in_progress" | "resolved" | "all";
type UrgencyType = "standard" | "high" | "critical" | "";

const VIEW_TABS: { value: ViewType; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

const STATUS_COLORS: Record<string, string> = {
  open: "bg-red-100 text-red-800",
  in_progress: "bg-yellow-100 text-yellow-800",
  resolved: "bg-green-100 text-green-800",
};

const URGENCY_BADGES: Record<string, string> = {
  standard: "bg-gray-100 text-gray-700",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-red-500 text-white",
};

function toTitleCase(s: string): string {
  return s
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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

function CardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-gray-100 bg-gray-50 p-4 space-y-2">
      <div className="h-4 w-1/3 rounded bg-gray-200" />
      <div className="h-3 w-2/3 rounded bg-gray-200" />
    </div>
  );
}

export default function EscalationsPage() {
  const router = useRouter();
  const [view, setView] = useState<ViewType>("open");
  const [urgency, setUrgency] = useState<UrgencyType>("");

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    api.escalations.list.useInfiniteQuery(
      {
        status: view,
        urgency: urgency || undefined,
        limit: 25,
      },
      {
        getNextPageParam: (last) => last.nextCursor,
        refetchInterval: 10_000,
      },
    );

  const allItems = data?.pages.flatMap((p) => p.items) ?? [];

  const observerRef = useRef<IntersectionObserver | null>(null);
  const setupSentinel = (el: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    if (!el) return;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { threshold: 0.1 },
    );
    observerRef.current.observe(el);
  };

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

      {/* Urgency filter */}
      <div className="flex gap-2">
        {(
          [
            { value: "" as UrgencyType, label: "All Urgency" },
            { value: "critical" as UrgencyType, label: "Critical" },
            { value: "high" as UrgencyType, label: "High" },
            { value: "standard" as UrgencyType, label: "Standard" },
          ] as { value: UrgencyType; label: string }[]
        ).map((opt) => (
          <button
            key={opt.value}
            onClick={() => setUrgency(opt.value)}
            className={[
              "rounded-full border px-3 py-1 text-xs font-medium transition",
              urgency === opt.value
                ? "border-blue-600 bg-blue-600 text-white"
                : "border-gray-200 text-gray-600 hover:border-gray-300",
            ].join(" ")}
          >
            {opt.label}
          </button>
        ))}
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
            No escalations found
          </div>
        ) : (
          <>
            {allItems.map((esc) => {
              const customerName =
                esc.conversations?.contact_display_name ??
                esc.conversations?.contact_handle ??
                "Unknown customer";
              const statusColor =
                STATUS_COLORS[esc.status] ?? "bg-gray-100 text-gray-700";
              const urgencyBadge =
                URGENCY_BADGES[esc.urgency] ?? "bg-gray-100 text-gray-700";
              const isCritical = esc.urgency === "critical";

              return (
                <button
                  key={esc.id}
                  onClick={() =>
                    router.push(`/dashboard/escalations/${esc.id}`)
                  }
                  className="flex w-full flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:border-blue-200 hover:shadow-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                      {customerName}
                    </span>
                    <span
                      className={[
                        "rounded-full px-2 py-0.5 text-xs font-semibold capitalize",
                        urgencyBadge,
                        isCritical ? "animate-pulse" : "",
                      ]
                        .join(" ")
                        .trim()}
                    >
                      {esc.urgency}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusColor}`}
                    >
                      {esc.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="text-xs font-medium text-gray-700">
                    {toTitleCase(esc.category)}
                  </p>
                  {esc.ai_summary && (
                    <p className="line-clamp-2 text-xs text-gray-500">
                      {esc.ai_summary}
                    </p>
                  )}
                  <p className="text-xs text-gray-400">
                    {timeAgo(esc.created_at)}
                  </p>
                </button>
              );
            })}
            <div ref={setupSentinel} className="h-4" />
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
