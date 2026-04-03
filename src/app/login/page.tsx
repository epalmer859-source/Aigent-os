"use client";

import Link from "next/link";
import { useActionState } from "react";
import { loginPageAction } from "~/server/auth/actions";

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(loginPageAction, null);

  return (
    <div className="min-h-screen bg-[#09090B] flex flex-col items-center justify-center px-4">
      {/* Wordmark */}
      <Link
        href="/"
        className="text-lg font-bold text-zinc-50 tracking-tight mb-10 hover:text-white transition-colors"
      >
        AIgent OS
      </Link>

      {/* Card */}
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
        <h1 className="text-2xl font-bold text-zinc-50 mb-1">Welcome back</h1>
        <p className="text-sm text-zinc-500 mb-8">Sign in to your account</p>

        <form action={formAction} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-medium text-zinc-400">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-50 placeholder-zinc-600 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-600 transition-colors"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-medium text-zinc-400">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-50 placeholder-zinc-600 outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-600 transition-colors"
            />
          </div>

          {state?.error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="w-full bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-full py-3 text-sm transition-all duration-200 hover:scale-[1.01] active:scale-[0.99] mt-1"
          >
            {isPending ? "Signing in…" : "Log In"}
          </button>
        </form>

        <p className="text-sm text-zinc-500 text-center mt-6">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-blue-500 hover:text-blue-400 transition-colors">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
