"use client";

import { useMemo } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUpRight01Icon,
  ArrowDownRight01Icon,
  ArrowRight01Icon,
  PlayIcon,
} from "@hugeicons/core-free-icons";
import { useAppSelector } from "@/store/hooks";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatUsd } from "@/lib/format";
import { marginUsd, notionalUsd } from "@/lib/perp";
import { isReplayable } from "@/lib/replay/path";
import type { CompletedTrade, TradeEpisode } from "@/types";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";

interface Props {
  /** Open the details sheet for a completed trade (sharing lives there). */
  onOpenTrade: (trade: CompletedTrade) => void;
  /** Play the recorded price path for a trade (only for replayable rows). */
  onReplay: (trade: CompletedTrade, episode: TradeEpisode) => void;
}

// Trade history + derived stats, rendered inside the AccountSheet as a sub-view.
// Scoped to the active trading mode so demo (localStorage) and live (backend)
// trades never mix — demo money and real money keep separate logs + stats.
export function HistoryPanel({ onOpenTrade, onReplay }: Props) {
  const mode = useAppSelector((s) => s.tradingMode.mode);
  const allTrades = useAppSelector((s) => s.history.trades);
  const episodes = useAppSelector((s) => s.replay.byId);
  // Only LIVE history is fetched; demo rows come from localStorage and are
  // present on the first render, so demo never shows a loading state.
  const liveHydrated = useAppSelector((s) => s.history.liveHydrated);
  const historyLoading = mode === "live" && !liveHydrated;
  // Memoize so the filtered array keeps a stable identity between renders.
  const trades = useMemo(
    () => allTrades.filter((t) => t.mode === mode),
    [allTrades, mode]
  );
  const stats = useMemo(() => computeStats(trades), [trades]);

  return (
    <>
      <div className="mb-4 grid grid-cols-3 gap-2">
        <StatTile
          label="Lifetime PnL"
          value={`${stats.lifetimePnl >= 0 ? "+" : "−"}${formatUsd(
            Math.abs(stats.lifetimePnl)
          )}`}
          color={stats.lifetimePnl >= 0 ? "up" : "down"}
        />
        <StatTile label="Win rate" value={`${(stats.winRate * 100).toFixed(0)}%`} />
        <StatTile label="Trades" value={`${stats.total}`} />
        <StatTile label="Win streak" value={`${stats.currentStreak}`} />
        <StatTile label="Best streak" value={`${stats.longestStreak}`} />
        <StatTile label="Volume" value={formatUsd(stats.volume)} />
      </div>

      {historyLoading ? (
        // Rows in outline while the backend's history is in flight. The empty
        // state below is a CLAIM ("you have never traded") and must not be
        // shown to a user whose trades simply haven't arrived yet.
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[52px] rounded-xl" />
          ))}
        </div>
      ) : trades.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-muted">
          No trades yet. Tap UP or DOWN to start.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {trades.map((t) => {
            // A row is replayable only when its recording actually covers the
            // trade — see isReplayable(). Age is irrelevant; coverage is not.
            const episode = t.episodeId ? episodes[t.episodeId] : undefined;
            const canReplay = isReplayable(episode);
            return (
              <TradeRow
                key={t.id}
                trade={t}
                onOpenDetails={() => onOpenTrade(t)}
                onReplay={
                  canReplay && episode ? () => onReplay(t, episode) : undefined
                }
              />
            );
          })}
        </div>
      )}
    </>
  );
}

