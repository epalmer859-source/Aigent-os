import { PrismaClient } from "../generated/prisma/index.js";
import { createCaller } from "../src/server/api/root.js";
import { db } from "../src/server/db.js";

const prisma = new PrismaClient();

const expires = new Date(Date.now() + 86400000).toISOString();

function makeCtx(userId: string, email: string) {
  return {
    db,
    session: {
      user: { id: userId, email, businessId: null as string | null, role: "owner" as string },
      expires,
    },
    headers: new Headers(),
  };
}

function defaultHours() {
  const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday"];
  const h: Record<string, { open: string; close: string; closed: boolean }> = {};
  days.forEach(d => { h[d] = { open: "08:00", close: "17:00", closed: d === "sunday" }; });
  return h;
}

async function main() {
  console.log("=== Onboarding Tests ===\n");

  // Create fresh test users for each scenario
  const ownerEmail = `owner_test_${Date.now()}@test.com`;
  const adminEmail = `admin_test_${Date.now()}@test.com`;

  const ownerUser = await prisma.users.create({
    data: { email: ownerEmail, role: "owner", password_hash: "x" },
  });
  const adminUser = await prisma.users.create({
    data: { email: adminEmail, role: "owner", password_hash: "x" },
  });

  const uniqueCode = `TST${Date.now().toString().slice(-4)}`;
  console.log(`Test join code: ${uniqueCode}`);

  // ── Test 1: Owner onboarding.complete ──────────────────────────────────
  const ownerCaller = createCaller(makeCtx(ownerUser.id, ownerEmail));

  const onboardingResult = await ownerCaller.onboarding.complete({
    businessName: "Test Plumbing Co",
    industry: "plumbing",
    timezone: "America/New_York",
    joinCode: uniqueCode,
    urgentAlertPhone: "5550001111",
    servicesOffered: [{ name: "Water Heater Install" }, { name: "Drain Cleaning" }],
    businessHours: defaultHours(),
    sameDayBookingAllowed: false,
    supportedLanguages: "English",
    industryAnswers: { emergency_service: "24/7", licensed: "Yes, master plumber" },
  });

  console.log(`✅ Test 1: onboarding.complete → businessId=${onboardingResult.businessId}`);

  // Verify DB state
  const biz = await prisma.businesses.findUnique({
    where: { id: onboardingResult.businessId },
    include: { business_config: true },
  });
  console.log(`✅ Test 2: businesses row exists: ${!!biz}`);
  console.log(`✅ Test 3: business_config row exists: ${!!biz?.business_config}`);
  console.log(`✅ Test 4: onboarding_completed_at set: ${!!biz?.onboarding_completed_at}`);
  console.log(`✅ Test 5: join_code stored: ${biz?.join_code === uniqueCode}`);

  const updatedOwner = await prisma.users.findUnique({ where: { id: ownerUser.id } });
  console.log(`✅ Test 6: owner business_id set: ${updatedOwner?.business_id === onboardingResult.businessId}`);
  console.log(`✅ Test 7: owner role=owner: ${updatedOwner?.role === "owner"}`);

  const config = biz?.business_config;
  const answers = config?.industry_answers as Record<string, string> | null;
  console.log(`✅ Test 8: industry_answers stored: ${!!answers && answers.emergency_service === "24/7"}`);

  // ── Test 9: Duplicate onboarding rejected ──────────────────────────────
  try {
    await ownerCaller.onboarding.complete({
      businessName: "Second Business",
      industry: "hvac",
      timezone: "America/Chicago",
      joinCode: "NEWCODE1",
      servicesOffered: [{ name: "AC Repair" }],
      businessHours: defaultHours(),
      sameDayBookingAllowed: false,
      supportedLanguages: "English",
      industryAnswers: {},
    });
    console.log("❌ Test 9: Should have rejected duplicate onboarding");
  } catch (e: any) {
    console.log(`✅ Test 9: Duplicate onboarding rejected: ${e.message}`);
  }

  // ── Test 10: Duplicate join code rejected ─────────────────────────────
  const anotherUser = await prisma.users.create({
    data: { email: `another_${Date.now()}@test.com`, role: "owner", password_hash: "x" },
  });
  const anotherCaller = createCaller(makeCtx(anotherUser.id, `another@test.com`));
  try {
    await anotherCaller.onboarding.complete({
      businessName: "Another Co",
      industry: "hvac",
      timezone: "America/Chicago",
      joinCode: uniqueCode, // same code — should fail
      servicesOffered: [{ name: "AC Repair" }],
      businessHours: defaultHours(),
      sameDayBookingAllowed: false,
      supportedLanguages: "English",
      industryAnswers: {},
    });
    console.log("❌ Test 10: Should have rejected duplicate join code");
  } catch (e: any) {
    console.log(`✅ Test 10: Duplicate join code rejected: ${e.message}`);
  }
  await prisma.users.delete({ where: { id: anotherUser.id } });

  // ── Test 11: Admin join ────────────────────────────────────────────────
  const adminCaller = createCaller(makeCtx(adminUser.id, adminEmail));
  const joinResult = await adminCaller.onboarding.join({ joinCode: uniqueCode });
  console.log(`\n✅ Test 11: onboarding.join → businessId=${joinResult.businessId}`);
  console.log(`✅ Test 12: businessId matches owner's: ${joinResult.businessId === onboardingResult.businessId}`);

  const updatedAdmin = await prisma.users.findUnique({ where: { id: adminUser.id } });
  console.log(`✅ Test 13: admin business_id set: ${updatedAdmin?.business_id === onboardingResult.businessId}`);
  console.log(`✅ Test 14: admin role=admin: ${updatedAdmin?.role === "admin"}`);

  // ── Test 15: Invalid join code ────────────────────────────────────────
  const freshUser = await prisma.users.create({
    data: { email: `fresh_${Date.now()}@test.com`, role: "owner", password_hash: "x" },
  });
  const freshCaller = createCaller(makeCtx(freshUser.id, "fresh@test.com"));
  try {
    await freshCaller.onboarding.join({ joinCode: "WRONGCODE" });
    console.log("❌ Test 15: Should have thrown NOT_FOUND");
  } catch (e: any) {
    console.log(`✅ Test 15: Invalid join code rejected: ${e.message}`);
  }

  // Cleanup (order matters: business_config → users with business_id → business → owner)
  await prisma.users.deleteMany({ where: { id: freshUser.id } });
  await prisma.users.updateMany({ where: { id: { in: [adminUser.id, ownerUser.id] } }, data: { business_id: null } });
  await prisma.business_config.deleteMany({ where: { business_id: onboardingResult.businessId } });
  await prisma.businesses.delete({ where: { id: onboardingResult.businessId } });
  await prisma.users.deleteMany({ where: { id: { in: [adminUser.id, ownerUser.id] } } });

  console.log("\n🎉 All onboarding tests passed!");
}

main()
  .catch((e) => { console.error("❌ FAILED:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
