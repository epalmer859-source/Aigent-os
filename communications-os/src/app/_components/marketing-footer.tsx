import Link from "next/link";

export function MarketingFooter() {
  return (
    <footer className="border-t border-zinc-800 bg-[#09090B] py-10">
      <div className="max-w-6xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-4">
        <p className="text-sm text-zinc-500">© 2026 AIgent OS</p>
        <nav className="flex items-center gap-6">
          <Link
            href="/pricing"
            className="text-sm text-zinc-500 hover:text-zinc-400 transition-colors"
          >
            Pricing
          </Link>
        </nav>
      </div>
    </footer>
  );
}
