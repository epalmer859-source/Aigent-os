"use client";

import { useEffect, useRef, useState } from "react";

interface LogEvent {
  id: number;
  label: string;
  sublabel: string;
  colorClass: string;
  dotClass: string;
}

const ALL_EVENTS: Omit<LogEvent, "id">[] = [
  {
    label: "Quote approved",
    sublabel: "Sent at 9:41 AM — owner reviewed and approved",
    colorClass: "bg-blue-500/10 border-blue-500/20",
    dotClass: "bg-blue-500",
  },
  {
    label: "Lead responded",
    sublabel: "Inbound text — replied in 4 seconds",
    colorClass: "bg-zinc-800/80 border-zinc-700/50",
    dotClass: "bg-zinc-400",
  },
  {
    label: "Escalation flagged",
    sublabel: "Legal language detected — routed to owner immediately",
    colorClass: "bg-red-500/10 border-red-500/20",
    dotClass: "bg-red-500",
  },
  {
    label: "Appointment booked",
    sublabel: "Tuesday 2 PM confirmed — reminder scheduled",
    colorClass: "bg-green-500/10 border-green-500/20",
    dotClass: "bg-green-500",
  },
  {
    label: "Follow-up sent",
    sublabel: "Quote Day 3 — customer replied within the hour",
    colorClass: "bg-zinc-800/80 border-zinc-700/50",
    dotClass: "bg-zinc-400",
  },
  {
    label: "Human takeover",
    sublabel: "Owner stepped in — 10:03 AM, thread handed off",
    colorClass: "bg-yellow-500/10 border-yellow-500/20",
    dotClass: "bg-yellow-500",
  },
  {
    label: "Complaint isolated",
    sublabel: "Dissatisfaction detected — surfaced to Urgent section",
    colorClass: "bg-red-500/10 border-red-500/20",
    dotClass: "bg-red-500",
  },
  {
    label: "Approval pending",
    sublabel: "Quote for $1,840 waiting on sign-off before send",
    colorClass: "bg-yellow-500/10 border-yellow-500/20",
    dotClass: "bg-yellow-500",
  },
  {
    label: "Missed call recovered",
    sublabel: "Outbound text sent in 6 seconds — customer replied",
    colorClass: "bg-green-500/10 border-green-500/20",
    dotClass: "bg-green-500",
  },
  {
    label: "Booking confirmed",
    sublabel: "Thursday 3 PM — confirmation sent, logged",
    colorClass: "bg-zinc-800/80 border-zinc-700/50",
    dotClass: "bg-zinc-400",
  },
];

let counter = 0;

function makeEvent(template: Omit<LogEvent, "id">): LogEvent {
  return { ...template, id: counter++ };
}

const VISIBLE_COUNT = 5;
const INITIAL_EVENTS = ALL_EVENTS.slice(0, VISIBLE_COUNT).map(makeEvent);

export function LiveEventLog() {
  const [events, setEvents] = useState<LogEvent[]>(INITIAL_EVENTS);
  const [nextIndex, setNextIndex] = useState(VISIBLE_COUNT);
  const ref = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !started.current) {
          started.current = true;

          const interval = setInterval(() => {
            setNextIndex((idx) => {
              const next = idx % ALL_EVENTS.length;
              const template = ALL_EVENTS[next];
              if (!template) return (idx + 1) % ALL_EVENTS.length;

              const newEvent = makeEvent(template);

              setEvents((prev) => [newEvent, ...prev.slice(0, VISIBLE_COUNT - 1)]);

              return (idx + 1) % ALL_EVENTS.length;
            });
          }, 2400);

          return () => clearInterval(interval);
        }
      },
      { threshold: 0.3 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="space-y-2.5">
      {/* Live indicator */}
      <div className="flex items-center gap-2 mb-4">
        <span className="w-2 h-2 rounded-full bg-green-500 animate-dot-pulse" />
        <span className="text-xs text-zinc-500 uppercase tracking-widest">Live system activity</span>
      </div>

      {events.map((event, i) => (
        <div
          key={event.id}
          className={`rounded-xl border px-5 py-3.5 transition-all duration-500 ${event.colorClass} ${
            i === 0 ? "animate-event-slide-in" : ""
          }`}
          style={{ opacity: 1 - i * 0.12 }}
        >
          <div className="flex items-center gap-2.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${event.dotClass}`} />
            <p className="text-sm font-medium text-zinc-100">{event.label}</p>
          </div>
          <p className="text-xs text-zinc-500 mt-1 ml-4">{event.sublabel}</p>
        </div>
      ))}

      <p className="text-xs text-zinc-700 text-center pt-1">
        Every event logged. Every action traceable.
      </p>
    </div>
  );
}
