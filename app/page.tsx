"use client";

import { useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { MarketSwitcher } from "@/components/sheets/MarketSwitcher";
import { AccountSheet } from "@/components/sheets/AccountSheet";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { DesktopLayout } from "@/components/layout/DesktopLayout";
import { useAgentWallet } from "@/hooks/useAgentWallet";
import { useBulkAccount } from "@/hooks/useBulkAccount";
import { useDemoPnl } from "@/hooks/useDemoPnl";
import { useLiveTrail } from "@/hooks/useLiveTrail";
import { useFeedback } from "@/hooks/useFeedback";
import { useTrade } from "@/hooks/useTrade";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import type { PositionOverlay } from "@/lib/chart/engine";

// Orchestrates all trade/account state, then delegates rendering to the mobile
// or desktop layout. The homepage IS the trading screen.
export default function TradePage() {
  const activeSymbol = useAppSelector((s) => s.market.active);
  const isDesktop = useIsDesktop();

  // Lifecycle hooks.
  const agent = useAgentWallet();
  useFeedback();
  useBulkAccount(agent.masterAddress, agent.privyId);
  useDemoPnl();
  useLiveTrail(agent.signer);
  const trade = useTrade(agent.signer);

  // Position overlay for the chart (entry/liq/trail lines + PnL fill).
  const chartPosition: PositionOverlay | null = trade.position
    ? {
        entryPrice: trade.position.entryPrice,
        liquidationPrice: trade.position.liquidationPrice,
        pnl: trade.position.unrealizedPnl,
        trailStopPrice: trade.position.trailActive
          ? trade.position.trailStopPrice
          : undefined,
      }
    : null;

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  const layoutProps = {
    symbol: activeSymbol,
    chartPosition,
    trade,
    onOpenMarket: () => setSwitcherOpen(true),
    onOpenAccount: () => setAccountOpen(true),
  };

  return (
    <>
      {isDesktop ? (
        <DesktopLayout {...layoutProps} />
      ) : (
        <MobileLayout {...layoutProps} />
      )}

      <MarketSwitcher open={switcherOpen} onClose={() => setSwitcherOpen(false)} />
      <AccountSheet
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        agent={agent}
      />
    </>
  );
}
