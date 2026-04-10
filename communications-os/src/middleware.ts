import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { edgeAuthConfig } from "~/server/auth/edge-config";

const { auth } = NextAuth(edgeAuthConfig);

export default auth((req) => {
  const session = req.auth;
  const { pathname } = req.nextUrl;

  const isAuthenticated = !!session?.user;
  const hasBusinessId = !!session?.user?.businessId;

  // ── Protect these routes ──────────────────────────────────
  const requiresAuth =
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/onboarding") ||
    pathname === "/choose-role" ||
    pathname === "/join";

  if (requiresAuth && !isAuthenticated) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  // ── Auth pages: redirect away if already signed in ────────
  const isAuthPage =
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/sign-in" ||
    pathname === "/sign-up";

  if (isAuthPage && isAuthenticated && hasBusinessId) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/onboarding/:path*",
    "/choose-role",
    "/join",
    "/login",
    "/signup",
    "/sign-in",
    "/sign-up",
  ],
};
