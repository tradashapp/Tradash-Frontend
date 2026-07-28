"use client";

import { useEffect, useState } from "react";
import { useAppSelector } from "@/store/hooks";
import { MarketSwitcher } from "@/components/sheets/MarketSwitcher";
import { AccountSheet } from "@/components/sheets/AccountSheet";
import { OnboardingTutorial } from "@/components/onboarding/OnboardingTutorial";
import { InstallSheet } from "@/components/sheets/InstallSheet";
import { RegisterSW } from "@/components/pwa/RegisterSW";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { DesktopLayout } from "@/components/layout/DesktopLayout";
import { ShareCardModal, type ShareSubject } from "@/components/share/ShareCardModal";
import { breakEvenPrice } from "@/lib/perp";
import { useAgentWallet } from "@/hooks/useAgentWallet";
import { useBulkAccount } from "@/hooks/useBulkAccount";
import { useDemoPnl } from "@/hooks/useDemoPnl";
import { useLiveTrail } from "@/hooks/useLiveTrail";
import { useFeedback } from "@/hooks/useFeedback";
import { useAllPrices } from "@/hooks/useAllPrices";
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
  useAllPrices(); // live price for ALL markets (switcher + multi-market PnL)
  useBulkAccount(agent.masterAddress, agent.privyId);
  useDemoPnl();
  useLiveTrail(agent.signer);
  const trade = useTrade(agent.signer);

  // Position overlay for the chart. The entry LINE is drawn at the BREAK-EVEN
  // MagicBlock price — the exact level where the displayed PnL reads 0.00 and the
  // mark line flips profit↔loss. This keeps the entry line, the moving line and
  // the gradient in one coordinate space and lands correctly after a reload
  // (which drops the tap-time chartEntryPrice but re-anchors PnL from Bulk).
  const chartPosition: PositionOverlay | null = trade.position
    ? {
        entryPrice: breakEvenPrice(trade.mode, trade.position),
        liquidationPrice: trade.position.liquidationPrice,
        pnl: trade.position.unrealizedPnl,
        trailStopPrice: trade.position.trailActive
          ? trade.position.trailStopPrice
          : undefined,
      }
    : null;

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [shareSubject, setShareSubject] = useState<ShareSubject | null>(null);

  // Auto-show the "how it works" walkthrough on first visit (persisted flag).
  const tutorialSeen = useAppSelector((s) => s.settings.tutorialSeen);
  useEffect(() => {
    if (!tutorialSeen) setTutorialOpen(true);
  }, [tutorialSeen]);

  const layoutProps = {
    symbol: activeSymbol,
    chartPosition,
    trade,
    onOpenMarket: () => setSwitcherOpen(true),
    onOpenAccount: () => setAccountOpen(true),
    onShare: (subject: ShareSubject) => setShareSubject(subject),
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
        onShare={(subject) => setShareSubject(subject)}
        onOpenTutorial={() => {
          setAccountOpen(false);
          setTutorialOpen(true);
        }}
        onOpenInstall={() => {
          setAccountOpen(false);
          setInstallOpen(true);
        }}
      />
      <OnboardingTutorial
        open={tutorialOpen}
        onClose={() => setTutorialOpen(false)}
      />
      <InstallSheet open={installOpen} onClose={() => setInstallOpen(false)} />
      <ShareCardModal
        subject={shareSubject}
        onClose={() => setShareSubject(null)}
      />
      <RegisterSW />
    </>
  );
}
