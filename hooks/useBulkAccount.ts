"use client";

import { useEffect, useRef } from "react";
import { subscribeAccount } from "@/lib/bulk/accountWs";
import { fetchAccount } from "@/lib/bulk/client";
import { readMargin } from "@/lib/bulk/types";
import { isDustSize } from "@/lib/bulk/orders";
import { readProtection } from "@/lib/bulk/protection";
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
import {
  hydrateLiveHistory,
  markLiveHydrated,
} from "@/store/slices/historySlice";
import { recordClose } from "@/lib/history";
import {
  rememberOpen,
  readStoredOpen,
  forgetOpen,
  type StoredOpenPosition,
} from "@/lib/bulk/openPositionStore";
import { reconcileClose } from "@/lib/bulk/reconcileClose";
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
      // Signed out: there is no live history to wait for, so settle the flag or
      // the history panel would show a loading state indefinitely.
      dispatch(markLiveHydrated());
      lastOpen.current = {};
      // The stored open-position sentinel is deliberately NOT cleared here.
      // Signing out says nothing about what happened on Bulk, and the whole
      // point of it is to survive the app not running — clearing it would throw
      // away the only record of a position whose stop fires before the next
      // sign-in, which is exactly the case this exists to catch. It is keyed by
      // wallet, so it can only ever be read back by the account that wrote it.
      return;
    }

    // Load this user's persisted live history from the backend (by Privy DID).
    // No DID means nothing to fetch — settle the flag so the panel renders its
    // empty state instead of waiting on a request that will never be made.
    if (!privyId) dispatch(markLiveHydrated());
    if (privyId) {
      api
        .fetchHistory(privyId)
        .then((trades) => {
          // Always apply: an empty result means this user has no live trades,
          // so any stale live rows should be cleared while demo trades stay.
          dispatch(hydrateLiveHistory(trades));
        })
        .catch(() => {
          // Failed fetch still settles the flag: showing the empty state is
          // wrong but recoverable, whereas an endless skeleton is a dead end.
          dispatch(markLiveHydrated());
        });

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
          // A flat account still has to answer for anything we last saw open:
          // a stop that fired while the app was closed leaves exactly this
          // shape. Reconcile against an EMPTY open set.
          backfillUnobservedCloses(store, dispatch, walletAddress, privyId, []);
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
        // NOTE: dust rows (a sub-lot residue left by a close that filled a hair
        // short) are dropped by `snapshotToPosition`, so they never seed
        // `lastOpen` and never render. That is deliberate — they are unclosable
        // — but it also means a position that shrank to dust while we were NOT
        // connected produces no open→absent transition here, and so no history
        // row. Nothing can be reconstructed from this endpoint alone (the exit
        // price and pre-close size are gone), so such a close is logged for
        // backfill rather than silently dropped.
        for (const raw of acct.positions) {
          const sym = bulkToSym[raw.symbol];
          if (!sym || raw.size === 0) continue;
          if (isDustSize(raw.size, MARKETS[sym].lotSize)) {
            console.warn(
              `[tradash] ${raw.symbol} is stranded dust (size ${raw.size}); ` +
                `its close was never recorded to history and cannot be ` +
                `reconstructed from /account — backfill from Bulk fills.`
            );
          }
        }
        const open = acct.positions
          .filter((p) => p.size !== 0)
          .map((p) => snapshotToPosition(p))
          .filter((p): p is Position => p !== null)
          .map((p) => enrich(store, dispatch, p, lastOpen.current[p.symbol]));
        const map: Partial<Record<MarketSymbol, Position>> = {};
        for (const p of open) map[p.symbol] = p;
        lastOpen.current = map;
        dispatch(reconcilePositions(open));
        // Anything we last saw open that Bulk no longer reports closed while we
        // were not watching — record it before overwriting the snapshot, or the
        // evidence it ever existed is gone.
        backfillUnobservedCloses(store, dispatch, walletAddress, privyId, open);
        rememberOpen(walletAddress, open);
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
        rememberOpen(
          walletAddress,
          Object.values(incoming) as Position[]
        );
      },

      // Single-market delta.
      onPositionDelta: (symbol, p) => {
        const prev = lastOpen.current[symbol] ?? null;
        if (prev && !p) {
          recordCloseFor(store, dispatch, privyId, prev, toast);
          delete lastOpen.current[symbol];
          // Recorded here, so the sentinel has done its job. Dropping it is
          // what stops the next load backfilling this same close a second time.
          forgetOpen(walletAddress, symbol);
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
          rememberOpen(
            walletAddress,
            Object.values(lastOpen.current) as Position[]
          );
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

/**
 * Record closes that happened while the app was NOT running.
 *
 * TP / SL / trailing stops rest on Bulk and fire server-side, so a position can
 * go flat with no client watching. The normal recording path keys off an
 * open→absent transition seen live, which in that case never happens — so the
 * trade was silently missing from history, stats and the leaderboard, while an
 * identical trade closed by hand recorded fine.
 *
 * Compares the positions we durably remembered as open against what Bulk
 * actually reports now; anything remembered but no longer open is a close we
 * missed. Called with the authoritative open set from the seed `/account` read.
 *
 * Each missed market is forgotten BEFORE the row is written, so a close is
 * recorded ONCE — the write has no server-side dedupe, and a duplicate would
 * inflate the public leaderboard.
 */
function backfillUnobservedCloses(
  store: AppStore,
  dispatch: AppDispatch,
  wallet: string,
  privyId: string | null,
  openNow: Position[]
) {
  const stored = readStoredOpen(wallet);
  if (stored.length === 0) return;

  const stillOpen = new Set(openNow.map((p) => p.symbol));
  const missed = stored.filter((p) => !stillOpen.has(p.symbol));
  if (missed.length === 0) return;

  // CLAIM the missed markets synchronously, before any awaiting. Everything
  // below is async, and both `rememberOpen` (which rewrites the whole map) and a
  // second call to this function can land in that window — so leaving the
  // sentinels in place until the write completes is how the same close gets
  // recorded twice. Forgetting them first makes the claim atomic: whoever reads
  // the store next sees these markets as already handled.
  for (const prev of missed) forgetOpen(wallet, prev.symbol);

  // The price feed streams in and starts EMPTY, while this runs as soon as the
  // seed /account read resolves — so reading prices right now usually gets
  // nothing, and every backfill would fall back to entry (PnL 0) or pick a
  // trigger without being able to tell which one fired. One short wait for the
  // first tick is the difference between a truthful row and a placeholder.
  void waitForPrice(store, missed[0].symbol).then(() => {
    for (const prev of missed) recordBackfilled(store, dispatch, privyId, prev);
  });
}

/**
 * Resolve once this market has a price, or after a short timeout.
 *
 * Bounded deliberately: a backfilled row that is slightly less precise is far
 * better than one that never gets written because the oracle happened to be
 * down. On timeout the reconciler falls back as documented.
 */
function waitForPrice(store: AppStore, symbol: MarketSymbol): Promise<void> {
  if (store.getState().price.prices[symbol] != null) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      unsub();
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, 4000);
    const unsub = store.subscribe(() => {
      if (store.getState().price.prices[symbol] != null) finish();
    });
  });
}

