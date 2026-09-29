"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { startSwitch, finishSwitch } from "@/store/slices/marketSlice";
import { MarketSwitcher } from "@/components/sheets/MarketSwitcher";
import { AccountSheet } from "@/components/sheets/AccountSheet";
import { OnboardingTutorial } from "@/components/onboarding/OnboardingTutorial";
import { InstallSheet } from "@/components/sheets/InstallSheet";
import { LeaderboardSheet } from "@/components/sheets/LeaderboardSheet";
import { RegisterSW } from "@/components/pwa/RegisterSW";
import { MobileLayout } from "@/components/layout/MobileLayout";
import { DesktopLayout } from "@/components/layout/DesktopLayout";
import { ShareCardModal, type ShareSubject } from "@/components/share/ShareCardModal";
import { TradeDetailsSheet } from "@/components/sheets/TradeDetailsSheet";
import { TradeReplayModal } from "@/components/replay/TradeReplayModal";
import {
  breakEvenPrice,
  bulkToChartSpace,
  chartLiquidationPrice,
  netBreakEvenPrice,
} from "@/lib/perp";
import { marketPath, marketMeta } from "@/lib/markets";
import { useAgentWallet } from "@/hooks/useAgentWallet";
import { useBulkAccount } from "@/hooks/useBulkAccount";
import { useDemoPnl } from "@/hooks/useDemoPnl";
import { useLiveProfitSound } from "@/hooks/useLiveProfitSound";
import { useMusic } from "@/hooks/useMusic";
import { useTradeRecorder } from "@/hooks/useTradeRecorder";
import { useFeedback } from "@/hooks/useFeedback";
import { useAllPrices } from "@/hooks/useAllPrices";
import { useTrade } from "@/hooks/useTrade";
import { useLeverage } from "@/hooks/useLeverage";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { useDefaultSize } from "@/hooks/useDefaultSize";
import type { PositionOverlay } from "@/lib/chart/engine";
import {
  findStopLoss,
  findTakeProfit,
  findTrailingStop,
} from "@/lib/bulk/protection";
import type {
  CompletedTrade,
  MarketSymbol,
  Position,
  TradeEpisode,
} from "@/types";

interface Props {
  /**
   * Market to open on load, from the route (`/btc`, `/eth`, `/sol`). The screen
   * seeds Redux from this once on mount; thereafter the in-app switcher owns the
   * active market and keeps the URL in sync.
   */
  initialMarket: MarketSymbol;
}

/**
 * A Bulk-quoted trigger price in the chart's space, or undefined when unset.
 *
 * Every Bulk-quoted level the chart draws goes through a translation like this
 * one; see `bulkToChartShift`.
 */
