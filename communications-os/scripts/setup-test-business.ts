import { PrismaClient } from "../generated/prisma/index.js";

const prisma = new PrismaClient();

async function main() {
  // Check current state
  const testUser = await prisma.users.findUnique({
    where: { email: "test@example.com" },
  });
  if (!testUser) {
    console.error("❌ Test user not found");
    process.exit(1);
  }

  console.log(`Test user id: ${testUser.id}`);
  console.log(`Current business_id: ${testUser.business_id}`);

  if (testUser.business_id) {
    console.log("✅ Already has business_id — no action needed");
    return;
  }

  // Create a test business owned by the test user
  const biz = await prisma.businesses.create({
    data: {
      owner_user_id: testUser.id,
      business_name: "Test Plumbing Co",
      industry: "plumbing",
      timezone: "America/New_York",
      join_code: "TESTJOIN1",
    },
  });
  console.log(`✅ Created business: ${biz.id}`);

  // Associate test user with business
  await prisma.users.update({
    where: { email: "test@example.com" },
    data: { business_id: biz.id },
  });
  console.log(`✅ Set test user business_id = ${biz.id}`);
}

main()
  .catch((e) => {
    console.error("❌ FAILED:", e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
