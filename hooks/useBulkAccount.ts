"use client";

import { useEffect, useRef } from "react";
import { subscribeAccount } from "@/lib/bulk/accountWs";
import { fetchAccount } from "@/lib/bulk/client";
import { readMargin } from "@/lib/bulk/types";
import type { BulkPosition } from "@/lib/bulk/types";
import { MARKETS } from "@/lib/markets";
import { api } from "@/lib/api";
import { useAppDispatch, useAppStore } from "@/store/hooks";
import { setBalance, mergeBalance } from "@/store/slices/userSlice";
import {
  setPosition,
  reconcilePositions,
  clearAllPositions,
} from "@/store/slices/positionSlice";
import { clearPendingChartEntry } from "@/store/slices/tradingSlice";
import { hydrateLiveHistory } from "@/store/slices/historySlice";
import { recordClose } from "@/lib/history";
import { hydrateLiveEpisodes } from "@/store/slices/replaySlice";
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

      // Recorded price paths for replaying those trades. Optional data — a
      // failure here must never affect the history itself.
      api
        .fetchEpisodes(privyId)
        .then((episodes) => dispatch(hydrateLiveEpisodes(episodes)))
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
        // Bulk renamed these (totalBalance→totalMargin, availableBalance→
        // availableMargin), so read them through the normalizer rather than by
        // a single hard-coded spelling.
        const m = readMargin(acct.margin);
        dispatch(
          setBalance({
            equity: m.equity ?? 0,
            available: m.available ?? 0,
            marginUsed: m.marginUsed ?? 0,
            unrealizedPnl: m.unrealizedPnl ?? 0,
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
      // A snapshot is authoritative and replaces the balance; a delta is
      // partial and must be MERGED. Replacing on a delta is what previously
      // zeroed `equity` and left the pill showing PnL-since-load only.
      onBalance: (b, snapshot) =>
        dispatch(snapshot ? setBalance(b) : mergeBalance(b)),

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
            // decrease() opened, so it never spins forever, and log the event to
            // history (WS is the source of truth for the real filled size/PnL).
            toastAdjust(toast, prev, next);
            recordAdjustFor(store, dispatch, privyId, prev, next);
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
  // recordClose sealed the recording into the store — upload it so the replay
  // survives a reload and follows the user across devices. Best-effort: a
  // failed upload costs a replay, never the trade row.
  if (privyId && trade.episodeId) {
    const episode = store.getState().replay.byId[trade.episodeId];
    if (episode) api.recordEpisode(privyId, episode).catch(() => {});
  }
  // Confirm the close (upgrades the pending close-<sym> loading toast if present).
  toast(`Closed ${prev.symbol}`, {
    type: prev.unrealizedPnl >= 0 ? "success" : "info",
    id: `close-${prev.symbol}`,
    description: `Realized ${fmtUsd(prev.unrealizedPnl)}`,
    // Only an actual gain earns the burst — break-even closes stay quiet so the
    // celebration keeps meaning something.
    confetti: prev.unrealizedPnl > 0,
  });
}

// Log a live add / reduce to trade history. An `add` has no realized PnL; a
// `reduce` realizes the portion that left the position (prev PnL scaled by the
// fraction reduced). Size logged is the delta actually filled.
function recordAdjustFor(
  store: AppStore,
  dispatch: AppDispatch,
  privyId: string | null,
  prev: Position,
  next: Position
) {
  const delta = Math.abs(next.size - prev.size);
  if (next.size > prev.size) {
    // Added size — informational row, no realized PnL.
    const t = recordClose(dispatch, "live", next, next.entryPrice, 0, "add", delta);
    if (privyId) api.recordTrade(privyId, t).catch(() => {});
  } else {
    // Reduced size — realize the reduced fraction of the prior PnL.
    const exit = store.getState().price.prices[prev.symbol] ?? prev.entryPrice;
    const realized =
      prev.size > 0 ? prev.unrealizedPnl * (delta / prev.size) : 0;
    const t = recordClose(dispatch, "live", prev, exit, realized, "reduce", delta);
    if (privyId) api.recordTrade(privyId, t).catch(() => {});
  }
}

// Confirm a live add / reduce (upgrades the pending adjust-<sym> loading toast
// that increase()/decrease() opened). Fires only on an open→open SIZE change.
function toastAdjust(toast: ToastFn, prev: Position, next: Position) {
  const added = next.size > prev.size;
  toast(`${added ? "Added to" : "Reduced"} ${next.symbol}`, {
    type: added ? "success" : "info",
    id: `adjust-${next.symbol}`,
    description: `${next.leverage}× · ${fmtUsd(next.marginUsed).replace("+", "")} margin`,
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
