"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "~/trpc/react";

// ── Shared constants ───────────────────────────────────────────

type Tab = "today" | "upcoming" | "history" | "cancelled";

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  NOT_STARTED:  { bg: "#f3f4f6", text: "#374151", label: "Not Started" },
  EN_ROUTE:     { bg: "#dbeafe", text: "#1d4ed8", label: "En Route" },
  ARRIVED:      { bg: "#fef3c7", text: "#92400e", label: "Arrived" },
  IN_PROGRESS:  { bg: "#e0e7ff", text: "#4338ca", label: "In Progress" },
  COMPLETED:    { bg: "#d1fae5", text: "#065f46", label: "Completed" },
  INCOMPLETE:   { bg: "#fee2e2", text: "#991b1b", label: "Incomplete" },
  CANCELED:     { bg: "#f3f4f6", text: "#6b7280", label: "Canceled" },
  NEEDS_REBOOK: { bg: "#fef3c7", text: "#92400e", label: "Needs Rebook" },
};

const NEXT_STATUS: Record<string, string> = {
  NOT_STARTED: "EN_ROUTE",
  EN_ROUTE: "ARRIVED",
  ARRIVED: "IN_PROGRESS",
  IN_PROGRESS: "COMPLETED",
};

const ACTION_LABELS: Record<string, string> = {
  EN_ROUTE: "Start Driving",
  ARRIVED: "Mark Arrived",
  IN_PROGRESS: "Start Job",
  COMPLETED: "Complete Job",
};

// ── Main Page ──────────────────────────────────────────────────

