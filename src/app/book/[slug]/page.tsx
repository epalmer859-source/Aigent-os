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
      className="relative min-h-screen overflow-hidden"
      style={{ background: "#08090c" }}
    >
      {/* ── Ambient orbs ── */}
      <div
        className="animate-orb pointer-events-none absolute -top-40 -left-40 h-[600px] w-[600px] rounded-full opacity-20"
        style={{
          background:
            "radial-gradient(circle at center, #3b82f6 0%, #6366f1 40%, transparent 70%)",
          filter: "blur(80px)",
        }}
      />
      <div
        className="animate-orb-2 pointer-events-none absolute bottom-0 right-0 h-[500px] w-[500px] rounded-full opacity-10"
        style={{
          background:
            "radial-gradient(circle at center, #8b5cf6 0%, #3b82f6 40%, transparent 70%)",
          filter: "blur(100px)",
        }}
      />

      {/* ── Noise texture overlay ── */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.025]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* ── Grid lines ── */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
        }}
      />

      <div className="relative z-10 mx-auto max-w-5xl px-4 pb-20 pt-10">

        {/* ── Header ── */}
        <header className="mb-10 animate-fade-in-up">
          <div className="flex items-center gap-2 mb-3">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium tracking-widest uppercase"
              style={{
                background: "rgba(59,130,246,0.1)",
                border: "1px solid rgba(59,130,246,0.2)",
                color: "#60a5fa",
              }}
            >
              <span
                className="animate-dot-pulse h-1.5 w-1.5 rounded-full"
                style={{ background: "#3b82f6" }}
              />
              {industryLabel}
            </span>
          </div>

          <h1
            className="text-4xl font-bold tracking-tight sm:text-5xl"
            style={{ color: "#f4f4f5" }}
          >
            {row.business_name}
          </h1>

          {row.preferred_phone_number && (
            <a
              href={`tel:${row.preferred_phone_number}`}
              className="mt-3 inline-flex items-center gap-2 text-sm transition-colors"
              style={{ color: "#a1a1aa" }}
            >
              <svg
                width="14" height="14" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.79a19.79 19.79 0 01-3.07-8.63A2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
              </svg>
              {row.preferred_phone_number}
            </a>
          )}

          {/* Divider */}
          <div
            className="mt-8 h-px w-full"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,0.08) 30%, rgba(255,255,255,0.08) 70%, transparent)",
            }}
          />
        </header>

        {/* ── Main grid ── */}
        <div className="grid gap-8 lg:grid-cols-[1fr_400px]">

          {/* ── Left — info panels ── */}
          <div className="space-y-6">

            {/* Services */}
            {services.length > 0 && (
              <section className="animate-fade-in-up" style={{ animationDelay: "0.1s" }}>
                <p
                  className="mb-4 text-xs font-semibold uppercase tracking-[0.2em]"
                  style={{ color: "#a1a1aa" }}
                >
                  Services
                </p>
                <ul className="grid gap-2.5 sm:grid-cols-2">
                  {services.map((s, i) => (
                    <li
                      key={i}
                      className="glass card-hover group relative overflow-hidden rounded-2xl p-4"
                    >
                      {/* Subtle left accent */}
                      <div
                        className="absolute left-0 top-0 h-full w-[2px] rounded-l-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                        style={{
                          background: "linear-gradient(180deg, #3b82f6, #6366f1)",
                        }}
                      />
                      <p className="text-sm font-medium" style={{ color: "#e4e4e7" }}>
                        {s.name}
                      </p>
                      {s.description && (
                        <p className="mt-1 text-xs leading-relaxed" style={{ color: "#a1a1aa" }}>
                          {s.description}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Hours */}
            {hours.length > 0 && (
              <section className="animate-fade-in-up" style={{ animationDelay: "0.2s" }}>
                <p
                  className="mb-4 text-xs font-semibold uppercase tracking-[0.2em]"
                  style={{ color: "#a1a1aa" }}
                >
                  Hours
                </p>
                <div className="glass rounded-2xl overflow-hidden">
                  {hours.map(({ day, label }, i) => (
                    <div
                      key={day}
                      className="flex items-center justify-between px-5 py-3 transition-colors hover:bg-white/[0.02]"
                      style={{
                        borderBottom: i < hours.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none",
                      }}
                    >
                      <span className="text-sm font-medium" style={{ color: "#a1a1aa" }}>
                        {day}
                      </span>
                      <span
                        className="text-sm font-medium tabular-nums"
                        style={{ color: label === "Closed" ? "#71717a" : "#e4e4e7" }}
                      >
                        {label}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Trust badge */}
            <div
              className="animate-fade-in-up flex items-center gap-3 rounded-2xl px-5 py-4"
              style={{
                animationDelay: "0.3s",
                background: "rgba(59,130,246,0.04)",
                border: "1px solid rgba(59,130,246,0.1)",
              }}
            >
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                style={{ background: "rgba(59,130,246,0.15)" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: "#a1a1aa" }}>
                Your information is private and secure. We never share your data with third parties.
              </p>
            </div>
          </div>

          {/* ── Right — chat widget ── */}
          <div className="animate-fade-in-up lg:sticky lg:top-8 lg:self-start" style={{ animationDelay: "0.15s" }}>
            <p
              className="mb-4 text-xs font-semibold uppercase tracking-[0.2em]"
              style={{ color: "#a1a1aa" }}
            >
              Chat with us
            </p>
            <ChatWidget businessId={row.id} businessName={row.business_name} />
          </div>
        </div>
      </div>
    </main>
  );
}
