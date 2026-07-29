"use client";

import { useCallback, useRef, useState } from "react";
import { CanvasChart } from "@/components/chart/CanvasChart";
import { DotGrid, type DotGridHandle } from "@/components/background/DotGrid";
import { MarketHeader } from "@/components/trade/MarketHeader";
import { BalancePill } from "@/components/trade/BalancePill";
import { TradeControls } from "@/components/trade/TradeControls";
import { PositionDock } from "@/components/trade/PositionDock";
import { PositionsSheet } from "@/components/sheets/PositionsSheet";
import type { ChartFrame, PositionOverlay } from "@/lib/chart/engine";
import type { MarketSymbol } from "@/types";
import type { useTrade } from "@/hooks/useTrade";
import type { ShareSubject } from "@/components/share/ShareCardModal";

interface Props {
  symbol: MarketSymbol;
  chartPosition: PositionOverlay | null;
  trade: ReturnType<typeof useTrade>;
  onOpenMarket: () => void;
  onOpenAccount: () => void;
  onShare: (subject: ShareSubject) => void;
}

// Mobile: full-screen chart with the market header + balance pill floating on
// top, and the trade controls docked at the bottom.
export function MobileLayout({
  symbol,
  chartPosition,
  trade,
  onOpenMarket,
  onOpenAccount,
  onShare,
}: Props) {
  const gridRef = useRef<DotGridHandle | null>(null);
  const [positionsOpen, setPositionsOpen] = useState(false);
  const handleFrame = useCallback((f: ChartFrame) => {
    gridRef.current?.react(f);
  }, []);

  return (
    <main className="relative flex h-dvh w-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 z-0">
        <DotGrid ref={gridRef} />
      </div>
      <div className="absolute inset-0 z-10">
        <CanvasChart
          symbol={symbol}
          position={chartPosition}
          onFrame={handleFrame}
        />
      </div>

      {/* Position dock — docked to the chart's left-center. Shown while a
          position is open (add more size / reduce it). */}
      {trade.position && <PositionDock trade={trade} />}

      <header className="relative z-20 flex items-start justify-between px-3 pt-4">
        <MarketHeader symbol={symbol} onOpen={onOpenMarket} />
        <BalancePill onOpen={onOpenAccount} />
      </header>

      <div className="relative z-20 flex-1" />

      <footer className="relative z-20 px-4 pb-6">
        <TradeControls
          position={trade.position}
          trailActive={trade.trailActive}
          trailEligible={trade.trailEligible}
          trailPct={trade.trailPct}
          onLong={trade.openLong}
          onShort={trade.openShort}
          onToggleTrail={trade.toggleTrail}
          onClose={trade.close}
          onViewPositions={() => setPositionsOpen(true)}
        />
      </footer>

      <PositionsSheet
        open={positionsOpen}
        onClose={() => setPositionsOpen(false)}
        onShare={onShare}
      />
    </main>
  );
}