function chartTrigger(
  mode: "demo" | "live",
  pos: Position,
  triggerPrice: number | undefined
): number | undefined {
  if (triggerPrice == null) return undefined;
  return bulkToChartSpace(mode, pos, triggerPrice);
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
  useLiveProfitSound();
  useMusic(); // after useFeedback, which creates the AudioContext it plays on
  useTradeRecorder(); // records real price paths for trade replay
  // Holds the order size at its per-market default (min, or 5% of available)
  // until the user picks one by hand. After useBulkAccount, so the first
  // computation sees a balance rather than null.
  useDefaultSize();
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
        // Shifted into the SAME (MagicBlock) space as the entry line above.
        // Bulk quotes liquidation against its own feed, so drawing it raw put
        // it off by the spread between the two feeds — and moved it as that
        // spread changed. See chartLiquidationPrice.
        liquidationPrice: chartLiquidationPrice(trade.mode, trade.position),
        // Where closing nets zero after ALL fees — paid so far plus the exit
        // fee — and funding. See netBreakEvenPriceBulk. Null (not drawn) in
        // demo, which charges no fees.
        breakEvenPrice:
          netBreakEvenPrice(trade.mode, trade.position) ?? undefined,
        pnl: trade.position.unrealizedPnl,
        // Resting TP / SL, translated out of Bulk's price space into the
        // chart's. Bulk stores a trigger against its own feed, so drawing the
        // raw number would put the line ~0.05% from where it actually fires —
        // the same trap the liquidation line above already corrects for.
        takeProfitPrice: chartTrigger(
          trade.mode,
          trade.position,
          findTakeProfit(trade.position.protection)?.triggerPrice
        ),
        stopLossPrice: chartTrigger(
          trade.mode,
          trade.position,
          findStopLoss(trade.position.protection)?.triggerPrice
        ),
        // The trailing stop gets its OWN line: it can rest alongside a fixed
        // stop, and the two are different promises (a ratcheting floor vs a
        // static one), so collapsing them would hide one of the two levels that
        // can actually close the position.
        trailStopPrice:
          trade.mode === "demo"
            ? trade.position.trailActive
              ? trade.position.trailStopPrice
              : undefined
            : chartTrigger(
                trade.mode,
                trade.position,
                findTrailingStop(trade.position.protection)?.triggerPrice
              ),
      }
    : null;

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [shareSubject, setShareSubject] = useState<ShareSubject | null>(null);
  // The trade being replayed, with its recording. Null while the player is shut.
  const [replaySubject, setReplaySubject] = useState<{
    episode: TradeEpisode;
    trade: CompletedTrade;
  } | null>(null);
  // The history trade whose details sheet is open. Null while it's shut.
  const [detailTrade, setDetailTrade] = useState<CompletedTrade | null>(null);
  // Which view the account sheet opens on. "history" only for the details
  // sheet's back button; every other way in lands on the menu.
  const [accountView, setAccountView] = useState<"menu" | "history">("menu");
  useEffect(() => {
    if (!accountOpen) setAccountView("menu");
  }, [accountOpen]);

  // Auto-show the "how it works" walkthrough on first visit (persisted flag).
  // Waits for settings to load: this effect runs before Providers' hydrate
  // effect, so without the gate it read the default `false` on every reload.
  const settingsHydrated = useAppSelector((s) => s.settings.hydrated);
  const tutorialSeen = useAppSelector((s) => s.settings.tutorialSeen);
  useEffect(() => {
    if (settingsHydrated && !tutorialSeen) setTutorialOpen(true);
  }, [settingsHydrated, tutorialSeen]);

  // Per-market leverage, owned here so the market-settings sheet (inside the
  // layout) and the order path agree on one instance — it debounces its push to
  // Bulk, and two copies would each run their own timer for the same market.
  const leverage = useLeverage(agent.signer);

  const layoutProps = {
    symbol: activeSymbol,
    chartPosition,
    trade,
    leverage,
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
        initialView={accountView}
        onOpenTrade={(trade) => {
          // Swap sheets rather than stacking them — two grabbers leave it
          // unclear which one a drag dismisses. Back reverses the swap.
          setAccountOpen(false);
          setDetailTrade(trade);
        }}
        onReplay={(trade, episode) => setReplaySubject({ trade, episode })}
        onOpenTutorial={() => {
          setAccountOpen(false);
          setTutorialOpen(true);
        }}
        onOpenInstall={() => {
          setAccountOpen(false);
          setInstallOpen(true);
        }}
        onOpenLeaderboard={() => {
          // Close the account sheet first — two stacked sheets leave the user
          // with two grabbers and no clear idea which dismisses what.
          setAccountOpen(false);
          setLeaderboardOpen(true);
        }}
      />
      <OnboardingTutorial
        open={tutorialOpen}
        onClose={() => setTutorialOpen(false)}
      />
      <InstallSheet open={installOpen} onClose={() => setInstallOpen(false)} />
      <LeaderboardSheet
        open={leaderboardOpen}
        onClose={() => setLeaderboardOpen(false)}
        // The leaderboard is reached FROM the account sheet, which closes to
        // open it — so back reverses exactly that, rather than dumping the user
        // on the chart and making them re-open the account to get where they were.
        onBack={() => {
          setLeaderboardOpen(false);
          setAccountOpen(true);
        }}
      />
      <TradeDetailsSheet
        trade={detailTrade}
        onClose={() => setDetailTrade(null)}
        onBack={() => {
          setDetailTrade(null);
          setAccountView("history");
          setAccountOpen(true);
        }}
        onShare={(trade) => {
          // Hand off to the PnL card; the two overlays never stack.
          setDetailTrade(null);
          setShareSubject({ kind: "trade", trade });
        }}
      />
      <ShareCardModal
        subject={shareSubject}
        onClose={() => setShareSubject(null)}
      />
      <TradeReplayModal
        subject={replaySubject}
        onClose={() => setReplaySubject(null)}
        onShare={(trade) => {
          // Hand off to the PnL card, closing the player so the two overlays
          // never stack.
          setReplaySubject(null);
          setShareSubject({ kind: "trade", trade });
        }}
      />
      <RegisterSW />
    </>
  );
}
