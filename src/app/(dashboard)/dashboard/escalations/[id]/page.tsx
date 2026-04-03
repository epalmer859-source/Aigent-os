"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "~/trpc/react";

// ── Helpers ────────────────────────────────────────────────────────────────
function toTitleCase(s: string): string {
  return s
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_COLORS: Record<string, string> = {
  open: "bg-red-100 text-red-800",
  in_progress: "bg-yellow-100 text-yellow-800",
  resolved: "bg-green-100 text-green-800",
};

const URGENCY_BADGES: Record<string, string> = {
  standard: "bg-gray-100 text-gray-700",
  high: "bg-orange-100 text-orange-800",
  critical: "bg-red-500 text-white",
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 text-sm">
      <span className="w-36 shrink-0 font-medium text-gray-500">{label}</span>
      <span className="text-gray-900">{value}</span>
    </div>
  );
}

// ── Mini chat bubble ───────────────────────────────────────────────────────
function MiniBubble({
  direction,
  senderType,
  content,
  createdAt,
}: {
  direction: string;
  senderType: string;
  content: string | null;
  createdAt: Date | string;
}) {
  if (!content) return null;

  const isInbound = direction === "inbound";
  const isSystem =
    senderType === "system" || senderType === "automation";
  const isAi = senderType === "ai";

  const time = new Date(createdAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  if (isSystem) {
    return (
      <div className="my-1 flex justify-center">
        <span className="rounded-full bg-gray-100 px-3 py-0.5 text-xs text-gray-500">
          {content}
        </span>
      </div>
    );
  }

  const bubbleClass = isInbound
    ? "bg-gray-100 text-gray-900 rounded-br-xl rounded-tr-xl rounded-tl-xl"
    : isAi
      ? "bg-blue-600 text-white rounded-bl-xl rounded-tl-xl rounded-tr-xl"
      : "bg-green-600 text-white rounded-bl-xl rounded-tl-xl rounded-tr-xl";

  const wrapClass = isInbound ? "justify-start" : "justify-end";
  const metaClass = isInbound ? "text-left" : "text-right";

  return (
    <div className={`my-1 flex ${wrapClass}`}>
      <div className="max-w-[75%]">
        <div className={`px-2.5 py-1.5 text-xs ${bubbleClass}`}>{content}</div>
        <p className={`mt-0.5 text-xs text-gray-400 ${metaClass}`}>
          {senderType} · {time}
        </p>
      </div>
    </div>
  );
}

// ── Skeleton ───────────────────────────────────────────────────────────────
function DetailSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-1/4 rounded bg-gray-200" />
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-6 space-y-3">
        <div className="h-5 w-1/3 rounded bg-gray-200" />
        <div className="h-4 w-2/3 rounded bg-gray-200" />
        <div className="h-4 w-1/2 rounded bg-gray-200" />
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────
export default function EscalationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [resolutionNote, setResolutionNote] = useState("");

  const { data, isLoading, refetch } = api.escalations.detail.useQuery(
    { escalationId: id },
    { refetchInterval: 10_000 },
  );

  const updateMutation = api.escalations.updateStatus.useMutation({
    onSuccess: () => {
      setResolutionNote("");
      void refetch();
    },
  });

  if (isLoading) return <DetailSkeleton />;
  if (!data) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-400">
        Escalation not found.
      </div>
    );
  }

  const { recentMessages, conversations, customers, ...esc } = data;

  const customerName =
    customers?.display_name ??
    conversations?.contact_display_name ??
    conversations?.contact_handle ??
    "Unknown customer";

  const statusColor = STATUS_COLORS[esc.status] ?? "bg-gray-100 text-gray-700";
  const urgencyBadge =
    URGENCY_BADGES[esc.urgency] ?? "bg-gray-100 text-gray-700";
  const isCritical = esc.urgency === "critical";

  const isOpen = esc.status === "open";
  const isInProgress = esc.status === "in_progress";
  const isResolved = esc.status === "resolved";

  return (
    <div className="mx-auto max-w-xl space-y-4">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/dashboard/escalations")}
          className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          ← Back
        </button>
        <h1 className="text-lg font-bold text-gray-900">Escalation</h1>
      </div>

      {/* Main info */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">
            {toTitleCase(esc.category)}
          </span>
          <span
            className={[
              "rounded-full px-2 py-0.5 text-xs font-semibold capitalize",
              urgencyBadge,
              isCritical ? "animate-pulse" : "",
            ]
              .join(" ")
              .trim()}
          >
            {esc.urgency}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusColor}`}
          >
            {esc.status.replace(/_/g, " ")}
          </span>
        </div>

        {esc.ai_summary && (
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
            <p className="mb-1 text-xs font-medium text-gray-500">AI Summary</p>
            {esc.ai_summary}
          </div>
        )}

        <InfoRow label="Created" value={fmtDateTime(esc.created_at)} />

        {isResolved && (
          <>
            <InfoRow
              label="Resolved at"
              value={fmtDateTime(esc.resolved_at)}
            />
            {esc.resolution_note && (
              <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
                <p className="mb-1 text-xs font-medium text-green-600">
                  Resolution Note
                </p>
                {esc.resolution_note}
              </div>
            )}
          </>
        )}
      </div>

      {/* Conversation context */}
      {conversations && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Conversation
          </h2>
          <p className="text-sm font-medium text-gray-900">{customerName}</p>
          {conversations.contact_handle && (
            <p className="text-xs text-gray-500">{conversations.contact_handle}</p>
          )}
          <div className="flex gap-3 text-xs text-gray-500">
            <span className="capitalize">
              {conversations.primary_state?.replace(/_/g, " ")}
            </span>
            <span>·</span>
            <span className="capitalize">Owner: {conversations.current_owner}</span>
          </div>
          {conversations.cached_summary && (
            <p className="text-xs text-gray-500 italic">
              {conversations.cached_summary}
            </p>
          )}
          <button
            onClick={() =>
              router.push(`/dashboard/conversations/${conversations.id}`)
            }
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            View full conversation →
          </button>
        </div>
      )}

      {/* Recent messages */}
      {recentMessages.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Recent Messages
          </h2>
          <div className="max-h-64 overflow-y-auto rounded-lg bg-gray-50 px-3 py-2">
            {recentMessages.map((msg) => (
              <MiniBubble
                key={msg.id}
                direction={msg.direction}
                senderType={msg.sender_type}
                content={msg.content}
                createdAt={msg.created_at}
              />
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      {!isResolved && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Actions
          </h2>

          {(isInProgress || isOpen) && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Resolution note{isInProgress ? " *" : " (optional for quick resolve)"}
              </label>
              <textarea
                rows={3}
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                placeholder="Describe how this was resolved…"
                className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {isOpen && (
              <button
                onClick={() =>
                  updateMutation.mutate({
                    escalationId: id,
                    status: "in_progress",
                  })
                }
                disabled={updateMutation.isPending}
                className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-yellow-600 disabled:opacity-50"
              >
                Start Working
              </button>
            )}
            <button
              onClick={() =>
                updateMutation.mutate({
                  escalationId: id,
                  status: "resolved",
                  resolutionNote: resolutionNote || undefined,
                })
              }
              disabled={
                updateMutation.isPending ||
                (isInProgress && !resolutionNote.trim())
              }
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-700 disabled:opacity-50"
            >
              {updateMutation.isPending ? "Saving…" : "Resolve"}
            </button>
          </div>

          {isInProgress && !resolutionNote.trim() && (
            <p className="text-xs text-gray-400">
              A resolution note is required before resolving.
            </p>
          )}

          {updateMutation.isError && (
            <p className="text-xs text-red-500">
              {updateMutation.error.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
