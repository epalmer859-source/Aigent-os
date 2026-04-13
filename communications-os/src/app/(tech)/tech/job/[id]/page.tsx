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

type ValidStatus = "NOT_STARTED" | "EN_ROUTE" | "ARRIVED" | "IN_PROGRESS" | "NEEDS_REBOOK";

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [showCompletionFlow, setShowCompletionFlow] = useState(false);

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
      setShowCompletionFlow(true);
      return;
    }
    if (nextStatus) {
      updateStatus.mutate({ jobId: id, status: nextStatus as ValidStatus });
    }
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
          label="Scheduled"
          value={
            (job as any).job_start_time && (job as any).job_end_time
              ? `${(job as any).job_start_time} – ${(job as any).job_end_time}`
              : "Time TBD"
          }
        />
        <DetailRow
          label="Service"
          value={`${(job as any).is_follow_up ? "Follow-Up" : "Diagnostic"} — ${(job as any).service_duration_minutes ?? (job.estimated_duration_minutes - (job.drive_time_minutes || 0))} min on site`}
        />
        <DetailRow label="Drive Time" value={`${job.drive_time_minutes || 15} min`} />
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
            <button
              onClick={handleNeedsRebook}
              disabled={updateStatus.isPending}
              className="w-full rounded-xl border px-4 py-2.5 text-sm font-medium transition disabled:opacity-60"
              style={{
                borderColor: "var(--border)",
                color: "#d97706",
                background: "var(--bg-elevated)",
              }}
            >
              Needs Rebook
            </button>
          )}
        </div>
      )}

      {/* Completion flow */}
      {showCompletionFlow && (
        <JobDetailCompletionFlow
          jobId={id}
          onClose={() => setShowCompletionFlow(false)}
          onComplete={() => void refetch()}
        />
      )}
    </div>
  );
}

