"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "~/trpc/react";

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtCurrency(amount: unknown): string {
  const n = Number(amount);
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);
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

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtTime(t: Date | string): string {
  return new Date(t).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_COLORS: Record<string, string> = {
  intake_open: "bg-gray-100 text-gray-700",
  under_review: "bg-yellow-100 text-yellow-800",
  approved_to_send: "bg-blue-100 text-blue-800",
  sent: "bg-blue-100 text-blue-800",
  accepted: "bg-green-100 text-green-800",
  declined: "bg-red-100 text-red-800",
  withdrawn: "bg-gray-100 text-gray-600",
  expired: "bg-orange-100 text-orange-800",
  superseded: "bg-gray-100 text-gray-600",
};

const APPT_STATUS_COLORS: Record<string, string> = {
  booked: "bg-blue-100 text-blue-800",
  rescheduled: "bg-yellow-100 text-yellow-800",
  canceled: "bg-red-100 text-red-800",
  completed: "bg-green-100 text-green-800",
  no_show: "bg-orange-100 text-orange-800",
};

const NEEDS_ACTION = new Set(["intake_open", "under_review"]);
const WITHDRAWABLE = new Set(["intake_open", "under_review", "approved_to_send", "sent"]);
const TERMINAL = new Set(["accepted", "declined", "withdrawn", "expired", "superseded"]);

// ── Sub-components ─────────────────────────────────────────────────────────
function InfoRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  if (value === null || value === undefined || value === "" || value === "—") return null;
  return (
    <div className="flex gap-3 text-sm">
      <span className="w-36 shrink-0 font-medium text-gray-500">{label}</span>
      <span className="text-gray-900">{value}</span>
    </div>
  );
}

interface TimelineEvent {
  label: string;
  date: Date | string | null | undefined;
}

