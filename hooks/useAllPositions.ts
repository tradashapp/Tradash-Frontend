"use client";

import { useMemo } from "react";
import { useAppSelector } from "@/store/hooks";
import { displayPnlFor, roi } from "@/lib/perp";
import { MARKET_ORDER } from "@/lib/markets";
import type { MarketSymbol, Position } from "@/types";

// A single open position enriched with its live display PnL, ROI and the current
// (mark) price of its market — so the UI can render every market's position, not
// just the active one.
export interface LivePosition {
  position: Position;
  /** Display PnL at the current oracle price (mode-aware, smooth). */
  pnl: number;
  /** ROI on margin as a percentage. */
  roiPct: number;
  /** Current mark price for this market (undefined until the feed ticks). */
  markPrice: number | undefined;
}

export interface AllPositions {
  /** Every open position (across all markets), ordered by market. */
  items: LivePosition[];
  /** Aggregated unrealized PnL across all open positions. */
  totalPnl: number;
  /** Aggregated margin at risk across all open positions. */
  totalMargin: number;
  /** Aggregated ROI on total margin as a percentage. */
  totalRoiPct: number;
}

// Aggregates ALL open positions for the current mode (live or demo) across every
// market, each with its own live PnL/ROI. Powers the "all markets" positions
// panel and the summed Unrealized PnL card. useAllPrices already streams every
// market's price into the price slice, so background markets stay accurate.
export function useAllPositions(): AllPositions {
  const mode = useAppSelector((s) => s.tradingMode.mode);
  const livePositions = useAppSelector((s) => s.position.bySymbol);
  const demoPositions = useAppSelector((s) => s.tradingMode.demo.positions);
  const prices = useAppSelector((s) => s.price.prices);

  const source = mode === "demo" ? demoPositions : livePositions;

  return useMemo(() => {
    const items: LivePosition[] = [];
    let totalPnl = 0;
    let totalMargin = 0;

    for (const sym of MARKET_ORDER as MarketSymbol[]) {
      const raw = source[sym];
      if (!raw) continue;
      const markPrice = prices[sym];
      const pnl = displayPnlFor(mode, raw, markPrice);
      const roiPct = roi(pnl, raw.marginUsed) * 100;
      items.push({
        position: { ...raw, unrealizedPnl: pnl },
        pnl,
        roiPct,
        markPrice,
      });
      totalPnl += pnl;
      totalMargin += raw.marginUsed;
    }

    return {
      items,
      totalPnl,
      totalMargin,
      totalRoiPct: totalMargin > 0 ? (totalPnl / totalMargin) * 100 : 0,
    };
  }, [mode, source, prices]);
}
