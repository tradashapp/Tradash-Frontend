"use client";

import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import type { LeaderboardMetric, LeaderboardPeriod } from "@/types";

const METRICS: { value: LeaderboardMetric; label: string }[] = [
  { value: "roi", label: "ROI" },
  { value: "pnl", label: "PnL" },
];

const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "all", label: "All time" },
];

/**
 * The two filter rows, pinned above the podium: what to rank by, and over what
 * window. Both are segmented controls rather than dropdowns — there are only a
 * handful of options and the current one should be readable at a glance.
 */
export function Filters({
  metric,
  period,
  onMetric,
  onPeriod,
}: {
  metric: LeaderboardMetric;
  period: LeaderboardPeriod;
  onMetric: (m: LeaderboardMetric) => void;
  onPeriod: (p: LeaderboardPeriod) => void;
}) {
  return (
    <div className="mb-1 flex flex-col gap-2">
      <Segmented
        options={METRICS}
        value={metric}
        onChange={onMetric}
        ariaLabel="Rank by"
      />
      <Segmented
        options={PERIODS}
        value={period}
        onChange={onPeriod}
        ariaLabel="Time period"
      />
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="glass-inset flex gap-1 rounded-full p-1"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              if (active) return;
              playSound("tap");
              haptic("tap");
              onChange(o.value);
            }}
            className={`flex-1 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              active
                ? "bg-up text-black"
                : "text-text-muted hover:text-text"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