function Timeline({ events }: { events: TimelineEvent[] }) {
  const filtered = events.filter((e) => e.date);
  if (filtered.length === 0) return null;
  return (
    <div className="space-y-0">
      {filtered.map((ev, i) => (
        <div key={i} className="flex items-start gap-3">
          <div className="flex flex-col items-center">
            <div className="mt-1 h-2.5 w-2.5 rounded-full bg-blue-500" />
            {i < filtered.length - 1 && (
              <div className="h-8 w-px bg-gray-200" />
            )}
          </div>
          <div className="pb-1">
            <p className="text-xs font-medium text-gray-700">{ev.label}</p>
            <p className="text-xs text-gray-400">{fmtDateTime(ev.date)}</p>
          </div>
        </div>
      ))}
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
        <div className="h-4 w-1/2 rounded bg-gray-200" />
        <div className="h-4 w-2/3 rounded bg-gray-200" />
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────
export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [approveAmount, setApproveAmount] = useState("");
  const [approveTerms, setApproveTerms] = useState("");

  const { data, isLoading, refetch } = api.quotes.detail.useQuery(
    { quoteId: id },
    { refetchInterval: 15_000 },
  );

  const approveMutation = api.quotes.approve.useMutation({
    onSuccess: () => {
      setApproveAmount("");
      setApproveTerms("");
      void refetch();
    },
  });

  const withdrawMutation = api.quotes.withdraw.useMutation({
    onSuccess: () => void refetch(),
  });

  if (isLoading) return <DetailSkeleton />;
  if (!data) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-400">
        Quote not found.
      </div>
    );
  }

  const { appointments, customers, conversations, ...quote } = data;
  const statusColor = STATUS_COLORS[quote.status] ?? "bg-gray-100 text-gray-700";
  const customerName =
    customers?.display_name ??
    conversations?.contact_display_name ??
    conversations?.contact_handle ??
    "Unknown customer";

  function handleApprove(e: React.FormEvent) {
    e.preventDefault();
    const amount = parseFloat(approveAmount);
    if (isNaN(amount) || amount <= 0) return;
    approveMutation.mutate({
      quoteId: id,
      approvedAmount: amount,
      approvedTerms: approveTerms || undefined,
    });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/dashboard/quotes")}
          className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          ← Back
        </button>
        <h1 className="text-lg font-bold text-gray-900">Quote Detail</h1>
      </div>

      {/* Status + customer */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusColor}`}
          >
            {quote.status.replace(/_/g, " ")}
          </span>
        </div>
        <InfoRow label="Customer" value={customerName} />
        <InfoRow
          label="Requested service"
          value={quote.requested_service}
        />
        <InfoRow label="Quote details" value={quote.quote_details} />
        <InfoRow
          label="Approved amount"
          value={
            quote.approved_amount != null
              ? fmtCurrency(quote.approved_amount)
              : null
          }
        />
        <InfoRow label="Approved terms" value={quote.approved_terms} />
        <InfoRow
          label="Customer response"
          value={quote.customer_response}
        />
        {quote.expires_at && (
          <InfoRow
            label="Expires"
            value={
              <span
                className={
                  new Date(quote.expires_at) < new Date()
                    ? "font-medium text-red-600"
                    : ""
                }
              >
                {fmtDate(quote.expires_at)}
              </span>
            }
          />
        )}
      </div>

      {/* Customer info + conversation link */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Customer
        </h2>
        <p className="text-sm font-medium text-gray-900">{customerName}</p>
        {conversations?.contact_handle && (
          <p className="text-xs text-gray-500">{conversations.contact_handle}</p>
        )}
        {conversations?.channel && (
          <p className="text-xs capitalize text-gray-500">
            {conversations.channel}
          </p>
        )}
        {conversations?.id && (
          <button
            onClick={() =>
              router.push(`/dashboard/conversations/${conversations.id}`)
            }
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            View conversation →
          </button>
        )}
      </div>

      {/* Approve form */}
      {NEEDS_ACTION.has(quote.status) && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Approve Quote
          </h2>
          <form onSubmit={handleApprove} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Approved Amount (USD) *
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={approveAmount}
                onChange={(e) => setApproveAmount(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">
                Terms (optional)
              </label>
              <textarea
                rows={3}
                placeholder="Payment terms, conditions…"
                value={approveTerms}
                onChange={(e) => setApproveTerms(e.target.value)}
                className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              />
            </div>
            <button
              type="submit"
              disabled={
                approveMutation.isPending ||
                !approveAmount ||
                parseFloat(approveAmount) <= 0
              }
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-700 disabled:opacity-50"
            >
              {approveMutation.isPending ? "Approving…" : "Approve Quote"}
            </button>
            {approveMutation.isError && (
              <p className="text-xs text-red-500">
                {approveMutation.error.message}
              </p>
            )}
          </form>
        </div>
      )}

      {/* Withdraw button */}
      {WITHDRAWABLE.has(quote.status) && !NEEDS_ACTION.has(quote.status) && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Actions
          </h2>
          <button
            onClick={() => withdrawMutation.mutate({ quoteId: id })}
            disabled={withdrawMutation.isPending}
            className="rounded-lg bg-gray-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:opacity-50"
          >
            {withdrawMutation.isPending ? "Withdrawing…" : "Withdraw Quote"}
          </button>
          {withdrawMutation.isError && (
            <p className="mt-1 text-xs text-red-500">
              {withdrawMutation.error.message}
            </p>
          )}
        </div>
      )}

      {/* Terminal state notice */}
      {TERMINAL.has(quote.status) && (
        <div className="rounded-xl border border-gray-100 bg-gray-50 p-4 text-center text-sm text-gray-500">
          This quote is{" "}
          <span className="font-medium capitalize">
            {quote.status.replace(/_/g, " ")}
          </span>{" "}
          — no further actions available.
        </div>
      )}

      {/* Timeline */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-gray-500">
          Timeline
        </h2>
        <Timeline
          events={[
            { label: "Created", date: quote.created_at },
            { label: "Approved", date: quote.approved_at },
            { label: "Sent to customer", date: quote.sent_at },
            { label: "Customer responded", date: quote.customer_responded_at },
            { label: "Expires", date: quote.expires_at },
          ]}
        />
      </div>

      {/* Related appointments */}
      {appointments.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Related Appointments
          </h2>
          <div className="space-y-2">
            {appointments.map((appt) => {
              const apptColor =
                APPT_STATUS_COLORS[appt.status] ?? "bg-gray-100 text-gray-700";
              return (
                <button
                  key={appt.id}
                  onClick={() =>
                    router.push(`/dashboard/appointments/${appt.id}`)
                  }
                  className="flex w-full items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-left transition hover:bg-gray-100"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {fmtDate(appt.appointment_date)}{" "}
                      {fmtTime(appt.appointment_time)}
                    </p>
                    {appt.service_type && (
                      <p className="text-xs text-gray-500">{appt.service_type}</p>
                    )}
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${apptColor}`}
                  >
                    {appt.status.replace(/_/g, " ")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
