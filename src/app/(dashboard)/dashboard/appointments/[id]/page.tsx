"use client";

import { useParams, useRouter } from "next/navigation";
import { api } from "~/trpc/react";

// ── Helpers ────────────────────────────────────────────────────────────────
function fmtDate(d: Date | string) {
  return new Date(d).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function fmtTime(t: Date | string) {
  return new Date(t).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtShortDate(d: Date | string) {
  return new Date(d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const STATUS_COLORS: Record<string, string> = {
  booked: "bg-blue-100 text-blue-800",
  rescheduled: "bg-yellow-100 text-yellow-800",
  canceled: "bg-red-100 text-red-800",
  completed: "bg-green-100 text-green-800",
  no_show: "bg-orange-100 text-orange-800",
};

const DISPATCH_COLORS: Record<string, string> = {
  en_route: "bg-blue-100 text-blue-800",
  delayed: "bg-orange-100 text-orange-800",
  arrived: "bg-green-100 text-green-800",
  on_site: "bg-purple-100 text-purple-800",
};

const FINAL_STATUSES = new Set(["completed", "canceled", "no_show"]);

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

// ── Info row ──────────────────────────────────────────────────────────────
function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  if (!value) return null;
  return (
    <div className="flex gap-3 text-sm">
      <span className="w-32 shrink-0 font-medium text-gray-500">{label}</span>
      <span className="text-gray-900">{value}</span>
    </div>
  );
}

// ── Action button ─────────────────────────────────────────────────────────
function ActionBtn({
  onClick,
  disabled,
  color,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-4 py-2 text-sm font-medium text-white transition disabled:opacity-50 ${color}`}
    >
      {children}
    </button>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────
export default function AppointmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { data: appt, isLoading, refetch } = api.appointments.detail.useQuery(
    { appointmentId: id },
    { refetchInterval: 30_000 },
  );

  const statusMutation = api.appointments.updateStatus.useMutation({
    onSuccess: () => void refetch(),
  });
  const dispatchMutation = api.appointments.updateDispatch.useMutation({
    onSuccess: () => void refetch(),
  });

  const isBusy = statusMutation.isPending || dispatchMutation.isPending;

  if (isLoading) return <DetailSkeleton />;
  if (!appt) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-400">
        Appointment not found.
      </div>
    );
  }

  const isFinal = FINAL_STATUSES.has(appt.status);
  const statusColor = STATUS_COLORS[appt.status] ?? "bg-gray-100 text-gray-700";

  const customerName =
    appt.conversations?.contact_display_name ??
    appt.conversations?.contact_handle ??
    "Unknown customer";

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/dashboard/appointments")}
          className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
        >
          ← Back
        </button>
        <h1 className="text-lg font-bold text-gray-900">Appointment Detail</h1>
      </div>

      {/* Main card */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusColor}`}
          >
            {appt.status.replace(/_/g, " ")}
          </span>
          {appt.dispatch_status && (
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${DISPATCH_COLORS[appt.dispatch_status] ?? "bg-gray-100 text-gray-700"}`}
            >
              {appt.dispatch_status.replace(/_/g, " ")}
            </span>
          )}
          {appt.is_recurring && (
            <span className="text-sm text-gray-400" title="Recurring appointment">
              🔁 Recurring
            </span>
          )}
        </div>

        <InfoRow label="Date" value={fmtDate(appt.appointment_date)} />
        <InfoRow label="Time" value={fmtTime(appt.appointment_time)} />
        {appt.duration_minutes && (
          <InfoRow label="Duration" value={`${appt.duration_minutes} min`} />
        )}
        <InfoRow label="Service" value={appt.service_type} />
        <InfoRow label="Address" value={appt.address} />
        <InfoRow label="Technician" value={appt.technician_name} />
        <InfoRow label="Access notes" value={appt.access_notes} />
        <InfoRow label="Admin notes" value={appt.admin_notes} />
        {appt.completed_at && (
          <InfoRow
            label="Completed at"
            value={fmtShortDate(appt.completed_at)}
          />
        )}
        {appt.canceled_at && (
          <InfoRow label="Canceled at" value={fmtShortDate(appt.canceled_at)} />
        )}
      </div>

      {/* Customer + conversation */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Customer
        </h2>
        <p className="text-sm font-medium text-gray-900">{customerName}</p>
        {appt.conversations?.contact_handle && (
          <p className="text-xs text-gray-500">
            {appt.conversations.contact_handle}
          </p>
        )}
        {appt.conversations && (
          <button
            onClick={() =>
              router.push(`/dashboard/conversations/${appt.conversations!.id}`)
            }
            className="mt-1 text-xs font-medium text-blue-600 hover:underline"
          >
            View conversation →
          </button>
        )}
      </div>

      {/* Status actions */}
      {!isFinal && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Update Status
          </h2>
          <div className="flex flex-wrap gap-2">
            <ActionBtn
              color="bg-green-600 hover:bg-green-700"
              disabled={isBusy}
              onClick={() =>
                statusMutation.mutate({
                  appointmentId: id,
                  status: "completed",
                })
              }
            >
              Mark Completed
            </ActionBtn>
            <ActionBtn
              color="bg-orange-500 hover:bg-orange-600"
              disabled={isBusy}
              onClick={() =>
                statusMutation.mutate({
                  appointmentId: id,
                  status: "no_show",
                })
              }
            >
              Mark No Show
            </ActionBtn>
            <ActionBtn
              color="bg-red-600 hover:bg-red-700"
              disabled={isBusy}
              onClick={() =>
                statusMutation.mutate({ appointmentId: id, status: "canceled" })
              }
            >
              Cancel
            </ActionBtn>
          </div>
          {(statusMutation.isError || dispatchMutation.isError) && (
            <p className="text-xs text-red-500">
              {statusMutation.error?.message ??
                dispatchMutation.error?.message}
            </p>
          )}
        </div>
      )}

      {/* Dispatch actions (only when booked/rescheduled) */}
      {(appt.status === "booked" || appt.status === "rescheduled") && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Dispatch Status
          </h2>
          <div className="flex flex-wrap gap-2">
            <ActionBtn
              color="bg-blue-600 hover:bg-blue-700"
              disabled={isBusy || appt.dispatch_status === "en_route"}
              onClick={() =>
                dispatchMutation.mutate({
                  appointmentId: id,
                  dispatchStatus: "en_route",
                })
              }
            >
              En Route
            </ActionBtn>
            <ActionBtn
              color="bg-green-600 hover:bg-green-700"
              disabled={isBusy || appt.dispatch_status === "arrived"}
              onClick={() =>
                dispatchMutation.mutate({
                  appointmentId: id,
                  dispatchStatus: "arrived",
                })
              }
            >
              Arrived
            </ActionBtn>
            <ActionBtn
              color="bg-purple-600 hover:bg-purple-700"
              disabled={isBusy || appt.dispatch_status === "on_site"}
              onClick={() =>
                dispatchMutation.mutate({
                  appointmentId: id,
                  dispatchStatus: "on_site",
                })
              }
            >
              On Site
            </ActionBtn>
            <ActionBtn
              color="bg-orange-500 hover:bg-orange-600"
              disabled={isBusy || appt.dispatch_status === "delayed"}
              onClick={() =>
                dispatchMutation.mutate({
                  appointmentId: id,
                  dispatchStatus: "delayed",
                })
              }
            >
              Mark Delayed
            </ActionBtn>
            {appt.dispatch_status && (
              <ActionBtn
                color="bg-gray-400 hover:bg-gray-500"
                disabled={isBusy}
                onClick={() =>
                  dispatchMutation.mutate({
                    appointmentId: id,
                    dispatchStatus: null,
                  })
                }
              >
                Clear Dispatch
              </ActionBtn>
            )}
          </div>
        </div>
      )}

      {/* Change requests */}
      {appt.appointment_change_requests.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Change Requests
          </h2>
          <div className="space-y-2">
            {appt.appointment_change_requests.map((req) => (
              <div
                key={req.id}
                className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm space-y-1"
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium capitalize text-gray-900">
                    {req.request_type}
                  </span>
                  <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs capitalize text-gray-700">
                    {req.request_status}
                  </span>
                </div>
                {req.customer_reason && (
                  <p className="text-xs text-gray-600">
                    Reason: {req.customer_reason}
                  </p>
                )}
                {req.preferred_day_text && (
                  <p className="text-xs text-gray-600">
                    Preferred day: {req.preferred_day_text}
                  </p>
                )}
                {req.preferred_window_text && (
                  <p className="text-xs text-gray-600">
                    Window: {req.preferred_window_text}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recurring service info */}
      {appt.is_recurring && appt.recurring_services && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Recurring Service
          </h2>
          <InfoRow label="Service" value={appt.recurring_services.service_type} />
          <InfoRow
            label="Frequency"
            value={appt.recurring_services.frequency}
          />
          <InfoRow
            label="Preferred day"
            value={appt.recurring_services.preferred_day}
          />
          {appt.recurring_services.preferred_time && (
            <InfoRow
              label="Preferred time"
              value={fmtTime(appt.recurring_services.preferred_time)}
            />
          )}
          <InfoRow
            label="Status"
            value={appt.recurring_services.status}
          />
          <InfoRow
            label="Start date"
            value={fmtShortDate(appt.recurring_services.start_date)}
          />
          {appt.recurring_services.end_date && (
            <InfoRow
              label="End date"
              value={fmtShortDate(appt.recurring_services.end_date)}
            />
          )}
        </div>
      )}
    </div>
  );
}