/** Write ONE backfilled close: reconcile it, forget it, record it. */
function recordBackfilled(
  store: AppStore,
  dispatch: AppDispatch,
  privyId: string | null,
  prev: StoredOpenPosition
) {
  const price = store.getState().price.prices[prev.symbol];
  const { position, exitPrice, pnl, confident } = reconcileClose(prev, price);

  const trade = recordClose(dispatch, "live", position, exitPrice, pnl);
  if (privyId) void api.recordTrade(privyId, trade);

  console.info(
    `[tradash] backfilled an unobserved ${prev.symbol} close ` +
      `(exit ${exitPrice}${confident ? " from a resting trigger" : " ESTIMATED"}, ` +
      `pnl ${pnl.toFixed(2)}) — closed server-side while the app was shut.`
  );
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
  // Queued through the outbox: this resolves once the write has either landed
  // or been persisted for retry, so the trade survives an API outage.
  if (privyId) void api.recordTrade(privyId, trade);
  // recordClose sealed the recording into the store — upload it so the replay
  // survives a reload and follows the user across devices. Best-effort: a
  // failed upload costs a replay, never the trade row.
  if (privyId && trade.episodeId) {
    const episode = store.getState().replay.byId[trade.episodeId];
    if (episode) void api.recordEpisode(privyId, episode);
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
    if (privyId) void api.recordTrade(privyId, t);
  } else {
    // Reduced size — realize the reduced fraction of the prior PnL.
    const exit = store.getState().price.prices[prev.symbol] ?? prev.entryPrice;
    const realized =
      prev.size > 0 ? prev.unrealizedPnl * (delta / prev.size) : 0;
    const t = recordClose(dispatch, "live", prev, exit, realized, "reduce", delta);
    if (privyId) void api.recordTrade(privyId, t);
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
  // Sub-lot residue from a close that filled a hair short — unclosable on Bulk
  // and economically zero. Mirrors the same filter on the WS path (toPosition
  // in lib/bulk/accountWs.ts); both must agree or the REST snapshot would
  // resurrect a position the stream drops.
  if (isDustSize(open.size, MARKETS[sym].lotSize)) return null;
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
    // Bulk's own mark + charged costs: the first translates Bulk-quoted lines
    // into the chart's MagicBlock space, the second draws the net break-even.
    markPriceBulk: open.fairPrice,
    realizedPnl: open.realizedPnl,
    // Resting TP/SL/trailing. Must match the WS path (toPosition) or a refetch
    // would blank out protection the stream had already shown.
    protection: readProtection(open.protection?.orders),
    openedAt: Date.now(),
  };
}