function TradeRow({
  trade,
  onOpenDetails,
  onReplay,
}: {
  trade: CompletedTrade;
  onOpenDetails: () => void;
  /** Absent when there's no usable recording — the row then isn't tappable. */
  onReplay?: () => void;
}) {
  const kind = trade.kind ?? "close";
  const isAdd = kind === "add"; // informational — no realized PnL
  const win = trade.pnl >= 0;
  const up = trade.direction === "long";
  const kindLabel = { close: "Close", add: "Add", reduce: "Reduce" }[kind];
  return (
    <div
      className={`glass-inset flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm ${
        onReplay
          ? "cursor-pointer transition-colors hover:bg-white/[0.06]"
          : ""
      }`}
      onClick={
        onReplay
          ? () => {
              playSound("tap");
              haptic("tap");
              onReplay();
            }
          : undefined
      }
      role={onReplay ? "button" : undefined}
      tabIndex={onReplay ? 0 : undefined}
      onKeyDown={
        onReplay
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onReplay();
              }
            }
          : undefined
      }
      aria-label={onReplay ? `Replay ${trade.symbol} trade` : undefined}
    >
      {/* Direction as an up/down arrow chip (green/red), not long/short. */}
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-md ${
          up ? "bg-up-soft text-up" : "bg-down-soft text-down"
        }`}
        aria-label={up ? "Up" : "Down"}
      >
        <HugeiconsIcon
          icon={up ? ArrowUpRight01Icon : ArrowDownRight01Icon}
          size={16}
        />
      </span>
      <div className="flex-1 leading-tight">
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{trade.symbol}</span>
          {onReplay && (
            <HugeiconsIcon
              icon={PlayIcon}
              size={11}
              className="text-text-muted"
              aria-hidden
            />
          )}
          {/* Event tag so add/reduce/close are distinguishable in the list. */}
          {kind !== "close" && (
            <span className="rounded bg-white/10 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-text-muted">
              {kindLabel}
            </span>
          )}
          {/* Bulk liquidated some or all of it — the PnL alone doesn't say why. */}
          {trade.liquidated && (
            <span className="rounded bg-down-soft px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-down">
              Liq
            </span>
          )}
        </div>
        <div className="truncate text-[11px] text-text-muted">
          {trade.leverage}× · {fmtDuration(trade.durationMs)}
          {costsLabel(trade)}
        </div>
      </div>
      <div className="text-right leading-tight">
        {isAdd ? (
          // An add has no realized PnL — show the margin moved, muted.
          <div className="tabular font-semibold text-text-muted">
            +{formatUsd(marginUsd(trade.size, trade.entryPrice, trade.leverage))}
          </div>
        ) : (
          <>
            <div
              className={`tabular font-semibold ${win ? "text-up" : "text-down"}`}
            >
              {win ? "+" : "−"}
              {formatUsd(Math.abs(trade.pnl))}
            </div>
            <div className={`text-[11px] ${win ? "text-up" : "text-down"}`}>
              {win ? "+" : "−"}
              {Math.abs(trade.roi * 100).toFixed(1)}%
            </div>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          playSound("tap");
          haptic("tap");
          onOpenDetails();
        }}
        className="rounded-full p-1.5 text-text-muted transition-colors hover:bg-white/10 hover:text-text"
        aria-label={`${trade.symbol} trade details`}
      >
        <HugeiconsIcon icon={ArrowRight01Icon} size={16} />
      </button>
    </div>
  );
}

function StatTile({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: "up" | "down";
}) {
  return (
    <div className="glass-inset rounded-2xl p-3">
      <div className="text-[10px] text-text-muted">{label}</div>
      <div
        className={`tabular text-sm font-semibold ${
          color === "up" ? "text-up" : color === "down" ? "text-down" : "text-text"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Fees and funding, when the row carries them (rows rebuilt from Bulk fills).
 * Shown BESIDE the PnL, not taken out of it: the headline PnL is price PnL
 * before costs, the same number the leaderboard ranks on.
 */
function costsLabel(trade: CompletedTrade): string {
  const parts: string[] = [];
  if (trade.fees != null && Math.abs(trade.fees) >= 0.005) {
    // A cashflow: negative = paid. A net maker rebate reads as a credit.
    parts.push(
      trade.fees < 0
        ? `fees ${formatUsd(-trade.fees)}`
        : `rebate ${formatUsd(trade.fees)}`
    );
  }
  if (trade.funding != null && Math.abs(trade.funding) >= 0.005) {
    parts.push(
      `funding ${trade.funding >= 0 ? "+" : "−"}${formatUsd(Math.abs(trade.funding))}`
    );
  }
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = m / 60;
  // Rebuilt Bulk history can include positions held for days.
  if (h < 48) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

interface Stats {
  total: number;
  winRate: number;
  currentStreak: number;
  longestStreak: number;
  volume: number;
  lifetimePnl: number;
}

function computeStats(allTrades: CompletedTrade[]): Stats {
  // Stats only count events that realize PnL — full closes and partial reduces.
  // `add` rows have no realized PnL and would drag win-rate / inflate counts.
  const trades = allTrades.filter((t) => (t.kind ?? "close") !== "add");
  if (trades.length === 0)
    return {
      total: 0,
      winRate: 0,
      currentStreak: 0,
      longestStreak: 0,
      volume: 0,
      lifetimePnl: 0,
    };
  let wins = 0;
  let lifetimePnl = 0;
  let volume = 0;
  let longest = 0;
  let streak = 0;
  for (const t of [...trades].reverse()) {
    if (t.pnl > 0) {
      wins++;
      streak++;
      if (streak > longest) longest = streak;
    } else {
      streak = 0;
    }
    lifetimePnl += t.pnl;
    // Convert to USD at THIS row's entry price before adding. `size` is base
    // asset, so summing it raw added BTC to SOL to ETH — a number that was not
    // dollars and not even one unit, and which under-reported BTC rows by ~5
    // orders of magnitude while SOL rows dominated the total.
    volume += notionalUsd(t.size, t.entryPrice);
  }
  return {
    total: trades.length,
    winRate: wins / trades.length,
    currentStreak: streak,
    longestStreak: longest,
    volume,
    lifetimePnl,
  };
}
