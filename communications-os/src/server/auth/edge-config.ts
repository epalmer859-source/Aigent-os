import type { NextAuthConfig } from "next-auth";

/**
 * Minimal NextAuth config for the middleware (edge runtime).
 * No Prisma, no bcrypt — only what's needed to verify the JWT
 * and reconstruct session.user with our custom fields.
 */
export const edgeAuthConfig = {
  providers: [],
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in" },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.businessId = (user as { businessId?: string | null }).businessId ?? null;
        token.role = (user as { role?: string }).role ?? "";
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
          role: token.role as string,
        },
      };
    },
  },
} satisfies NextAuthConfig;
