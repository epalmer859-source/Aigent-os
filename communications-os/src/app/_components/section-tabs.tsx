"use client";

import { useEffect, useRef, useState } from "react";

const TABS = [
  { id: "the-problem",    label: "The Problem" },
  { id: "how-it-works",   label: "How It Works" },
  { id: "ai-front-desk",  label: "AI Front Desk" },
  { id: "control",        label: "Control" },
  { id: "whats-inside",   label: "What's Inside" },
  { id: "capabilities",   label: "Capabilities" },
  { id: "pricing-section", label: "Pricing" },
];

export function SectionTabs() {
  const [active, setActive] = useState("");
  const [visible, setVisible] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Show tabs after scrolling past hero
  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > window.innerHeight * 0.65);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Track which section is in view
  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    TABS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (!el) return;

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting) setActive(id);
        },
        {
          threshold: 0.25,
          rootMargin: "-64px 0px -45% 0px",
        },
      );

      observer.observe(el);
      observers.push(observer);
    });

    return () => observers.forEach((o) => o.disconnect());
  }, []);

  // Auto-scroll the tab bar to keep active tab visible
  useEffect(() => {
    if (!scrollRef.current || !active) return;
    const activeEl = scrollRef.current.querySelector(`[data-tab="${active}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    }
  }, [active]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 112;
    window.scrollTo({ top, behavior: "smooth" });
  };

  return (
    <div
      className={`fixed top-16 left-0 right-0 z-40 border-b border-zinc-800/80 bg-[#09090B]/90 backdrop-blur-md transition-all duration-500 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-2 pointer-events-none"
      }`}
    >
      <div className="max-w-6xl mx-auto px-4">
        <div
          ref={scrollRef}
          className="flex items-center gap-0.5 overflow-x-auto py-1"
          style={{ scrollbarWidth: "none" }}
        >
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              data-tab={id}
              onClick={() => scrollTo(id)}
              className={`relative shrink-0 px-4 py-2.5 text-sm font-medium rounded-lg transition-all duration-200 whitespace-nowrap ${
                active === id
                  ? "text-zinc-50"
                  : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {label}
              {active === id && (
                <span className="absolute inset-x-2 bottom-1 h-px bg-blue-500 rounded-full" />
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
