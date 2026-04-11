"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "~/trpc/react";

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

export default function TechQueuePage() {
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

  return (
    <div className="mx-auto max-w-2xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1
            className="text-2xl font-bold"
            style={{ color: "var(--t1)" }}
          >
            {isToday ? "Today's Jobs" : "Jobs"}
          </h1>
          <p className="text-sm" style={{ color: "var(--t3)" }}>
            {displayDate}
          </p>
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

      {isLoading && (
        <p className="text-sm" style={{ color: "var(--t3)" }}>
          Loading jobs...
        </p>
      )}

      {jobs && jobs.length === 0 && (
        <div
          className="rounded-xl border p-8 text-center"
          style={{
            background: "var(--bg-elevated)",
            borderColor: "var(--border)",
          }}
        >
          <p className="text-lg font-medium" style={{ color: "var(--t2)" }}>
            No jobs scheduled
          </p>
          <p className="mt-1 text-sm" style={{ color: "var(--t3)" }}>
            {isToday
              ? "You have no jobs for today. Enjoy your break!"
              : "No jobs scheduled for this day."}
          </p>
        </div>
      )}

      {/* Active jobs */}
      {activeJobs && activeJobs.length > 0 && (
        <div className="space-y-3">
          {activeJobs.map((job, idx) => {
            const statusInfo =
              STATUS_COLORS[job.status] ?? STATUS_COLORS.NOT_STARTED!;
            const nextStatus = NEXT_STATUS[job.status];
            const actionLabel = nextStatus
              ? ACTION_LABELS[nextStatus]
              : undefined;

            return (
              <div
                key={job.id}
                className="rounded-xl border p-4"
                style={{
                  background: "var(--bg-elevated)",
                  borderColor: "var(--border)",
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                        style={{
                          background: "var(--bg-hover)",
                          color: "var(--t2)",
                        }}
                      >
                        {idx + 1}
                      </span>
                      <Link
                        href={`/tech/job/${job.id}`}
                        className="truncate text-sm font-semibold hover:underline"
                        style={{ color: "var(--t1)" }}
                      >
                        {job.customers?.display_name ?? "Customer"}
                      </Link>
                    </div>
                    <p
                      className="ml-8 mt-0.5 text-xs"
                      style={{ color: "var(--t3)" }}
                    >
                      {job.service_types?.name ?? "Service"} &middot;{" "}
                      {job.estimated_duration_minutes} min &middot;{" "}
                      {job.drive_time_minutes} min drive
                    </p>
                    <p
                      className="ml-8 mt-0.5 truncate text-xs"
                      style={{ color: "var(--t3)" }}
                    >
                      {job.address_text}
                    </p>
                  </div>
                  <span
                    className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium"
                    style={{
                      background: statusInfo.bg,
                      color: statusInfo.text,
                    }}
                  >
                    {statusInfo.label}
                  </span>
                </div>

                {/* Action button */}
                {actionLabel && nextStatus && (
                  <div className="ml-8 mt-3">
                    <button
                      onClick={() =>
                        updateStatus.mutate({
                          jobId: job.id,
                          status: nextStatus as "EN_ROUTE" | "ARRIVED" | "IN_PROGRESS" | "COMPLETED",
                        })
                      }
                      disabled={updateStatus.isPending}
                      className="rounded-lg px-4 py-2 text-sm font-medium text-white transition disabled:opacity-60"
                      style={{
                        background:
                          nextStatus === "COMPLETED"
                            ? "#16a34a"
                            : "#3b82f6",
                      }}
                    >
                      {updateStatus.isPending ? "Updating..." : actionLabel}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Completed jobs */}
      {completedJobs && completedJobs.length > 0 && (
        <div className="mt-6">
          <h2
            className="mb-3 text-sm font-semibold uppercase tracking-wide"
            style={{ color: "var(--t3)" }}
          >
            Completed ({completedJobs.length})
          </h2>
          <div className="space-y-2">
            {completedJobs.map((job) => {
              const statusInfo =
                STATUS_COLORS[job.status] ?? STATUS_COLORS.COMPLETED!;
              return (
                <Link
                  key={job.id}
                  href={`/tech/job/${job.id}`}
                  className="flex items-center justify-between rounded-lg border px-4 py-3 transition hover:shadow-sm"
                  style={{
                    background: "var(--bg-elevated)",
                    borderColor: "var(--border)",
                  }}
                >
                  <div className="min-w-0">
                    <p
                      className="truncate text-sm font-medium"
                      style={{ color: "var(--t2)" }}
                    >
                      {job.customers?.display_name ?? "Customer"}
                    </p>
                    <p className="text-xs" style={{ color: "var(--t3)" }}>
                      {job.service_types?.name ?? "Service"}
                      {job.actual_duration_minutes
                        ? ` \u00b7 ${job.actual_duration_minutes} min`
                        : ""}
                    </p>
                  </div>
                  <span
                    className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium"
                    style={{
                      background: statusInfo.bg,
                      color: statusInfo.text,
                    }}
                  >
                    {statusInfo.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
