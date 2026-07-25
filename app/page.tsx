"use client";

import { useCallback, useRef, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { CanvasChart } from "@/components/chart/CanvasChart";
import { DotGrid, type DotGridHandle } from "@/components/background/DotGrid";
import { MarketHeader } from "@/components/trade/MarketHeader";
import { BalancePill } from "@/components/trade/BalancePill";
import { TradeControls } from "@/components/trade/TradeControls";
import { MarketSwitcher } from "@/components/sheets/MarketSwitcher";
import { AccountSheet } from "@/components/sheets/AccountSheet";
import { useAgentWallet } from "@/hooks/useAgentWallet";
import { useBulkAccount } from "@/hooks/useBulkAccount";
import { useDemoPnl } from "@/hooks/useDemoPnl";
import { useTrade } from "@/hooks/useTrade";
import type { ChartFrame, PositionOverlay } from "@/lib/chart/engine";

// The homepage IS the trading screen. Demo and Live coexist; UP/DOWN and Close
// route through useTrade to the demo simulator or the live Bulk client by mode.
export default function TradePage() {
  const activeSymbol = useAppSelector((s) => s.market.active);

  // Wallet / account / demo lifecycle hooks.
  const agent = useAgentWallet();
  useBulkAccount(agent.masterAddress);
  useDemoPnl();
  const trade = useTrade(agent.signer);

  // Position overlay for the chart (entry/liq lines + PnL fill), or null when flat.
  const chartPosition: PositionOverlay | null = trade.position
    ? {
        entryPrice: trade.position.entryPrice,
        liquidationPrice: trade.position.liquidationPrice,
        pnl: trade.position.unrealizedPnl,
      }
    : null;

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  const gridRef = useRef<DotGridHandle | null>(null);
  const handleFrame = useCallback((f: ChartFrame) => {
    gridRef.current?.react(f);
  }, []);

  return (
    <main className="relative flex h-dvh w-full flex-col overflow-hidden">
      {/* Background dot grid */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <DotGrid ref={gridRef} />
      </div>

      {/* Live chart */}
      <div className="absolute inset-0 z-10">
        <CanvasChart
          symbol={activeSymbol}
          position={chartPosition}
          onFrame={handleFrame}
        />
      </div>

      {/* Top bar: market (left) + balance/mode (right) */}
      <header className="relative z-20 flex items-start justify-between px-3 pt-4">
        <MarketHeader symbol={activeSymbol} onOpen={() => setSwitcherOpen(true)} />
        <BalancePill onOpen={() => setAccountOpen(true)} />
      </header>

      <div className="relative z-20 flex-1" />

      {/* Trade controls: UP/DOWN when flat, detail strip + Increase/Decrease in a trade */}
      <footer className="relative z-20 px-4 pb-6">
        <TradeControls
          position={trade.position}
          onLong={trade.openLong}
          onShort={trade.openShort}
          onIncrease={trade.increase}
          onDecrease={trade.decrease}
        />
      </footer>

      {/* Sheets */}
      <MarketSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} />
      <AccountSheet
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        agent={agent}
      />
    </main>
  );
}
