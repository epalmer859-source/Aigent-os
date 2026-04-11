"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
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

const STATUS_FLOW: string[] = [
  "NOT_STARTED",
  "EN_ROUTE",
  "ARRIVED",
  "IN_PROGRESS",
  "COMPLETED",
];

type ValidStatus = "NOT_STARTED" | "EN_ROUTE" | "ARRIVED" | "IN_PROGRESS" | "COMPLETED" | "INCOMPLETE" | "NEEDS_REBOOK";
type CompletionNote = "FIXED" | "NEEDS_FOLLOWUP" | "CUSTOMER_DECLINED";

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [completionNote, setCompletionNote] = useState<CompletionNote>("FIXED");
  const [showCompleteModal, setShowCompleteModal] = useState(false);

  const { data: job, isLoading, refetch } = api.techDashboard.jobDetail.useQuery(
    { jobId: id },
  );

  const updateStatus = api.techDashboard.updateJobStatus.useMutation({
    onSuccess: () => void refetch(),
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-lg py-12 text-center">
        <p style={{ color: "var(--t3)" }}>Loading job details...</p>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="mx-auto max-w-lg py-12 text-center">
        <p style={{ color: "var(--t2)" }}>Job not found</p>
        <Link href="/tech" className="mt-2 text-sm text-blue-600 hover:underline">
          Back to queue
        </Link>
      </div>
    );
  }

  const statusInfo = STATUS_COLORS[job.status] ?? STATUS_COLORS.NOT_STARTED!;
  const currentIdx = STATUS_FLOW.indexOf(job.status);
  const nextStatus = currentIdx >= 0 && currentIdx < STATUS_FLOW.length - 1
    ? STATUS_FLOW[currentIdx + 1]
    : undefined;
  const isFinished = job.status === "COMPLETED" || job.status === "INCOMPLETE" || job.status === "CANCELED";

  function handleAdvance() {
    if (nextStatus === "COMPLETED") {
      setShowCompleteModal(true);
      return;
    }
    if (nextStatus) {
      updateStatus.mutate({ jobId: id, status: nextStatus as ValidStatus });
    }
  }

  function handleComplete() {
    updateStatus.mutate({
      jobId: id,
      status: "COMPLETED",
      completionNote,
    });
    setShowCompleteModal(false);
  }

  function handleIncomplete() {
    updateStatus.mutate({
      jobId: id,
      status: "INCOMPLETE",
      completionNote: "NEEDS_FOLLOWUP",
    });
  }

  function handleNeedsRebook() {
    updateStatus.mutate({
      jobId: id,
      status: "NEEDS_REBOOK",
    });
  }

  return (
    <div className="mx-auto max-w-lg">
      {/* Back link */}
      <Link
        href="/tech"
        className="mb-4 inline-flex items-center gap-1 text-sm hover:underline"
        style={{ color: "var(--accent-text)" }}
      >
        &larr; Back to queue
      </Link>

      {/* Job header */}
      <div
        className="rounded-xl border p-5"
        style={{
          background: "var(--bg-elevated)",
          borderColor: "var(--border)",
        }}
      >
        <div className="flex items-start justify-between">
          <h1 className="text-xl font-bold" style={{ color: "var(--t1)" }}>
            {job.customers?.display_name ?? "Customer"}
          </h1>
          <span
            className="rounded-full px-3 py-1 text-xs font-medium"
            style={{ background: statusInfo.bg, color: statusInfo.text }}
          >
            {statusInfo.label}
          </span>
        </div>

        <p className="mt-1 text-sm" style={{ color: "var(--t2)" }}>
          {job.service_types?.name ?? "Service"}
        </p>

        {/* Progress tracker */}
        {!isFinished && (
          <div className="mt-4 flex items-center gap-1">
            {STATUS_FLOW.map((s, i) => {
              const done = i <= currentIdx;
              return (
                <div
                  key={s}
                  className="h-1.5 flex-1 rounded-full"
                  style={{
                    background: done ? "#22c55e" : "var(--bg-hover)",
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Details */}
      <div
        className="mt-4 space-y-3 rounded-xl border p-5"
        style={{
          background: "var(--bg-elevated)",
          borderColor: "var(--border)",
        }}
      >
        <DetailRow label="Address" value={job.address_text} />
        <DetailRow
          label="Duration"
          value={`${job.estimated_duration_minutes} min estimated`}
        />
        <DetailRow label="Drive Time" value={`${job.drive_time_minutes} min`} />
        {/* Customer contact info comes from conversations, not the customer record */}
        {job.job_notes && <DetailRow label="Notes" value={job.job_notes} />}
        {job.actual_duration_minutes && (
          <DetailRow
            label="Actual Duration"
            value={`${job.actual_duration_minutes} min`}
          />
        )}
        {job.completion_note && (
          <DetailRow
            label="Completion Note"
            value={job.completion_note.replace(/_/g, " ")}
          />
        )}
      </div>

      {/* Action buttons */}
      {!isFinished && (
        <div className="mt-4 space-y-2">
          {/* Primary advance button */}
          {nextStatus && (
            <button
              onClick={handleAdvance}
              disabled={updateStatus.isPending}
              className="w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition disabled:opacity-60"
              style={{
                background:
                  nextStatus === "COMPLETED"
                    ? "#16a34a"
                    : "#3b82f6",
              }}
            >
              {updateStatus.isPending
                ? "Updating..."
                : nextStatus === "EN_ROUTE"
                  ? "Start Driving"
                  : nextStatus === "ARRIVED"
                    ? "Mark Arrived"
                    : nextStatus === "IN_PROGRESS"
                      ? "Start Job"
                      : "Complete Job"}
            </button>
          )}

          {/* Secondary actions */}
          {job.status === "IN_PROGRESS" && (
            <div className="flex gap-2">
              <button
                onClick={handleIncomplete}
                disabled={updateStatus.isPending}
                className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition disabled:opacity-60"
                style={{
                  borderColor: "var(--border)",
                  color: "#dc2626",
                  background: "var(--bg-elevated)",
                }}
              >
                Mark Incomplete
              </button>
              <button
                onClick={handleNeedsRebook}
                disabled={updateStatus.isPending}
                className="flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition disabled:opacity-60"
                style={{
                  borderColor: "var(--border)",
                  color: "#d97706",
                  background: "var(--bg-elevated)",
                }}
              >
                Needs Rebook
              </button>
            </div>
          )}
        </div>
      )}

      {/* Completion modal */}
      {showCompleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div
            className="mx-4 w-full max-w-sm rounded-xl border p-6 shadow-xl"
            style={{
              background: "var(--bg-elevated)",
              borderColor: "var(--border)",
            }}
          >
            <h2
              className="mb-4 text-lg font-semibold"
              style={{ color: "var(--t1)" }}
            >
              Complete Job
            </h2>
            <p className="mb-3 text-sm" style={{ color: "var(--t2)" }}>
              How did the job go?
            </p>

            <div className="space-y-2">
              {(
                [
                  ["FIXED", "Fixed / Resolved"],
                  ["NEEDS_FOLLOWUP", "Needs Follow-up"],
                  ["CUSTOMER_DECLINED", "Customer Declined"],
                ] as const
              ).map(([value, label]) => (
                <label
                  key={value}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border p-3"
                  style={{
                    borderColor:
                      completionNote === value
                        ? "#22c55e"
                        : "var(--border)",
                    background:
                      completionNote === value
                        ? "#f0fdf4"
                        : "transparent",
                  }}
                >
                  <input
                    type="radio"
                    name="completionNote"
                    value={value}
                    checked={completionNote === value}
                    onChange={() => setCompletionNote(value)}
                    className="sr-only"
                  />
                  <span className="text-sm font-medium" style={{ color: "var(--t1)" }}>
                    {label}
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-5 flex gap-2">
              <button
                onClick={() => setShowCompleteModal(false)}
                className="flex-1 rounded-lg border px-4 py-2 text-sm font-medium"
                style={{
                  borderColor: "var(--border)",
                  color: "var(--t2)",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleComplete}
                disabled={updateStatus.isPending}
                className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-700 disabled:opacity-60"
              >
                {updateStatus.isPending ? "Saving..." : "Complete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  value,
  isPhone,
}: {
  label: string;
  value: string;
  isPhone?: boolean;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--t3)" }}>
        {label}
      </p>
      {isPhone ? (
        <a
          href={`tel:${value}`}
          className="text-sm font-medium text-blue-600 hover:underline"
        >
          {value}
        </a>
      ) : (
        <p className="text-sm" style={{ color: "var(--t1)" }}>
          {value}
        </p>
      )}
    </div>
  );
}
