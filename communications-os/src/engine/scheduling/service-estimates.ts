// ============================================================
// src/engine/scheduling/service-estimates.ts
//
// QUERY HELPERS — Service estimate lookups for the scheduling
// engine and AI booking pipeline.
//
// These are standalone utilities that query the service_estimates
// table. They do NOT modify existing engine modules.
// ============================================================

import type { PrismaClient } from "../../../generated/prisma";

/**
 * Look up the estimated duration for a named service.
 * Uses case-insensitive matching against active service estimates.
 * Returns null if no match — caller should fall back to diagnostic time.
 */
export async function getServiceEstimate(
  db: PrismaClient,
  businessId: string,
  serviceName: string,
): Promise<number | null> {
  // Try exact case-insensitive match first
  const rows = await db.service_estimates.findMany({
    where: {
      business_id: businessId,
      is_active: true,
    },
    select: { name: true, estimated_minutes: true },
  });

  const lower = serviceName.toLowerCase().trim();

  // Exact match
  const exact = rows.find((r) => r.name.toLowerCase() === lower);
  if (exact) return exact.estimated_minutes;

  // Fuzzy: check if the service name contains or is contained by any estimate name
  const fuzzy = rows.find(
    (r) =>
      r.name.toLowerCase().includes(lower) ||
      lower.includes(r.name.toLowerCase()),
  );
  if (fuzzy) return fuzzy.estimated_minutes;

  return null;
}

/**
 * Get the diagnostic visit duration for a business.
 * Defaults to 30 minutes if not configured.
 */
export async function getDiagnosticTime(
  db: PrismaClient,
  businessId: string,
): Promise<number> {
  const diag = await db.service_estimates.findFirst({
    where: {
      business_id: businessId,
      is_active: true,
      name: { contains: "Diagnostic", mode: "insensitive" },
    },
    select: { estimated_minutes: true },
  });

  return diag?.estimated_minutes ?? 30;
}

/**
 * Get the maximum minutes a tech should spend on a single visit
 * before scheduling a return. Stored on the businesses table.
 * Defaults to 150 (2.5 hours).
 */
export async function getOnSiteCapMinutes(
  db: PrismaClient,
  businessId: string,
): Promise<number> {
  const biz = await db.businesses.findUnique({
    where: { id: businessId },
    select: { onsite_cap_minutes: true },
  });

  return biz?.onsite_cap_minutes ?? 150;
}
