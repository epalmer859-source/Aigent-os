import { PrismaClient } from "../generated/prisma/index.js";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = "test@example.com";
  const password = "testpassword123";

  const existing = await prisma.users.findUnique({ where: { email } });
  if (existing) {
    console.log(`ℹ️  User already exists: ${existing.id}`);
    return;
  }

  const password_hash = await bcrypt.hash(password, 12);

  const user = await prisma.users.create({
    data: {
      email,
      password_hash,
      role: "owner",
    },
  });

  console.log(`✅ Test user created`);
  console.log(`   ID:    ${user.id}`);
  console.log(`   Email: ${user.email}`);
  console.log(`   Role:  ${user.role}`);
}

main()
  .catch((e) => {
    console.error("❌ FAILED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
