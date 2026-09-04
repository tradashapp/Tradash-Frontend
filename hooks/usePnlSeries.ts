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

/**
 * How each window names itself in the balance card ("Today's P&L", "7D P&L").
 * The pills live in the chart but re-label the row above it, so the two read as
 * one control rather than two competing P&L figures.
 */
export const PNL_RANGE_TITLES: Record<PnlRange, string> = {
  "24h": "Today’s P&L",
  "7d": "7D P&L",
  "30d": "30D P&L",
  all: "All-time P&L",
};

const WINDOW_MS: Record<Exclude<PnlRange, "all">, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/**
 * The instant a window opens. Exported so the balance card's realized sum and
 * the chart's series are cut at exactly the same boundary — two definitions of
 * "the last 7 days" would put a different number beside the curve than on it.
 */
export function pnlRangeStart(range: PnlRange, now = Date.now()): number {
  return range === "all" ? 0 : now - WINDOW_MS[range];
}

/**
 * How many points the curve is resampled to. The raw trade log is clustered —
 * a burst of closes inside one minute, then hours of nothing — which draws as
 * spikes joined by flat runs. Resampling onto an even time grid and smoothing
 * across it turns that into a continuous wave, which is what an equity curve
 * actually looks like at this zoom level.
 */
const SAMPLES = 64;

/**
 * Half-width of the smoothing window, in samples. Wide enough to round every
 * trade-to-trade step into a curve, narrow enough that the shape still tracks
 * where the P&L actually went.
 */
const SMOOTH_RADIUS = 4;

export interface PnlPoint {
  /** ms epoch. */
  t: number;
  /** Cumulative P&L at this instant, relative to the window's start. */
  v: number;
  /** Account total balance at this instant — what the scrub tooltip reports. */
  balance: number | null;
}

export interface PnlSeries {
  /** Smoothed, evenly-spaced curve across the window, oldest → newest. */
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
 * Moving-average smoothing over the resampled values.
 *
 * Applied to the RESAMPLED grid, not the raw trades: on an even grid every
 * sample carries the same amount of time, so the average can't be skewed by a
 * cluster of trades that happen to sit close together. The window shrinks at
 * the ends so the first and last samples stay exactly where the data puts them
 * — the tip must remain the true current P&L, not an average that drifts off it.
 */
function smooth(values: number[]): number[] {
  const n = values.length;
  if (n < 3) return values;
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    // Symmetric window, clipped to whichever edge is nearer — an asymmetric
    // window would shift the curve sideways relative to its timestamps.
    const r = Math.min(SMOOTH_RADIUS, i, n - 1 - i);
    let sum = 0;
    for (let k = i - r; k <= i + r; k++) sum += values[k];
    out[i] = sum / (2 * r + 1);
  }
  return out;
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
    const from = pnlRangeStart(range, now);

    const realized: CompletedTrade[] = trades
      .filter((t) => t.mode === mode && t.kind !== "add" && t.closedAt >= from)
      .sort((a, b) => a.closedAt - b.closedAt);

    // Start the curve at zero on the window's left edge, so the line shows P&L
    // EARNED IN THIS WINDOW rather than an all-time total that happens to be
    // clipped — otherwise "24h" and "All" would draw the same shape at
    // different offsets and the 24h number would read as lifetime P&L.
    const startT = realized.length
      ? Math.min(from || realized[0].closedAt, realized[0].closedAt)
      : from || now;

    // The raw step function: cumulative P&L at each realized close.
    const steps: { t: number; v: number }[] = [{ t: startT, v: 0 }];
    let cum = 0;
    for (const t of realized) {
      cum += t.pnl;
      steps.push({ t: t.closedAt, v: cum });
    }

    // The live tip: whatever is floating on open positions right now, stacked
    // on top of everything realized in the window. This point moves every tick.
    const net = cum + floatingPnl;
    steps.push({ t: now, v: net });

    // Percentage against what the account was worth when the window opened.
    const openingBalance = currentBalance != null ? currentBalance - net : null;
    const pct =
      openingBalance != null && openingBalance > 0
        ? (net / openingBalance) * 100
        : null;

    // Resample the step function onto an even time grid. A degenerate span
    // (every point at the same instant) has no time axis to sample, so the raw
    // steps are used as-is and spread by index at draw time.
    const span = now - startT;
    let grid: { t: number; v: number }[];
    if (span <= 0) {
      grid = steps;
    } else {
      grid = [];
      let cursor = 0;
      for (let i = 0; i < SAMPLES; i++) {
        const t = startT + (span * i) / (SAMPLES - 1);
        // Advance to the last step at or before `t` — the value in force then.
        while (cursor + 1 < steps.length && steps[cursor + 1].t <= t) cursor++;
        grid.push({ t, v: steps[cursor].v });
      }
      // Pin the tip to the true current value; the sampling loop can otherwise
      // land the last sample on the step before it.
      grid[grid.length - 1] = { t: now, v: net };
    }

    const smoothed = smooth(grid.map((g) => g.v));
    // Balance at a point in the past = balance now, minus everything earned
    // between then and now. Unknown while the balance itself is unknown.
    const points: PnlPoint[] = grid.map((g, i) => ({
      t: g.t,
      v: smoothed[i],
      balance: currentBalance != null ? currentBalance - (net - smoothed[i]) : null,
    }));

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
