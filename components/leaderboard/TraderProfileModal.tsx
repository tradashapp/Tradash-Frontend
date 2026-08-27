"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Cancel01Icon,
  ArrowUpRight01Icon,
  ArrowDownRight01Icon,
} from "@hugeicons/core-free-icons";
import { api } from "@/lib/api";
import { formatUsd } from "@/lib/format";
import { Avatar } from "./Avatar";
import type {
  CompletedTrade,
  LeaderboardEntry,
  LeaderboardPeriod,
  TraderProfile,
} from "@/types";

/** Trades shown before the user asks for more. */
const PREVIEW = 3;

interface Props {
  /** The tapped row. Null closes the modal. */
  subject: LeaderboardEntry | null;
  /** The period being viewed — the profile reports the SAME window. */
  period: LeaderboardPeriod;
  onClose: () => void;
}

/**
 * The public profile behind a leaderboard row: headline totals, a win/loss
 * breakdown, and recent trades.
 *
 * It's a centred modal rather than another bottom sheet because it opens FROM a
 * sheet — stacking a second sheet over the first leaves the user with two
 * grabbers and no clear idea which one dismisses what.
 *
 * Figures are scoped to the leaderboard's window, so a profile opened from the
 * weekly board shows weekly numbers and agrees with the row that was tapped.
 */
export function TraderProfileModal({ subject, period, onClose }: Props) {
  const [profile, setProfile] = useState<TraderProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!subject) return;
    let live = true;
    setLoading(true);
    setExpanded(false);
    setProfile(null);
    api
      .fetchTrader(subject.userId, period)
      .then((p) => {
        if (live) setProfile(p);
      })
      .catch(() => {
        if (live) setProfile(null);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [subject, period]);

  // Escape closes, matching the scrim tap.
  useEffect(() => {
    if (!subject) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [subject, onClose]);

  const trades = profile?.recentTrades ?? [];
  const shown = expanded ? trades : trades.slice(0, PREVIEW);

  return (
    <AnimatePresence>
      {subject && (
        <>
          <motion.div
            className="fixed inset-0 z-[60] bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`@${subject.username} profile`}
            className="fixed inset-x-4 top-1/2 z-[61] mx-auto flex max-h-[80dvh] max-w-md -translate-y-1/2 flex-col overflow-hidden rounded-3xl bg-bg-elevated p-5 ring-1 ring-white/10"
            initial={{ opacity: 0, scale: 0.94, y: "-46%" }}
            animate={{ opacity: 1, scale: 1, y: "-50%" }}
            exit={{ opacity: 0, scale: 0.94, y: "-46%" }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="glass-inset absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text active:scale-90"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={16} />
            </button>

            {/* Identity. Seeded from the tapped row so the header is correct
                immediately, before the profile request resolves. */}
            <div className="mb-4 flex flex-col items-center">
              <Avatar
                src={profile?.avatarUrl ?? subject.avatarUrl}
                name={subject.username}
                className="h-20 w-20 ring-2 ring-up/50"
              />
              <span className="mt-2 text-base font-semibold">
                @{profile?.username ?? subject.username}
              </span>
              <span className="text-[11px] text-text-muted">
                {subject.rank >= 1 ? `Rank #${subject.rank}` : "Unranked"} ·{" "}
                {PERIOD_LABEL[period]}
              </span>
            </div>

            {loading && !profile ? (
              <p className="py-8 text-center text-sm text-text-muted">
                Loading…
              </p>
            ) : !profile ? (
              <p className="py-8 text-center text-sm text-text-muted">
                Couldn&rsquo;t load this profile.
              </p>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                {/* Headline pair: what they made, and how efficiently. */}
                <div className="mb-2 grid grid-cols-2 gap-2">
                  <Stat
                    label="PnL"
                    value={`${profile.pnl >= 0 ? "+" : "−"}${formatUsd(
                      Math.abs(profile.pnl)
                    )}`}
                    tone={profile.pnl >= 0 ? "up" : "down"}
                  />
                  <Stat
                    label="ROI"
                    value={`${profile.roi >= 0 ? "+" : "−"}${Math.abs(
                      profile.roi * 100
                    ).toFixed(1)}%`}
                    tone={profile.roi >= 0 ? "up" : "down"}
                  />
                </div>

                <div className="mb-4 grid grid-cols-3 gap-2">
                  <Stat label="Volume" value={formatUsd(profile.volume)} />
                  <Stat label="Trades" value={`${profile.trades}`} />
                  <Stat
                    label="Win rate"
                    value={`${(profile.winRate * 100).toFixed(0)}%`}
                  />
                  <Stat label="Wins" value={`${profile.wins}`} tone="up" />
                  <Stat label="Losses" value={`${profile.losses}`} tone="down" />
                  <Stat
                    label="Avg size"
                    value={
                      profile.trades > 0
                        ? formatUsd(profile.volume / profile.trades)
                        : "—"
                    }
                  />
                </div>

                <h4 className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">
                  Recent trades
                </h4>
                {shown.length === 0 ? (
                  <p className="py-4 text-center text-xs text-text-muted">
                    No trades in this period.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1">
                    {shown.map((t) => (
                      <TradeRow key={t.id} trade={t} />
                    ))}
                  </div>
                )}

                {trades.length > PREVIEW && (
                  <button
                    type="button"
                    onClick={() => setExpanded((e) => !e)}
                    className="mt-2 w-full rounded-xl bg-white/[0.05] py-2 text-xs font-medium text-text-muted transition-colors hover:text-text"
                  >
                    {expanded
                      ? "Show less"
                      : `Show more (${trades.length - PREVIEW})`}
                  </button>
                )}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

const PERIOD_LABEL: Record<LeaderboardPeriod, string> = {
  daily: "Today",
  weekly: "This week",
  monthly: "This month",
  all: "All time",
};

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  return (
    <div className="glass-inset rounded-xl p-2.5">
      <div className="text-[10px] text-text-muted">{label}</div>
      <div
        className={`tabular text-sm font-semibold ${
          tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-text"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/** One trade in the recent list. Read-only — another user's trade isn't
    shareable or replayable from here. */
function TradeRow({ trade }: { trade: CompletedTrade }) {
  const up = trade.direction === "long";
  const win = trade.pnl >= 0;
  return (
    <div className="glass-inset flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm">
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-md ${
          up ? "bg-up-soft text-up" : "bg-down-soft text-down"
        }`}
        aria-label={up ? "Long" : "Short"}
      >
        <HugeiconsIcon
          icon={up ? ArrowUpRight01Icon : ArrowDownRight01Icon}
          size={13}
        />
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-xs font-medium">{trade.symbol}</div>
        <div className="text-[10px] text-text-muted">{trade.leverage}×</div>
      </div>
      <div className="text-right leading-tight">
        <div
          className={`tabular text-xs font-semibold ${win ? "text-up" : "text-down"}`}
        >
          {win ? "+" : "−"}
          {formatUsd(Math.abs(trade.pnl))}
        </div>
        <div className={`text-[10px] ${win ? "text-up" : "text-down"}`}>
          {win ? "+" : "−"}
          {Math.abs(trade.roi * 100).toFixed(1)}%
        </div>
      </div>
    </div>
  );
}
