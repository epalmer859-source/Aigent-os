"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "~/server/auth/actions";
import { api } from "~/trpc/react";

const tabs = [
  { label: "Urgent", href: "/dashboard/urgent", ownerOnly: false },
  { label: "Conversations", href: "/dashboard/conversations", ownerOnly: false },
  { label: "Quotes", href: "/dashboard/quotes", ownerOnly: false },
  { label: "Escalations", href: "/dashboard/escalations", ownerOnly: false },
  { label: "Settings", href: "/dashboard/settings", ownerOnly: false },
] as const;

interface DashboardNavProps {
  email: string;
  role: string;
}

export default function DashboardNav({ email, role }: DashboardNavProps) {
  const pathname = usePathname();
  const isOwner = role === "owner";
  const { data: counts } = api.dashboard.counts.useQuery(undefined, {
    refetchInterval: 15_000,
  });

  const visibleTabs = tabs.filter((tab) => !tab.ownerOnly || isOwner);

  return (
    <header className="border-b border-gray-200 bg-white">
      {/* Top bar */}
      <div className="flex h-14 items-center justify-between px-4 sm:px-6">
        <span className="text-base font-semibold text-gray-900">
          AIgent OS
        </span>

        {/* User menu */}
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-gray-500 sm:block">{email}</span>
          <form action={signOutAction}>
            <button
              type="submit"
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>

      {/* Tab bar */}
      <nav className="flex overflow-x-auto px-4 sm:px-6" aria-label="Tabs">
        {visibleTabs.map((tab) => {
          const isActive =
            pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={[
                "flex-shrink-0 border-b-2 px-3 py-3 text-sm font-medium transition",
                isActive
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700",
              ].join(" ")}
            >
              {tab.href === "/dashboard/urgent" && counts && counts.total > 0
                ? `Urgent (${counts.total})`
                : tab.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
