import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "~/server/auth";

export default async function ChooseRolePage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/sign-in");
  }

  // Already onboarded — route based on role
  if (session.user.businessId) {
    if (session.user.role === "technician") {
      redirect("/tech");
    }
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md px-4">
        <h1 className="mb-2 text-center text-2xl font-semibold text-gray-900">
          How are you joining?
        </h1>
        <p className="mb-8 text-center text-sm text-gray-500">
          Tell us your role to get started
        </p>

        <div className="flex flex-col gap-4">
          <Link
            href="/onboarding"
            className="flex flex-col gap-1 rounded-xl border-2 border-gray-200 bg-white p-6 transition hover:border-blue-500 hover:shadow-sm"
          >
            <span className="text-lg font-semibold text-gray-900">
              I&apos;m the Business Owner
            </span>
            <span className="text-sm text-gray-500">
              Set up your business and manage your communications
            </span>
          </Link>

          <Link
            href="/join"
            className="flex flex-col gap-1 rounded-xl border-2 border-gray-200 bg-white p-6 transition hover:border-blue-500 hover:shadow-sm"
          >
            <span className="text-lg font-semibold text-gray-900">
              I&apos;m a Manager / Owner
            </span>
            <span className="text-sm text-gray-500">
              Join an existing team with full dashboard access
            </span>
          </Link>

          <Link
            href="/join?role=technician"
            className="flex flex-col gap-1 rounded-xl border-2 border-gray-200 bg-white p-6 transition hover:border-green-500 hover:shadow-sm"
          >
            <span className="text-lg font-semibold text-gray-900">
              I&apos;m a Technician
            </span>
            <span className="text-sm text-gray-500">
              Join your team and view your daily job queue
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
