"use client";

import { useState } from "react";
import { api } from "~/trpc/react";

// ── Types ──────────────────────────────────────────────────────

type Tab = "daily" | "technicians" | "controls";

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

// ── Main Page ──────────────────────────────────────────────────

export default function OwnerSchedulePage() {
  const [activeTab, setActiveTab] = useState<Tab>("daily");

  const tabs: { key: Tab; label: string }[] = [
    { key: "daily", label: "Daily View" },
    { key: "technicians", label: "Technicians" },
    { key: "controls", label: "Controls" },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold" style={{ color: "var(--t1)" }}>
          Schedule
        </h1>
      </div>

      {/* Tab bar */}
      <div
        className="mb-6 flex gap-1 rounded-lg p-1"
        style={{ background: "var(--bg-hover)" }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="flex-1 rounded-md px-4 py-2 text-sm font-medium transition"
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

      {activeTab === "daily" && <DailyView />}
      {activeTab === "technicians" && <TechnicianList />}
      {activeTab === "controls" && <SchedulingControls />}
    </div>
  );
}

// ── Daily View ─────────────────────────────────────────────────

function DailyView() {
  const [dateStr, setDateStr] = useState(
    () => new Date().toISOString().slice(0, 10),
  );

  const { data: technicians, isLoading: loadingTechs } =
    api.scheduling.listTechnicians.useQuery(undefined);

  const isToday = dateStr === new Date().toISOString().slice(0, 10);
  const displayDate = new Date(dateStr + "T12:00:00").toLocaleDateString(
    "en-US",
    { weekday: "long", month: "long", day: "numeric" },
  );

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: "var(--t1)" }}>
            {isToday ? "Today" : displayDate}
          </h2>
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

      {loadingTechs && (
        <p className="text-sm" style={{ color: "var(--t3)" }}>
          Loading technicians...
        </p>
      )}

      {technicians && technicians.length === 0 && (
        <EmptyCard message="No technicians found. Add technicians in Settings." />
      )}

      {technicians && technicians.length > 0 && (
        <div className="space-y-4">
          {technicians.map((tech) => (
            <TechDayCard key={tech.id} tech={tech} dateStr={dateStr} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tech Day Card ──────────────────────────────────────────────

function TechDayCard({
  tech,
  dateStr,
}: {
  tech: { id: string; name: string; is_active: boolean };
  dateStr: string;
}) {
  const { data: jobs, isLoading } = api.scheduling.getQueue.useQuery(
    {
      technicianId: tech.id,
      date: new Date(dateStr + "T00:00:00Z").toISOString(),
    },
  );

  const completedCount = Array.isArray(jobs)
    ? jobs.filter((j: any) => j.status === "COMPLETED").length
    : 0;
  const totalCount = Array.isArray(jobs) ? jobs.length : 0;

  return (
    <div
      className="rounded-xl border"
      style={{
        background: "var(--bg-elevated)",
        borderColor: "var(--border)",
      }}
    >
      {/* Tech header */}
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white"
            style={{
              background: tech.is_active
                ? "linear-gradient(135deg, #22c55e, #16a34a)"
                : "#9ca3af",
            }}
          >
            {tech.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: "var(--t1)" }}>
              {tech.name}
            </p>
            {!tech.is_active && (
              <span className="text-[10px] font-medium text-amber-600">
                Inactive
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          {isLoading ? (
            <p className="text-xs" style={{ color: "var(--t3)" }}>
              Loading...
            </p>
          ) : (
            <p className="text-xs" style={{ color: "var(--t3)" }}>
              {completedCount}/{totalCount} done
            </p>
          )}
        </div>
      </div>

      {/* Jobs list */}
      <div className="px-5 py-2">
        {isLoading && (
          <p className="py-3 text-center text-xs" style={{ color: "var(--t3)" }}>
            Loading queue...
          </p>
        )}

        {!isLoading && totalCount === 0 && (
          <p className="py-3 text-center text-xs" style={{ color: "var(--t3)" }}>
            No jobs scheduled
          </p>
        )}

        {!isLoading &&
          Array.isArray(jobs) &&
          jobs.map((job: any, idx: number) => {
            const statusInfo =
              STATUS_COLORS[job.status as string] ?? STATUS_COLORS.NOT_STARTED!;
            return (
              <div
                key={job.id ?? idx}
                className="flex items-center justify-between py-2"
                style={{
                  borderBottom:
                    idx < jobs.length - 1
                      ? "1px solid var(--border)"
                      : "none",
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold"
                    style={{ background: "var(--bg-hover)", color: "var(--t3)" }}
                  >
                    {idx + 1}
                  </span>
                  <div className="min-w-0">
                    <p
                      className="truncate text-sm font-medium"
                      style={{ color: "var(--t1)" }}
                    >
                      {job.address_text ?? "Job"}
                    </p>
                    <p className="text-xs" style={{ color: "var(--t3)" }}>
                      {job.estimated_duration_minutes ?? "?"}min
                      {job.drive_time_minutes
                        ? ` \u00b7 ${job.drive_time_minutes}min drive`
                        : ""}
                    </p>
                  </div>
                </div>
                <span
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
                  style={{ background: statusInfo.bg, color: statusInfo.text }}
                >
                  {statusInfo.label}
                </span>
              </div>
            );
          })}
      </div>
    </div>
  );
}

// ── Technician List ────────────────────────────────────────────

function TechnicianList() {
  const { data: technicians, isLoading } =
    api.scheduling.listTechnicians.useQuery(undefined);

  if (isLoading) {
    return (
      <p className="text-sm" style={{ color: "var(--t3)" }}>
        Loading technicians...
      </p>
    );
  }

  if (!technicians || technicians.length === 0) {
    return <EmptyCard message="No technicians yet. Add your first technician to start scheduling." />;
  }

  return (
    <div className="space-y-3">
      {technicians.map((tech) => (
        <div
          key={tech.id}
          className="flex items-center justify-between rounded-xl border p-4"
          style={{
            background: "var(--bg-elevated)",
            borderColor: "var(--border)",
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white"
              style={{
                background: tech.is_active
                  ? "linear-gradient(135deg, #22c55e, #16a34a)"
                  : "#9ca3af",
              }}
            >
              {tech.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--t1)" }}>
                {tech.name}
              </p>
              <p className="text-xs" style={{ color: "var(--t3)" }}>
                {tech.working_hours_start} - {tech.working_hours_end}
                {" \u00b7 "}
                Lunch {tech.lunch_start} - {tech.lunch_end}
              </p>
            </div>
          </div>
          <span
            className="rounded-full px-2.5 py-0.5 text-xs font-medium"
            style={{
              background: tech.is_active ? "#d1fae5" : "#f3f4f6",
              color: tech.is_active ? "#065f46" : "#6b7280",
            }}
          >
            {tech.is_active ? "Active" : "Inactive"}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Scheduling Controls ────────────────────────────────────────

function SchedulingControls() {
  const { data: mode, refetch: refetchMode } =
    api.scheduling.getSchedulingMode.useQuery(undefined);

  const pause = api.scheduling.pauseScheduling.useMutation({
    onSuccess: () => void refetchMode(),
  });
  const resume = api.scheduling.resumeScheduling.useMutation({
    onSuccess: () => void refetchMode(),
  });
  const resync = api.scheduling.requestResync.useMutation({
    onSuccess: () => void refetchMode(),
  });

  const isPaused = mode?.mode === "paused";
  const isAuto = mode?.mode === "active" || !mode;

  return (
    <div className="space-y-4">
      {/* Current mode */}
      <div
        className="rounded-xl border p-5"
        style={{
          background: "var(--bg-elevated)",
          borderColor: "var(--border)",
        }}
      >
        <h3
          className="mb-1 text-sm font-semibold uppercase tracking-wide"
          style={{ color: "var(--t3)" }}
        >
          Scheduling Mode
        </h3>
        <div className="flex items-center gap-3">
          <div
            className="h-3 w-3 rounded-full"
            style={{
              background: isPaused ? "#f59e0b" : "#22c55e",
            }}
          />
          <p className="text-lg font-semibold" style={{ color: "var(--t1)" }}>
            {isPaused ? "Paused" : "Automatic"}
          </p>
        </div>
        <p className="mt-1 text-sm" style={{ color: "var(--t3)" }}>
          {isPaused
            ? "AI scheduling is paused. New bookings will queue but not auto-assign."
            : "AI is automatically scheduling and optimizing jobs."}
        </p>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        {isAuto ? (
          <button
            onClick={() => pause.mutate()}
            disabled={pause.isPending}
            className="rounded-xl border px-5 py-2.5 text-sm font-medium transition hover:shadow-sm disabled:opacity-60"
            style={{
              borderColor: "#f59e0b",
              color: "#d97706",
              background: "var(--bg-elevated)",
            }}
          >
            {pause.isPending ? "Pausing..." : "Pause Scheduling"}
          </button>
        ) : (
          <>
            <button
              onClick={() => resume.mutate()}
              disabled={resume.isPending}
              className="rounded-xl bg-green-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-green-700 disabled:opacity-60"
            >
              {resume.isPending ? "Resuming..." : "Resume Scheduling"}
            </button>
            <button
              onClick={() => resync.mutate()}
              disabled={resync.isPending}
              className="rounded-xl border px-5 py-2.5 text-sm font-medium transition hover:shadow-sm disabled:opacity-60"
              style={{
                borderColor: "var(--border)",
                color: "var(--t2)",
                background: "var(--bg-elevated)",
              }}
            >
              {resync.isPending ? "Syncing..." : "Request Resync"}
            </button>
          </>
        )}
      </div>

      {/* Sick tech */}
      <SickTechPanel />
    </div>
  );
}

// ── Sick Tech Panel ────────────────────────────────────────────

function SickTechPanel() {
  const [selectedTechId, setSelectedTechId] = useState("");
  const { data: technicians } =
    api.scheduling.listTechnicians.useQuery(undefined);

  const redistribute = api.scheduling.redistributeSickTech.useMutation();

  function handleRedistribute() {
    if (!selectedTechId) return;
    redistribute.mutate({
      technicianId: selectedTechId,
      date: new Date().toISOString(),
    });
  }

  return (
    <div
      className="rounded-xl border p-5"
      style={{
        background: "var(--bg-elevated)",
        borderColor: "var(--border)",
      }}
    >
      <h3
        className="mb-3 text-sm font-semibold uppercase tracking-wide"
        style={{ color: "var(--t3)" }}
      >
        Sick Tech / Emergency Rebook
      </h3>
      <p className="mb-3 text-sm" style={{ color: "var(--t2)" }}>
        Redistribute all of a technician&apos;s jobs for today to other available
        techs.
      </p>

      <div className="flex gap-2">
        <select
          value={selectedTechId}
          onChange={(e) => setSelectedTechId(e.target.value)}
          className="flex-1 rounded-lg border px-3 py-2 text-sm"
          style={{
            background: "var(--bg)",
            borderColor: "var(--border)",
            color: "var(--t1)",
          }}
        >
          <option value="">Select technician...</option>
          {technicians?.map((tech) => (
            <option key={tech.id} value={tech.id}>
              {tech.name}
            </option>
          ))}
        </select>
        <button
          onClick={handleRedistribute}
          disabled={!selectedTechId || redistribute.isPending}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-60"
        >
          {redistribute.isPending ? "Redistributing..." : "Redistribute"}
        </button>
      </div>

      {redistribute.isSuccess && (
        <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          Jobs redistributed successfully.
        </p>
      )}
      {redistribute.isError && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          {redistribute.error.message}
        </p>
      )}
    </div>
  );
}

// ── Empty Card ─────────────────────────────────────────────────

function EmptyCard({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl border p-8 text-center"
      style={{
        background: "var(--bg-elevated)",
        borderColor: "var(--border)",
      }}
    >
      <p className="text-sm" style={{ color: "var(--t3)" }}>
        {message}
      </p>
    </div>
  );
}
