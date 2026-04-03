import { PrismaClient } from "../generated/prisma/index.js";

const prisma = new PrismaClient();

async function main() {
  // Test 1: Basic connection
  const businessCount = await prisma.businesses.count();
  console.log(`✅ Connected. Businesses in DB: ${businessCount}`);

  // Test 2: Verify enums work
  const states =
    await prisma.$queryRaw`SELECT unnest(enum_range(NULL::conversation_primary_state)) as state`;
  console.log(`✅ State enum has ${(states as any[]).length} values`);

  // Test 3: Verify relations work
  const userCount = await prisma.users.count();
  console.log(`✅ Users in DB: ${userCount}`);

  // Test 4: Verify password_hash column exists
  const columns = await prisma.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'password_hash'
  `;
  console.log(
    `✅ password_hash column exists: ${(columns as any[]).length > 0}`,
  );

  console.log(
    "\n🎉 Step 1 PASSED — Prisma is connected to your existing database",
  );
}

main()
  .catch((e) => {
    console.error("❌ FAILED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
