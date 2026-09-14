"use client";

import { useCallback, useRef, useState } from "react";
import { CanvasChart } from "@/components/chart/CanvasChart";
import { DotGrid, type DotGridHandle } from "@/components/background/DotGrid";
import { MarketHeader } from "@/components/trade/MarketHeader";
import { BalancePill } from "@/components/trade/BalancePill";
import { TradeControls } from "@/components/trade/TradeControls";
import { PositionDock } from "@/components/trade/PositionDock";
import { MarketSettingsSheet } from "@/components/sheets/MarketSettingsSheet";
import type { ChartFrame, PositionOverlay } from "@/lib/chart/engine";
import type { MarketSymbol } from "@/types";
import type { useTrade } from "@/hooks/useTrade";
import type { useLeverage } from "@/hooks/useLeverage";
import type { ShareSubject } from "@/components/share/ShareCardModal";

interface Props {
  symbol: MarketSymbol;
  chartPosition: PositionOverlay | null;
  trade: ReturnType<typeof useTrade>;
  leverage: ReturnType<typeof useLeverage>;
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
  leverage,
  onOpenMarket,
  onOpenAccount,
  onShare,
}: Props) {
  const gridRef = useRef<DotGridHandle | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
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

      {/* Market dock — docked to the chart's left-center. ALWAYS shown: it
          reads out the size / leverage / trailing the next order will use, so
          it is just as relevant on a flat account. Tapping opens the market
          settings sheet. */}
      <PositionDock symbol={symbol} onOpen={() => setSettingsOpen(true)} />

      {/* pt clears the status bar / notch. Needs `viewportFit: "cover"` in the
          root viewport export for the inset to be non-zero — in an installed
          PWA the page runs full-screen, so without this the status bar sits on
          top of the market and balance pills. */}
      <header className="relative z-20 flex items-start justify-between px-3 pt-[calc(env(safe-area-inset-top)+16px)]">
        <MarketHeader symbol={symbol} onOpen={onOpenMarket} />
        <BalancePill onOpen={onOpenAccount} />
      </header>

      <div className="pointer-events-none relative z-20 flex-1" />

      {/* The home-indicator inset lives HERE rather than on <body>: body
          padding moved every fixed-position sheet up off the bottom of the
          screen, leaving a black strip under them. So the footer carries its
          own safe area.

          In an installed PWA the inset is already ~34px of clearance on its own,
          so stacking a further 12px on top left a visibly tall empty band under
          the UP/DOWN buttons. The PWA case therefore gets the inset and nothing
          else — `max()` picks the inset when it is the larger value — while a
          browser (inset 0) still gets a flat 12px so the buttons don't sit flush
          against the bottom edge of the window. */}
      <footer className="relative z-20 px-4">
        <TradeControls
          position={trade.position}
          trailActive={trade.trailActive}
          trailEligible={trade.trailEligible}
          trailPct={trade.trailPct}
          onLong={trade.openLong}
          onShort={trade.openShort}
          onToggleTrail={trade.toggleTrail}
          onClose={trade.close}
          onViewPositions={() => setSettingsOpen(true)}
        />
      </footer>

      <MarketSettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        symbol={symbol}
        leverage={leverage}
        onShare={onShare}
        onCloseAll={trade.closeAll}
      />
    </main>
  );
}
