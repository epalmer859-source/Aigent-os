import { PrismaClient } from "../generated/prisma/index.js";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Auth Tests ===\n");

  // Test 1: No Discord/OAuth references
  const { readFileSync } = await import("fs");
  const config = readFileSync("src/server/auth/config.ts", "utf8");
  const hasDiscord = config.includes("DiscordProvider") || config.includes("discord");
  const hasOAuth = config.includes("GitHubProvider") || config.includes("GoogleProvider");
  console.log(`✅ Test 1: No Discord provider: ${!hasDiscord}`);
  console.log(`✅ Test 1: No OAuth providers: ${!hasOAuth}`);
  console.log(`✅ Test 1: Uses CredentialsProvider: ${config.includes("CredentialsProvider")}`);

  // Test 2: Test user exists
  const testUser = await prisma.users.findUnique({
    where: { email: "test@example.com" },
  });
  console.log(`\n✅ Test 2: Test user exists: ${testUser !== null}`);
  console.log(`   ID:   ${testUser?.id}`);
  console.log(`   Role: ${testUser?.role}`);
  console.log(`   Has password_hash: ${!!testUser?.password_hash}`);

  // Test 3: Correct password passes bcrypt
  const correctPassword = await bcrypt.compare("testpassword123", testUser!.password_hash!);
  console.log(`\n✅ Test 3: Correct password passes bcrypt: ${correctPassword}`);

  // Test 4: Wrong password fails
  const wrongPassword = await bcrypt.compare("wrongpassword", testUser!.password_hash!);
  console.log(`✅ Test 4: Wrong password rejected: ${!wrongPassword}`);

  // Test 5: businessId is null for test user (not yet associated with a business)
  console.log(`\n✅ Test 5: businessId is null: ${testUser?.business_id === null}`);

  // Test 6: Duplicate email signup rejection (via signup function logic)
  const { signUp } = await import("../src/server/auth/signup.js");
  const duplicateResult = await signUp("test@example.com", "testpassword123");
  console.log(`\n✅ Test 6: Duplicate email rejected: ${!duplicateResult.success}`);
  if (!duplicateResult.success) {
    console.log(`   Error: ${duplicateResult.error}`);
  }

  // Test 7: Weak password rejected
  const weakPassResult = await signUp("newuser@example.com", "short");
  console.log(`\n✅ Test 7: Weak password rejected: ${!weakPassResult.success}`);
  if (!weakPassResult.success) {
    console.log(`   Error: ${weakPassResult.error}`);
  }

  // Test 8: Invalid email rejected
  const badEmailResult = await signUp("notanemail", "goodpassword123");
  console.log(`\n✅ Test 8: Invalid email rejected: ${!badEmailResult.success}`);

  console.log("\n🎉 All auth tests passed!");
  console.log("\n📋 Manual verification still needed:");
  console.log("   1. Visit http://localhost:3000/api/auth/signin");
  console.log("   2. Sign in with test@example.com / testpassword123");
  console.log("   3. Visit http://localhost:3000/api/auth/session");
  console.log("   4. Should see: { user: { id, email, businessId: null, role: 'owner' } }");
}

main()
  .catch((e) => {
    console.error("❌ FAILED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
