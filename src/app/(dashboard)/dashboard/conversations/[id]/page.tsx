"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "~/trpc/react";

// ── Helpers ────────────────────────────────────────────────────────────────
function formatTime(date: Date | string) {
  return new Date(date).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDate(date: Date | string) {
  return new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const STATE_COLORS: Record<string, string> = {
  new_lead: "bg-blue-100 text-blue-800",
  booking_in_progress: "bg-indigo-100 text-indigo-800",
  quote_sent: "bg-yellow-100 text-yellow-800",
  job_in_progress: "bg-orange-100 text-orange-800",
  human_takeover_active: "bg-purple-100 text-purple-800",
  resolved: "bg-green-100 text-green-800",
  closed_completed: "bg-gray-100 text-gray-700",
};

// ── Bubble styles by sender_type ───────────────────────────────────────────
type BubbleStyle = {
  wrapper: string;
  bubble: string;
  meta: string;
};

function getBubbleStyle(
  direction: string,
  senderType: string,
): BubbleStyle {
  if (direction === "inbound") {
    return {
      wrapper: "justify-start",
      bubble: "bg-gray-100 text-gray-900 rounded-br-xl rounded-tr-xl rounded-tl-xl",
      meta: "text-left",
    };
  }
  if (senderType === "ai") {
    return {
      wrapper: "justify-end",
      bubble: "bg-blue-600 text-white rounded-bl-xl rounded-tl-xl rounded-tr-xl",
      meta: "text-right",
    };
  }
  if (senderType === "system" || senderType === "automation") {
    return {
      wrapper: "justify-center",
      bubble: "bg-gray-200 text-gray-500 text-xs rounded-xl",
      meta: "text-center",
    };
  }
  // owner / admin_team
  return {
    wrapper: "justify-end",
    bubble: "bg-green-600 text-white rounded-bl-xl rounded-tl-xl rounded-tr-xl",
    meta: "text-right",
  };
}

function senderLabel(senderType: string): string {
  switch (senderType) {
    case "ai": return "AI";
    case "owner": return "Owner";
    case "admin_team": return "Admin";
    case "customer": return "Customer";
    case "system": return "System";
    case "automation": return "Automation";
    default: return senderType;
  }
}

// ── Skeleton ───────────────────────────────────────────────────────────────
function DetailSkeleton() {
  return (
    <div className="flex h-[calc(100vh-8rem)] animate-pulse flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4">
      <div className="h-6 w-1/3 rounded bg-gray-200" />
      <div className="flex-1 space-y-3 py-4">
        <div className="h-10 w-1/2 rounded-xl bg-gray-100" />
        <div className="ml-auto h-10 w-1/2 rounded-xl bg-blue-100" />
        <div className="h-10 w-2/3 rounded-xl bg-gray-100" />
      </div>
      <div className="h-12 w-full rounded-xl bg-gray-100" />
    </div>
  );
}

// ── Place Appointment Modal ────────────────────────────────────────────────
function PlaceAppointmentModal({
  conversationId,
  defaultAddress,
  onClose,
  onSuccess,
}: {
  conversationId: string;
  defaultAddress: string | null | undefined;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("09:00");
  const [serviceType, setServiceType] = useState("");
  const [duration, setDuration] = useState("");
  const [address, setAddress] = useState(defaultAddress ?? "");
  const [tech, setTech] = useState("");
  const [accessNotes, setAccessNotes] = useState("");
  const [adminNotes, setAdminNotes] = useState("");

  const createMutation = api.appointments.create.useMutation({
    onSuccess: () => { onSuccess(); onClose(); },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate({
      conversationId,
      appointmentDate: date,
      appointmentTime: time,
      serviceType: serviceType || undefined,
      durationMinutes: duration ? parseInt(duration) : undefined,
      address: address || undefined,
      technicianName: tech || undefined,
      accessNotes: accessNotes || undefined,
      adminNotes: adminNotes || undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">Place Appointment</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Date *</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Time *</label>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Service Type</label>
            <input type="text" value={serviceType} onChange={(e) => setServiceType(e.target.value)} placeholder="e.g. Gutter Cleaning"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Duration (min)</label>
              <input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="60"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Technician</label>
              <input type="text" value={tech} onChange={(e) => setTech(e.target.value)} placeholder="Name"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Address</label>
            <input type="text" value={address} onChange={(e) => setAddress(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Access Notes</label>
            <input type="text" value={accessNotes} onChange={(e) => setAccessNotes(e.target.value)} placeholder="Gate code, parking…"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">Admin Notes</label>
            <input type="text" value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400" />
          </div>
          {createMutation.isError && (
            <p className="text-xs text-red-500">{createMutation.error.message}</p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={createMutation.isPending}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">
              {createMutation.isPending ? "Booking…" : "Book Appointment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Timer helpers ──────────────────────────────────────────────────────────
const TIMER_OPTIONS = [
  { label: "1 hour", seconds: 3600 },
  { label: "4 hours", seconds: 14400 },
  { label: "1 day", seconds: 86400 },
  { label: "3 days", seconds: 259200 },
  { label: "7 days", seconds: 604800 },
  { label: "Never", seconds: 0 },
];

function takeoverCountdown(expiresAt: Date | string | null | undefined): string {
  if (!expiresAt) return "Timer disabled";
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const hrs = Math.floor(diff / 3_600_000);
  if (hrs < 1) return "< 1 hour";
  if (hrs < 24) return `${hrs}h remaining`;
  return `${Math.floor(hrs / 24)}d remaining`;
}

// ── Main page ──────────────────────────────────────────────────────────────
export default function ConversationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: conv, isLoading, refetch } = api.conversations.detail.useQuery(
    { conversationId: id },
    { refetchInterval: 5_000 },
  );

  const sendMutation = api.conversations.sendMessage.useMutation({
    onSuccess: async () => {
      setMessage("");
      await refetch();
      setTimeout(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 100);
    },
  });

  const [showApptModal, setShowApptModal] = useState(false);

  const enableTakeoverMutation = api.conversations.enableTakeover.useMutation({
    onSuccess: () => void refetch(),
  });
  const disableTakeoverMutation = api.conversations.disableTakeover.useMutation({
    onSuccess: () => void refetch(),
  });
  const timerMutation = api.conversations.updateTakeoverTimer.useMutation({
    onSuccess: () => void refetch(),
  });

  // Scroll to bottom when messages load / change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conv?.message_log_message_log_conversation_idToconversations?.length]);

  if (isLoading) return <DetailSkeleton />;
  if (!conv) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-400">
        Conversation not found.
      </div>
    );
  }

  const messages = conv.message_log_message_log_conversation_idToconversations;
  const customer = conv.customers;
  const stateColor =
    STATE_COLORS[conv.primary_state] ?? "bg-gray-100 text-gray-700";

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() || sendMutation.isPending) return;
    sendMutation.mutate({ conversationId: id, content: message.trim() });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend(e as unknown as React.FormEvent);
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* ── Left: thread ─────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-gray-200 bg-white">
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-gray-100 p-4">
          <button
            onClick={() => router.push("/dashboard/conversations")}
            className="shrink-0 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            ← Back
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-gray-900">
              {conv.contact_display_name ?? conv.contact_handle}
            </p>
            <p className="text-xs text-gray-500">{conv.contact_handle} · {conv.channel}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${stateColor}`}>
              {conv.primary_state.replace(/_/g, " ")}
            </span>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 capitalize">
              {conv.current_owner}
            </span>
          </div>
        </div>

        {/* Message thread */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {messages.length === 0 && (
            <p className="py-8 text-center text-sm text-gray-400">
              No messages yet
            </p>
          )}
          {messages.map((msg) => {
            const style = getBubbleStyle(msg.direction, msg.sender_type);
            const isCenter =
              msg.sender_type === "system" || msg.sender_type === "automation";

            if (isCenter) {
              return (
                <div key={msg.id} className="my-3 flex justify-center">
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">
                    {msg.content ?? ""}
                  </span>
                </div>
              );
            }

            return (
              <div key={msg.id} className={`my-2 flex ${style.wrapper}`}>
                <div className="max-w-[70%]">
                  <div className={`px-3 py-2 text-sm ${style.bubble}`}>
                    {msg.content ?? ""}
                  </div>
                  <p className={`mt-0.5 text-xs text-gray-400 ${style.meta}`}>
                    {senderLabel(msg.sender_type)} · {formatTime(msg.created_at)}
                  </p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <form onSubmit={handleSend} className="border-t border-gray-100 p-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={textareaRef}
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
              className="flex-1 resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            />
            <button
              type="submit"
              disabled={!message.trim() || sendMutation.isPending}
              className="shrink-0 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
            >
              {sendMutation.isPending ? "Sending…" : "Send"}
            </button>
          </div>
          {sendMutation.isError && (
            <p className="mt-1 text-xs text-red-500">
              {sendMutation.error.message}
            </p>
          )}
        </form>
      </div>

      {/* ── Right: sidebar ────────────────────────────────────────────────── */}
      <div className="hidden w-64 shrink-0 space-y-4 overflow-y-auto lg:block">
        {/* Place Appointment */}
        <button
          onClick={() => setShowApptModal(true)}
          className="w-full rounded-xl border border-blue-200 bg-blue-50 py-2.5 text-sm font-medium text-blue-700 transition hover:bg-blue-100"
        >
          + Place Appointment
        </button>

        {/* Customer */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Customer
          </h3>
          <p className="text-sm font-medium text-gray-900">
            {customer?.display_name ?? conv.contact_display_name ?? conv.contact_handle}
          </p>
          <p className="text-xs text-gray-500">{conv.contact_handle}</p>
          <p className="text-xs capitalize text-gray-500">{conv.channel}</p>
          {customer?.do_not_contact && (
            <p className="mt-1 rounded bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
              Do Not Contact
            </p>
          )}
        </div>

        {/* Appointments */}
        {conv.appointments.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Appointments
            </h3>
            <div className="space-y-2">
              {conv.appointments.map((appt) => (
                <div key={appt.id} className="rounded-lg bg-blue-50 px-3 py-2">
                  <p className="text-xs font-medium text-blue-900">
                    {formatDate(appt.appointment_date)}
                  </p>
                  <p className="text-xs text-blue-700 capitalize">{appt.status}</p>
                  {appt.technician_name && (
                    <p className="text-xs text-blue-600">{appt.technician_name}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quotes */}
        {conv.quotes.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Quotes
            </h3>
            <div className="space-y-2">
              {conv.quotes.map((q) => (
                <div key={q.id} className="rounded-lg bg-yellow-50 px-3 py-2">
                  <p className="text-xs font-medium capitalize text-yellow-900">
                    {q.status.replace(/_/g, " ")}
                  </p>
                  {q.approved_amount != null && (
                    <p className="text-xs text-yellow-700">
                      ${Number(q.approved_amount).toFixed(2)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Escalations */}
        {conv.escalations.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Escalations
            </h3>
            <div className="space-y-2">
              {conv.escalations.map((esc) => (
                <div key={esc.id} className="rounded-lg bg-red-50 px-3 py-2">
                  <p className="text-xs font-medium capitalize text-red-900">
                    {esc.category.replace(/_/g, " ")}
                  </p>
                  <p className="text-xs text-red-700 capitalize">{esc.status}</p>
                  {esc.urgency && (
                    <p className="text-xs text-red-600 capitalize">{esc.urgency}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Human takeover */}
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Human Takeover
          </h3>
          {conv.current_owner !== "human_takeover" ? (
            <button
              onClick={() =>
                enableTakeoverMutation.mutate({ conversationId: id })
              }
              disabled={enableTakeoverMutation.isPending}
              className="w-full rounded-lg bg-purple-600 py-2 text-xs font-medium text-white transition hover:bg-purple-700 disabled:opacity-50"
            >
              {enableTakeoverMutation.isPending ? "Enabling…" : "Take Over"}
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">
                Taken over{" "}
                {conv.human_takeover_enabled_at
                  ? formatTime(conv.human_takeover_enabled_at)
                  : ""}
              </p>
              <p className="text-xs font-medium text-purple-700">
                {takeoverCountdown(conv.human_takeover_expires_at)}
              </p>
              <select
                defaultValue=""
                onChange={(e) => {
                  const sec = parseInt(e.target.value);
                  if (!isNaN(sec)) {
                    timerMutation.mutate({
                      conversationId: id,
                      timerSeconds: sec,
                    });
                  }
                  e.target.value = "";
                }}
                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs outline-none"
              >
                <option value="" disabled>
                  Change timer…
                </option>
                {TIMER_OPTIONS.map((opt) => (
                  <option key={opt.seconds} value={opt.seconds}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() =>
                  disableTakeoverMutation.mutate({ conversationId: id })
                }
                disabled={disableTakeoverMutation.isPending}
                className="w-full rounded-lg bg-gray-600 py-2 text-xs font-medium text-white transition hover:bg-gray-700 disabled:opacity-50"
              >
                {disableTakeoverMutation.isPending ? "Resuming…" : "Resume AI"}
              </button>
            </div>
          )}
          {(enableTakeoverMutation.isError || disableTakeoverMutation.isError) && (
            <p className="mt-1 text-xs text-red-500">
              {enableTakeoverMutation.error?.message ??
                disableTakeoverMutation.error?.message}
            </p>
          )}
        </div>
      </div>

      {/* Place Appointment modal */}
      {showApptModal && (
        <PlaceAppointmentModal
          conversationId={id}
          defaultAddress={conv.collected_service_address}
          onClose={() => setShowApptModal(false)}
          onSuccess={() => void refetch()}
        />
      )}
    </div>
  );
}
