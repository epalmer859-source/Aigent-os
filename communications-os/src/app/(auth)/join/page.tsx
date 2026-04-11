"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { api } from "~/trpc/react";

export default function JoinPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-gray-50"><p className="text-sm text-gray-400">Loading...</p></div>}>
      <JoinContent />
    </Suspense>
  );
}

function JoinContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { update } = useSession();
  const isTechnician = searchParams.get("role") === "technician";

  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [step, setStep] = useState<"code" | "pick-tech">("code");
  const [selectedTechId, setSelectedTechId] = useState("");

  // Query technicians for a business (only fires when step === "pick-tech")
  const techQuery = api.onboarding.listTechnicians.useQuery(
    { joinCode: joinCode.trim().toUpperCase() },
    { enabled: step === "pick-tech" && isTechnician },
  );

  const joinMutation = api.onboarding.join.useMutation({
    onSuccess: async (data) => {
      await update(); // refresh JWT with new businessId + role
      if (data.role === "technician") {
        window.location.assign("/tech");
      } else {
        window.location.assign("/dashboard/urgent");
      }
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const code = joinCode.trim().toUpperCase();
    if (!code) return;

    if (isTechnician) {
      // Go to step 2: pick your technician profile
      setStep("pick-tech");
    } else {
      // Admin join — submit directly
      joinMutation.mutate({ joinCode: code });
    }
  }

  function handleTechSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!selectedTechId) {
      setError("Please select your technician profile");
      return;
    }
    joinMutation.mutate({
      joinCode: joinCode.trim().toUpperCase(),
      technicianId: selectedTechId,
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-semibold text-gray-900">
          {isTechnician ? "Join as Technician" : "Join your team"}
        </h1>
        <p className="mb-6 text-sm text-gray-500">
          Get the join code from your business owner
        </p>

        {step === "code" && (
          <form onSubmit={handleCodeSubmit} className="flex flex-col gap-4">
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
              {joinMutation.isPending
                ? "Joining…"
                : isTechnician
                  ? "Next"
                  : "Join Team"}
            </button>
          </form>
        )}

        {step === "pick-tech" && (
          <form onSubmit={handleTechSubmit} className="flex flex-col gap-4">
            <p className="text-sm text-gray-600">
              Select your technician profile:
            </p>

            {techQuery.isLoading && (
              <p className="text-sm text-gray-400">Loading technicians…</p>
            )}

            {techQuery.data && techQuery.data.length === 0 && (
              <p className="text-sm text-amber-600">
                No technician profiles found for this business. Ask your owner
                to add you as a technician first.
              </p>
            )}

            {techQuery.data && techQuery.data.length > 0 && (
              <div className="flex flex-col gap-2">
                {techQuery.data.map((tech) => (
                  <label
                    key={tech.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border-2 p-3 transition ${
                      selectedTechId === tech.id
                        ? "border-green-500 bg-green-50"
                        : "border-gray-200 hover:border-gray-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="technicianId"
                      value={tech.id}
                      checked={selectedTechId === tech.id}
                      onChange={() => setSelectedTechId(tech.id)}
                      className="sr-only"
                    />
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-sm font-semibold text-green-700">
                      {tech.name.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm font-medium text-gray-900">
                      {tech.name}
                    </span>
                  </label>
                ))}
              </div>
            )}

            {error && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep("code");
                  setSelectedTechId("");
                  setError("");
                }}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={joinMutation.isPending || !selectedTechId}
                className="flex-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-700 disabled:opacity-60"
              >
                {joinMutation.isPending ? "Joining…" : "Join as Technician"}
              </button>
            </div>
          </form>
        )}

        <p className="mt-5 text-center text-sm text-gray-500">
          <Link href="/choose-role" className="text-blue-600 hover:underline">
            &larr; Back
          </Link>
        </p>
      </div>
    </div>
  );
}
