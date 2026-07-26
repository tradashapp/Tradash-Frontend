"use client";

import { useAppSelector } from "@/store/hooks";
import { formatUsd } from "@/lib/format";
import type { CompletedTrade } from "@/types";

// Trade history + derived stats, rendered inside the AccountSheet as a sub-view.
export function HistoryPanel() {
  const trades = useAppSelector((s) => s.history.trades);
  const stats = computeStats(trades);

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

      {trades.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-muted">
          No trades yet. Tap UP or DOWN to start.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {trades.map((t) => (
            <TradeRow key={t.id} trade={t} />
          ))}
        </div>
      )}
    </>
  );
}

function TradeRow({ trade }: { trade: CompletedTrade }) {
  const win = trade.pnl >= 0;
  return (
    <div className="glass-inset flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm">
      <span
        className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
          trade.direction === "long" ? "bg-up-soft text-up" : "bg-down-soft text-down"
        }`}
      >
        {trade.direction === "long" ? "LONG" : "SHORT"}
      </span>
      <div className="flex-1 leading-tight">
        <div className="font-medium">{trade.symbol}</div>
        <div className="text-[11px] text-text-muted">
          {trade.leverage}× · {fmtDuration(trade.durationMs)}
        </div>
      </div>
      <div className="text-right leading-tight">
        <div className={`tabular font-semibold ${win ? "text-up" : "text-down"}`}>
          {win ? "+" : "−"}
          {formatUsd(Math.abs(trade.pnl))}
        </div>
        <div className={`text-[11px] ${win ? "text-up" : "text-down"}`}>
          {win ? "+" : "−"}
          {Math.abs(trade.roi * 100).toFixed(1)}%
        </div>
      </div>
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

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${(m / 60).toFixed(1)}h`;
}

interface Stats {
  total: number;
  winRate: number;
  currentStreak: number;
  longestStreak: number;
  volume: number;
  lifetimePnl: number;
}

function computeStats(trades: CompletedTrade[]): Stats {
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
    volume += t.size;
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
