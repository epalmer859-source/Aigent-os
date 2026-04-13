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
          {jobs.map((job) => (
            <CompactJobRow key={job.id} job={job} />
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
              <CompactJobRow key={job.id} job={job} />
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
  onStatusChange: (status: "NOT_STARTED" | "EN_ROUTE" | "ARRIVED" | "IN_PROGRESS" | "NEEDS_REBOOK") => void;
  isUpdating: boolean;
  isNextInQueue?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showDelayOptions, setShowDelayOptions] = useState(false);
  const [selectedDelay, setSelectedDelay] = useState<number | null>(null);
  const [showCompletionFlow, setShowCompletionFlow] = useState(false);
  const statusInfo = STATUS_COLORS[job.status as string] ?? STATUS_COLORS.NOT_STARTED!;
  const nextStatus = NEXT_STATUS[job.status as string];
  const actionLabel = nextStatus ? ACTION_LABELS[nextStatus] : undefined;
  const customerName = job.customers?.display_name || "\u2014";
  const phone = job.customer_phone as string | null;
  const address = job.address_text as string | null;
  const summary = (job.job_summary || job.service_types?.name || "\u2014") as string;

  // Schedule times computed server-side
  const jobTimeLabel = (job.job_start_time && job.job_end_time)
    ? `${job.job_start_time} – ${job.job_end_time}`
    : "Time TBD";
  const serviceDuration = job.service_duration_minutes as number | undefined;
  const isFollowUp = job.is_follow_up as boolean | undefined;

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
            {jobTimeLabel} &middot; {isFollowUp ? "Follow-Up" : (job.service_types?.name ?? "Service")}
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

          {/* Schedule time + service duration */}
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 shrink-0" style={{ color: "var(--t3)" }} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" /></svg>
            <span className="text-sm font-medium" style={{ color: "var(--t1)" }}>
              {jobTimeLabel}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4 shrink-0" style={{ color: "var(--t3)" }} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" /></svg>
            <span className="text-sm" style={{ color: "var(--t2)" }}>
              {isFollowUp ? "Follow-Up" : "Diagnostic"} &middot; {serviceDuration ?? 90} min on site &middot; {job.drive_time_minutes || 15} min drive
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

          {/* Update via Assistant */}
          <Link
            href={`/tech/assistant?jobId=${job.id}&jobName=${encodeURIComponent(customerName)}&jobService=${encodeURIComponent(job.service_types?.name ?? "Service")}`}
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition hover:shadow-sm"
            style={{ borderColor: "#22c55e", color: "#22c55e", background: "rgba(34,197,94,0.05)" }}
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 01-4.083-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zm-4 0H9v2h2V9z" clipRule="evenodd" /></svg>
            Update Job via Assistant
          </Link>

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
              <div className="flex w-full flex-col gap-2">
                {/* Arrived / Delayed row */}
                {!showDelayOptions ? (
                  <div className="flex gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); onStatusChange("ARRIVED"); }}
                      disabled={isUpdating}
                      className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-60"
                      style={{ background: "#f59e0b" }}
                    >
                      {isUpdating ? "Updating..." : "Arrived"}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowDelayOptions(true); }}
                      disabled={isUpdating}
                      className="flex-1 rounded-lg border-2 px-4 py-2.5 text-sm font-semibold transition disabled:opacity-60"
                      style={{ borderColor: "#ef4444", color: "#ef4444", background: "rgba(239,68,68,0.05)" }}
                    >
                      Delayed
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs font-medium" style={{ color: "var(--t2)" }}>
                      How long is the delay?
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {[10, 15, 20, 30, 40].map((mins) => (
                        <button
                          key={mins}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDelay(mins);
                            setShowDelayOptions(false);
                          }}
                          className="rounded-lg border px-3 py-2 text-sm font-medium transition hover:shadow-sm"
                          style={{
                            borderColor: "#ef4444",
                            color: "#ef4444",
                            background: "rgba(239,68,68,0.05)",
                          }}
                        >
                          {mins} min
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowDelayOptions(false); }}
                      className="text-xs font-medium"
                      style={{ color: "var(--t3)" }}
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Show selected delay badge + still allow Arrived */}
                {selectedDelay && !showDelayOptions && (
                  <div className="flex items-center gap-2">
                    <span
                      className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                      style={{ background: "#fee2e2", color: "#991b1b" }}
                    >
                      Delayed ~{selectedDelay} min
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelectedDelay(null); }}
                      className="text-xs"
                      style={{ color: "var(--t3)" }}
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
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
              <button
                onClick={(e) => { e.stopPropagation(); setShowCompletionFlow(true); }}
                className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition"
                style={{ background: "#16a34a" }}
              >
                Complete Job
              </button>
            )}
            {(job.status === "NOT_STARTED" && !isNextInQueue) && (
              <p className="w-full text-center text-xs" style={{ color: "var(--t3)" }}>
                Complete the job above first
              </p>
            )}
          </div>
        </div>
      )}

      {/* Completion flow modal */}
      {showCompletionFlow && (
        <CompletionFlow
          jobId={job.id}
          onClose={() => setShowCompletionFlow(false)}
        />
      )}
    </div>
  );
}

