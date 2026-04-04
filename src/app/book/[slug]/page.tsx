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
      return {
        day,
        label: h.closed ? "Closed" : `${h.open} – ${h.close}`,
      };
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
        select: {
          business_hours: true,
          services_offered: true,
        },
      },
    },
  });

  if (!row || row.deleted_at !== null) notFound();

  const business = row!;

  // Services — [{name, description?}]
  const services = ensureArray(business.business_config?.services_offered).map((s) =>
    typeof s === "object" && s !== null
      ? (s as { name: string; description?: string })
      : { name: String(s) },
  );

  // Hours
  const hoursRaw = business.business_config?.business_hours;
  const hours = formatHours(
    typeof hoursRaw === "object" && hoursRaw !== null
      ? (hoursRaw as Record<string, { open: string; close: string; closed: boolean }>)
      : null,
  );

  return (
    <main className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <div className="bg-gray-900 text-white">
        <div className="mx-auto max-w-4xl px-4 py-5">
          <p className="text-xs font-medium uppercase tracking-widest text-gray-400">
            {formatIndustry(business.industry as string)}
          </p>
          <h1 className="mt-1 text-2xl font-bold">{business.business_name}</h1>
          {business.preferred_phone_number && (
            <a
              href={`tel:${business.preferred_phone_number}`}
              className="mt-1 inline-block text-sm text-gray-300 hover:text-white"
            >
              {business.preferred_phone_number}
            </a>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-4xl px-4 py-8 grid gap-8 lg:grid-cols-[1fr_380px]">

        {/* Left — business info */}
        <div className="space-y-6">

          {/* Services */}
          {services.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">
                Services
              </h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {services.map((s, i) => (
                  <li key={i} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                    <p className="text-sm font-medium text-gray-900">{s.name}</p>
                    {s.description && (
                      <p className="mt-0.5 text-xs text-gray-500">{s.description}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Hours */}
          {hours.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">
                Hours
              </h2>
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                {hours.map(({ day, label }, i) => (
                  <div
                    key={day}
                    className={`flex justify-between px-4 py-2.5 text-sm ${
                      i < hours.length - 1 ? "border-b border-gray-100" : ""
                    }`}
                  >
                    <span className="font-medium text-gray-700">{day}</span>
                    <span className={label === "Closed" ? "text-gray-400" : "text-gray-900"}>
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right — chat widget */}
        <div className="lg:sticky lg:top-8 lg:self-start">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">
            Get a Quote or Book
          </h2>
          <ChatWidget businessId={business.id} />
        </div>
      </div>
    </main>
  );
}
