"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "~/trpc/react";

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
  pending: "bg-yellow-100 text-yellow-800",
  approved: "bg-green-100 text-green-800",
  denied: "bg-red-100 text-red-800",
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

function DetailSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-1/4 rounded bg-gray-200" />
      <div className="rounded-xl border border-gray-100 bg-gray-50 p-6 space-y-3">
        <div className="h-5 w-1/3 rounded bg-gray-200" />
        <div className="h-4 w-2/3 rounded bg-gray-200" />
      </div>
    </div>
  );
}

export default function ApprovalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [adminNotes, setAdminNotes] = useState("");

  const { data, isLoading, refetch } = api.approvals.detail.useQuery(
    { approvalId: id },
    { refetchInterval: 15_000 },
  );

  const decideMutation = api.approvals.decide.useMutation({
    onSuccess: () => void refetch(),
  });

  if (isLoading) return <DetailSkeleton />;
  if (!data) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-400">
        Approval request not found.
      </div>
    );
  }

  const customerName =
    data.customers?.display_name ??
    data.conversations?.contact_display_name ??
    data.conversations?.contact_handle ??
    "Unknown customer";

  const statusColor = STATUS_COLORS[data.status] ?? "bg-gray-100 text-gray-700";
  const isPending = data.status === "pending";

  function handleDecide(decision: "approved" | "denied") {
    decideMutation.mutate({
      approvalId: id,
      decision,
      adminNotes: adminNotes || undefined,
    });
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/dashboard/approvals")}
          className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          ← Back
        </button>
        <h1 className="text-lg font-bold text-gray-900">Approval Request</h1>
      </div>

      {/* Main info */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusColor}`}
          >
            {data.status}
          </span>
        </div>
        <InfoRow label="Customer" value={customerName} />
        <InfoRow
          label="Request type"
          value={
            <span className="capitalize">
              {data.request_type.replace(/_/g, " ")}
            </span>
          }
        />
        {data.ai_summary && (
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
            <p className="mb-1 text-xs font-medium text-gray-500">AI Summary</p>
            {data.ai_summary}
          </div>
        )}
        {data.admin_notes && (
          <InfoRow label="Admin notes" value={data.admin_notes} />
        )}
        {!isPending && (
          <>
            <InfoRow
              label="Decided at"
              value={fmtDateTime(data.decided_at)}
            />
          </>
        )}
      </div>

      {/* Conversation context */}
      {data.conversations && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Conversation Context
          </h2>
          <p className="text-sm font-medium text-gray-900">{customerName}</p>
          {data.conversations.contact_handle && (
            <p className="text-xs text-gray-500">
              {data.conversations.contact_handle}
            </p>
          )}
          {data.conversations.cached_summary && (
            <p className="mt-1 text-xs text-gray-500 italic">
              {data.conversations.cached_summary}
            </p>
          )}
          <button
            onClick={() =>
              router.push(`/dashboard/conversations/${data.conversations!.id}`)
            }
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            View conversation →
          </button>
        </div>
      )}

      {/* Action panel — only for pending */}
      {isPending && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Decision
          </h2>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Admin notes (optional)
            </label>
            <textarea
              rows={3}
              value={adminNotes}
              onChange={(e) => setAdminNotes(e.target.value)}
              placeholder="Add a note about your decision…"
              className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => handleDecide("approved")}
              disabled={decideMutation.isPending}
              className="flex-1 rounded-lg bg-green-600 py-2 text-sm font-medium text-white transition hover:bg-green-700 disabled:opacity-50"
            >
              {decideMutation.isPending ? "Saving…" : "Approve"}
            </button>
            <button
              onClick={() => handleDecide("denied")}
              disabled={decideMutation.isPending}
              className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
            >
              {decideMutation.isPending ? "Saving…" : "Deny"}
            </button>
          </div>
          {decideMutation.isError && (
            <p className="text-xs text-red-500">
              {decideMutation.error.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
