"use client";

import { useState } from "react";
import { Plus, Minus } from "lucide-react";

interface FaqItem {
  question: string;
  answer: string;
}

interface FaqAccordionProps {
  items: FaqItem[];
}

export function FaqAccordion({ items }: FaqAccordionProps) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div
          key={i}
          className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden"
        >
          <button
            className="w-full flex items-center justify-between gap-4 px-8 py-6 text-left hover:bg-zinc-800/50 transition-colors"
            onClick={() => setOpen(open === i ? null : i)}
            aria-expanded={open === i}
          >
            <span className="text-zinc-50 font-medium">{item.question}</span>
            <span className="shrink-0 text-zinc-500">
              {open === i ? (
                <Minus size={18} strokeWidth={1.5} />
              ) : (
                <Plus size={18} strokeWidth={1.5} />
              )}
            </span>
          </button>

          {open === i && (
            <div className="px-8 pb-6">
              <p className="text-zinc-400 leading-relaxed">{item.answer}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
