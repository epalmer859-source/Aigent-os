"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "~/server/auth/actions";
import { useTheme } from "~/app/_components/ThemeProvider";

// ── Icons ──────────────────────────────────────────────────────────────────

function IconQueue() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <line x1="8" y1="8" x2="16" y2="8"/>
      <line x1="8" y1="12" x2="16" y2="12"/>
      <line x1="8" y1="16" x2="12" y2="16"/>
    </svg>
  );
}
function IconSchedule() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/>
      <line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  );
}
function IconMoon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>
    </svg>
  );
}
function IconSun() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/>
      <line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );
}
function IconMenu() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="12" x2="21" y2="12"/>
      <line x1="3" y1="6" x2="21" y2="6"/>
      <line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  );
}
function IconX() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  );
}

// ── Nav config ─────────────────────────────────────────────────────────────

function IconSettings() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
    </svg>
  );
}

function IconChat() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
    </svg>
  );
}

const NAV = [
  { label: "My Jobs",    href: "/tech",            Icon: IconQueue },
  { label: "Schedule",   href: "/tech/schedule",    Icon: IconSchedule },
  { label: "Assistant",  href: "/tech/assistant",   Icon: IconChat },
  { label: "Settings",   href: "/tech/settings",    Icon: IconSettings },
] as const;

// ── NavItem ────────────────────────────────────────────────────────────────

function NavItem({
  label,
  href,
  Icon,
  isActive,
  onClick,
}: {
  label: string;
  href: string;
  Icon: React.FC;
  isActive: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150"
      style={{
        background: isActive ? "var(--bg-active)" : "transparent",
        color: isActive ? "var(--accent-text)" : "var(--t2)",
      }}
      onMouseEnter={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
        if (!isActive) (e.currentTarget as HTMLElement).style.color = "var(--t1)";
      }}
      onMouseLeave={(e) => {
        if (!isActive) (e.currentTarget as HTMLElement).style.background = "transparent";
        if (!isActive) (e.currentTarget as HTMLElement).style.color = "var(--t2)";
      }}
    >
      <span className="shrink-0" style={{ color: isActive ? "var(--accent-text)" : "var(--t3)" }}>
        <Icon />
      </span>
      <span className="flex-1">{label}</span>
    </Link>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────

function Sidebar({
  email,
  pathname,
  onClose,
}: {
  email: string;
  pathname: string;
  onClose?: () => void;
}) {
  const { theme, toggle } = useTheme();

  return (
    <aside
      className="sidebar-scroll flex h-full flex-col overflow-y-auto"
      style={{
        background: "var(--sidebar-bg)",
        borderRight: "1px solid var(--sidebar-border)",
        width: "240px",
        minWidth: "240px",
      }}
    >
      {/* Logo */}
      <div
        className="flex h-14 shrink-0 items-center gap-2.5 px-4"
        style={{ borderBottom: "1px solid var(--sidebar-border)" }}
      >
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-black text-white"
          style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)" }}
        >
          T
        </div>
        <span className="text-sm font-semibold" style={{ color: "var(--t1)" }}>
          Tech Portal
        </span>
        {onClose && (
          <button onClick={onClose} className="ml-auto rounded-md p-1 transition-colors" style={{ color: "var(--t3)" }}>
            <IconX />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 px-2 py-4">
        {NAV.map(({ label, href, Icon }) => (
          <NavItem
            key={href}
            label={label}
            href={href}
            Icon={Icon}
            isActive={pathname === href || (href !== "/tech" && pathname.startsWith(href + "/"))}
            onClick={onClose}
          />
        ))}
      </nav>

      {/* Bottom */}
      <div
        className="shrink-0 space-y-0.5 px-2 pb-4 pt-2"
        style={{ borderTop: "1px solid var(--sidebar-border)" }}
      >
        <button
          onClick={toggle}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150"
          style={{ color: "var(--t2)" }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--bg-hover)";
            (e.currentTarget as HTMLElement).style.color = "var(--t1)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
            (e.currentTarget as HTMLElement).style.color = "var(--t2)";
          }}
        >
          <span className="shrink-0" style={{ color: "var(--t3)" }}>
            {theme === "dark" ? <IconSun /> : <IconMoon />}
          </span>
          {theme === "dark" ? "Light mode" : "Dark mode"}
        </button>

        <div className="mt-1 px-3 pb-1 pt-2">
          <p className="mb-2 truncate text-xs" style={{ color: "var(--t3)" }}>
            {email}
          </p>
          <form action={signOutAction}>
            <button
              type="submit"
              className="w-full rounded-lg px-3 py-2 text-xs font-medium transition-all duration-150"
              style={{
                background: "var(--bg-hover)",
                border: "1px solid var(--border)",
                color: "var(--t2)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.color = "var(--t1)";
                (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.color = "var(--t2)";
                (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
              }}
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

// ── TechShell ──────────────────────────────────────────────────────────────

export default function TechShell({
  email,
  technicianId,
  children,
}: {
  email: string;
  technicianId: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="flex h-dvh overflow-hidden" style={{ background: "var(--bg)" }}>
      {/* Desktop sidebar */}
      <div className="hidden lg:flex lg:h-full lg:flex-col">
        <Sidebar email={email} pathname={pathname} />
      </div>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.6)" }}
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex flex-col shadow-2xl" style={{ zIndex: 50 }}>
            <Sidebar email={email} pathname={pathname} onClose={() => setMobileOpen(false)} />
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile top bar */}
        <header
          className="flex h-14 shrink-0 items-center gap-3 px-4 lg:hidden"
          style={{
            background: "var(--sidebar-bg)",
            borderBottom: "1px solid var(--sidebar-border)",
          }}
        >
          <button
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-1.5 transition-colors"
            style={{ color: "var(--t2)" }}
          >
            <IconMenu />
          </button>
          <div
            className="flex h-7 w-7 items-center justify-center rounded-lg text-xs font-black text-white"
            style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)" }}
          >
            T
          </div>
          <span className="text-sm font-semibold" style={{ color: "var(--t1)" }}>
            Tech Portal
          </span>
        </header>

        {/* Page content */}
        <main
          className="content-scroll flex-1 overflow-y-auto p-5 lg:p-6"
          style={{ background: "var(--bg)" }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
