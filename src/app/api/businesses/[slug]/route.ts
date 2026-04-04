import { type NextRequest, NextResponse } from "next/server";
import { db } from "~/server/db";

function ensureArray(val: unknown): string[] {
  if (Array.isArray(val)) return val as string[];
  if (typeof val === "string") {
    try { return JSON.parse(val) as string[]; } catch { return [val]; }
  }
  return [];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;

    const row = await db.businesses.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        business_name: true,
        industry: true,
        preferred_phone_number: true,
        deleted_at: true,
        business_config: {
          select: {
            business_hours: true,
            services_offered: true,
            service_area_type: true,
            service_area_list: true,
            service_area_radius_miles: true,
            service_area_center_address: true,
          },
        },
      },
    });

    if (!row || row.deleted_at !== null) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const cfg = row!.business_config;

    // Parse services — stored as jsonb array of {name, description?} objects
    const servicesOffered = ensureArray(cfg?.services_offered).map((s) =>
      typeof s === "string" ? { name: s } : s,
    );

    // Build service area string
    let serviceArea: string | null = null;
    if (cfg) {
      if (
        cfg.service_area_type === "radius" &&
        cfg.service_area_radius_miles &&
        cfg.service_area_center_address
      ) {
        serviceArea = `${cfg.service_area_radius_miles}-mile radius from ${cfg.service_area_center_address}`;
      } else if (cfg.service_area_list) {
        const list = ensureArray(cfg.service_area_list);
        serviceArea = list.join(", ") || null;
      }
    }

    return NextResponse.json({
      id: row!.id,
      slug: row!.slug,
      name: row!.business_name,
      industry: row!.industry as string,
      phone: row!.preferred_phone_number ?? null,
      hours: (cfg?.business_hours as Record<string, { open: string; close: string; closed: boolean }> | null) ?? null,
      servicesOffered,
      serviceArea,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[api/businesses/slug] error:", message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
