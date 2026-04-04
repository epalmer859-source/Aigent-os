"use client";

import { api } from "~/trpc/react";

// ── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(date: Date | string) {
  const ms = Date.now() - new Date(date).getTime();
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function cardRow(label: string, value: string | null | undefined) {
  if (!value) return null;
  return (
    <p className="text-xs" style={{ color: "var(--t3)" }}>
      <span style={{ color: "var(--t2)" }}>{label}:</span> {value}
    </p>
  );
}

// ── Skeleton ───────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div
      className="animate-pulse rounded-xl p-4"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--border)" }}
    >
      <div className="mb-2 h-4 w-1/2 rounded-lg" style={{ background: "var(--skeleton)" }} />
      <div className="h-3 w-2/3 rounded-lg" style={{ background: "var(--skeleton)" }} />
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
    <div className="flex items-center gap-2 py-3">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      <p className="text-sm" style={{ color: "var(--t3)" }}>All clear</p>
    </div>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  count: number;
  accentColor: string;
  children: React.ReactNode;
}

function Section({ title, count, accentColor, children }: SectionProps) {
  return (
    <div
      className="rounded-2xl p-5"
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="mb-4 flex items-center gap-2.5">
        {/* Color dot */}
        <span
          className="h-2 w-2 rounded-full shrink-0"
          style={{ background: accentColor }}
        />
        <h2 className="text-sm font-semibold" style={{ color: "var(--t1)" }}>
          {title}
        </h2>
        {count > 0 && (
          <span
            className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-white"
            style={{ background: accentColor }}
          >
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Alert card ─────────────────────────────────────────────────────────────

interface AlertCardProps {
  accentColor: string;
  children: React.ReactNode;
}

function AlertCard({ accentColor, children }: AlertCardProps) {
  return (
    <div
      className="relative overflow-hidden rounded-xl p-4"
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderLeft: `3px solid ${accentColor}`,
      }}
    >
      {children}
    </div>
  );
}

// ── Badge ──────────────────────────────────────────────────────────────────

function Badge({ label, bg, text }: { label: string; bg: string; text: string }) {
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ background: bg, color: text }}
    >
      {label}
    </span>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function UrgentPage() {
  const { data, isLoading } = api.dashboard.urgentItems.useQuery(undefined, {
    refetchInterval: 15_000,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold" style={{ color: "var(--t1)" }}>
          Urgent
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--t3)" }}>
          Items requiring immediate attention
        </p>
      </div>

      {/* ── Escalations ── */}
      <Section title="Escalations" count={data?.escalations.length ?? 0} accentColor="#ef4444">
        {isLoading ? (
          <SectionSkeleton />
        ) : data?.escalations.length === 0 ? (
          <AllClear />
        ) : (
          <div className="space-y-2">
            {data!.escalations.map((esc) => {
              const conv = esc.conversations;
              const name = conv?.customers?.display_name ?? conv?.contact_display_name ?? conv?.contact_handle ?? "Unknown";
              const lastMsg = conv?.message_log_conversations_last_customer_message_idTomessage_log;
              return (
                <AlertCard key={esc.id} accentColor="#ef4444">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium" style={{ color: "var(--t1)" }}>{name}</p>
                    <Badge
                      label={esc.urgency ?? esc.category ?? ""}
                      bg="rgba(239,68,68,0.12)"
                      text="#f87171"
                    />
                  </div>
                  {esc.ai_summary && (
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed" style={{ color: "var(--t2)" }}>
                      {esc.ai_summary}
                    </p>
                  )}
                  {lastMsg?.content && (
                    <p className="mt-1 line-clamp-1 text-xs italic" style={{ color: "var(--t3)" }}>
                      &ldquo;{lastMsg.content}&rdquo;
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-3">
                    {cardRow("Channel", conv?.channel)}
                    <p className="text-xs" style={{ color: "var(--t3)" }}>{timeAgo(esc.created_at)}</p>
                  </div>
                </AlertCard>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── Stale AI Conversations ── */}
      <Section title="Stale Conversations" count={data?.staleConversations.length ?? 0} accentColor="#f97316">
        {isLoading ? (
          <SectionSkeleton />
        ) : data?.staleConversations.length === 0 ? (
          <AllClear />
        ) : (
          <div className="space-y-2">
            {data!.staleConversations.map((conv) => {
              const name = conv.customers?.display_name ?? conv.contact_display_name ?? conv.contact_handle ?? "Unknown";
              const lastMsg = conv.message_log_conversations_last_customer_message_idTomessage_log;
              return (
                <AlertCard key={conv.id} accentColor="#f97316">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium" style={{ color: "var(--t1)" }}>{name}</p>
                    {conv.last_customer_message_at && (
                      <span className="text-xs" style={{ color: "#fb923c" }}>
                        {timeAgo(conv.last_customer_message_at)}
                      </span>
                    )}
                  </div>
                  {lastMsg?.content && (
                    <p className="mt-1.5 line-clamp-2 text-xs italic leading-relaxed" style={{ color: "var(--t2)" }}>
                      &ldquo;{lastMsg.content}&rdquo;
                    </p>
                  )}
                  {cardRow("Channel", conv.channel)}
                </AlertCard>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── Pending Approvals ── */}
      <Section title="Pending Approvals" count={data?.pendingApprovals.length ?? 0} accentColor="#eab308">
        {isLoading ? (
          <SectionSkeleton />
        ) : data?.pendingApprovals.length === 0 ? (
          <AllClear />
        ) : (
          <div className="space-y-2">
            {data!.pendingApprovals.map((appr) => {
              const conv = appr.conversations;
              const name = conv?.customers?.display_name ?? conv?.contact_display_name ?? conv?.contact_handle ?? "Unknown";
              return (
                <AlertCard key={appr.id} accentColor="#eab308">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium" style={{ color: "var(--t1)" }}>{name}</p>
                    <Badge
                      label={appr.request_type ?? ""}
                      bg="rgba(234,179,8,0.12)"
                      text="#facc15"
                    />
                  </div>
                  {appr.ai_summary && (
                    <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed" style={{ color: "var(--t2)" }}>
                      {appr.ai_summary}
                    </p>
                  )}
                  <p className="mt-2 text-xs" style={{ color: "var(--t3)" }}>{timeAgo(appr.created_at)}</p>
                </AlertCard>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── Human Takeovers ── */}
      <Section title="Human Takeovers" count={data?.humanTakeovers.length ?? 0} accentColor="#a855f7">
        {isLoading ? (
          <SectionSkeleton />
        ) : data?.humanTakeovers.length === 0 ? (
          <AllClear />
        ) : (
          <div className="space-y-2">
            {data!.humanTakeovers.map((conv) => {
              const name = conv.customers?.display_name ?? conv.contact_display_name ?? conv.contact_handle ?? "Unknown";
              return (
                <AlertCard key={conv.id} accentColor="#a855f7">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium" style={{ color: "var(--t1)" }}>{name}</p>
                    {conv.human_takeover_enabled_at && (
                      <span className="text-xs" style={{ color: "#c084fc" }}>
                        {timeAgo(conv.human_takeover_enabled_at)}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 space-y-0.5">
                    {cardRow("Channel", conv.channel)}
                    {cardRow("Prior state", conv.prior_state)}
                  </div>
                </AlertCard>
              );
            })}
          </div>
        )}
      </Section>

      {/* ── Today's Appointments ── */}
      <Section title="Today's Appointments" count={data?.todayAppointments.length ?? 0} accentColor="#3b82f6">
        {isLoading ? (
          <SectionSkeleton />
        ) : data?.todayAppointments.length === 0 ? (
          <AllClear />
        ) : (
          <div className="space-y-2">
            {data!.todayAppointments.map((appt) => {
              const name = appt.customers?.display_name ?? appt.conversations?.contact_display_name ?? appt.conversations?.contact_handle ?? "Unknown";
              return (
                <AlertCard key={appt.id} accentColor="#3b82f6">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium" style={{ color: "var(--t1)" }}>{name}</p>
                    <Badge
                      label={appt.status ?? ""}
                      bg="rgba(59,130,246,0.12)"
                      text="#60a5fa"
                    />
                  </div>
                  <div className="mt-2 space-y-0.5">
                    {cardRow("Service", appt.service_type)}
                    {appt.appointment_time && (
                      <p className="text-xs" style={{ color: "var(--t3)" }}>
                        <span style={{ color: "var(--t2)" }}>Time:</span>{" "}
                        {String(appt.appointment_time)}
                      </p>
                    )}
                  </div>
                </AlertCard>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
