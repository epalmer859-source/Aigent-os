"use server";

import { AuthError } from "next-auth";
import { signIn, signOut } from "~/server/auth";
import { signUp } from "~/server/auth/signup";

export async function signInAction(
  _prevState: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  try {
    // On success, NextAuth throws a NEXT_REDIRECT — re-throw it so Next.js handles it
    await signIn("credentials", { email, password, redirectTo: "/dashboard/urgent" });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Invalid email or password" };
    }
    throw error;
  }
  return null;
}

export async function signUpAndSignInAction(
  _prevState: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const result = await signUp(email, password);
  if (!result.success) {
    return { error: result.error };
  }

  try {
    await signIn("credentials", { email, password, redirectTo: "/choose-role" });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Account created but sign-in failed. Please sign in." };
    }
    throw error;
  }
  return null;
}

export async function signOutAction() {
  await signOut({ redirectTo: "/sign-in" });
}

// ── Used by /login page (dark marketing-style auth) ───────────

export async function loginPageAction(
  _prevState: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  try {
    await signIn("credentials", { email, password, redirectTo: "/dashboard" });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Invalid email or password. Please try again." };
    }
    throw error;
  }
  return null;
}

// ── Used by /signup page ──────────────────────────────────────

export async function signupPageAction(
  _prevState: { error: string } | null,
  formData: FormData,
): Promise<{ error: string } | null> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  const result = await signUp(email, password);
  if (!result.success) {
    return { error: result.error };
  }

  try {
    await signIn("credentials", { email, password, redirectTo: "/choose-role" });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Account created. Please log in." };
    }
    throw error;
  }
  return null;
}