// ── Completion Flow ───────────────────────────────────────────

// Time dropdown options: sub-hour granularity (10m increments) then 30m increments up to 9 hours
const TIME_OPTIONS = [10, 20, 30, 40, 50, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360, 390, 420, 450, 480, 510, 540].map((mins) => {
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  const label = hrs > 0
    ? rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`
    : `${mins}m`;
  return { value: mins, label };
});

type CompletionStep =
  | "ask_fixed"        // "Did you fix the issue on site?"
  | "scenario_1"       // First visit, can't fix → follow-up panel
  | "scenario_2"       // First visit, fixed → review choice
  | "scenario_3"       // Return visit → review choice
  | "follow_up_form";  // Needs Follow-Up details form

function CompletionFlow({ jobId, onClose }: { jobId: string; onClose: () => void }) {
  const utils = api.useUtils();
  const { data: followUpStatus, isLoading: checkingFollowUp } =
    api.techDashboard.checkFollowUpStatus.useQuery({ jobId });

  const completeJob = api.techDashboard.completeJobWithOutcome.useMutation({
    onSuccess: () => {
      void utils.techDashboard.myJobs.invalidate();
      onClose();
    },
  });

  // Follow-up form state
  const [description, setDescription] = useState("");
  const [lowMinutes, setLowMinutes] = useState(60);
  const [highMinutes, setHighMinutes] = useState(120);
  const [needsParts, setNeedsParts] = useState(false);
  const [partsDescription, setPartsDescription] = useState("");
  const [partsExpectedDate, setPartsExpectedDate] = useState("");
  const [partsNotes, setPartsNotes] = useState("");
  const [needsAdditionalTech, setNeedsAdditionalTech] = useState(false);
  const [additionalTechReason, setAdditionalTechReason] = useState("");

  // Step state
  const [step, setStep] = useState<CompletionStep | null>(null);

  // Determine initial step based on follow-up status
  const currentStep = step ?? (
    checkingFollowUp ? null :
    followUpStatus?.isReturnVisit ? "scenario_3" :
    "ask_fixed"
  );

  // Validate time spread
  const spreadMinutes = highMinutes - lowMinutes;
  const spreadValid = spreadMinutes >= 0 && spreadMinutes <= 180;
  const highValid = highMinutes <= 540;

  const handleComplete = (
    outcome: "FIXED" | "NEEDS_FOLLOWUP" | "CUSTOMER_DECLINED",
    requestReview: boolean,
  ) => {
    const followUp = outcome === "NEEDS_FOLLOWUP" ? {
      description,
      estimatedLowMinutes: lowMinutes,
      estimatedHighMinutes: highMinutes,
      needsParts,
      partsDescription: needsParts ? partsDescription : undefined,
      partsExpectedDate: needsParts && partsExpectedDate ? partsExpectedDate : undefined,
      partsNotes: needsParts && partsNotes ? partsNotes : undefined,
      needsAdditionalTech,
      additionalTechReason: needsAdditionalTech && additionalTechReason ? additionalTechReason : undefined,
    } : undefined;

    completeJob.mutate({
      jobId,
      outcome,
      requestReview,
      followUp,
    });
  };

  if (checkingFollowUp || currentStep === null) {
    return (
      <div
        className="border-t px-4 py-6 text-center"
        style={{ borderColor: "var(--border)" }}
      >
        <p className="text-sm" style={{ color: "var(--t3)" }}>Loading...</p>
      </div>
    );
  }

  return (
    <div
      className="border-t px-4 py-4"
      style={{ borderColor: "var(--border)", background: "rgba(0,0,0,0.02)" }}
      onClick={(e) => e.stopPropagation()}
    >
      {completeJob.isError && (
        <div className="mb-3 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "#ef4444", color: "#ef4444", background: "rgba(239,68,68,0.05)" }}>
          {completeJob.error.message}
        </div>
      )}

      {/* Step: Did you fix the issue? */}
      {currentStep === "ask_fixed" && (
        <div className="space-y-3">
          <p className="text-sm font-semibold" style={{ color: "var(--t1)" }}>
            Did you fix the issue on site?
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setStep("scenario_2")}
              className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition"
              style={{ background: "#16a34a" }}
            >
              Yes
            </button>
            <button
              onClick={() => setStep("scenario_1")}
              className="flex-1 rounded-lg border-2 px-4 py-2.5 text-sm font-semibold transition"
              style={{ borderColor: "#f59e0b", color: "#92400e", background: "rgba(245,158,11,0.05)" }}
            >
              No
            </button>
          </div>
          <button
            onClick={onClose}
            className="w-full text-center text-xs font-medium"
            style={{ color: "var(--t3)" }}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Scenario 1: First visit, can't fix */}
      {currentStep === "scenario_1" && (
        <div className="space-y-3">
          <p className="text-sm font-semibold" style={{ color: "var(--t1)" }}>
            What happens next?
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => setStep("follow_up_form")}
              className="w-full rounded-lg border-2 px-4 py-2.5 text-sm font-semibold transition"
              style={{ borderColor: "#f59e0b", color: "#92400e", background: "rgba(245,158,11,0.05)" }}
            >
              Needs Follow-Up
            </button>
            <button
              onClick={() => handleComplete("CUSTOMER_DECLINED", false)}
              disabled={completeJob.isPending}
              className="w-full rounded-lg border px-4 py-2.5 text-sm font-medium transition disabled:opacity-60"
              style={{ borderColor: "var(--border)", color: "var(--t2)" }}
            >
              {completeJob.isPending ? "Completing..." : "Customer Declined \u2014 Mark Complete"}
            </button>
          </div>
          <button
            onClick={() => setStep("ask_fixed")}
            className="w-full text-center text-xs font-medium"
            style={{ color: "var(--t3)" }}
          >
            Back
          </button>
        </div>
      )}

      {/* Scenario 2 & 3: Fixed / Return visit → review choice */}
      {(currentStep === "scenario_2" || currentStep === "scenario_3") && (
        <div className="space-y-3">
          <p className="text-sm font-semibold" style={{ color: "var(--t1)" }}>
            Request a review from the customer?
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => handleComplete("FIXED", true)}
              disabled={completeJob.isPending}
              className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-60"
              style={{ background: "#16a34a" }}
            >
              {completeJob.isPending ? "Completing..." : "Complete with Review Request"}
            </button>
            <button
              onClick={() => handleComplete("FIXED", false)}
              disabled={completeJob.isPending}
              className="w-full rounded-lg border px-4 py-2.5 text-sm font-medium transition disabled:opacity-60"
              style={{ borderColor: "var(--border)", color: "var(--t2)" }}
            >
              {completeJob.isPending ? "Completing..." : "Complete without Review"}
            </button>
          </div>
          <button
            onClick={() => currentStep === "scenario_2" ? setStep("ask_fixed") : onClose()}
            className="w-full text-center text-xs font-medium"
            style={{ color: "var(--t3)" }}
          >
            {currentStep === "scenario_2" ? "Back" : "Cancel"}
          </button>
        </div>
      )}

      {/* Follow-Up Form */}
      {currentStep === "follow_up_form" && (
        <div className="space-y-3">
          <p className="text-sm font-semibold" style={{ color: "var(--t1)" }}>
            Follow-Up Details
          </p>

          {/* Description */}
          <div>
            <label className="mb-1 block text-xs font-medium" style={{ color: "var(--t2)" }}>
              What needs to be done on the return visit?
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--bg-elevated)", color: "var(--t1)" }}
              placeholder="Describe the work needed..."
            />
          </div>

          {/* Time range dropdowns */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium" style={{ color: "var(--t2)" }}>
                Low Estimate
              </label>
              <select
                value={lowMinutes}
                onChange={(e) => setLowMinutes(Number(e.target.value))}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", background: "var(--bg-elevated)", color: "var(--t1)" }}
              >
                {TIME_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium" style={{ color: "var(--t2)" }}>
                High Estimate
              </label>
              <select
                value={highMinutes}
                onChange={(e) => setHighMinutes(Number(e.target.value))}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", background: "var(--bg-elevated)", color: "var(--t1)" }}
              >
                {TIME_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
          {!spreadValid && (
            <p className="text-xs" style={{ color: "#ef4444" }}>
              Spread between low and high cannot exceed 3 hours.
            </p>
          )}
          {!highValid && (
            <p className="text-xs" style={{ color: "#ef4444" }}>
              High estimate cannot exceed 9 hours.
            </p>
          )}
          <p className="text-xs" style={{ color: "var(--t3)" }}>
            The gap between your low and high estimate determines the customer&apos;s arrival window. A tighter estimate means a tighter window for the next customer.
          </p>

          {/* Parts needed */}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={needsParts}
              onChange={(e) => setNeedsParts(e.target.checked)}
              className="h-4 w-4 rounded border"
            />
            <span className="text-sm" style={{ color: "var(--t2)" }}>Parts needed</span>
          </label>
          {needsParts && (
            <div className="space-y-2 pl-6">
              <input
                value={partsDescription}
                onChange={(e) => setPartsDescription(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", background: "var(--bg-elevated)", color: "var(--t1)" }}
                placeholder="Describe parts needed..."
              />
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--t2)" }}>
                  Expected arrival date
                </label>
                <input
                  type="date"
                  value={partsExpectedDate}
                  onChange={(e) => setPartsExpectedDate(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  style={{ borderColor: "var(--border)", background: "var(--bg-elevated)", color: "var(--t1)" }}
                />
              </div>
              <input
                value={partsNotes}
                onChange={(e) => setPartsNotes(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", background: "var(--bg-elevated)", color: "var(--t1)" }}
                placeholder="Additional parts notes..."
              />
            </div>
          )}

          {/* Additional tech */}
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={needsAdditionalTech}
              onChange={(e) => setNeedsAdditionalTech(e.target.checked)}
              className="h-4 w-4 rounded border"
            />
            <span className="text-sm" style={{ color: "var(--t2)" }}>Needs additional technician</span>
          </label>
          {needsAdditionalTech && (
            <input
              value={additionalTechReason}
              onChange={(e) => setAdditionalTechReason(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm pl-6"
              style={{ borderColor: "var(--border)", background: "var(--bg-elevated)", color: "var(--t1)" }}
              placeholder="Why is a second tech needed?"
            />
          )}

          {/* Submit */}
          <button
            onClick={() => handleComplete("NEEDS_FOLLOWUP", false)}
            disabled={completeJob.isPending || !description.trim() || !spreadValid || !highValid}
            className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white transition disabled:opacity-60"
            style={{ background: "#f59e0b" }}
          >
            {completeJob.isPending ? "Completing..." : "Submit Follow-Up & Complete Job"}
          </button>
          <button
            onClick={() => setStep("scenario_1")}
            className="w-full text-center text-xs font-medium"
            style={{ color: "var(--t3)" }}
          >
            Back
          </button>
        </div>
      )}
    </div>
  );
}

function CompactJobRow({ job }: { job: any }) {
  const statusInfo = STATUS_COLORS[job.status as string] ?? STATUS_COLORS.COMPLETED!;
  const customerName = job.customers?.display_name || "\u2014";
  const phone = job.customer_phone as string | null;
  const address = job.address_text as string | null;
  const summary = (job.job_summary || job.service_types?.name || "\u2014") as string;
  const duration = job.estimated_duration_minutes ?? job.actual_duration_minutes;

  return (
    <div
      className="rounded-lg border px-4 py-3"
      style={{
        background: "var(--bg-elevated)",
        borderColor: "var(--border)",
      }}
    >
      {/* Name + status */}
      <div className="flex items-center justify-between">
        <Link
          href={`/tech/job/${job.id}`}
          className="truncate text-sm font-semibold hover:underline"
          style={{ color: "var(--t1)" }}
        >
          {customerName}
        </Link>
        <span
          className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={{ background: statusInfo.bg, color: statusInfo.text }}
        >
          {statusInfo.label}
        </span>
      </div>

      {/* Phone */}
      <div className="mt-1 flex items-center gap-1.5">
        <svg className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--t3)" }} viewBox="0 0 20 20" fill="currentColor"><path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" /></svg>
        {phone ? (
          <a href={`tel:${phone}`} className="text-sm font-medium hover:underline" style={{ color: "#3b82f6" }}>{phone}</a>
        ) : (
          <span className="text-sm" style={{ color: "var(--t3)" }}>{"\u2014"}</span>
        )}
      </div>

      {/* Service + duration */}
      <p className="mt-1 text-xs" style={{ color: "var(--t3)" }}>
        {job.service_types?.name ?? "Service"}
        {duration ? ` \u00b7 ${duration} min` : ""}
        {job.drive_time_minutes ? ` \u00b7 ${job.drive_time_minutes} min drive` : ""}
      </p>

      {/* Address */}
      <div className="mt-1 flex items-start gap-1.5">
        <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--t3)" }} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>
        <p className="text-sm" style={{ color: "var(--t1)" }}>{address || "\u2014"}</p>
      </div>

      {/* Directions button */}
      {address && (
        <a
          href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition hover:shadow-sm"
          style={{ color: "#3b82f6", borderColor: "#3b82f6", background: "rgba(59,130,246,0.05)" }}
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" /></svg>
          Get Directions
        </a>
      )}

      {/* Summary */}
      <div className="mt-2 rounded-lg border px-3 py-2" style={{ borderColor: "var(--border)", background: "var(--bg)" }}>
        <p className="text-xs leading-relaxed" style={{ color: "var(--t1)" }}>{summary}</p>
      </div>
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
