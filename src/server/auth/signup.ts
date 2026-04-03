import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "~/server/db";

const signUpSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export type SignUpResult =
  | { success: true; userId: string }
  | { success: false; error: string };

export async function signUp(
  email: string,
  password: string,
): Promise<SignUpResult> {
  const parsed = signUpSchema.safeParse({ email, password });
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const existing = await db.users.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return { success: false, error: "An account with that email already exists" };
  }

  const password_hash = await bcrypt.hash(parsed.data.password, 12);

  const user = await db.users.create({
    data: {
      email: parsed.data.email,
      password_hash,
      role: "owner",
    },
  });

  return { success: true, userId: user.id };
}
