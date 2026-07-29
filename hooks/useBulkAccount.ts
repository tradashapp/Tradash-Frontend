"use client";

import { useEffect, useRef } from "react";
import { subscribeAccount } from "@/lib/bulk/accountWs";
import { fetchAccount } from "@/lib/bulk/client";
import type { BulkPosition } from "@/lib/bulk/types";
import { MARKETS } from "@/lib/markets";
import { api } from "@/lib/api";
import { useAppDispatch, useAppStore } from "@/store/hooks";
import { setBalance } from "@/store/slices/userSlice";
import {
  setPosition,
  reconcilePositions,
  clearAllPositions,
} from "@/store/slices/positionSlice";
import { clearPendingChartEntry } from "@/store/slices/tradingSlice";
import { hydrateLiveHistory } from "@/store/slices/historySlice";
import { recordClose } from "@/lib/history";
import { useToast, type ToastOptions } from "@/components/toast/ToastProvider";
import type { Direction, MarketSymbol, Position } from "@/types";
import type { AppDispatch, AppStore } from "@/store";

type ToastFn = (title: string, opts?: ToastOptions) => string;

const fmtUsd = (n: number) =>
  `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const bulkToSym = Object.fromEntries(
  (Object.keys(MARKETS) as MarketSymbol[]).map((s) => [MARKETS[s].bulkSymbol, s])
) as Record<string, MarketSymbol>;

// Subscribes to the Bulk account WS. Bulk supports one position PER MARKET, so
// we track positions keyed by symbol: snapshots reconcile all markets, deltas
// update one market. On any market going flat we record the completed trade.
export function useBulkAccount(
  walletAddress: string | null,
  privyId: string | null
) {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const { toast } = useToast();
  // Last-seen open live position per market, to reconstruct trades on close.
  const lastOpen = useRef<Partial<Record<MarketSymbol, Position>>>({});

  useEffect(() => {
    if (!walletAddress) {
      dispatch(setBalance(null));
      dispatch(clearAllPositions());
      lastOpen.current = {};
      return;
    }

    // Load this user's persisted live history from the backend (by Privy DID).
    if (privyId) {
      api
        .fetchHistory(privyId)
        .then((trades) => {
          // Always apply: an empty result means this user has no live trades,
          // so any stale live rows should be cleared while demo trades stay.
          dispatch(hydrateLiveHistory(trades));
        })
        .catch(() => {});
    }

    // Seed snapshot (unsigned). null = account has never traded (flat).
    fetchAccount(walletAddress)
      .then((acct) => {
        if (!acct) {
          dispatch(setBalance({ equity: 0, available: 0, marginUsed: 0 }));
          dispatch(clearAllPositions());
          lastOpen.current = {};
          return;
        }
        dispatch(
          setBalance({
            equity: acct.margin.totalBalance,
            available: acct.margin.availableBalance,
            marginUsed: acct.margin.marginUsed,
            unrealizedPnl: acct.margin.unrealizedPnl,
          })
        );
        const open = acct.positions
          .filter((p) => p.size !== 0)
          .map((p) => snapshotToPosition(p))
          .filter((p): p is Position => p !== null)
          .map((p) => enrich(store, dispatch, p, lastOpen.current[p.symbol]));
        const map: Partial<Record<MarketSymbol, Position>> = {};
        for (const p of open) map[p.symbol] = p;
        lastOpen.current = map;
        dispatch(reconcilePositions(open));
      })
      .catch(() => {});

    const unsub = subscribeAccount(walletAddress, {
      onBalance: (b) => dispatch(setBalance(b)),

      // Full snapshot: reconcile ALL markets. Any previously-open market absent
      // from the incoming set has closed → record it.
      onSnapshot: (positions) => {
        const incoming: Partial<Record<MarketSymbol, Position>> = {};
        for (const p of positions) {
          incoming[p.symbol] = enrich(
            store,
            dispatch,
            p,
            lastOpen.current[p.symbol]
          );
        }
        // New opens (were flat, now present) → confirm the pending open toast.
        for (const sym of Object.keys(incoming) as MarketSymbol[]) {
          if (!lastOpen.current[sym]) toastOpen(toast, incoming[sym]!);
        }
        // Detect closes: symbols we had open but are no longer present.
        for (const sym of Object.keys(lastOpen.current) as MarketSymbol[]) {
          if (!incoming[sym]) {
            recordCloseFor(store, dispatch, privyId, lastOpen.current[sym]!, toast);
          }
        }
        lastOpen.current = incoming;
        dispatch(reconcilePositions(Object.values(incoming) as Position[]));
      },

      // Single-market delta.
      onPositionDelta: (symbol, p) => {
        const prev = lastOpen.current[symbol] ?? null;
        if (prev && !p) {
          recordCloseFor(store, dispatch, privyId, prev, toast);
          delete lastOpen.current[symbol];
          dispatch(setPosition({ symbol, position: null }));
          return;
        }
        if (p) {
          const next = enrich(store, dispatch, p, prev ?? undefined);
          if (!prev) {
            toastOpen(toast, next); // flat → open: confirm the fill
          } else if (Math.abs(next.size - prev.size) > prev.size * 1e-6) {
            // open → open with a SIZE change = an add / reduce filled. Resolve
            // the pending adjust toast (keyed adjust-<sym>) that increase()/
            // decrease() opened, so it never spins forever.
            toastAdjust(toast, prev, next);
          }
          lastOpen.current[symbol] = next;
          dispatch(setPosition({ symbol, position: next }));
        }
      },
    });

    return unsub;
  }, [walletAddress, privyId, dispatch, store, toast]);
}

// Attach the PnL anchor (Bulk PnL + MagicBlock price now), preserve openedAt, and
// on first open consume the tap-time MagicBlock price for the entry-line visual.
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
    openedAt: prev?.openedAt ?? p.openedAt,
    pnlAnchor: p.unrealizedPnl,
    priceAnchorMb: mbNow,
    chartEntryPrice: tapEntry ?? mbNow ?? p.entryPrice,
  };
}

function recordCloseFor(
  store: AppStore,
  dispatch: AppDispatch,
  privyId: string | null,
  prev: Position,
  toast: ToastFn
) {
  const exit = store.getState().price.prices[prev.symbol] ?? prev.entryPrice;
  const trade = recordClose(dispatch, "live", prev, exit, prev.unrealizedPnl);
  if (privyId) api.recordTrade(privyId, trade).catch(() => {});
  // Confirm the close (upgrades the pending close-<sym> loading toast if present).
  toast(`Closed ${prev.symbol}`, {
    type: prev.unrealizedPnl >= 0 ? "success" : "info",
    id: `close-${prev.symbol}`,
    description: `Realized ${fmtUsd(prev.unrealizedPnl)}`,
  });
}

// Confirm a live open (upgrades the pending open-<sym> loading toast).
function toastOpen(toast: ToastFn, pos: Position) {
  toast(`${pos.direction === "long" ? "Long" : "Short"} ${pos.symbol} opened`, {
    type: "success",
    id: `open-${pos.symbol}`,
    description: `${pos.leverage}× · ${fmtUsd(pos.marginUsed).replace("+", "")} margin`,
  });
}

function snapshotToPosition(open: BulkPosition): Position | null {
  const sym = bulkToSym[open.symbol];
  if (!sym) return null;
  const direction: Direction = open.size > 0 ? "long" : "short";
  const marginUsed =
    open.leverage > 0 ? Math.abs(open.notional) / open.leverage : 0;
  return {
    symbol: sym,
    direction,
    size: Math.abs(open.size),
    entryPrice: open.price,
    leverage: open.leverage,
    liquidationPrice: open.liquidationPrice,
    marginUsed,
    unrealizedPnl: open.unrealizedPnl,
    openedAt: Date.now(),
  };
}