// Time dropdown options: sub-hour granularity (10m increments) then 30m increments up to 9 hours
const TIME_OPTIONS = [10, 20, 30, 40, 50, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360, 390, 420, 450, 480, 510, 540].map((mins) => {
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  const label = hrs > 0 ? (rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`) : `${mins}m`;
  return { value: mins, label };
});

type CompletionStep = "ask_fixed" | "scenario_1" | "scenario_2" | "scenario_3" | "follow_up_form";

function JobDetailCompletionFlow({
  jobId,
  onClose,
  onComplete,
}: {
  jobId: string;
  onClose: () => void;
  onComplete: () => void;
}) {
  const { data: followUpStatus, isLoading: checkingFollowUp } =
    api.techDashboard.checkFollowUpStatus.useQuery({ jobId });

  const completeJob = api.techDashboard.completeJobWithOutcome.useMutation({
    onSuccess: () => { onComplete(); onClose(); },
  });

  const [step, setStep] = useState<CompletionStep | null>(null);
  const [description, setDescription] = useState("");
  const [lowMinutes, setLowMinutes] = useState(60);
  const [highMinutes, setHighMinutes] = useState(120);
  const [needsParts, setNeedsParts] = useState(false);
  const [partsDescription, setPartsDescription] = useState("");
  const [partsExpectedDate, setPartsExpectedDate] = useState("");
  const [partsNotes, setPartsNotes] = useState("");
  const [needsAdditionalTech, setNeedsAdditionalTech] = useState(false);
  const [additionalTechReason, setAdditionalTechReason] = useState("");

  const currentStep = step ?? (
    checkingFollowUp ? null :
    followUpStatus?.isReturnVisit ? "scenario_3" : "ask_fixed"
  );

  const spreadValid = (highMinutes - lowMinutes) >= 0 && (highMinutes - lowMinutes) <= 180;
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
    completeJob.mutate({ jobId, outcome, requestReview, followUp });
  };

  if (checkingFollowUp || currentStep === null) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div
        className="mx-4 w-full max-w-sm rounded-xl border p-6 shadow-xl"
        style={{ background: "var(--bg-elevated)", borderColor: "var(--border)" }}
      >
        {completeJob.isError && (
          <div className="mb-3 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "#ef4444", color: "#ef4444" }}>
            {completeJob.error.message}
          </div>
        )}

        {currentStep === "ask_fixed" && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold" style={{ color: "var(--t1)" }}>Did you fix the issue?</h2>
            <div className="flex gap-2">
              <button onClick={() => setStep("scenario_2")} className="flex-1 rounded-lg px-4 py-2.5 text-sm font-semibold text-white" style={{ background: "#16a34a" }}>Yes</button>
              <button onClick={() => setStep("scenario_1")} className="flex-1 rounded-lg border-2 px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "#f59e0b", color: "#92400e" }}>No</button>
            </div>
            <button onClick={onClose} className="w-full text-center text-xs" style={{ color: "var(--t3)" }}>Cancel</button>
          </div>
        )}

        {currentStep === "scenario_1" && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold" style={{ color: "var(--t1)" }}>What happens next?</h2>
            <button onClick={() => setStep("follow_up_form")} className="w-full rounded-lg border-2 px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "#f59e0b", color: "#92400e" }}>Needs Follow-Up</button>
            <button onClick={() => handleComplete("CUSTOMER_DECLINED", false)} disabled={completeJob.isPending} className="w-full rounded-lg border px-4 py-2.5 text-sm font-medium disabled:opacity-60" style={{ borderColor: "var(--border)", color: "var(--t2)" }}>
              {completeJob.isPending ? "Completing..." : "Customer Declined \u2014 Mark Complete"}
            </button>
            <button onClick={() => setStep("ask_fixed")} className="w-full text-center text-xs" style={{ color: "var(--t3)" }}>Back</button>
          </div>
        )}

        {(currentStep === "scenario_2" || currentStep === "scenario_3") && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold" style={{ color: "var(--t1)" }}>Request a review?</h2>
            <button onClick={() => handleComplete("FIXED", true)} disabled={completeJob.isPending} className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60" style={{ background: "#16a34a" }}>
              {completeJob.isPending ? "Completing..." : "Complete with Review Request"}
            </button>
            <button onClick={() => handleComplete("FIXED", false)} disabled={completeJob.isPending} className="w-full rounded-lg border px-4 py-2.5 text-sm font-medium disabled:opacity-60" style={{ borderColor: "var(--border)", color: "var(--t2)" }}>
              {completeJob.isPending ? "Completing..." : "Complete without Review"}
            </button>
            <button onClick={() => currentStep === "scenario_2" ? setStep("ask_fixed") : onClose()} className="w-full text-center text-xs" style={{ color: "var(--t3)" }}>
              {currentStep === "scenario_2" ? "Back" : "Cancel"}
            </button>
          </div>
        )}

        {currentStep === "follow_up_form" && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold" style={{ color: "var(--t1)" }}>Follow-Up Details</h2>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--t1)" }} placeholder="What needs to be done on the return visit?" />
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--t2)" }}>Low Estimate</label>
                <select value={lowMinutes} onChange={(e) => setLowMinutes(Number(e.target.value))} className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--t1)" }}>
                  {TIME_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--t2)" }}>High Estimate</label>
                <select value={highMinutes} onChange={(e) => setHighMinutes(Number(e.target.value))} className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--t1)" }}>
                  {TIME_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>
            </div>
            {!spreadValid && <p className="text-xs" style={{ color: "#ef4444" }}>Spread cannot exceed 3 hours.</p>}
            {!highValid && <p className="text-xs" style={{ color: "#ef4444" }}>High estimate cannot exceed 9 hours.</p>}
            <p className="text-xs" style={{ color: "var(--t3)" }}>The gap between your low and high estimate determines the customer&apos;s arrival window. A tighter estimate means a tighter window for the next customer.</p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={needsParts} onChange={(e) => setNeedsParts(e.target.checked)} className="h-4 w-4 rounded border" />
              <span className="text-sm" style={{ color: "var(--t2)" }}>Parts needed</span>
            </label>
            {needsParts && (
              <div className="space-y-2 pl-6">
                <input value={partsDescription} onChange={(e) => setPartsDescription(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--t1)" }} placeholder="Describe parts needed..." />
                <div>
                  <label className="mb-1 block text-xs font-medium" style={{ color: "var(--t2)" }}>Expected arrival date</label>
                  <input type="date" value={partsExpectedDate} onChange={(e) => setPartsExpectedDate(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--t1)" }} />
                </div>
                <input value={partsNotes} onChange={(e) => setPartsNotes(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--t1)" }} placeholder="Additional parts notes..." />
              </div>
            )}
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={needsAdditionalTech} onChange={(e) => setNeedsAdditionalTech(e.target.checked)} className="h-4 w-4 rounded border" />
              <span className="text-sm" style={{ color: "var(--t2)" }}>Needs additional technician</span>
            </label>
            {needsAdditionalTech && (
              <input value={additionalTechReason} onChange={(e) => setAdditionalTechReason(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm pl-6" style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--t1)" }} placeholder="Why is a second tech needed?" />
            )}
            <button onClick={() => handleComplete("NEEDS_FOLLOWUP", false)} disabled={completeJob.isPending || !description.trim() || !spreadValid || !highValid} className="w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60" style={{ background: "#f59e0b" }}>
              {completeJob.isPending ? "Completing..." : "Submit Follow-Up & Complete"}
            </button>
            <button onClick={() => setStep("scenario_1")} className="w-full text-center text-xs" style={{ color: "var(--t3)" }}>Back</button>
          </div>
        )}
      </div>
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
