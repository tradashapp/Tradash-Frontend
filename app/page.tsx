"use client";

import { useCallback, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUp01Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { useAppSelector } from "@/store/hooks";
import { CanvasChart } from "@/components/chart/CanvasChart";
import { DotGrid, type DotGridHandle } from "@/components/background/DotGrid";
import { MarketHeader } from "@/components/trade/MarketHeader";
import { MarketSwitcher } from "@/components/sheets/MarketSwitcher";
import type { ChartFrame } from "@/lib/chart/engine";

// The homepage IS the trading screen. Phase 1: live chart + price-reactive dot
// grid + top-left market header (clickable → asset switcher). Trade buttons
// wired in Phase 3.
export default function TradePage() {
  const activeSymbol = useAppSelector((s) => s.market.active);
  const position = useAppSelector((s) => s.position.current);

  // Fill only appears while in a position: green for +PnL, red for -PnL.
  const fillMode: "none" | "up" | "down" =
    position == null ? "none" : position.unrealizedPnl >= 0 ? "up" : "down";

  const [switcherOpen, setSwitcherOpen] = useState(false);

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

      {/* Top-left market identity — logo + live price + name, opens switcher */}
      <header className="relative z-20 flex items-start px-3 pt-4">
        <MarketHeader symbol={activeSymbol} onOpen={() => setSwitcherOpen(true)} />
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

      {/* Asset switcher bottom sheet */}
      <MarketSwitcher
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
      />
    </main>
  );
}
