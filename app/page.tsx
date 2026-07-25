"use client";

import { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUp01Icon, ArrowDown01Icon } from "@hugeicons/core-free-icons";
import { useAppSelector } from "@/store/hooks";
import { CanvasChart } from "@/components/chart/CanvasChart";
import { DotGrid, type DotGridHandle } from "@/components/background/DotGrid";
import { MarketHeader } from "@/components/trade/MarketHeader";
import { BalancePill } from "@/components/trade/BalancePill";
import { PositionPanel } from "@/components/trade/PositionPanel";
import { MarketSwitcher } from "@/components/sheets/MarketSwitcher";
import { AccountSheet } from "@/components/sheets/AccountSheet";
import { useAgentWallet } from "@/hooks/useAgentWallet";
import { useBulkAccount } from "@/hooks/useBulkAccount";
import { useDemoPnl } from "@/hooks/useDemoPnl";
import { useTrade } from "@/hooks/useTrade";
import type { ChartFrame } from "@/lib/chart/engine";

// The homepage IS the trading screen. Demo and Live coexist; UP/DOWN and Close
// route through useTrade to the demo simulator or the live Bulk client by mode.
export default function TradePage() {
  const activeSymbol = useAppSelector((s) => s.market.active);

  // Wallet / account / demo lifecycle hooks.
  const agent = useAgentWallet();
  useBulkAccount(agent.masterAddress);
  useDemoPnl();
  const trade = useTrade(agent.signer);

  // Position-aware chart fill (green +PnL / red -PnL while in a trade).
  const fillMode: "none" | "up" | "down" =
    trade.position == null
      ? "none"
      : trade.position.unrealizedPnl >= 0
        ? "up"
        : "down";

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
          fillMode={fillMode}
          onFrame={handleFrame}
        />
      </div>

      {/* Top bar: market (left) + balance/mode (right) */}
      <header className="relative z-20 flex items-start justify-between px-3 pt-4">
        <MarketHeader symbol={activeSymbol} onOpen={() => setSwitcherOpen(true)} />
        <BalancePill onOpen={() => setAccountOpen(true)} />
      </header>

      <div className="relative z-20 flex-1" />

      {/* Trade controls: UP/DOWN when flat, PositionPanel when in a trade */}
      <footer className="relative z-20 px-4 pb-6">
        <AnimatePresence mode="wait">
          {trade.hasPosition && trade.position ? (
            <PositionPanel
              key="panel"
              position={trade.position}
              onClose={trade.close}
            />
          ) : (
            <motion.div
              key="buttons"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              className="grid grid-cols-2 gap-3"
            >
              <button
                type="button"
                onClick={trade.openLong}
                className="flex items-center justify-center gap-2 rounded-2xl bg-up-soft py-5 text-lg font-semibold text-up backdrop-blur-sm transition-transform duration-150 ease-snap active:scale-95"
              >
                <HugeiconsIcon icon={ArrowUp01Icon} size={22} />
                UP
              </button>
              <button
                type="button"
                onClick={trade.openShort}
                className="flex items-center justify-center gap-2 rounded-2xl bg-down-soft py-5 text-lg font-semibold text-down backdrop-blur-sm transition-transform duration-150 ease-snap active:scale-95"
              >
                <HugeiconsIcon icon={ArrowDown01Icon} size={22} />
                DOWN
              </button>
            </motion.div>
          )}
        </AnimatePresence>
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
