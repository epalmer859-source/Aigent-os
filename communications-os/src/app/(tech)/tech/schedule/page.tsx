"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "~/trpc/react";

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  NOT_STARTED:  { bg: "#f3f4f6", text: "#374151", label: "Scheduled" },
  EN_ROUTE:     { bg: "#dbeafe", text: "#1d4ed8", label: "En Route" },
  ARRIVED:      { bg: "#fef3c7", text: "#92400e", label: "Arrived" },
  IN_PROGRESS:  { bg: "#e0e7ff", text: "#4338ca", label: "In Progress" },
  COMPLETED:    { bg: "#d1fae5", text: "#065f46", label: "Done" },
  INCOMPLETE:   { bg: "#fee2e2", text: "#991b1b", label: "Incomplete" },
  CANCELED:     { bg: "#f3f4f6", text: "#6b7280", label: "Canceled" },
  NEEDS_REBOOK: { bg: "#fef3c7", text: "#92400e", label: "Rebook" },
};

function getWeekDates(baseDate: Date): string[] {
  const monday = new Date(baseDate);
  const day = monday.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  monday.setDate(monday.getDate() + diff);

  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

export default function TechSchedulePage() {
  const [weekOffset, setWeekOffset] = useState(0);

  const baseDate = new Date();
  baseDate.setDate(baseDate.getDate() + weekOffset * 7);
  const weekDates = getWeekDates(baseDate);
  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: "var(--t1)" }}>
          Schedule
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekOffset((w) => w - 1)}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium transition hover:shadow-sm"
            style={{
              background: "var(--bg-elevated)",
              borderColor: "var(--border)",
              color: "var(--t2)",
            }}
          >
            &larr;
          </button>
          <button
            onClick={() => setWeekOffset(0)}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium transition hover:shadow-sm"
            style={{
              background: weekOffset === 0 ? "var(--bg-active)" : "var(--bg-elevated)",
              borderColor: "var(--border)",
              color: weekOffset === 0 ? "var(--accent-text)" : "var(--t2)",
            }}
          >
            This Week
          </button>
          <button
            onClick={() => setWeekOffset((w) => w + 1)}
            className="rounded-lg border px-3 py-1.5 text-sm font-medium transition hover:shadow-sm"
            style={{
              background: "var(--bg-elevated)",
              borderColor: "var(--border)",
              color: "var(--t2)",
            }}
          >
            &rarr;
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {weekDates.map((dateStr) => (
          <DayRow key={dateStr} dateStr={dateStr} isToday={dateStr === todayStr} />
        ))}
      </div>
    </div>
  );
}

function DayRow({ dateStr, isToday }: { dateStr: string; isToday: boolean }) {
  const { data: jobs } = api.techDashboard.myJobs.useQuery({ date: dateStr });

  const label = new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });

  return (
    <div
      className="rounded-xl border p-4"
      style={{
        background: "var(--bg-elevated)",
        borderColor: isToday ? "#22c55e" : "var(--border)",
        borderWidth: isToday ? "2px" : "1px",
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="text-sm font-semibold"
            style={{ color: isToday ? "#16a34a" : "var(--t1)" }}
          >
            {label}
          </span>
          {isToday && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
              TODAY
            </span>
          )}
        </div>
        {jobs && (
          <span className="text-xs" style={{ color: "var(--t3)" }}>
            {jobs.length} job{jobs.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {jobs && jobs.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {jobs.map((job) => {
            const statusInfo = STATUS_COLORS[job.status] ?? STATUS_COLORS.NOT_STARTED!;
            return (
              <Link
                key={job.id}
                href={`/tech/job/${job.id}`}
                className="flex items-center justify-between rounded-lg px-3 py-2 transition"
                style={{ background: "var(--bg-hover)" }}
              >
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-medium" style={{ color: "var(--t1)" }}>
                    {job.customers?.display_name ?? "Customer"}
                  </span>
                  <span className="ml-2 text-xs" style={{ color: "var(--t3)" }}>
                    {job.service_types?.name ?? "Service"} &middot; {job.estimated_duration_minutes}min
                  </span>
                </div>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{ background: statusInfo.bg, color: statusInfo.text }}
                >
                  {statusInfo.label}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
