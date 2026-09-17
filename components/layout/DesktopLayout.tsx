"use client";

import { useCallback, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ChartLineData01Icon,
  Settings02Icon,
  Clock01Icon,
  Analytics01Icon,
} from "@hugeicons/core-free-icons";
import { CanvasChart } from "@/components/chart/CanvasChart";
import { DotGrid, type DotGridHandle } from "@/components/background/DotGrid";
import { MarketHeader } from "@/components/trade/MarketHeader";
import { BalancePill } from "@/components/trade/BalancePill";
import { TradeControls } from "@/components/trade/TradeControls";
import { PositionDock } from "@/components/trade/PositionDock";
import { PositionsPanel } from "@/components/trade/PositionsPanel";
import { TpSlSheet } from "@/components/sheets/TpSlSheet";
import { MarketSettingsSheet } from "@/components/sheets/MarketSettingsSheet";
import {
  AdjustPositionSheet,
  type AdjustMode,
} from "@/components/sheets/AdjustPositionSheet";
import type { LivePosition } from "@/hooks/useAllPositions";
import type { ChartFrame, PositionOverlay } from "@/lib/chart/engine";
import type { MarketSymbol } from "@/types";
import type { useTrade } from "@/hooks/useTrade";
import type { useLeverage } from "@/hooks/useLeverage";
import type { ShareSubject } from "@/components/share/ShareCardModal";
import Image from "next/image";

interface Props {
  symbol: MarketSymbol;
  chartPosition: PositionOverlay | null;
  trade: ReturnType<typeof useTrade>;
  leverage: ReturnType<typeof useLeverage>;
  onOpenMarket: () => void;
  onOpenAccount: () => void;
  onShare: (subject: ShareSubject) => void;
}

// Desktop: sidebar (nav) · chart ~70% · right panel (balance + position + controls).
export function DesktopLayout({
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
  // Which position the add/reduce sheet is editing. The right panel stays
  // visible behind it, so this is a plain overlay rather than a swap.
  const [adjust, setAdjust] = useState<{
    symbol: MarketSymbol;
    mode: AdjustMode;
  } | null>(null);
  // Which position's TP/SL is being edited.
  const [tpsl, setTpsl] = useState<MarketSymbol | null>(null);
  const handleFrame = useCallback((f: ChartFrame) => {
    gridRef.current?.react(f); 
  }, []); 

  return (
    <main className="grid h-dvh w-full grid-cols-[220px_1fr_320px] overflow-hidden">
      {/* Sidebar */}
      <aside className=" flex flex-col gap-1 border-r border-white/5 rounded-r-[50px] p-4 py-6">
        <div className="mb-4 flex items-center px-2">
          <Image src={"/images/logos/tradash-white.png"} alt="logo" height={100} width={100} className="w-6 h-6" />
          <span className="text-lg font-bold tracking-tight">Tradash</span>
        </div>
        <SidebarItem icon={ChartLineData01Icon} label="Markets" onClick={onOpenMarket} />
        <SidebarItem icon={Clock01Icon} label="History" onClick={onOpenAccount} />
        <SidebarItem icon={Analytics01Icon} label="Statistics" onClick={onOpenAccount} />
        <SidebarItem icon={Settings02Icon} label="Settings" onClick={onOpenAccount} />
      </aside> 

      {/* Chart (center, ~70% of the remaining space) */} 
      <section className="relative overflow-hidden">
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
        <div className="relative z-20 p-4">
          <MarketHeader symbol={symbol} onOpen={onOpenMarket} />
        </div>

        {/* Market dock — docked to the chart's left-center. ALWAYS shown: it
            reads out the size / leverage / trailing the next order will use,
            so it is just as relevant on a flat account. Tapping opens the
            market settings sheet. */}
        <PositionDock symbol={symbol} onOpen={() => setSettingsOpen(true)} />
      </section>

      {/* Right panel */}
      <aside className="flex min-h-0 flex-col gap-3 overflow-hidden border-l border-white/5 p-4">
        <div className="flex shrink-0 justify-end">
          <BalancePill onOpen={onOpenAccount} />
        </div>

        <PositionsPanel
          onShare={onShare}
          onCloseAll={trade.closeAll}
          onAdjust={(item: LivePosition, mode: AdjustMode) =>
            setAdjust({ symbol: item.position.symbol, mode })
          }
          onClosePosition={(item: LivePosition) =>
            trade.closePosition(item.position.symbol)
          }
          onEditTpSl={(item: LivePosition) => setTpsl(item.position.symbol)}
        />

        <div className="shrink-0">
          <TradeControls
            position={trade.position}
            trailActive={trade.trailActive}
            trailEligible={trade.trailEligible}
            trailPct={trade.trailPct}
            onLong={trade.openLong}
            onShort={trade.openShort}
            onToggleTrail={trade.toggleTrail}
            onClose={trade.close}
          />
        </div>
      </aside>

      {/* Same sheet as mobile. The right panel already lists positions, but the
          size / leverage / trailing controls live only here, so the dock needs
          somewhere to open on desktop too. */}
      <MarketSettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        symbol={symbol}
        leverage={leverage}
      />

      {/* Add / reduce for one position, opened from a row in the right panel. */}
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

      {/* Take-profit / stop-loss for one position, from the same row. */}
      <TpSlSheet
        open={tpsl != null}
        onClose={() => setTpsl(null)}
        symbol={tpsl}
        onSubmit={trade.setTpSl}
      />
    </main>
  );
}

function SidebarItem({
  icon,
  label,
  onClick,
}: {
  icon: typeof Settings02Icon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-text-muted transition-colors hover:bg-white/5 hover:text-text"
    >
      <HugeiconsIcon icon={icon} size={18} />
      {label}
    </button>
  );
}
