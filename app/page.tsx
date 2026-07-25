"use client";

import { useCallback, useRef } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUp01Icon,
  ArrowDown01Icon,
  Analytics01Icon,
} from "@hugeicons/core-free-icons";
import { useAppSelector } from "@/store/hooks";
import { MARKETS } from "@/lib/markets";
import { CanvasChart } from "@/components/chart/CanvasChart";
import { DotGrid, type DotGridHandle } from "@/components/background/DotGrid";
import type { ChartFrame } from "@/lib/chart/engine";

// The homepage IS the trading screen. Phase 1: live chart + price-reactive dot
// grid + live header. Trade buttons wired in Phase 3.
export default function TradePage() {
  const activeSymbol = useAppSelector((s) => s.market.active);
  const price = useAppSelector((s) => s.price.prices[activeSymbol]);
  const position = useAppSelector((s) => s.position.current);
  const market = MARKETS[activeSymbol];

  // Fill only appears while in a position: green for +PnL, red for -PnL.
  const fillMode: "none" | "up" | "down" =
    position == null ? "none" : position.unrealizedPnl >= 0 ? "up" : "down";

  const gridRef = useRef<DotGridHandle | null>(null);
  // Chart pushes each frame here; forward it to the dot grid imperatively.
  const handleFrame = useCallback((f: ChartFrame) => {
    gridRef.current?.react(f);
  }, []);

  return (
    <main className="relative flex h-dvh w-full flex-col overflow-hidden">
      {/* Background dot grid */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <DotGrid ref={gridRef} />
      </div>

      {/* Live chart, filling the viewport behind the UI */}
      <div className="absolute inset-0 z-10">
        <CanvasChart
          symbol={activeSymbol}
          fillMode={fillMode}
          onFrame={handleFrame}
        />
      </div>

      {/* Header: market + live price */}
      <header className="relative z-20 flex items-center justify-between px-5 pt-5">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={Analytics01Icon} size={20} className="text-up" />
          <span className="text-sm font-medium text-text-muted">
            {market.label}
          </span>
        </div>
        <div className="tabular text-right">
          <div className="text-2xl font-semibold">
            {price != null
              ? `$${price.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}`
              : "—"}
          </div>
          <div className="text-xs text-text-muted">{market.bulkSymbol}</div>
        </div>
      </header>

      {/* Spacer pushes buttons to the bottom without covering the chart */}
      <div className="relative z-20 flex-1" />

      {/* Trade buttons — wired in Phase 3 */}
      <footer className="relative z-20 grid grid-cols-2 gap-3 px-5 pb-6">
        <button
          type="button"
          disabled
          className="flex items-center justify-center gap-2 rounded-2xl bg-up-soft py-5 text-lg font-semibold text-up backdrop-blur-sm transition-transform duration-150 ease-snap active:scale-95 disabled:opacity-60"
        >
          <HugeiconsIcon icon={ArrowUp01Icon} size={22} />
          UP
        </button>
        <button
          type="button"
          disabled
          className="flex items-center justify-center gap-2 rounded-2xl bg-down-soft py-5 text-lg font-semibold text-down backdrop-blur-sm transition-transform duration-150 ease-snap active:scale-95 disabled:opacity-60"
        >
          <HugeiconsIcon icon={ArrowDown01Icon} size={22} />
          DOWN
        </button>
      </footer>
    </main>
  );
}
