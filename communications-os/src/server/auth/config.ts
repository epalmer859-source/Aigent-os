import { type NextAuthConfig } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "~/server/db";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      businessId: string | null;
      technicianId: string | null;
      role: string;
    };
  }
  interface User {
    businessId: string | null;
    technicianId: string | null;
    role: string;
  }
}

export const authConfig = {
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = z
          .object({ email: z.string().email(), password: z.string().min(1) })
          .safeParse(credentials);

        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        const user = await db.users.findUnique({ where: { email } });
        if (!user?.password_hash) return null;

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          emailVerified: null,
          businessId: user.business_id,
          technicianId: user.technician_id,
          role: user.role,
        };
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in" },
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.businessId = user.businessId;
        token.technicianId = user.technicianId;
        token.role = user.role;
      }
      // Re-fetch from DB when session.update() is called OR when businessId is missing
      // (covers stale tokens where onboarding completed but JWT wasn't refreshed)
      if (token.id && (trigger === "update" || !token.businessId)) {
        const fresh = await db.users.findUnique({
          where: { id: token.id as string },
          select: { business_id: true, technician_id: true, role: true },
        });
        if (fresh) {
          token.businessId = fresh.business_id;
          token.technicianId = fresh.technician_id;
          token.role = fresh.role;
        }
      }
      return token;
    },
    session({ session, token }) {
      return {
        ...session,
        user: {
          id: token.id as string,
          email: token.email as string,
          businessId: (token.businessId as string | null) ?? null,
          technicianId: (token.technicianId as string | null) ?? null,
          role: token.role as string,
        },
      };
    },
  },
} satisfies NextAuthConfig;
