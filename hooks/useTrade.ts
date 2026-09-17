"use client";

import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { MARKETS, leverageFor } from "@/lib/markets";
import {
  openPosition,
  trailStopFor,
  trailReferencePrice,
  canTrail,
  displayPnlFor,
  liquidationPrice,
} from "@/lib/perp";
import {
  setDemoPosition,
  patchDemoPosition,
  settleDemo,
} from "@/store/slices/tradingModeSlice";
import { patchPosition } from "@/store/slices/positionSlice";
import {
  setOrderStatus,
  setOrderError,
  setPendingChartEntry,
  clearPendingChartEntry,
} from "@/store/slices/tradingSlice";
import { recordClose } from "@/lib/history";
import {
  playSound,
  playCloseOutcome,
  beginProfitTracking,
  stopProfitTracking,
} from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import { useToast } from "@/components/toast/ToastProvider";
import {
  openMarket,
  reduceMarket,
  baseSizeFromUsd,
  isBuilderNotApprovedError,
} from "@/lib/bulk/orders";
import { setMarketLeverage as pushLeverageToBulk } from "@/lib/bulk/leverage";
import type { AgentSigner } from "@/lib/bulk/signing";
import { findStopLoss, findTakeProfit } from "@/lib/bulk/protection";
import { useProtection } from "@/hooks/useProtection";
import type { Direction, MarketSymbol, Position } from "@/types";

// A "significant" profit move ~= 5% of the margin at risk.
const profitStepFor = (marginUsd: number) => Math.max(marginUsd * 0.05, 1);

/**
 * Fraction of free margin an order may consume.
 *
 * Bulk recomputes leverage against ITS equity at fill time, which is not quite
 * the equity our last WS snapshot reported — funding, fees and price movement
 * all move it between the tap and the fill. Sizing to 100% of available margin
 * therefore lands fractionally over the market cap and is rejected outright, so
 * we leave 2% of slack for that drift.
 */
export const MARGIN_HEADROOM = 0.98;

/**
 * Don't submit an order below this margin. Bulk enforces a per-market
 * `minNotional` (as low as $1 on BTC, $50 on most others); at 10x leverage $5 of
 * margin clears a $50 floor, and anything under this is a dust order the user
 * did not mean to place.
 */
const MIN_MARGIN_USD = 5;

// Bulk's /order gateway can 504 (or the request abort) even though the order
// STILL FILLS — so a timeout is not a real failure. When we see one, we leave
// the pending loading toast in place and let the account WS resolve it (to the
// add/reduce/open/close confirmation), rather than flashing a false error.
function isGatewayTimeout(msg: string): boolean {
  return (
    /\b50[24]\b/.test(msg) ||
    /timeout|timed out|aborted|gateway|network/i.test(msg)
  );
}

