"use client";

import { motion } from "framer-motion";
import { formatUsd } from "@/lib/format";
import { Avatar } from "./Avatar";
import type { LeaderboardEntry, LeaderboardMetric } from "@/types";

interface Props {
  /** Ranks 1-3, in rank order. Shorter arrays render the slots that exist. */
  top: LeaderboardEntry[];
  metric: LeaderboardMetric;
  onSelect: (entry: LeaderboardEntry) => void;
}

/**
 * The top three, as a podium.
 *
 * Layout: 2nd — 1st — 3rd, with 1st both taller and lifted, so the eye lands on
 * the winner before it reads the ranks. The staggered heights are what make the
 * arrangement read diagonally; the runners-up also sit lower on the baseline
 * (translate-y) so the three tops form a shallow V rather than a flat row.
 *
 * The avatar overlaps the top edge of each plinth rather than sitting inside it,
 * which is what keeps a short box from looking cramped.
 */
export function Podium({ top, metric, onSelect }: Props) {
  // Index by rank rather than by array position — a board with two traders on
  // it must still put the winner in the middle, not on the left.
  const byRank = new Map(top.map((e) => [e.rank, e]));
  const order: { rank: 1 | 2 | 3 }[] = [{ rank: 2 }, { rank: 1 }, { rank: 3 }];

  return (
    <div className="mb-5 flex items-end justify-center gap-2 px-1 pt-10">
      {order.map(({ rank }, i) => {
        const entry = byRank.get(rank);
        return (
          <Plinth
            key={rank}
            rank={rank}
            entry={entry}
            metric={metric}
            // Stagger the reveal from the winner outwards.
            delay={rank === 1 ? 0 : 0.08 + i * 0.02}
            onSelect={onSelect}
          />
        );
      })}
    </div>
  );
}

/** Per-rank presentation. 1st is taller, lifted, and wears the brand glow. */
const RANKS = {
  1: {
    label: "1st",
    height: "h-[104px]",
    lift: "-translate-y-3",
    // The green rim + outer bloom is reserved for the winner alone.
    box: "bg-up-soft ring-1 ring-up/60 shadow-[0_0_28px_-4px_rgba(114,233,18,0.45)]",
    labelColor: "text-up",
    ring: "ring-2 ring-up",
    avatar: "h-16 w-16",
  },
  2: {
    label: "2nd",
    height: "h-[78px]",
    lift: "translate-y-0",
    box: "bg-white/[0.05] ring-1 ring-white/10",
    labelColor: "text-text-muted",
    ring: "ring-1 ring-white/20",
    avatar: "h-12 w-12",
  },
  3: {
    label: "3rd",
    height: "h-[64px]",
    lift: "translate-y-1",
    box: "bg-white/[0.035] ring-1 ring-white/[0.08]",
    labelColor: "text-text-muted",
    ring: "ring-1 ring-white/[0.14]",
    avatar: "h-12 w-12",
  },
} as const;

function Plinth({
  rank,
  entry,
  metric,
  delay,
  onSelect,
}: {
  rank: 1 | 2 | 3;
  /** Absent when fewer than three traders have ranked — the slot renders empty. */
  entry: LeaderboardEntry | undefined;
  metric: LeaderboardMetric;
  delay: number;
  onSelect: (entry: LeaderboardEntry) => void;
}) {
  const style = RANKS[rank];
  const value = entry
    ? metric === "pnl"
      ? `${entry.pnl >= 0 ? "+" : "−"}${formatUsd(Math.abs(entry.pnl))}`
      : `${entry.roi >= 0 ? "+" : "−"}${Math.abs(entry.roi * 100).toFixed(1)}%`
    : "—";
  const up = (entry?.[metric] ?? 0) >= 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className={`flex flex-1 flex-col items-center ${style.lift}`}
    >
      {/* Avatar + handle, straddling the top edge of the plinth. */}
      <Avatar
        src={entry?.avatarUrl}
        name={entry?.username}
        className={`${style.avatar} ${style.ring}`}
      />
      <span className="mt-1.5 max-w-full truncate px-1 text-[11px] font-medium text-text">
        {entry ? `@${entry.username}` : "—"}
      </span>
      <span
        className={`tabular text-[11px] font-semibold ${
          !entry ? "text-text-muted" : up ? "text-up" : "text-down"
        }`}
      >
        {value}
      </span>

      {/* The plinth itself. The position label is inscribed on its face. */}
      <button
        type="button"
        disabled={!entry}
        onClick={() => entry && onSelect(entry)}
        aria-label={entry ? `View @${entry.username}` : undefined}
        className={`mt-2 flex w-full items-start justify-center rounded-t-2xl pt-2.5 transition-transform disabled:cursor-default ${style.height} ${style.box} ${
          entry ? "active:scale-[0.97]" : "opacity-40"
        }`}
      >
        <span
          className={`text-lg font-black tracking-tight ${style.labelColor}`}
        >
          {style.label}
        </span>
      </button>
    </motion.div>
  );
}
