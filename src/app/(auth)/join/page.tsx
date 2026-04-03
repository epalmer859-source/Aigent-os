"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { api } from "~/trpc/react";

export default function JoinPage() {
  const router = useRouter();
  const { update } = useSession();
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");

  const joinMutation = api.onboarding.join.useMutation({
    onSuccess: async () => {
      await update(); // refresh JWT with new businessId + role=admin
      window.location.assign("/dashboard/urgent");
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    joinMutation.mutate({ joinCode: joinCode.trim().toUpperCase() });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-semibold text-gray-900">
          Join your team
        </h1>
        <p className="mb-6 text-sm text-gray-500">
          Get the join code from your business owner
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="joinCode"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Join Code
            </label>
            <input
              id="joinCode"
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="e.g. SMITH42"
              autoComplete="off"
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm uppercase tracking-widest outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={joinMutation.isPending}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            {joinMutation.isPending ? "Joining…" : "Join Team"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-gray-500">
          <Link href="/choose-role" className="text-blue-600 hover:underline">
            ← Back
          </Link>
        </p>
      </div>
    </div>
  );
}
