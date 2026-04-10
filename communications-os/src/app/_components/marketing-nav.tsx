"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

export function MarketingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-zinc-800 bg-black/80 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link
          href="/"
          className="text-lg font-bold text-zinc-50 tracking-tight hover:text-white transition-colors"
        >
          AIgent OS
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-8">
          <Link
            href="/pricing"
            className="text-sm text-zinc-400 hover:text-zinc-50 transition-colors"
          >
            Pricing
          </Link>
          <Link
            href="/pricing"
            className="rounded-full bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-5 py-2 transition-colors"
          >
            Get Started
          </Link>
        </nav>

        {/* Mobile hamburger */}
        <button
          className="md:hidden text-zinc-400 hover:text-zinc-50 transition-colors"
          onClick={() => setOpen(!open)}
          aria-label="Toggle menu"
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div className="md:hidden border-t border-zinc-800 bg-black/95 px-6 py-5 flex flex-col gap-4">
          <Link
            href="/pricing"
            className="text-sm text-zinc-400 hover:text-zinc-50 transition-colors"
            onClick={() => setOpen(false)}
          >
            Pricing
          </Link>
          <Link
            href="/pricing"
            className="rounded-full bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium px-5 py-3 text-center transition-colors"
            onClick={() => setOpen(false)}
          >
            Get Started
          </Link>
        </div>
      )}
    </header>
  );
}
