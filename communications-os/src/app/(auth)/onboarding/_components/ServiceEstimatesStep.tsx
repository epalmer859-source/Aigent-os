"use client";

import { useState } from "react";
import {
  REQUIRED_SERVICES,
  OPTIONAL_SERVICES,
  CATEGORY_LABELS,
  type HvacServiceDefault,
} from "~/engine/scheduling/hvac-service-defaults";

export interface ServiceEstimateEntry {
  name: string;
  category: string;
  estimatedMinutes: number;
  isActive: boolean;
  tier: "required" | "optional";
}

/** Build the initial list of 60 services with default times. */
export function buildInitialEstimates(): ServiceEstimateEntry[] {
  return [
    ...REQUIRED_SERVICES.map((s) => ({
      name: s.name,
      category: s.category,
      estimatedMinutes: s.estimatedMinutes,
      isActive: true,
      tier: s.tier as "required" | "optional",
    })),
    ...OPTIONAL_SERVICES.map((s) => ({
      name: s.name,
      category: s.category,
      estimatedMinutes: s.estimatedMinutes,
      isActive: false,
      tier: s.tier as "required" | "optional",
    })),
  ];
}

function groupByCategory(items: ServiceEstimateEntry[]): Map<string, ServiceEstimateEntry[]> {
  const map = new Map<string, ServiceEstimateEntry[]>();
  for (const item of items) {
    if (!map.has(item.category)) map.set(item.category, []);
    map.get(item.category)!.push(item);
  }
  return map;
}

export default function ServiceEstimatesStep({
  estimates,
  onChange,
}: {
  estimates: ServiceEstimateEntry[];
  onChange: (updated: ServiceEstimateEntry[]) => void;
}) {
  const [optionalExpanded, setOptionalExpanded] = useState(false);

  const required = estimates.filter((e) => e.tier === "required");
  const optional = estimates.filter((e) => e.tier === "optional");
  const requiredGroups = groupByCategory(required);
  const optionalGroups = groupByCategory(optional);

  function updateMinutes(name: string, minutes: number) {
    onChange(
      estimates.map((e) =>
        e.name === name ? { ...e, estimatedMinutes: Math.max(5, minutes) } : e,
      ),
    );
  }

  function toggleActive(name: string) {
    onChange(
      estimates.map((e) =>
        e.name === name && e.tier === "optional"
          ? { ...e, isActive: !e.isActive }
          : e,
      ),
    );
  }

  const enabledOptionalCount = optional.filter((o) => o.isActive).length;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-gray-600">
        Review the default time estimates for each service. These drive scheduling
        — adjust any that don&apos;t match your team&apos;s typical job times.
      </p>

      {/* Required services */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-gray-800">
          Required Services (30)
        </h3>
        {Array.from(requiredGroups.entries()).map(([cat, items]) => (
          <CategoryGroup
            key={cat}
            category={cat}
            items={items}
            onUpdateMinutes={updateMinutes}
            showToggle={false}
          />
        ))}
      </div>

      {/* Optional services */}
      <div className="rounded-xl border border-gray-200 bg-gray-50">
        <button
          type="button"
          onClick={() => setOptionalExpanded(!optionalExpanded)}
          className="flex w-full items-center justify-between px-4 py-3 text-left"
        >
          <div>
            <span className="text-sm font-semibold text-gray-800">
              30 Additional Services
            </span>
            {enabledOptionalCount > 0 && (
              <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                {enabledOptionalCount} enabled
              </span>
            )}
          </div>
          <span
            className="text-xs text-gray-400 transition-transform"
            style={{ transform: optionalExpanded ? "rotate(180deg)" : "rotate(0deg)" }}
          >
            &#9660;
          </span>
        </button>

        <p className="px-4 pb-2 text-xs text-gray-500">
          Enabling these additional services drastically improves the AI&apos;s schedule
          estimation accuracy before inspection.
        </p>

        {optionalExpanded && (
          <div className="border-t border-gray-200 px-4 pb-4 pt-2">
            {Array.from(optionalGroups.entries()).map(([cat, items]) => (
              <CategoryGroup
                key={cat}
                category={cat}
                items={items}
                onUpdateMinutes={updateMinutes}
                onToggle={toggleActive}
                showToggle={true}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function CategoryGroup({
  category,
  items,
  onUpdateMinutes,
  onToggle,
  showToggle,
}: {
  category: string;
  items: ServiceEstimateEntry[];
  onUpdateMinutes: (name: string, minutes: number) => void;
  onToggle?: (name: string) => void;
  showToggle: boolean;
}) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
        {CATEGORY_LABELS[category] ?? category}
      </p>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div
            key={item.name}
            className="flex items-center gap-3 rounded-lg border px-3 py-2"
            style={{
              borderColor: item.isActive ? "#e5e7eb" : "#f3f4f6",
              background: item.isActive ? "#fff" : "#f9fafb",
              opacity: item.isActive ? 1 : 0.6,
            }}
          >
            {showToggle && onToggle && (
              <button
                type="button"
                onClick={() => onToggle(item.name)}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs"
                style={{
                  borderColor: item.isActive ? "#3b82f6" : "#d1d5db",
                  background: item.isActive ? "#3b82f6" : "#fff",
                  color: item.isActive ? "#fff" : "transparent",
                }}
              >
                {item.isActive ? "\u2713" : ""}
              </button>
            )}
            <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
              {item.name}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <input
                type="number"
                min={5}
                max={600}
                value={item.estimatedMinutes}
                onChange={(e) =>
                  onUpdateMinutes(item.name, parseInt(e.target.value) || 5)
                }
                className="w-16 rounded border border-gray-300 px-2 py-1 text-right text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100"
                disabled={showToggle && !item.isActive}
              />
              <span className="text-xs text-gray-400">min</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
