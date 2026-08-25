"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { startSwitch, finishSwitch } from "@/store/slices/marketSlice";
import { MarketSwitcher } from "@/components/sheets/MarketSwitcher";
import { AccountSheet } from "@/components/sheets/AccountSheet";
import { OnboardingTutorial } from "@/components/onboarding/OnboardingTutorial";
import { InstallSheet } from "@/components/sheets/InstallSheet";
import { RegisterSW } from "@/components/pwa/RegisterSW";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { DesktopLayout } from "@/components/layout/DesktopLayout";
import { ShareCardModal, type ShareSubject } from "@/components/share/ShareCardModal";
import { breakEvenPrice } from "@/lib/perp";
import { marketPath, marketMeta } from "@/lib/markets";
import { useAgentWallet } from "@/hooks/useAgentWallet";
import { useBulkAccount } from "@/hooks/useBulkAccount";
import { useDemoPnl } from "@/hooks/useDemoPnl";
import { useLiveTrail } from "@/hooks/useLiveTrail";
import { useTradeRecorder } from "@/hooks/useTradeRecorder";
import { useFeedback } from "@/hooks/useFeedback";
import { useAllPrices } from "@/hooks/useAllPrices";
import { useTrade } from "@/hooks/useTrade";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import type { PositionOverlay } from "@/lib/chart/engine";
import type { MarketSymbol } from "@/types";

interface Props {
  /**
   * Market to open on load, from the route (`/btc`, `/eth`, `/sol`). The screen
   * seeds Redux from this once on mount; thereafter the in-app switcher owns the
   * active market and keeps the URL in sync.
   */
  initialMarket: MarketSymbol;
}

// The trading screen. One component backs every market route — the route only
// differs in its initial market + server metadata/OG. Orchestrates all
// trade/account state, then delegates rendering to the mobile or desktop layout.
export function TradeScreen({ initialMarket }: Props) {
  const dispatch = useAppDispatch();
  const activeSymbol = useAppSelector((s) => s.market.active);
  const isDesktop = useIsDesktop();

  // Seed the active market from the route once, before first paint, so the chart
  // boots straight into the shared market (no BTC flash then swap). Layout effect
  // runs pre-paint; a ref makes it one-shot so later in-app switches aren't undone.
  const seeded = useRef(false);
  useLayoutEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (initialMarket !== activeSymbol) {
      dispatch(startSwitch(initialMarket));
      dispatch(finishSwitch());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the address bar + tab title in sync as the market changes in-app (no
  // navigation, so the chart keeps running). A copied link then always matches
  // the visible chart. (Server metadata still owns the crawler-visible OG tags.)
  useEffect(() => {
    const target = marketPath(activeSymbol);
    if (window.location.pathname !== target) {
      window.history.replaceState(null, "", target);
    }
    document.title = marketMeta(activeSymbol).title;
  }, [activeSymbol]);

  // Lifecycle hooks.
  const agent = useAgentWallet();
  useFeedback();
  useAllPrices(); // live price for ALL markets (switcher + multi-market PnL)
  useBulkAccount(agent.masterAddress, agent.privyId);
  useDemoPnl();
  useLiveTrail(agent.signer);
  useTradeRecorder(); // records real price paths for trade replay
  // A rejected-for-unapproved-builder-code order is the only reliable signal
  // that our cached approval is stale — feed it back so the Account sheet shows
  // the step as incomplete and offers the re-approve button.
  // A blocked live trade opens the Account sheet, where both setup steps live.
  // Declared before `accountOpen` below — `setAccountOpen` is a stable setter,
  // so referencing it here is safe.
  const trade = useTrade(agent.signer, agent.invalidateBuilderApproval, {
    authenticated: agent.authenticated,
    onNeedsSetup: () => setAccountOpen(true),
  });

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