const fmtUsd = (n: number) =>
  `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// The single entry point the UI uses to trade. Routes to the demo simulator or
// the live Bulk client based on the current mode, behind one identical API.
// Live trading requires a ready agent signer (passed in from useAgentWallet).
//
// `onBuilderNotApproved` is called when Bulk rejects an order because our
// builder code was never approved. Since Bulk exposes no readable approval
// state, that rejection is the only authoritative correction signal — the
// caller uses it to drop the optimistic cache and re-surface the setup button.
//
// `opts.onNeedsSetup` turns a blocked live trade into the setup flow instead of
// a dead-end toast: the tap IS the intent, so that's the moment to ask for the
// two master signatures rather than up front, before the user has decided.
export function useTrade(
  signer: AgentSigner | null,
  onBuilderNotApproved?: () => void,
  opts?: { authenticated?: boolean; onNeedsSetup?: () => void }
) {
  const { authenticated = false, onNeedsSetup } = opts ?? {};
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  // Native Bulk trigger orders (TP / SL / trailing). Live trailing routes
  // through here so it rests server-side rather than in a client watcher.
  const { setProtection } = useProtection(signer);
  const mode = useAppSelector((s) => s.tradingMode.mode);
  // Optimistic (Bulk exposes no readable builder-approval state), so a stale
  // `true` is still possible on a new device — `onBuilderNotApproved` remains
  // the authoritative correction after a rejection.
  const builderApproved = useAppSelector((s) => s.trading.builderApproved);
  const activeSymbol = useAppSelector((s) => s.market.active);
  const settings = useAppSelector((s) => s.settings);
  // Free collateral reported by the Bulk account WS — the same figure Bulk
  // divides notional by when it checks the order against the leverage cap.
  const liveBalance = useAppSelector((s) => s.user.balance);
  // Positions are keyed by market; read the ACTIVE market's position for each
  // mode. One position per market, so switching markets shows the right one.
  const livePosition = useAppSelector(
    (s) => s.position.bySymbol[activeSymbol] ?? null
  );
  const demoPosition = useAppSelector(
    (s) => s.tradingMode.demo.positions[activeSymbol] ?? null
  );
  const price = useAppSelector((s) => s.price.prices[activeSymbol]);
  // closeAll works across EVERY market, so it needs the full position maps and
  // price book rather than just the active market's slice.
  const allLivePositions = useAppSelector((s) => s.position.bySymbol);
  const allDemoPositions = useAppSelector((s) => s.tradingMode.demo.positions);
  const allPrices = useAppSelector((s) => s.price.prices);

  const rawPosition = mode === "demo" ? demoPosition : livePosition;

  // Display PnL model:
  //  - LIVE: anchored to Bulk's real PnL (truth), interpolated smoothly with the
  //    MagicBlock price between Bulk's event-only updates (livePnlAt). The chart
  //    line (MagicBlock) and entry line (real Bulk entry) run on their own feeds
  //    and may look mismatched — like Bulk's own UI — but the PnL stays truthful.
  //  - DEMO: derived from the MagicBlock price vs entry (fully self-consistent).
  const position: Position | null =
    rawPosition && price != null
      ? {
          ...rawPosition,
          unrealizedPnl: displayPnlFor(mode, rawPosition, price),
        }
      : rawPosition;

  // --- Live-trade setup gate ---------------------------------------------
  // Replaces the five copies of `if (!signer) toast("Connect wallet…")`, which
  // misreported an onboarded-but-not-set-up user as disconnected, and never
  // checked the builder code at all (so those orders failed only once Bulk
  // rejected them, after the user had already committed).
  //
  // Returns the ready signer, or null when the caller must STOP — returning it
  // (rather than a boolean) is what lets `const s = requireLiveSetup()` narrow
  // away the null for the order calls below. Ordered by what the user has to do
  // next: connect → set up → approve.
  const requireLiveSetup = useCallback((): AgentSigner | null => {
    if (signer && builderApproved) return signer;

    // Genuinely not connected — the original message is correct here.
    if (!authenticated) {
      dispatch(setOrderError("Connect wallet to trade live"));
      toast("Connect wallet to trade live", { type: "error" });
      return null;
    }

    // Connected, but one-tap trading isn't set up (no authorized agent key).
    if (!signer) {
      const msg = "Enable one-tap trading to place live orders";
      dispatch(setOrderError(msg));
      toast("One-tap trading required", {
        type: "error",
        description: "Two quick signatures and you're set.",
      });
      onNeedsSetup?.();
      return null;
    }

    // Agent is ready but the builder code isn't approved. Every order carries
    // it, so Bulk would reject this — fail here with a reason the user can act
    // on rather than after the round-trip.
    const msg = "Approve the builder code to place live orders";
    dispatch(setOrderError(msg));
    toast("Approval required", {
      type: "error",
      description: "One signature to finish setup.",
    });
    onNeedsSetup?.();
    return null;
  }, [signer, builderApproved, authenticated, onNeedsSetup, dispatch, toast]);

  const open = useCallback(
    async (direction: Direction) => {
      if (price == null) return;
      const market = MARKETS[activeSymbol];
      // Leverage is per market (each has its own cap on Bulk), resolved through
      // `leverageFor` so an unset market falls back to the default and a stored
      // value can never exceed the cap.
      const leverage = leverageFor(activeSymbol, settings.leverageByMarket);

      if (mode === "demo") {
        // Simulate: create a position at the current oracle price.
        const pos = openPosition({
          symbol: activeSymbol,
          direction,
          marginUsd: settings.defaultPositionSize,
          leverage,
          entryPrice: price,
        });
        dispatch(setDemoPosition({ symbol: activeSymbol, position: pos }));
        playSound("open");
        haptic("open");
        beginProfitTracking(profitStepFor(pos.marginUsed));
        toast(`${direction === "long" ? "Long" : "Short"} ${activeSymbol} opened`, {
          type: "success",
          description: `${leverage}× · ${fmtUsd(
            pos.marginUsed
          ).replace("+", "")} margin`,
        });
        return;
      }

      // Live: one-tap market order via the agent signer.
      const liveSigner = requireLiveSetup();
      if (!liveSigner) return;

      // Size against the margin the account ACTUALLY has free, not against the
      // configured position size.
      //
      // Bulk derives the fill's leverage as notional / available-margin and
      // rejects it above the market cap (`rejectedRiskLimit`). So sizing
      // `defaultPositionSize × maxLeverage` fails whenever the wallet holds less
      // than defaultPositionSize: a $999 size at 10x on an account with $954
      // free is 9993/954 = ~10.5x, over a 10x cap, and the order is refused.
      // That is the exact rejection this guards against:
      //   "leverage ~11.6x exceeds max leverage 10.0x, margin: 954.1"
      //
      // HEADROOM: we also stay a hair under the cap. Bulk margins against its
      // own equity at fill time, which drifts from our snapshot with funding and
      // price movement between the tap and the fill — sizing at exactly the cap
      // leaves nothing for that drift and rejects on the rounding.
      const availableMargin = liveBalance?.available ?? null;
      const marginUsd =
        availableMargin != null
          ? Math.min(settings.defaultPositionSize, availableMargin * MARGIN_HEADROOM)
          : settings.defaultPositionSize;

      if (availableMargin != null && marginUsd < MIN_MARGIN_USD) {
        // Nothing to trade with — say so rather than letting Bulk reject it with
        // a risk-limit message the user can do nothing about.
        dispatch(clearPendingChartEntry(activeSymbol));
        toast("Not enough margin", {
          type: "error",
          description: `Deposit more USDC — $${availableMargin.toFixed(
            2
          )} available.`,
        });
        return;
      }
      // Snapshot the MagicBlock price at THIS instant (the tap) so the chart's
      // entry line lands exactly where the user clicked. Consumed when the
      // position appears via the WS. Purely visual — PnL stays Bulk-anchored.
      dispatch(
        setPendingChartEntry({ symbol: activeSymbol, price })
      );
      dispatch(setOrderStatus("submitting"));
      // Loading toast, keyed per market, upgraded to success by useBulkAccount
      // when the WS confirms the fill.
      toast(`Opening ${direction === "long" ? "long" : "short"} ${activeSymbol}…`, {
        type: "loading",
        id: `open-${activeSymbol}`,
      });
      try {
        // Bulk margins the fill at the leverage stored on the ACCOUNT for this
        // symbol, not at anything in the order. If the user changed leverage
        // moments ago the debounced sync in useLeverage may not have landed
        // yet, so push it here as well — the order would otherwise be margined
        // at the previous value while the UI showed the new one. Cheap and
        // idempotent; a failure must not block the trade, since the position
        // still opens (just at the leverage Bulk already had).
        try {
          await pushLeverageToBulk(liveSigner, market.bulkSymbol, leverage);
        } catch (e) {
          console.warn("[open] leverage sync skipped:", e);
        }
        const size = baseSizeFromUsd(marginUsd, leverage, price);
        await openMarket(liveSigner, {
          bulkSymbol: market.bulkSymbol,
          isLong: direction === "long",
          size,
          refPrice: price,
        });
        dispatch(setOrderStatus("filled"));
        playSound("open");
        haptic("open");
        beginProfitTracking(profitStepFor(settings.defaultPositionSize));
        // Success toast fires from useBulkAccount when the WS confirms the position.
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Order failed";
        dispatch(setOrderError(msg));
        // Our builder code isn't approved on this account — every order will be
        // rejected until it is. Correct the cached state and tell the user what
        // to actually DO, rather than surfacing Bulk's raw pubkey message.
        if (isBuilderNotApprovedError(e)) {
          onBuilderNotApproved?.();
          toast("Finish setup to trade", {
            type: "error",
            id: `open-${activeSymbol}`,
            description:
              "Approve the builder code in Account to enable trading.",
          });
          return;
        }
        toast("Order failed", {
          type: "error",
          id: `open-${activeSymbol}`,
          description: msg.replace(/^Bulk order error:\s*/, ""),
        });
      }
    },
    [
      mode,
      price,
      activeSymbol,
      settings,
      signer,
      liveBalance,
      requireLiveSetup,
      dispatch,
      toast,
      onBuilderNotApproved,
    ]
  );

  /**
   * Resolve the position an adjustment targets, plus ITS market's price.
   *
   * Add/reduce are reached from the positions list, which shows EVERY market —
   * so the target is not necessarily the market on screen. Defaulting to the
   * active symbol keeps the no-argument call behaving as before, but passing a
   * symbol is what stops a tap on the ETH row from adjusting the BTC position
   * the user happens to be looking at. The price has to come from the same
   * market too: sizing an ETH order off the BTC tick would be wrong by orders
   * of magnitude.
   */
  const resolveTarget = useCallback(
    (symbol?: MarketSymbol) => {
      const sym = symbol ?? activeSymbol;
      const source = mode === "demo" ? allDemoPositions : allLivePositions;
      const raw = source[sym] ?? null;
      if (!raw) return null;
      const mark = allPrices[sym];
      if (mark == null) return null;
      // Match the display PnL model used everywhere else, so a demo reduce
      // realizes the same number the row was showing.
      return {
        target: { ...raw, unrealizedPnl: displayPnlFor(mode, raw, mark) },
        mark,
      };
    },
    [mode, activeSymbol, allDemoPositions, allLivePositions, allPrices]
  );

  // Close a position in full. `symbol` defaults to the active market, so the
  // bottom Close button is unchanged; the positions list passes its row's
  // symbol to close a market the user is not currently looking at.
  const close = useCallback(async (symbol?: MarketSymbol) => {
    const resolved = resolveTarget(symbol);
    if (!resolved) return;
    const { target: position, mark: price } = resolved;
    const market = MARKETS[position.symbol];

    if (mode === "demo") {
      // Log the completed trade, then realize PnL into the demo balance.
      recordClose(dispatch, "demo", position, price, position.unrealizedPnl);
      dispatch(settleDemo({ symbol: position.symbol, pnl: position.unrealizedPnl }));
      playCloseOutcome(position.unrealizedPnl);
      haptic("close");
      stopProfitTracking();
      toast(`Closed ${position.symbol}`, {
        type: position.unrealizedPnl >= 0 ? "success" : "info",
        description: `Realized ${fmtUsd(position.unrealizedPnl)}`,
        confetti: position.unrealizedPnl > 0,
      });
      return;
    }

    const liveSigner = requireLiveSetup();
    if (!liveSigner) return;
    const closingPnl = position.unrealizedPnl;
    dispatch(setOrderStatus("submitting"));
    toast(`Closing ${position.symbol}…`, {
      type: "loading",
      id: `close-${position.symbol}`,
    });
    try {
      await reduceMarket(liveSigner, {
        bulkSymbol: market.bulkSymbol,
        positionIsLong: position.direction === "long",
        size: position.size,
        refPrice: price,
      });
      dispatch(setOrderStatus("filled"));
      // Last known unrealized PnL is the best estimate of the realized result
      // here: the authoritative fill arrives later over the WS, and the cue has
      // to land now, on the tap.
      playCloseOutcome(closingPnl);
      haptic("close");
      stopProfitTracking();
      // Success toast fires from useBulkAccount when the WS confirms flat.
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Close failed";
      dispatch(setOrderError(msg));
      toast("Close failed", {
        type: "error",
        id: `close-${position.symbol}`,
        description: msg.replace(/^Bulk order error:\s*/, ""),
      });
    }
  }, [mode, resolveTarget, signer, requireLiveSetup, dispatch, toast]);

  // Close EVERY open position, across all markets. Fired from the aggregated
  // PnL card when more than one position is open.
  //
  // Live closes are dispatched CONCURRENTLY (Promise.allSettled) rather than
  // awaited in sequence: each is an independent reduce-only order on its own
  // market, so serializing them would make the last position wait out every
  // round-trip before it, and prices move meanwhile. Per-market toasts still
  // arrive one after another as each resolves.
  const closeAll = useCallback(async () => {
    const source = mode === "demo" ? allDemoPositions : allLivePositions;
    const open = Object.values(source).filter((p): p is Position => p != null);
    if (open.length === 0) return;

    // One cue for the whole basket, keyed on the net result — several
    // overlapping win/loss clips would just smear into noise.
    let basketPnl = 0;

    if (mode === "demo") {
      for (const pos of open) {
        const mark = allPrices[pos.symbol];
        const pnl = displayPnlFor("demo", pos, mark);
        basketPnl += pnl;
        if (mark != null) recordClose(dispatch, "demo", pos, mark, pnl);
        dispatch(settleDemo({ symbol: pos.symbol, pnl }));
        toast(`Closed ${pos.symbol}`, {
          type: pnl >= 0 ? "success" : "info",
          description: `Realized ${fmtUsd(pnl)}`,
          confetti: pnl > 0,
        });
      }
      playCloseOutcome(basketPnl);
      haptic("close");
      stopProfitTracking();
      toast(`Closed all ${open.length} positions`, { type: "success" });
      return;
    }

    const liveSigner = requireLiveSetup();
    if (!liveSigner) return;

    dispatch(setOrderStatus("submitting"));
    basketPnl = open.reduce((sum, pos) => sum + pos.unrealizedPnl, 0);
    for (const pos of open) {
      toast(`Closing ${pos.symbol}…`, {
        type: "loading",
        id: `close-${pos.symbol}`,
      });
    }

    const results = await Promise.allSettled(
      open.map((pos) =>
        reduceMarket(liveSigner, {
          bulkSymbol: MARKETS[pos.symbol].bulkSymbol,
          positionIsLong: pos.direction === "long",
          size: pos.size,
          refPrice: allPrices[pos.symbol] ?? pos.entryPrice,
        })
      )
    );

    // Per-market SUCCESS toasts are not fired here — useBulkAccount raises them
    // when the WS confirms each position actually went flat. Only failures need
    // reporting from this side.
    let failed = 0;
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        const msg =
          r.reason instanceof Error ? r.reason.message : "Close failed";
        // A gateway timeout does NOT mean the close failed — the order may
        // still have filled. Leave the pending toast for the WS to resolve.
        if (isGatewayTimeout(msg)) return;
        failed += 1;
        toast(`Close failed · ${open[i].symbol}`, {
          type: "error",
          id: `close-${open[i].symbol}`,
          description: msg.replace(/^Bulk order error:\s*/, ""),
        });
      }
    });

    if (failed === open.length) {
      dispatch(setOrderError("Close all failed"));
      return;
    }
    dispatch(setOrderStatus("filled"));
    playCloseOutcome(basketPnl);
    haptic("close");
    stopProfitTracking();
    toast(
      failed === 0
        ? `Closed all ${open.length} positions`
        : `Closed ${open.length - failed} of ${open.length} positions`,
      { type: failed === 0 ? "success" : "info" }
    );
  }, [
    mode,
    allDemoPositions,
    allLivePositions,
    allPrices,
    signer,
    requireLiveSetup,
    dispatch,
    toast,
  ]);


  // Add SIZE to an open position (same direction) — a market order for the
  // extra notional. `deltaUsd` is the margin to add; at the position's current
  // leverage that's `deltaUsd × leverage` of notional. Entry blends on fill.
  // `symbol` defaults to the active market; the positions list passes its row's.
  const increase = useCallback(
    async (deltaUsd: number, symbol?: MarketSymbol) => {
      const resolved = resolveTarget(symbol);
      if (!resolved || deltaUsd <= 0) return;
      const { target: position, mark: price } = resolved;
      const market = MARKETS[position.symbol];
      // Same risk-limit clamp as `open`: added notional is margined against the
      // account's FREE collateral, so adding more than that is rejected with
      // `rejectedRiskLimit` rather than partially filled. Demo has no Bulk
      // account behind it, so it keeps the requested size.
      const addMargin =
        mode === "live" && liveBalance?.available != null
          ? Math.min(deltaUsd, liveBalance.available * MARGIN_HEADROOM)
          : deltaUsd;
      if (mode === "live" && addMargin < MIN_MARGIN_USD) {
        toast("Not enough margin", {
          type: "error",
          description: "Deposit more USDC to add to this position.",
        });
        return;
      }
      const addSize = baseSizeFromUsd(addMargin, position.leverage, price);
      if (addSize <= 0) return;

      if (mode === "demo") {
        // Blend the new size in at the current price and re-average the entry.
        const newSize = position.size + addSize;
        const newEntry =
          (position.entryPrice * position.size + price * addSize) / newSize;
        const newMargin = position.marginUsed + deltaUsd;
        dispatch(
          patchDemoPosition({
            symbol: position.symbol,
            patch: {
              size: newSize,
              entryPrice: newEntry,
              marginUsed: newMargin,
              liquidationPrice: liquidationPrice(
                position.direction,
                newEntry,
                position.leverage
              ),
            },
          })
        );
        // Log the add (informational, no realized PnL) with the blended entry.
        recordClose(
          dispatch,
          "demo",
          { ...position, size: newSize, entryPrice: newEntry, marginUsed: newMargin },
          newEntry,
          0,
          "add",
          addSize
        );
        playSound("open");
        haptic("open");
        toast(`Added to ${position.symbol}`, {
          type: "success",
          description: `+${fmtUsd(deltaUsd).replace("+", "")} margin`,
        });
        return;
      }

      const liveSigner = requireLiveSetup();
      if (!liveSigner) return;
      dispatch(setOrderStatus("submitting"));
      // Fallback duration so a 504-that-never-fills can't spin forever; the WS
      // normally upgrades this to success/info well before it elapses.
      toast(`Adding to ${position.symbol}…`, {
        type: "loading",
        id: `adjust-${position.symbol}`,
        duration: 90_000,
      });
      try {
        await openMarket(liveSigner, {
          bulkSymbol: market.bulkSymbol,
          isLong: position.direction === "long",
          size: addSize,
          refPrice: price,
        });
        dispatch(setOrderStatus("filled"));
        playSound("open");
        haptic("open");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Order failed";
        dispatch(setOrderError(msg));
        // A 504/abort may have still filled — keep the loading toast and let the
        // WS confirm. Only show a hard failure for a genuine rejection.
        if (!isGatewayTimeout(msg)) {
          toast("Add failed", {
            type: "error",
            id: `adjust-${position.symbol}`,
            description: msg.replace(/^Bulk order error:\s*/, ""),
          });
        }
      }
    },
    [
      mode,
      resolveTarget,
      signer,
      liveBalance,
      requireLiveSetup,
      dispatch,
      toast,
    ]
  );

  // Reduce SIZE of an open position — a reduce-only market order for part of the
  // position. `deltaUsd` of margin at the current leverage, clamped to the
  // remaining size (so it never over-reduces; use Close for a full exit).
  // `symbol` defaults to the active market; the positions list passes its row's.
  const decrease = useCallback(
    async (deltaUsd: number, symbol?: MarketSymbol) => {
      const resolved = resolveTarget(symbol);
      if (!resolved || deltaUsd <= 0) return;
      const { target: position, mark: price } = resolved;
      const market = MARKETS[position.symbol];
      const rawSize = baseSizeFromUsd(deltaUsd, position.leverage, price);
      const cutSize = Math.min(rawSize, position.size);
      if (cutSize <= 0) return;

      if (mode === "demo") {
        const newSize = position.size - cutSize;
        // Realize the reduced portion's PnL into the demo balance.
        const realized =
          position.size > 0
            ? position.unrealizedPnl * (cutSize / position.size)
            : 0;
        if (newSize <= position.size * 0.001) {
          // Effectively a full close.
          recordClose(dispatch, "demo", position, price, position.unrealizedPnl);
          dispatch(
            settleDemo({ symbol: position.symbol, pnl: position.unrealizedPnl })
          );
        } else {
          // Partial reduce: realize the reduced fraction + log a reduce row.
          recordClose(dispatch, "demo", position, price, realized, "reduce", cutSize);
          dispatch(settleDemo({ symbol: position.symbol, pnl: realized }));
          dispatch(
            patchDemoPosition({
              symbol: position.symbol,
              patch: {
                size: newSize,
                marginUsed: position.marginUsed * (newSize / position.size),
              },
            })
          );
        }
        playSound("close");
        haptic("close");
        toast(`Reduced ${position.symbol}`, {
          type: "info",
          description: `−${fmtUsd(deltaUsd).replace("+", "").replace("−", "")} margin`,
        });
        return;
      }

      const liveSigner = requireLiveSetup();
      if (!liveSigner) return;
      dispatch(setOrderStatus("submitting"));
      toast(`Reducing ${position.symbol}…`, {
        type: "loading",
        id: `adjust-${position.symbol}`,
      });
      try {
        await reduceMarket(liveSigner, {
          bulkSymbol: market.bulkSymbol,
          positionIsLong: position.direction === "long",
          size: cutSize,
          refPrice: price,
        });
        dispatch(setOrderStatus("filled"));
        playSound("close");
        haptic("close");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Reduce failed";
        dispatch(setOrderError(msg));
        // A 504/abort may have still filled — keep the loading toast and let the
        // WS confirm. Only show a hard failure for a genuine rejection.
        if (!isGatewayTimeout(msg)) {
          toast("Reduce failed", {
            type: "error",
            id: `adjust-${position.symbol}`,
            description: msg.replace(/^Bulk order error:\s*/, ""),
          });
        }
      }
    },
    [mode, resolveTarget, signer, requireLiveSetup, dispatch, toast]
  );

  // Can a trail be armed right now? Only when in enough profit that the clamped
  // stop lands strictly in the profit zone (never at/below entry).
  //
  // `price` is a MagicBlock tick, so the reference it is measured against has
  // to be in MagicBlock space too — Bulk's raw entryPrice is not, and using it
  // mis-stated the profit by the spread between the feeds.
  const trailEligible =
    position != null &&
    price != null &&
    canTrail(
      position.direction,
      trailReferencePrice(mode, position),
      price,
      settings.defaultTrailPct
    );

  // Toggle the trailing stop.
  //
  // LIVE places a NATIVE Bulk trailing order (`trl`), which ratchets and fires
  // server-side — so it keeps working with the app closed. It used to run in
  // a client watcher (`useLiveTrail`) that only trailed while a tab was open;
  // that made "trailing stop" a promise the app could not keep overnight.
  //
  // DEMO keeps the local simulation (useDemoPnl ratchets it) — there is no Bulk
  // account behind a demo position to rest an order against.
  const toggleTrail = useCallback(async () => {
    if (!position || price == null) return;
    const sym = position.symbol;
    const trailBps = Math.round(settings.defaultTrailPct * 10_000);

    if (position.trailActive) {
      if (mode === "demo") {
        dispatch(
          patchDemoPosition({
            symbol: sym,
            patch: { trailActive: false, trailStopPrice: undefined },
          })
        );
      } else {
        // Cancel the resting trl but keep any take-profit: they are independent
        // sides, and turning the trail off must not silently disarm the TP.
        const tp = findTakeProfit(position.protection);
        const ok = await setProtection({
          symbol: sym,
          direction: position.direction,
          size: position.size,
          takeProfit: tp?.triggerPrice ?? null,
          stopLoss: null,
          trailBps: null,
        });
        if (!ok) return;
      }
      toast(`Trailing stop off · ${sym}`, { type: "info" });
      return;
    }

    // Guard: only arm when eligible. Same reference as `trailEligible` above,
    // so the button's enabled state and this check can never disagree.
    const reference = trailReferencePrice(mode, position);
    if (
      !canTrail(position.direction, reference, price, settings.defaultTrailPct)
    ) {
      return;
    }

    if (mode === "demo") {
      dispatch(
        patchDemoPosition({
          symbol: sym,
          patch: {
            trailActive: true,
            trailStopPrice: trailStopFor(
              position.direction,
              price,
              reference,
              settings.defaultTrailPct
            ),
          },
        })
      );
    } else {
      // A trail replaces the plain stop (one downside slot), but preserves the
      // take-profit.
      const tp = findTakeProfit(position.protection);
      const ok = await setProtection({
        symbol: sym,
        direction: position.direction,
        size: position.size,
        takeProfit: tp?.triggerPrice ?? null,
        stopLoss: null,
        trailBps,
      });
      if (!ok) return; // setProtection already explained why.
    }

    toast(`Trailing stop armed · ${sym}`, {
      type: "success",
      description: `Locks profit if price reverses ${(
        settings.defaultTrailPct * 100
      ).toFixed(1)}%`,
    });
  }, [
    position,
    price,
    mode,
    settings.defaultTrailPct,
    dispatch,
    toast,
    setProtection,
  ]);

  return {
    mode,
    position: position as Position | null,
    openLong: () => open("long"),
    openShort: () => open("short"),
    toggleTrail,
    // Live reads the RESTING trl order on Bulk; demo reads its local flag.
    // Using `trailActive` for both would leave the live button permanently off,
    // since nothing sets that flag once the trail lives server-side.
    trailActive:
      mode === "demo"
        ? (position?.trailActive ?? false)
        : findStopLoss(position?.protection)?.kind === "trailing",
    trailEligible,
    trailPct: settings.defaultTrailPct,
    /**
     * Apply a take-profit / stop-loss pair to one position (live only).
     *
     * Preserves a resting trailing stop when the user is only editing the
     * take-profit: the trail and a fixed stop share one downside slot, so
     * blindly passing `stopLoss` would disarm a trail the user never touched.
     */
    setTpSl: async ({
      symbol,
      takeProfit,
      stopLoss,
    }: {
      symbol: MarketSymbol;
      takeProfit: number | null;
      stopLoss: number | null;
    }) => {
      const target = allLivePositions[symbol];
      if (!target) return false;
      const trailing =
        findStopLoss(target.protection)?.kind === "trailing"
          ? Math.round(settings.defaultTrailPct * 10_000)
          : null;
      return setProtection({
        symbol,
        direction: target.direction,
        size: target.size,
        takeProfit,
        stopLoss: trailing ? null : stopLoss,
        trailBps: trailing,
      });
    },
    // Close the ACTIVE market's position. Wrapped rather than exposing `close`
    // directly: it is bound straight to onClick in the layouts, which would
    // otherwise hand the click event in as the symbol argument.
    close: () => close(),
    // Close one named market's position — used by the positions list, which can
    // show markets other than the one on screen.
    closePosition: (symbol: MarketSymbol) => close(symbol),
    closeAll,
    // Add / reduce SIZE of an open position (deltaUsd = margin at current lev).
    // Both default to the active market when no symbol is given.
    increase,
    decrease,
    hasPosition: position != null,
  };
}
