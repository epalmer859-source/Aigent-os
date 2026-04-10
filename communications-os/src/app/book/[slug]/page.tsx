import { notFound } from "next/navigation";
import { type Metadata } from "next";
import { db } from "~/server/db";
import ChatWidget from "./_components/ChatWidget";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatIndustry(raw: string): string {
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatHours(
  hours: Record<string, { open: string; close: string; closed: boolean }> | null,
): { day: string; label: string }[] {
  if (!hours) return [];
  const order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return order
    .filter((d) => d in hours)
    .map((day) => {
      const h = hours[day]!;
      return { day, label: h.closed ? "Closed" : `${h.open} – ${h.close}` };
    });
}

function ensureArray(val: unknown): unknown[] {
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try { return JSON.parse(val) as unknown[]; } catch { return []; }
  }
  return [];
}

// ── Metadata ──────────────────────────────────────────────────────────────────

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const row = await db.businesses.findUnique({
    where: { slug },
    select: { business_name: true, industry: true },
  });
  if (!row) return { title: "Book a Service" };
  return {
    title: `Book with ${row.business_name}`,
    description: `Chat with ${row.business_name} to book a ${formatIndustry(row.industry as string)} service.`,
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function BookPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const row = await db.businesses.findUnique({
    where: { slug },
    select: {
      id: true,
      business_name: true,
      industry: true,
      preferred_phone_number: true,
      deleted_at: true,
      business_config: {
        select: { business_hours: true, services_offered: true },
      },
    },
  });

  if (!row || row.deleted_at !== null) notFound();

  const services = ensureArray(row.business_config?.services_offered).map((s) =>
    typeof s === "object" && s !== null
      ? (s as { name: string; description?: string })
      : { name: String(s) },
  );

  const hoursRaw = row.business_config?.business_hours;
  const hours = formatHours(
    typeof hoursRaw === "object" && hoursRaw !== null
      ? (hoursRaw as Record<string, { open: string; close: string; closed: boolean }>)
      : null,
  );

  const industryLabel = formatIndustry(row.industry as string);

  return (
    <main
      className="relative overflow-hidden"
      style={{ background: "#08090c", minHeight: "100dvh" }}
    >
      {/* ── Ambient orbs ── */}
      <div
        className="animate-orb pointer-events-none absolute -left-40 -top-40 h-[700px] w-[700px] rounded-full"
        style={{
          background: "radial-gradient(circle at center, rgba(59,130,246,0.18) 0%, rgba(99,102,241,0.1) 40%, transparent 70%)",
          filter: "blur(80px)",
        }}
      />
      <div
        className="animate-orb-2 pointer-events-none absolute -bottom-20 right-0 h-[500px] w-[500px] rounded-full"
        style={{
          background: "radial-gradient(circle at center, rgba(139,92,246,0.12) 0%, transparent 70%)",
          filter: "blur(100px)",
        }}
      />

      {/* ── Subtle grid ── */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "72px 72px",
        }}
      />

      {/* ── Split layout ── */}
      <div className="relative z-10 flex min-h-dvh flex-col lg:flex-row">

        {/* ─── LEFT PANEL — brand + info ─────────────────────── */}
        <aside className="flex flex-col px-8 py-10 lg:w-[42%] lg:min-h-dvh lg:overflow-y-auto lg:px-14 lg:py-14">

          {/* Brand */}
          <div className="mb-10">
            <span
              className="mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]"
              style={{
                background: "rgba(59,130,246,0.08)",
                border: "1px solid rgba(59,130,246,0.18)",
                color: "#60a5fa",
              }}
            >
              <span
                className="animate-dot-pulse h-1.5 w-1.5 rounded-full"
                style={{ background: "#3b82f6" }}
              />
              {industryLabel}
            </span>

            <h1
              className="mt-3 text-4xl font-bold leading-tight tracking-tight lg:text-5xl"
              style={{ color: "#f4f4f5" }}
            >
              {row.business_name}
            </h1>

            {row.preferred_phone_number && (
              <a
                href={`tel:${row.preferred_phone_number}`}
                className="mt-4 inline-flex items-center gap-2 text-sm transition-opacity hover:opacity-100"
                style={{ color: "#a1a1aa", opacity: 0.85 }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.79a19.79 19.79 0 01-3.07-8.63A2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
                </svg>
                {row.preferred_phone_number}
              </a>
            )}

            {/* Divider */}
            <div
              className="mt-8 h-px"
              style={{ background: "linear-gradient(90deg, rgba(255,255,255,0.08) 0%, transparent 100%)" }}
            />
          </div>

          {/* Services */}
          {services.length > 0 && (
            <div className="mb-8">
              <p
                className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em]"
                style={{ color: "#71717a" }}
              >
                What we offer
              </p>
              <ul className="space-y-2">
                {services.map((s, i) => (
                  <li key={i} className="group flex items-start gap-3">
                    <div
                      className="mt-[3px] flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                      style={{
                        background: "rgba(59,130,246,0.1)",
                        border: "1px solid rgba(59,130,246,0.2)",
                      }}
                    >
                      <svg width="8" height="8" viewBox="0 0 12 12" fill="none">
                        <path d="M2 6l3 3 5-5" stroke="#60a5fa" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium leading-snug" style={{ color: "#e4e4e7" }}>
                        {s.name}
                      </p>
                      {s.description && (
                        <p className="mt-0.5 text-xs leading-relaxed" style={{ color: "#71717a" }}>
                          {s.description}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Hours */}
          {hours.length > 0 && (
            <div className="mb-8">
              <p
                className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em]"
                style={{ color: "#71717a" }}
              >
                Business hours
              </p>
              <div
                className="overflow-hidden rounded-xl"
                style={{ border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.02)" }}
              >
                {hours.map(({ day, label }, i) => (
                  <div
                    key={day}
                    className="flex items-center justify-between px-4 py-2.5"
                    style={{
                      borderBottom: i < hours.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                    }}
                  >
                    <span className="text-xs font-medium" style={{ color: "#a1a1aa" }}>
                      {day.slice(0, 3)}
                    </span>
                    <span
                      className="text-xs tabular-nums"
                      style={{ color: label === "Closed" ? "#52525b" : "#d4d4d8" }}
                    >
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Footer */}
          <div className="mt-8 flex items-center gap-2">
            <div
              className="flex h-5 w-5 items-center justify-center rounded-md"
              style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)" }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="white">
                <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
              </svg>
            </div>
            <p className="text-[11px]" style={{ color: "#3f3f46" }}>
              Powered by AIgent OS
            </p>
          </div>
        </aside>

        {/* ── Vertical divider (desktop only) ── */}
        <div
          className="hidden lg:block w-px shrink-0"
          style={{
            background: "linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.07) 20%, rgba(255,255,255,0.07) 80%, transparent 100%)",
          }}
        />

        {/* ─── RIGHT PANEL — chat ─────────────────────────────── */}
        <section
          className="relative flex flex-col lg:flex-1 lg:min-h-dvh"
          style={{ background: "rgba(10,11,16,0.6)" }}
        >
          <ChatWidget businessId={row.id} businessName={row.business_name} />
        </section>

      </div>
    </main>
  );
}
