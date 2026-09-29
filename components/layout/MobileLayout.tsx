"use client";

import { useCallback, useRef, useState } from "react";
import { CanvasChart } from "@/components/chart/CanvasChart";
import { ChartToolbar } from "@/components/chart/ChartToolbar";
import { ChartRecenterButton } from "@/components/chart/ChartRecenterButton";
import { useAppSelector } from "@/store/hooks";
import { DotGrid, type DotGridHandle } from "@/components/background/DotGrid";
import {
  ReactionLayer,
  type ReactionLayerHandle,
} from "@/components/chart/ReactionLayer";
import { MusicToggle } from "@/components/trade/MusicToggle";
import { MarketHeader } from "@/components/trade/MarketHeader";
import { BalancePill } from "@/components/trade/BalancePill";
import { TradeControls } from "@/components/trade/TradeControls";
import { PositionDock } from "@/components/trade/PositionDock";
import { MarketSettingsSheet } from "@/components/sheets/MarketSettingsSheet";
import { PositionsSheet } from "@/components/sheets/PositionsSheet";
import {
  AdjustPositionSheet,
  type AdjustMode,
} from "@/components/sheets/AdjustPositionSheet";
import { TpSlSheet } from "@/components/sheets/TpSlSheet";
import type { LivePosition } from "@/hooks/useAllPositions";
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
  const reactionsRef = useRef<ReactionLayerHandle | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [positionsOpen, setPositionsOpen] = useState(false);
  // The position being adjusted. Held here rather than in the positions sheet
  // because the adjust sheet REPLACES it — stacking two sheets would leave the
  // list scrolled behind a second overlay with two grabbers to dismiss.
  const [adjust, setAdjust] = useState<{
    symbol: MarketSymbol;
    mode: AdjustMode;
  } | null>(null);
  // Which position's TP/SL is being edited.
  const [tpsl, setTpsl] = useState<MarketSymbol | null>(null);
  const handleFrame = useCallback((f: ChartFrame) => {
    gridRef.current?.react(f);
    reactionsRef.current?.track(f);
  }, []);
  const chartView = useAppSelector((s) => s.settings.chartView);
  const chartInterval = useAppSelector((s) => s.settings.chartInterval);

  const openAdjust = useCallback((item: LivePosition, mode: AdjustMode) => {
    setPositionsOpen(false);
    setAdjust({ symbol: item.position.symbol, mode });
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
          view={chartView}
          interval={chartInterval}
        />
      </div>
      {/* Momentum callouts + surge glow, riding the line's tip. Above the
          chart, below the header and controls, never hit-testable. */}
      <div className="pointer-events-none absolute inset-0 z-[15]">
        <ReactionLayer ref={reactionsRef} />
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
        {/* Chart interval + chart type. Sits just above the trade buttons at
            their left, which is still the chart's bottom-left — the chart runs
            full-screen underneath the footer. */}
        <div className="mb-3 flex items-center justify-between">
          {/* Music sits with the chart controls rather than in the header:
              beside the balance pill it would overflow a 375px-wide phone
              once BTC's price fills the market pill. Here it is also
              thumb-reachable. */}
          <div className="flex items-center gap-2">
            <ChartToolbar />
            <MusicToggle />
          </div>
          {/* Re-center (candles only, once moved): the chart's bottom-right,
              mirroring the toolbar above the DOWN button. */}
          <ChartRecenterButton />
        </div>
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

      {/* Two distinct entry points, deliberately kept apart: the dock opens
          the ORDER SETTINGS (size / leverage / trailing), while the "View
          positions" pill opens the positions list on its own. */}
      <MarketSettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        symbol={symbol}
        leverage={leverage}
      />

      <PositionsSheet
        open={positionsOpen}
        onClose={() => setPositionsOpen(false)}
        onShare={onShare}
        onCloseAll={trade.closeAll}
        onAdjust={openAdjust}
        onClosePosition={(item) => trade.closePosition(item.position.symbol)}
        onEditTpSl={(item) => setTpsl(item.position.symbol)}
      />

      {/* Add / reduce for ONE position. Only the symbol is kept in state — the
          sheet re-reads the live row itself, so its PnL and mark price keep
          ticking while it is open. */}
      <AdjustPositionSheet
        open={adjust != null}
        onClose={() => setAdjust(null)}
        symbol={adjust?.symbol ?? null}
        mode={adjust?.mode ?? "add"}
        onSubmit={(usd, sym) =>
          adjust?.mode === "add"
            ? trade.increase(usd, sym)
            : trade.decrease(usd, sym)
        }
      />

      {/* Take-profit / stop-loss for ONE position. Like the adjust sheet, only
          the symbol is held here so the levels re-derive against a live mark. */}
      <TpSlSheet
        open={tpsl != null}
        onClose={() => setTpsl(null)}
        symbol={tpsl}
        onSubmit={trade.setTpSl}
      />
    </main>
  );
}
