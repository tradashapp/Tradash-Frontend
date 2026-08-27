"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { formatUsd } from "@/lib/format";
import { Avatar } from "./Avatar";
import type { LeaderboardEntry, LeaderboardMetric } from "@/types";

interface Props {
  entries: LeaderboardEntry[];
  /** The signed-in user's standing, if they rank at all. */
  me: LeaderboardEntry | null;
  metric: LeaderboardMetric;
  onSelect: (entry: LeaderboardEntry) => void;
}

/**
 * The ranked table (top 20) with the user's own row pinned to the bottom.
 *
 * The pinned row is NOT a permanent fixture: when the user's real row scrolls
 * into view inside the table, the floating copy drops away and the in-table row
 * takes over — otherwise the same person would appear twice, once floating over
 * the other. An IntersectionObserver on the in-table row drives that swap; when
 * the user ranks outside the top 20 there is no in-table row to observe, so the
 * floating row simply stays.
 */
export function LeaderboardTable({ entries, me, metric, onSelect }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const ownRowRef = useRef<HTMLDivElement | null>(null);
  // True while the user's own in-table row is visible in the scroll region.
  const [ownRowVisible, setOwnRowVisible] = useState(false);

  const meInTable = me != null && entries.some((e) => e.userId === me.userId);

  useEffect(() => {
    // Nothing to observe unless the user is inside the visible slice.
    if (!meInTable) {
      setOwnRowVisible(false);
      return;
    }
    const row = ownRowRef.current;
    const root = scrollRef.current;
    if (!row || !root) return;

    const io = new IntersectionObserver(
      ([entry]) => setOwnRowVisible(!!entry?.isIntersecting),
      {
        root,
        // Require most of the row to be showing before handing over, so the two
        // don't trade places while the row is half-hidden behind the float.
        threshold: 0.6,
      }
    );
    io.observe(row);
    return () => io.disconnect();
  }, [meInTable, entries]);

  if (entries.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-text-muted">
        No ranked traders yet. Close a trade to get on the board.
      </p>
    );
  }

  // The float is suppressed only while the real row is actually on screen.
  const showFloating = me != null && !ownRowVisible;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <HeaderRow metric={metric} />

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        // Leave room for the floating row so the last entry isn't trapped
        // underneath it at the bottom of the scroll.
        style={{ paddingBottom: showFloating ? 60 : 8 }}
      >
        <div className="flex flex-col gap-1">
          {entries.map((e) => {
            const isMe = me?.userId === e.userId;
            return (
              <Row
                key={e.userId}
                ref={isMe ? ownRowRef : undefined}
                entry={e}
                metric={metric}
                isMe={isMe}
                onSelect={onSelect}
              />
            );
          })}
        </div>
      </div>

      {/* The user's own standing, floating above the list. */}
      <AnimatePresence>
        {showFloating && me && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-none absolute inset-x-0 bottom-0 pt-6"
            // Fade the list out behind the float rather than cutting it off.
            style={{
              background:
                "linear-gradient(to top, rgba(15,17,22,0.96) 55%, transparent)",
            }}
          >
            <div className="pointer-events-auto">
              <Row entry={me} metric={metric} isMe floating onSelect={onSelect} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function HeaderRow({ metric }: { metric: LeaderboardMetric }) {
  return (
    <div className="mb-1.5 flex items-center gap-3 px-3 text-[10px] font-medium uppercase tracking-wide text-text-muted">
      <span className="w-6 shrink-0">#</span>
      <span className="flex-1">Trader</span>
      <span className="w-20 shrink-0 text-right">Volume</span>
      <span className="w-20 shrink-0 text-right">
        {metric === "pnl" ? "PnL" : "ROI"}
      </span>
    </div>
  );
}

interface RowProps {
  entry: LeaderboardEntry;
  metric: LeaderboardMetric;
  isMe?: boolean;
  /** The pinned copy at the bottom — gets a solid surface and a "You" tag. */
  floating?: boolean;
  onSelect: (entry: LeaderboardEntry) => void;
}

function Row({ entry, metric, isMe, floating, onSelect, ref }: RowProps & {
  ref?: React.Ref<HTMLDivElement>;
}) {
  const value = metric === "pnl" ? entry.pnl : entry.roi;
  const up = value >= 0;
  const text =
    metric === "pnl"
      ? `${up ? "+" : "−"}${formatUsd(Math.abs(entry.pnl))}`
      : `${up ? "+" : "−"}${Math.abs(entry.roi * 100).toFixed(1)}%`;

  return (
    <div
      ref={ref}
      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
        floating
          ? "bg-up-soft ring-1 ring-up/40 backdrop-blur"
          : isMe
            ? "bg-up-soft ring-1 ring-up/25"
            : "glass-inset"
      }`}
    >
      <span
        className={`tabular w-6 shrink-0 text-xs font-semibold ${
          entry.rank <= 3 ? "text-up" : "text-text-muted"
        }`}
      >
        {entry.rank}
      </span>

      <button
        type="button"
        onClick={() => onSelect(entry)}
        className="flex min-w-0 flex-1 items-center gap-2 text-left transition-opacity active:opacity-60"
        aria-label={`View @${entry.username}`}
      >
        <Avatar
          src={entry.avatarUrl}
          name={entry.username}
          className="h-7 w-7"
        />
        <span className="truncate font-medium">@{entry.username}</span>
        {isMe && (
          <span className="shrink-0 rounded bg-up px-1 py-0.5 text-[9px] font-bold uppercase text-black">
            You
          </span>
        )}
      </button>

      <span className="tabular w-20 shrink-0 text-right text-xs text-text-muted">
        {formatUsd(entry.volume)}
      </span>
      <span
        className={`tabular w-20 shrink-0 text-right font-semibold ${
          up ? "text-up" : "text-down"
        }`}
      >
        {text}
      </span>
    </div>
  );
}
