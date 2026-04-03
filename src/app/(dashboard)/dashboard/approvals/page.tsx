"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "~/trpc/react";

type ViewType = "pending" | "approved" | "denied" | "all";

const VIEW_TABS: { value: ViewType; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "denied", label: "Denied" },
  { value: "all", label: "All" },
];

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  denied: "bg-red-100 text-red-800",
};

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

export default function ApprovalsPage() {
  const router = useRouter();
  const [view, setView] = useState<ViewType>("pending");

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    api.approvals.list.useInfiniteQuery(
      { status: view, limit: 25 },
      {
        getNextPageParam: (last) => last.nextCursor,
        refetchInterval: 15_000,
      },
    );

  const allItems = data?.pages.flatMap((p) => p.items) ?? [];

  const sentinelRef = useRef<HTMLDivElement>(null);
  // IntersectionObserver for infinite scroll
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
            No approval requests found
          </div>
        ) : (
          <>
            {allItems.map((item) => {
              const customerName =
                item.conversations?.contact_display_name ??
                item.conversations?.contact_handle ??
                "Unknown customer";
              const statusColor =
                STATUS_COLORS[item.status] ?? "bg-gray-100 text-gray-700";
              return (
                <button
                  key={item.id}
                  onClick={() => router.push(`/dashboard/approvals/${item.id}`)}
                  className="flex w-full flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:border-blue-200 hover:shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-gray-900">
                      {customerName}
                    </p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusColor}`}
                    >
                      {item.status}
                    </span>
                  </div>
                  <p className="text-xs font-medium capitalize text-gray-700">
                    {item.request_type.replace(/_/g, " ")}
                  </p>
                  {item.ai_summary && (
                    <p className="line-clamp-2 text-xs text-gray-500">
                      {item.ai_summary}
                    </p>
                  )}
                  <p className="text-xs text-gray-400">
                    {timeAgo(item.created_at)}
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
