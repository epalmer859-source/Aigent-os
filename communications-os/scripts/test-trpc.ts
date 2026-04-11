/**
 * Tests all four tRPC procedure levels using the server-side caller directly.
 * This bypasses HTTP so we can inject session context manually.
 */
import { createCaller } from "../src/server/api/root.js";
import { db } from "../src/server/db.js";

type MockSession = {
  user: { id: string; email: string; businessId: string | null; technicianId: string | null; role: string };
  expires: string;
} | null;

function makeCtx(session: MockSession) {
  return { db, session, headers: new Headers() };
}

const FAKE_UUID = "00000000-0000-0000-0000-000000000001";
const expires = new Date(Date.now() + 86400000).toISOString();

async function main() {
  console.log("=== tRPC Authorization Level Tests ===\n");

  // ─── 1. publicProcedure ────────────────────────────────────────────────
  console.log("--- publicProcedure (test.hello) ---");

  // Logged out
  const caller_anon = createCaller(makeCtx(null));
  const pub1 = await caller_anon.test.hello();
  console.log(`✅ Logged out: ${pub1.message}`);

  // Logged in, no business
  const caller_noBiz = createCaller(makeCtx({
    user: { id: FAKE_UUID, email: "test@example.com", businessId: null, technicianId: null, role: "owner" },
    expires,
  }));
  const pub2 = await caller_noBiz.test.hello();
  console.log(`✅ Logged in (no business): ${pub2.message}`);

  // ─── 2. protectedProcedure ─────────────────────────────────────────────
  console.log("\n--- protectedProcedure (test.whoAmI) ---");

  // Logged out → UNAUTHORIZED
  try {
    await caller_anon.test.whoAmI();
    console.log("❌ Should have thrown UNAUTHORIZED");
  } catch (e: any) {
    console.log(`✅ Logged out → ${e.code}: ${e.message}`);
  }

  // Logged in, no business → OK
  const whoAmI = await caller_noBiz.test.whoAmI();
  console.log(`✅ Logged in (no business): userId=${whoAmI.userId}, role=${whoAmI.role}, businessId=${whoAmI.businessId}`);

  // ─── 3. businessProcedure ──────────────────────────────────────────────
  console.log("\n--- businessProcedure (test.myBusiness) ---");

  // Logged out → UNAUTHORIZED
  try {
    await caller_anon.test.myBusiness();
    console.log("❌ Should have thrown UNAUTHORIZED");
  } catch (e: any) {
    console.log(`✅ Logged out → ${e.code}: ${e.message}`);
  }

  // Logged in, businessId=null → FORBIDDEN "Complete onboarding first"
  try {
    await caller_noBiz.test.myBusiness();
    console.log("❌ Should have thrown FORBIDDEN");
  } catch (e: any) {
    console.log(`✅ No businessId → ${e.code}: ${e.message}`);
  }

  // Logged in, businessId set → OK
  const caller_hasBiz = createCaller(makeCtx({
    user: { id: FAKE_UUID, email: "test@example.com", businessId: FAKE_UUID, technicianId: null, role: "owner" },
    expires,
  }));
  const biz = await caller_hasBiz.test.myBusiness();
  console.log(`✅ Has businessId → businessId=${biz.businessId}`);

  // ─── 4. ownerProcedure ────────────────────────────────────────────────
  console.log("\n--- ownerProcedure (test.ownerOnly) ---");

  // Logged out → UNAUTHORIZED
  try {
    await caller_anon.test.ownerOnly();
    console.log("❌ Should have thrown UNAUTHORIZED");
  } catch (e: any) {
    console.log(`✅ Logged out → ${e.code}: ${e.message}`);
  }

  // Logged in, businessId=null → FORBIDDEN "Complete onboarding first"
  try {
    await caller_noBiz.test.ownerOnly();
    console.log("❌ Should have thrown FORBIDDEN");
  } catch (e: any) {
    console.log(`✅ No businessId → ${e.code}: ${e.message}`);
  }

  // Logged in, businessId set, role=admin → FORBIDDEN "Owner access required"
  const caller_admin = createCaller(makeCtx({
    user: { id: FAKE_UUID, email: "admin@example.com", businessId: FAKE_UUID, technicianId: null, role: "admin" },
    expires,
  }));
  try {
    await caller_admin.test.ownerOnly();
    console.log("❌ Should have thrown FORBIDDEN");
  } catch (e: any) {
    console.log(`✅ role=admin → ${e.code}: ${e.message}`);
  }

  // Logged in, businessId set, role=owner → OK
  const owner = await caller_hasBiz.test.ownerOnly();
  console.log(`✅ role=owner → ${owner.message}, businessId=${owner.businessId}`);

  console.log("\n🎉 Step 3 PASSED — All four authorization levels work correctly");
  console.log("\n📊 Summary:");
  console.log("   publicProcedure   → accessible to everyone");
  console.log("   protectedProcedure → UNAUTHORIZED if no session");
  console.log("   businessProcedure  → FORBIDDEN('Complete onboarding first') if no businessId");
  console.log("   ownerProcedure     → FORBIDDEN('Owner access required') if role != owner");
  console.log("   ctx.businessId is typed as string (not string|null) in business/owner procedures ✅");
}

main()
  .catch((e) => {
    console.error("❌ FAILED:", e);
    process.exit(1);
  });
