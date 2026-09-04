"use client";

import { useMemo } from "react";
import { useAppSelector } from "@/store/hooks";
import type { CompletedTrade } from "@/types";

/** Windows the P&L chart can be filtered to. */
export type PnlRange = "24h" | "7d" | "30d" | "all";

export const PNL_RANGES: { id: PnlRange; label: string }[] = [
  { id: "24h", label: "24H" },
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
  { id: "all", label: "All" },
];

const WINDOW_MS: Record<Exclude<PnlRange, "all">, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export interface PnlPoint {
  /** ms epoch. */
  t: number;
  /** Cumulative P&L at this instant, relative to the window's start. */
  v: number;
}

export interface PnlSeries {
  /** Cumulative curve across the window, oldest → newest. */
  points: PnlPoint[];
  /** Net P&L over the window (the curve's last value). */
  net: number;
  /** Net as a % of the balance the window opened at, or null if unknowable. */
  pct: number | null;
  /** How many realized trades fall inside the window. */
  tradeCount: number;
  /** True when there's nothing realized AND nothing floating to draw. */
  empty: boolean;
}

/**
 * Cumulative P&L over a time window, for the account sheet's chart.
 *
 * Built from the realized trade log plus the CURRENTLY floating unrealized P&L
 * as the final point — which is what makes the line move in real time, since
 * `totalPnl` is recomputed on every oracle tick.
 *
 * Only the current mode's trades count (demo and live are separate accounts),
 * and `add` rows are skipped: increasing a position's size realizes nothing, so
 * counting them would double-count P&L that the eventual close also reports.
 * This mirrors how `realizedToday` is derived in the account sheet.
 */
export function usePnlSeries(
  range: PnlRange,
  /** Live unrealized P&L across open positions — the curve's moving tip. */
  floatingPnl: number,
  /** Balance now, to express the window's net as a percentage. */
  currentBalance: number | null
): PnlSeries {
  const mode = useAppSelector((s) => s.tradingMode.mode);
  const trades = useAppSelector((s) => s.history.trades);

  // The window is recomputed per render rather than pinned, so "24h" keeps
  // meaning the last 24 hours while the sheet stays open.
  const now = Date.now();

  return useMemo(() => {
    const from = range === "all" ? 0 : now - WINDOW_MS[range];

    const realized: CompletedTrade[] = trades
      .filter(
        (t) => t.mode === mode && t.kind !== "add" && t.closedAt >= from
      )
      .sort((a, b) => a.closedAt - b.closedAt);

    // Start the curve at zero on the window's left edge, so the line shows P&L
    // EARNED IN THIS WINDOW rather than an all-time total that happens to be
    // clipped — otherwise "24h" and "All" would draw the same shape at
    // different offsets and the 24h number would read as lifetime P&L.
    const points: PnlPoint[] = [
      { t: realized.length ? Math.min(from || realized[0].closedAt, realized[0].closedAt) : from || now, v: 0 },
    ];

    let cum = 0;
    for (const t of realized) {
      cum += t.pnl;
      points.push({ t: t.closedAt, v: cum });
    }

    // The live tip: whatever is floating on open positions right now, stacked
    // on top of everything realized in the window. This point moves every tick.
    const net = cum + floatingPnl;
    points.push({ t: now, v: net });

    // Percentage against what the account was worth when the window opened.
    const openingBalance =
      currentBalance != null ? currentBalance - net : null;
    const pct =
      openingBalance != null && openingBalance > 0
        ? (net / openingBalance) * 100
        : null;

    return {
      points,
      net,
      pct,
      tradeCount: realized.length,
      empty: realized.length === 0 && floatingPnl === 0,
    };
    // `now` is intentionally part of the dependency list via floatingPnl's
    // cadence — it re-reads on each render the tick causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, mode, trades, floatingPnl, currentBalance]);
}
