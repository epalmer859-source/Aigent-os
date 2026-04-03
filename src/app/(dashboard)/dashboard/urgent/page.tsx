"use client";

import { api } from "~/trpc/react";

// ── Skeleton ───────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="animate-pulse rounded-lg border border-gray-100 bg-gray-50 p-4">
      <div className="mb-2 h-4 w-2/3 rounded bg-gray-200" />
      <div className="h-3 w-1/2 rounded bg-gray-200" />
    </div>
  );
}

function SectionSkeleton() {
  return (
    <div className="space-y-2">
      <SkeletonCard />
      <SkeletonCard />
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────
function AllClear() {
  return (
    <p className="py-4 text-sm text-gray-400">All clear ✓</p>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────────
interface SectionProps {
  title: string;
  count: number;
  color: string; // tailwind bg class for badge
  children: React.ReactNode;
}

function Section({ title, count, color, children }: SectionProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {count > 0 && (
          <span
            className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold text-white ${color}`}
          >
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Card helpers ───────────────────────────────────────────────────────────
function cardRow(label: string, value: string | null | undefined) {
  if (!value) return null;
  return (
    <p className="text-xs text-gray-500">
      <span className="font-medium text-gray-700">{label}:</span> {value}
    </p>
  );
}

function timeAgo(date: Date | string) {
  const ms = Date.now() - new Date(date).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function UrgentPage() {
  const { data, isLoading } = api.dashboard.urgentItems.useQuery(undefined, {
    refetchInterval: 15_000,
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-gray-900">Urgent</h1>

      {/* ── 1. Escalations ─────────────────────────────────────────── */}
      <Section
        title="Escalations"
        count={data?.escalations.length ?? 0}
        color="bg-red-500"
      >
        {isLoading ? (
          <SectionSkeleton />
        ) : data?.escalations.length === 0 ? (
          <AllClear />
        ) : (
          <div className="space-y-2">
            {data!.escalations.map((esc) => {
              const conv = esc.conversations;
              const name =
                conv?.customers?.display_name ??
                conv?.contact_display_name ??
                conv?.contact_handle ??
                "Unknown";
              const lastMsg =
                conv?.message_log_conversations_last_customer_message_idTomessage_log;
              return (
                <div
                  key={esc.id}
                  className="rounded-lg border border-red-100 bg-red-50 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900">{name}</p>
                    <span className="shrink-0 rounded-full bg-red-200 px-2 py-0.5 text-xs font-semibold uppercase text-red-800">
                      {esc.urgency ?? esc.category}
                    </span>
                  </div>
                  {esc.ai_summary && (
                    <p className="mt-1 line-clamp-2 text-xs text-gray-600">
                      {esc.ai_summary}
                    </p>
                  )}
                  {lastMsg?.content && (
                    <p className="mt-1 line-clamp-1 text-xs text-gray-500 italic">
                      "{lastMsg.content}"
                    </p>
                  )}
                  {cardRow("Channel", conv?.channel)}
                  <p className="mt-1 text-xs text-gray-400">
                    {timeAgo(esc.created_at)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── 2. Stale AI Conversations ──────────────────────────────── */}
      <Section
        title="Stale AI Conversations"
        count={data?.staleConversations.length ?? 0}
        color="bg-orange-500"
      >
        {isLoading ? (
          <SectionSkeleton />
        ) : data?.staleConversations.length === 0 ? (
          <AllClear />
        ) : (
          <div className="space-y-2">
            {data!.staleConversations.map((conv) => {
              const name =
                conv.customers?.display_name ??
                conv.contact_display_name ??
                conv.contact_handle ??
                "Unknown";
              const lastMsg =
                conv.message_log_conversations_last_customer_message_idTomessage_log;
              return (
                <div
                  key={conv.id}
                  className="rounded-lg border border-orange-100 bg-orange-50 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900">{name}</p>
                    <span className="shrink-0 text-xs text-orange-700">
                      {conv.last_customer_message_at
                        ? timeAgo(conv.last_customer_message_at)
                        : ""}
                    </span>
                  </div>
                  {lastMsg?.content && (
                    <p className="mt-1 line-clamp-2 text-xs text-gray-600 italic">
                      "{lastMsg.content}"
                    </p>
                  )}
                  {cardRow("Channel", conv.channel)}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── 3. Pending Approvals ───────────────────────────────────── */}
      <Section
        title="Pending Approvals"
        count={data?.pendingApprovals.length ?? 0}
        color="bg-yellow-500"
      >
        {isLoading ? (
          <SectionSkeleton />
        ) : data?.pendingApprovals.length === 0 ? (
          <AllClear />
        ) : (
          <div className="space-y-2">
            {data!.pendingApprovals.map((appr) => {
              const conv = appr.conversations;
              const name =
                conv?.customers?.display_name ??
                conv?.contact_display_name ??
                conv?.contact_handle ??
                "Unknown";
              return (
                <div
                  key={appr.id}
                  className="rounded-lg border border-yellow-100 bg-yellow-50 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900">{name}</p>
                    <span className="shrink-0 rounded-full bg-yellow-200 px-2 py-0.5 text-xs font-semibold text-yellow-800">
                      {appr.request_type}
                    </span>
                  </div>
                  {appr.ai_summary && (
                    <p className="mt-1 line-clamp-2 text-xs text-gray-600">
                      {appr.ai_summary}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-gray-400">
                    {timeAgo(appr.created_at)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── 4. Human Takeovers ─────────────────────────────────────── */}
      <Section
        title="Human Takeovers"
        count={data?.humanTakeovers.length ?? 0}
        color="bg-purple-500"
      >
        {isLoading ? (
          <SectionSkeleton />
        ) : data?.humanTakeovers.length === 0 ? (
          <AllClear />
        ) : (
          <div className="space-y-2">
            {data!.humanTakeovers.map((conv) => {
              const name =
                conv.customers?.display_name ??
                conv.contact_display_name ??
                conv.contact_handle ??
                "Unknown";
              return (
                <div
                  key={conv.id}
                  className="rounded-lg border border-purple-100 bg-purple-50 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900">{name}</p>
                    {conv.human_takeover_enabled_at && (
                      <span className="shrink-0 text-xs text-purple-700">
                        {timeAgo(conv.human_takeover_enabled_at)}
                      </span>
                    )}
                  </div>
                  {cardRow("Channel", conv.channel)}
                  {cardRow("Prior state", conv.prior_state)}
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── 5. Today's Appointments ───────────────────────────────── */}
      <Section
        title="Today's Appointments"
        count={data?.todayAppointments.length ?? 0}
        color="bg-blue-500"
      >
        {isLoading ? (
          <SectionSkeleton />
        ) : data?.todayAppointments.length === 0 ? (
          <AllClear />
        ) : (
          <div className="space-y-2">
            {data!.todayAppointments.map((appt) => {
              const name =
                appt.customers?.display_name ??
                appt.conversations?.contact_display_name ??
                appt.conversations?.contact_handle ??
                "Unknown";
              return (
                <div
                  key={appt.id}
                  className="rounded-lg border border-blue-100 bg-blue-50 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900">{name}</p>
                    <span className="shrink-0 rounded-full bg-blue-200 px-2 py-0.5 text-xs font-semibold capitalize text-blue-800">
                      {appt.status}
                    </span>
                  </div>
                  {cardRow("Service", appt.service_type)}
                  {appt.appointment_time && (
                    <p className="text-xs text-gray-500">
                      <span className="font-medium text-gray-700">Time:</span>{" "}
                      {String(appt.appointment_time)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