export default function TechQueuePage() {
  const [activeTab, setActiveTab] = useState<Tab>("today");

  const tabs: { key: Tab; label: string }[] = [
    { key: "today", label: "Today" },
    { key: "upcoming", label: "Upcoming" },
    { key: "history", label: "History" },
    { key: "cancelled", label: "Cancelled" },
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-4 text-2xl font-bold" style={{ color: "var(--t1)" }}>
        My Jobs
      </h1>

      {/* Tab bar */}
      <div
        className="mb-6 flex gap-1 rounded-lg p-1"
        style={{ background: "var(--bg-hover)" }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="flex-1 rounded-md px-3 py-2 text-sm font-medium transition"
            style={{
              background: activeTab === tab.key ? "var(--bg-elevated)" : "transparent",
              color: activeTab === tab.key ? "var(--t1)" : "var(--t3)",
              boxShadow: activeTab === tab.key ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "today" && <TodayTab />}
      {activeTab === "upcoming" && <UpcomingTab />}
      {activeTab === "history" && <HistoryTab />}
      {activeTab === "cancelled" && <CancelledTab />}
    </div>
  );
}

// ── Today Tab ──────────────────────────────────────────────────

function TodayTab() {
  const [dateStr, setDateStr] = useState(
    () => new Date().toISOString().slice(0, 10),
  );

  const { data: jobs, isLoading, refetch } = api.techDashboard.myJobs.useQuery(
    { date: dateStr },
    { refetchInterval: 30_000 },
  );

  const updateStatus = api.techDashboard.updateJobStatus.useMutation({
    onSuccess: () => void refetch(),
  });

  const isToday = dateStr === new Date().toISOString().slice(0, 10);
  const displayDate = new Date(dateStr + "T12:00:00").toLocaleDateString(
    "en-US",
    { weekday: "long", month: "long", day: "numeric" },
  );

  const activeJobs = jobs?.filter(
    (j) => j.status !== "COMPLETED" && j.status !== "CANCELED",
  );
  const completedJobs = jobs?.filter(
    (j) => j.status === "COMPLETED" || j.status === "CANCELED",
  );

  // Show "Start My Day" if it's today and the first job is NOT_STARTED
  const showStartDay =
    isToday &&
    activeJobs &&
    activeJobs.length > 0 &&
    activeJobs[0]!.status === "NOT_STARTED";

  return (
    <div>
      {/* Date header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-lg font-semibold" style={{ color: "var(--t1)" }}>
            {isToday ? "Today" : displayDate}
          </p>
          {isToday && (
            <p className="text-xs" style={{ color: "var(--t3)" }}>
              {displayDate}
            </p>
          )}
        </div>
        <input
          type="date"
          value={dateStr}
          onChange={(e) => setDateStr(e.target.value)}
          className="rounded-lg border px-3 py-1.5 text-sm"
          style={{
            background: "var(--bg-elevated)",
            borderColor: "var(--border)",
            color: "var(--t1)",
          }}
        />
      </div>

      {/* Start My Day button */}
      {showStartDay && (
        <button
          onClick={() =>
            updateStatus.mutate({
              jobId: activeJobs![0]!.id,
              status: "EN_ROUTE",
            })
          }
          disabled={updateStatus.isPending}
          className="mb-4 w-full rounded-xl py-3 text-sm font-semibold text-white transition disabled:opacity-60"
          style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)" }}
        >
          {updateStatus.isPending ? "Starting..." : "Start My Day"}
        </button>
      )}

      {isLoading && <LoadingState />}

      {jobs && jobs.length === 0 && (
        <EmptyCard
          title="No jobs scheduled"
          message={
            isToday
              ? "You have no jobs for today. Enjoy your break!"
              : "No jobs scheduled for this day."
          }
        />
      )}

      {/* Active jobs */}
      {activeJobs && activeJobs.length > 0 && (
        <div className="space-y-3">
          {activeJobs.map((job, idx) => {
            // A job is "next" if it's NOT_STARTED and no earlier job is also NOT_STARTED,
            // or if it's currently EN_ROUTE/ARRIVED/IN_PROGRESS (already active)
            const isActive = ["EN_ROUTE", "ARRIVED", "IN_PROGRESS"].includes(job.status);
            const firstNotStarted = activeJobs.findIndex((j: any) => j.status === "NOT_STARTED");
            const isNextInQueue = isActive || idx === firstNotStarted;

            return (
              <JobCard
                key={job.id}
                job={job}
                position={idx + 1}
                onStatusChange={(status) =>
                  updateStatus.mutate({ jobId: job.id, status })
                }
                isUpdating={updateStatus.isPending}
                isNextInQueue={isNextInQueue}
              />
            );
          })}
        </div>
      )}

      {/* Today's completed */}
      {completedJobs && completedJobs.length > 0 && (
        <div className="mt-6">
          <SectionHeader
            title={`Completed (${completedJobs.length})`}
          />
          <div className="space-y-2">
            {completedJobs.map((job) => (
              <CompactJobRow key={job.id} job={job} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Upcoming Tab ───────────────────────────────────────────────

function UpcomingTab() {
  const { data: jobs, isLoading } = api.techDashboard.upcomingJobs.useQuery();

  if (isLoading) return <LoadingState />;
  if (!jobs || jobs.length === 0) {
    return (
      <EmptyCard
        title="No upcoming jobs"
        message="You don't have any jobs scheduled in the next two weeks."
      />
    );
  }

  // Group by date
  const grouped = new Map<string, typeof jobs>();
  for (const job of jobs) {
    const dateKey =
      job.scheduled_date instanceof Date
        ? job.scheduled_date.toISOString().slice(0, 10)
        : String(job.scheduled_date).slice(0, 10);
    if (!grouped.has(dateKey)) grouped.set(dateKey, []);
    grouped.get(dateKey)!.push(job);
  }

  return (
    <div className="space-y-4">
      {Array.from(grouped.entries()).map(([dateKey, dayJobs]) => (
        <UpcomingDayGroup key={dateKey} dateStr={dateKey} jobs={dayJobs} />
      ))}
    </div>
  );
}

function UpcomingDayGroup({
  dateStr,
  jobs,
}: {
  dateStr: string;
  jobs: any[];
}) {
  const [open, setOpen] = useState(true);
  const label = new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = dateStr === tomorrow.toISOString().slice(0, 10);

  return (
    <div
      className="rounded-xl border"
      style={{
        background: "var(--bg-elevated)",
        borderColor: isTomorrow ? "#22c55e" : "var(--border)",
        borderWidth: isTomorrow ? "2px" : "1px",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: "var(--t1)" }}>
            {label}
          </span>
          {isTomorrow && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
              TOMORROW
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs" style={{ color: "var(--t3)" }}>
            {jobs.length} job{jobs.length !== 1 ? "s" : ""}
          </span>
          <span
            className="text-xs transition-transform"
            style={{
              color: "var(--t3)",
              transform: open ? "rotate(180deg)" : "rotate(0deg)",
            }}
          >
            &#9660;
          </span>
        </div>
      </button>

      {open && (
        <div
          className="space-y-2 px-4 pb-3"
          style={{ borderTop: "1px solid var(--border)" }}
        >
          <div className="pt-2" />
          {jobs.map((job, idx) => (
            <div
              key={job.id}
              className="flex items-center justify-between rounded-lg px-3 py-2.5"
              style={{ background: "var(--bg-hover)" }}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold"
                  style={{ background: "var(--bg)", color: "var(--t3)" }}
                >
                  {idx + 1}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" style={{ color: "var(--t1)" }}>
                    {job.customers?.display_name ?? "Customer"}
                  </p>
                  <p className="text-xs" style={{ color: "var(--t3)" }}>
                    {job.service_types?.name ?? "Service"} &middot;{" "}
                    {job.estimated_duration_minutes}min &middot;{" "}
                    {job.drive_time_minutes}min drive
                  </p>
                  <p className="truncate text-xs" style={{ color: "var(--t3)" }}>
                    {job.address_text}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── History Tab ────────────────────────────────────────────────

function HistoryTab() {
  const [cursor, setCursor] = useState(0);
  const { data: stats } = api.techDashboard.completionStats.useQuery();
  const { data, isLoading } = api.techDashboard.completedHistory.useQuery({
    cursor,
    limit: 10,
  });

  return (
    <div>
      {/* Stats cards */}
      {stats && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total Completed" value={String(stats.totalCompleted)} />
          <StatCard label="This Week" value={String(stats.thisWeekCompleted)} />
          <StatCard
            label="Avg Duration"
            value={stats.avgDurationMinutes > 0 ? `${stats.avgDurationMinutes}m` : "—"}
          />
          <StatCard
            label="Avg Jobs/Day"
            value={stats.avgJobsPerDay > 0 ? String(stats.avgJobsPerDay) : "—"}
          />
        </div>
      )}

      {isLoading && <LoadingState />}

      {data && data.items.length === 0 && cursor === 0 && (
        <EmptyCard
          title="No completed jobs yet"
          message="Your completed jobs will show up here."
        />
      )}

      {data && data.items.length > 0 && (
        <>
          <div className="space-y-2">
            {data.items.map((job) => (
              <HistoryRow key={job.id} job={job} />
            ))}
          </div>

          {/* Pagination */}
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs" style={{ color: "var(--t3)" }}>
              Showing {cursor + 1}–{Math.min(cursor + data.items.length, data.total)} of {data.total}
            </p>
            <div className="flex gap-2">
              {cursor > 0 && (
                <button
                  onClick={() => setCursor(Math.max(0, cursor - 10))}
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:shadow-sm"
                  style={{
                    background: "var(--bg-elevated)",
                    borderColor: "var(--border)",
                    color: "var(--t2)",
                  }}
                >
                  Previous
                </button>
              )}
              {data.hasMore && (
                <button
                  onClick={() => setCursor(data.nextCursor)}
                  className="rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:shadow-sm"
                  style={{
                    background: "var(--bg-elevated)",
                    borderColor: "var(--border)",
                    color: "var(--t2)",
                  }}
                >
                  Load More
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function HistoryRow({ job }: { job: any }) {
  const scheduledDate =
    job.scheduled_date instanceof Date
      ? job.scheduled_date
      : new Date(job.scheduled_date);

  const dateLabel = scheduledDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  const arrivedTime = job.arrived_at
    ? new Date(job.arrived_at).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  const completedTime = job.completed_at
    ? new Date(job.completed_at).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  const statusInfo =
    STATUS_COLORS[job.status as string] ?? STATUS_COLORS.COMPLETED!;

  return (
    <Link
      href={`/tech/job/${job.id}`}
      className="flex items-start gap-3 rounded-xl border px-4 py-3 transition hover:shadow-sm"
      style={{
        background: "var(--bg-elevated)",
        borderColor: "var(--border)",
      }}
    >
      {/* Date badge */}
      <div
        className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg text-center"
        style={{ background: "var(--bg-hover)" }}
      >
        <span className="text-[10px] font-medium leading-tight" style={{ color: "var(--t3)" }}>
          {scheduledDate.toLocaleDateString("en-US", { month: "short" })}
        </span>
        <span className="text-sm font-bold leading-tight" style={{ color: "var(--t1)" }}>
          {scheduledDate.getDate()}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <p className="truncate text-sm font-medium" style={{ color: "var(--t1)" }}>
            {job.customers?.display_name ?? "Customer"}
          </p>
          <span
            className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
            style={{ background: statusInfo.bg, color: statusInfo.text }}
          >
            {statusInfo.label}
          </span>
        </div>
        <p className="text-xs" style={{ color: "var(--t3)" }}>
          {job.service_types?.name ?? "Service"} &middot; {dateLabel}
        </p>
        <p className="truncate text-xs" style={{ color: "var(--t3)" }}>
          {job.address_text}
        </p>
        <div className="mt-1 flex gap-3 text-xs" style={{ color: "var(--t3)" }}>
          {arrivedTime && <span>Started {arrivedTime}</span>}
          {completedTime && <span>Done {completedTime}</span>}
          {job.actual_duration_minutes && (
            <span>{job.actual_duration_minutes}min</span>
          )}
        </div>
      </div>
    </Link>
  );
}

// ── Cancelled Tab ──────────────────────────────────────────────

function CancelledTab() {
  const { data: jobs, isLoading } = api.techDashboard.cancelledJobs.useQuery();

  if (isLoading) return <LoadingState />;
  if (!jobs || jobs.length === 0) {
    return (
      <EmptyCard
        title="No cancelled jobs"
        message="You don't have any cancelled jobs. Keep up the good work!"
      />
    );
  }

  return (
    <div className="space-y-2">
      {jobs.map((job) => {
        const date =
          job.scheduled_date instanceof Date
            ? job.scheduled_date
            : new Date(job.scheduled_date);

        return (
          <div
            key={job.id}
            className="flex items-center justify-between rounded-xl border px-4 py-3"
            style={{
              background: "var(--bg-elevated)",
              borderColor: "var(--border)",
            }}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" style={{ color: "var(--t2)" }}>
                {job.customers?.display_name ?? "Customer"}
              </p>
              <p className="text-xs" style={{ color: "var(--t3)" }}>
                {job.service_types?.name ?? "Service"} &middot;{" "}
                {date.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </p>
              <p className="truncate text-xs" style={{ color: "var(--t3)" }}>
                {job.address_text}
              </p>
            </div>
            <span
              className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{ background: "#f3f4f6", color: "#6b7280" }}
            >
              Cancelled
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Shared Components ──────────────────────────────────────────

function JobCard({
  job,
  position,
  onStatusChange,
  isUpdating,
  isNextInQueue,
}: {
  job: any;
  position: number;
  onStatusChange: (status: "NOT_STARTED" | "EN_ROUTE" | "ARRIVED" | "IN_PROGRESS" | "COMPLETED" | "INCOMPLETE" | "NEEDS_REBOOK") => void;
  isUpdating: boolean;
  isNextInQueue?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const statusInfo = STATUS_COLORS[job.status as string] ?? STATUS_COLORS.NOT_STARTED!;
  const nextStatus = NEXT_STATUS[job.status as string];
  const actionLabel = nextStatus ? ACTION_LABELS[nextStatus] : undefined;
  const customerName = job.customers?.display_name || "\u2014";
  const phone = job.customer_phone as string | null;
  const address = job.address_text as string | null;
  const summary = (job.job_summary || job.service_types?.name || "\u2014") as string;

  return (
    <div
      className="overflow-hidden rounded-xl border transition-shadow"
      style={{
        background: "var(--bg-elevated)",
        borderColor: expanded ? "#3b82f6" : "var(--border)",
        boxShadow: expanded ? "0 2px 8px rgba(0,0,0,0.08)" : undefined,
      }}
    >
      {/* Collapsed header — always visible, tap to expand */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
          style={{ background: "var(--bg-hover)", color: "var(--t2)" }}
        >
          {position}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" style={{ color: "var(--t1)" }}>
            {customerName}
          </p>
          <p className="truncate text-xs" style={{ color: "var(--t3)" }}>
            {job.service_types?.name ?? "Service"} &middot; {job.estimated_duration_minutes} min
          </p>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={{ background: statusInfo.bg, color: statusInfo.text }}
        >
          {statusInfo.label}
        </span>
        <svg
          className={`h-4 w-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
          style={{ color: "var(--t3)" }}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="space-y-3 border-t px-4 pb-4 pt-3" style={{ borderColor: "var(--border)" }}>
          {/* Phone */}
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 shrink-0" style={{ color: "var(--t3)" }} viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg>
            {phone ? (
              <a
                href={`tel:${phone}`}
                className="text-sm font-medium hover:underline"
                style={{ color: "#3b82f6" }}
              >
                {phone}
              </a>
            ) : (
              <span className="text-sm" style={{ color: "var(--t3)" }}>{"\u2014"}</span>
            )}
          </div>

          {/* Address */}
          <div className="flex items-start gap-2">
            <svg className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--t3)" }} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>
            <div className="min-w-0 flex-1">
              <p className="text-sm" style={{ color: "var(--t1)" }}>
                {address || "\u2014"}
              </p>
              {address && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:shadow-sm"
                  style={{ color: "#3b82f6", borderColor: "#3b82f6", background: "rgba(59,130,246,0.05)" }}
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v4.59L7.3 9.24a.75.75 0 00-1.1 1.02l3.25 3.5a.75.75 0 001.1 0l3.25-3.5a.75.75 0 10-1.1-1.02l-1.95 2.1V6.75z" clipRule="evenodd" /></svg>
                  Get Directions
                </a>
              )}
            </div>
          </div>

          {/* Duration + drive time */}
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 shrink-0" style={{ color: "var(--t3)" }} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" /></svg>
            <span className="text-sm" style={{ color: "var(--t2)" }}>
              {job.estimated_duration_minutes} min job &middot; {job.drive_time_minutes} min drive
            </span>
          </div>

          {/* Job summary */}
          <div className="rounded-lg border px-3 py-2.5" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
            <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--t3)" }}>Job Details</p>
            <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--t1)" }}>
              {summary}
            </p>
          </div>

          {/* Job notes */}
          {job.job_notes && (
            <div className="rounded-lg border px-3 py-2.5" style={{ borderColor: "#fbbf24", background: "rgba(251,191,36,0.05)" }}>
              <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "#92400e" }}>Notes</p>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: "var(--t1)" }}>
                {job.job_notes}
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex flex-wrap gap-2 pt-1">
            {job.status === "NOT_STARTED" && isNextInQueue && (
              <button
                onClick={(e) => { e.stopPropagation(); onStatusChange("EN_ROUTE"); }}
                disabled={isUpdating}
                className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-60"
                style={{ background: "#3b82f6" }}
              >
                {isUpdating ? "Updating..." : "Start Driving"}
              </button>
            )}
            {job.status === "EN_ROUTE" && (
              <button
                onClick={(e) => { e.stopPropagation(); onStatusChange("ARRIVED"); }}
                disabled={isUpdating}
                className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-60"
                style={{ background: "#f59e0b" }}
              >
                {isUpdating ? "Updating..." : "Mark Arrived"}
              </button>
            )}
            {job.status === "ARRIVED" && (
              <button
                onClick={(e) => { e.stopPropagation(); onStatusChange("IN_PROGRESS"); }}
                disabled={isUpdating}
                className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-60"
                style={{ background: "#6366f1" }}
              >
                {isUpdating ? "Updating..." : "Start Job"}
              </button>
            )}
            {job.status === "IN_PROGRESS" && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); onStatusChange("COMPLETED"); }}
                  disabled={isUpdating}
                  className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-60"
                  style={{ background: "#16a34a" }}
                >
                  {isUpdating ? "Updating..." : "Complete Job"}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onStatusChange("INCOMPLETE"); }}
                  disabled={isUpdating}
                  className="rounded-lg border px-4 py-2.5 text-sm font-medium transition disabled:opacity-60"
                  style={{ borderColor: "#ef4444", color: "#ef4444" }}
                >
                  Incomplete
                </button>
              </>
            )}
            {(job.status === "NOT_STARTED" && !isNextInQueue) && (
              <p className="w-full text-center text-xs" style={{ color: "var(--t3)" }}>
                Complete the job above first
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CompactJobRow({ job }: { job: any }) {
  const [expanded, setExpanded] = useState(false);
  const statusInfo = STATUS_COLORS[job.status as string] ?? STATUS_COLORS.COMPLETED!;
  const customerName = job.customers?.display_name || "\u2014";
  const phone = job.customer_phone as string | null;
  const address = job.address_text as string | null;
  const summary = (job.job_summary || job.service_types?.name || "\u2014") as string;

  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{
        background: "var(--bg-elevated)",
        borderColor: expanded ? "#3b82f6" : "var(--border)",
      }}
    >
      {/* Collapsed header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" style={{ color: "var(--t2)" }}>
            {customerName}
          </p>
          <p className="truncate text-xs" style={{ color: "var(--t3)" }}>
            {job.service_types?.name ?? "Service"}
            {job.actual_duration_minutes ? ` \u00b7 ${job.actual_duration_minutes} min` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className="rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{ background: statusInfo.bg, color: statusInfo.text }}
          >
            {statusInfo.label}
          </span>
          <svg
            className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
            style={{ color: "var(--t3)" }}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="space-y-2.5 border-t px-4 pb-3 pt-2.5" style={{ borderColor: "var(--border)" }}>
          {/* Phone */}
          <div className="flex items-center gap-2">
            <svg className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--t3)" }} viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg>
            {phone ? (
              <a href={`tel:${phone}`} className="text-sm font-medium hover:underline" style={{ color: "#3b82f6" }}>{phone}</a>
            ) : (
              <span className="text-sm" style={{ color: "var(--t3)" }}>{"\u2014"}</span>
            )}
          </div>
          {/* Address + directions */}
          <div className="flex items-start gap-2">
            <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--t3)" }} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>
            <div className="min-w-0 flex-1">
              <p className="text-sm" style={{ color: "var(--t1)" }}>{address || "\u2014"}</p>
              {address && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium hover:shadow-sm"
                  style={{ color: "#3b82f6", borderColor: "#3b82f6", background: "rgba(59,130,246,0.05)" }}
                >
                  Get Directions
                </a>
              )}
            </div>
          </div>
          {/* Summary */}
          <div className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
            <p className="text-xs leading-relaxed" style={{ color: "var(--t1)" }}>{summary}</p>
          </div>
          {/* Link to full detail */}
          <Link
            href={`/tech/job/${job.id}`}
            className="block text-center text-xs font-medium hover:underline"
            style={{ color: "#3b82f6" }}
          >
            View Full Details
          </Link>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-xl border p-3 text-center"
      style={{
        background: "var(--bg-elevated)",
        borderColor: "var(--border)",
      }}
    >
      <p className="text-xl font-bold" style={{ color: "var(--t1)" }}>
        {value}
      </p>
      <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--t3)" }}>
        {label}
      </p>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <h2
      className="mb-3 text-sm font-semibold uppercase tracking-wide"
      style={{ color: "var(--t3)" }}
    >
      {title}
    </h2>
  );
}

function EmptyCard({ title, message }: { title: string; message: string }) {
  return (
    <div
      className="rounded-xl border p-8 text-center"
      style={{
        background: "var(--bg-elevated)",
        borderColor: "var(--border)",
      }}
    >
      <p className="text-lg font-medium" style={{ color: "var(--t2)" }}>
        {title}
      </p>
      <p className="mt-1 text-sm" style={{ color: "var(--t3)" }}>
        {message}
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <p className="py-8 text-center text-sm" style={{ color: "var(--t3)" }}>
      Loading...
    </p>
  );
}
