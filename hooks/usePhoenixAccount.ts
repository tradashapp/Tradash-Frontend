"use client";

import { useEffect, useRef } from "react";
import { subscribeAccount } from "@/lib/phoenix/accountWs";
import { readAccount } from "@/lib/phoenix/account";
import { useAppDispatch, useAppStore } from "@/store/hooks";
import { setBalance } from "@/store/slices/userSlice";
import {
  reconcilePositions,
  clearAllPositions,
} from "@/store/slices/positionSlice";
import { clearPendingChartEntry } from "@/store/slices/tradingSlice";
import { markLiveHydrated } from "@/store/slices/historySlice";
import { useToast, type ToastOptions } from "@/components/toast/ToastProvider";
import type { AppDispatch, AppStore } from "@/store";
import type { MarketSymbol, Position } from "@/types";

type ToastFn = (title: string, opts?: ToastOptions) => string;

const fmtUsd = (n: number) =>
  `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/**
 * Live Phoenix account state → the Redux store.
 *
 * The Phoenix counterpart of `useBulkAccount`, and deliberately much smaller,
 * because Phoenix removes work Bulk forced on the client:
 *
 *   - No margin-field normalisation. Bulk renamed `totalBalance`→`totalMargin`
 *     mid-flight, so every read went through `readMargin`. Phoenix returns
 *     `{value, decimals, ui}` integers with stable names.
 *   - No snapshot-vs-delta merge. Bulk's websocket pushed PARTIAL balance
 *     deltas that had to be merged or equity would zero out. Here the stream is
 *     only a change notification and every value is re-read from REST, so there
 *     is no partial state to reconcile.
 *   - No history capture. Bulk history was written from the browser on an
 *     open→absent transition, which silently lost a close that happened while
 *     disconnected (`useBulkAccount.ts:118`). Phoenix history is indexed
 *     server-side from fills, so this hook does not write trades at all.
 *
 * IT DOES STILL RAISE TOASTS. `useTrade` opens a sticky `loading` toast keyed
 * `open-<sym>` / `close-<sym>` / `adjust-<sym>` and never resolves it on the
 * success path — by design, because only confirmed account state knows the
 * order actually filled. On Bulk that resolution came from the WS handlers; on
 * Phoenix nothing did it, so every live order left a toast spinning forever
 * while the balance pill visibly updated behind it. The position-transition
 * diff below is that missing half.
 *
 * WHY REST AND NOT THE STREAM'S CONTENTS: the `traderState` channel sends raw
 * per-subaccount collateral with no equity, margin requirement, PnL or risk
 * state. Computing those here would duplicate Phoenix's risk engine, and a
 * mismatch would draw a wrong liquidation line. So the stream says WHEN, REST
 * says WHAT.
 */
export function usePhoenixAccount(
  /** Owner wallet — the authority the stream and PDA derive from. */
  authority: string | null,
  /** Trader PDA for subaccount 0 (cross). Null until derived. */
  traderPda: string | null
) {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const { toast } = useToast();
  // Guards against a stale in-flight read landing after a newer one.
  const readSeq = useRef(0);
  // Last-seen open position per market, to diff transitions against.
  const lastOpen = useRef<Partial<Record<MarketSymbol, Position>>>({});
  // The FIRST read after mount is hydration, not news: the user's existing
  // positions are not fills that just happened, and toasting them would
  // announce an "opened" for every position on every page load.
  const hydrated = useRef(false);

  useEffect(() => {
    if (!authority || !traderPda) {
      dispatch(setBalance(null));
      dispatch(clearAllPositions());
      // History is server-indexed on Phoenix, so nothing here will hydrate it;
      // marking it hydrated stops the UI waiting on a write that never comes.
      dispatch(markLiveHydrated());
      lastOpen.current = {};
      hydrated.current = false;
      return;
    }

    let cancelled = false;

    const refresh = async () => {
      const seq = ++readSeq.current;
      // Mark prices come from the MagicBlock oracle already in the store, so a
      // position's PnL is computed against the same feed the chart draws.
      const prices = store.getState().price.prices as Partial<
        Record<MarketSymbol, number>
      >;
      const account = await readAccount(traderPda, prices).catch(() => null);
      // A later read has already landed — discard this one.
      if (cancelled || seq !== readSeq.current) return;

      if (!account) {
        // No trader account yet: the user has never funded Phoenix. Flat, not
        // an error.
        dispatch(setBalance({ equity: 0, available: 0, marginUsed: 0 }));
        dispatch(clearAllPositions());
        lastOpen.current = {};
        hydrated.current = true;
        return;
      }
      dispatch(setBalance(account.balance));

      // Carry forward the per-position fields Phoenix does not serve, and diff
      // against the previous read to resolve any pending order toast.
      const incoming: Partial<Record<MarketSymbol, Position>> = {};
      for (const p of account.positions) {
        incoming[p.symbol] = enrich(
          store,
          dispatch,
          p,
          lastOpen.current[p.symbol]
        );
      }

      if (hydrated.current) {
        // Flat → open: the order filled.
        for (const sym of Object.keys(incoming) as MarketSymbol[]) {
          const next = incoming[sym]!;
          const prev = lastOpen.current[sym];
          if (!prev) {
            toastOpen(toast, next);
          } else if (Math.abs(next.size - prev.size) > prev.size * 1e-6) {
            // Open → open with a SIZE change = an add / reduce filled.
            toastAdjust(toast, prev, next);
          }
        }
        // Open → absent: the position closed. Unlike Bulk this records no
        // history row — Phoenix indexes fills server-side — so it only
        // resolves the toast.
        for (const sym of Object.keys(lastOpen.current) as MarketSymbol[]) {
          if (!incoming[sym]) toastClose(toast, lastOpen.current[sym]!);
        }
      }

      lastOpen.current = incoming;
      hydrated.current = true;
      dispatch(reconcilePositions(Object.values(incoming) as Position[]));
    };

    // Seed immediately, then re-read whenever the account changes on chain.
    void refresh();
    const unsub = subscribeAccount(authority, { onChange: () => void refresh() });

    dispatch(markLiveHydrated());

    return () => {
      cancelled = true;
      unsub();
    };
  }, [authority, traderPda, dispatch, store, toast]);
}

/**
 * Carry forward what Phoenix does not serve per position.
 *
 * `readAccount` rebuilds every position from scratch on each read, and
 * `reconcilePositions` replaces the map wholesale, so anything not in the REST
 * payload is lost on the next tick unless it is re-attached here. `openedAt`
 * would reset to 0 (making every duration wrong) and the chart's entry line
 * would jump to a fresh price every few seconds.
 *
 * On first open it consumes the tap-time MagicBlock price so the entry line
 * lands where the user actually clicked. Mirrors `enrich` in `useBulkAccount`,
 * minus the PnL anchoring: Phoenix PnL is already derived from the MagicBlock
 * mark in `toPosition`, so there is no second price space to interpolate
 * between.
 */
function enrich(
  store: AppStore,
  dispatch: AppDispatch,
  p: Position,
  prev: Position | undefined
): Position {
  const state = store.getState();
  const mbNow = state.price.prices[p.symbol];
  const tapEntry = !prev
    ? state.trading.pendingChartEntry[p.symbol]
    : prev.chartEntryPrice;
  if (!prev) dispatch(clearPendingChartEntry(p.symbol));
  return {
    ...p,
    // Phoenix serves no open time, so the first read that saw the position is
    // the best available answer. It is a lower bound: a position opened before
    // this session appears to start at page load.
    openedAt: prev?.openedAt ?? (p.openedAt || Date.now()),
    chartEntryPrice: tapEntry ?? mbNow ?? p.entryPrice,
  };
}

/**
 * Size line for a fill toast.
 *
 * Bulk printed `{leverage}× · {margin} margin`, but Phoenix stores neither:
 * `toPosition` leaves `leverage` and `marginUsed` at 0 because margin comes
 * from size tiers rather than a per-position figure. Printing those zeroes
 * would read as "0× · $0.00 margin", so the notional — which IS known — is
 * reported instead.
 */
function sizeLine(pos: Position): string {
  const notional = pos.size * pos.entryPrice;
  return `${pos.size} ${pos.symbol} · $${notional.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Confirm a live open (upgrades the pending open-<sym> loading toast).
function toastOpen(toast: ToastFn, pos: Position) {
  toast(`${pos.direction === "long" ? "Long" : "Short"} ${pos.symbol} opened`, {
    type: "success",
    id: `open-${pos.symbol}`,
    description: sizeLine(pos),
  });
}

// Confirm a live add / reduce (upgrades the pending adjust-<sym> loading toast).
function toastAdjust(toast: ToastFn, prev: Position, next: Position) {
  const added = next.size > prev.size;
  toast(`${added ? "Added to" : "Reduced"} ${next.symbol}`, {
    type: added ? "success" : "info",
    id: `adjust-${next.symbol}`,
    description: sizeLine(next),
  });
}

// Confirm a live close (upgrades the pending close-<sym> loading toast).
function toastClose(toast: ToastFn, prev: Position) {
  toast(`Closed ${prev.symbol}`, {
    type: prev.unrealizedPnl >= 0 ? "success" : "info",
    id: `close-${prev.symbol}`,
    description: `Realized ${fmtUsd(prev.unrealizedPnl)}`,
    // Only an actual gain earns the burst — break-even closes stay quiet so the
    // celebration keeps meaning something.
    confetti: prev.unrealizedPnl > 0,
  });
}
