"use client";

import { config } from "@/lib/config";
import type {
  Direction,
  MarketSymbol,
  Position,
  ProtectionKind,
} from "@/types";

/**
 * A durable record of the live positions we last saw open, so a close that
 * happened while the app was CLOSED can still be written to trade history.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * History is recorded from an `open → absent` transition observed by
 * `useBulkAccount`: it remembers the open position in a ref and, when the
 * account WS reports that market flat, reconstructs the completed trade from
 * what it remembered. That ref lives in memory and starts empty.
 *
 * TP / SL / trailing stops rest on BULK and fire SERVER-SIDE, whether or not the
 * app is open (see `lib/bulk/protection.ts`). So the common case is:
 *
 *   1. user opens a position with a stop, then closes the tab
 *   2. Bulk fires the stop — the position goes flat on the server
 *   3. user comes back: the seed `/account` read and the WS snapshot both show
 *      NO position, so nothing is ever remembered as open
 *   4. there is no open→absent transition, so NO history row is ever written
 *
 * The trade simply vanished — missing from history, stats and the leaderboard —
 * while a manually-closed trade recorded fine, because closing by hand requires
 * the user to be there watching it. That asymmetry is the bug this fixes.
 *
 * Persisting the last-seen open position closes the gap: on startup we compare
 * what we stored against what Bulk actually reports and treat anything now flat
 * as a close to backfill.
 *
 * ── WHAT THIS IS NOT ─────────────────────────────────────────────────────────
 * NOT a source of truth for open positions. Those still come from Bulk only —
 * `store/persist.ts` deliberately never persists them, and this must not become
 * a back door that resurrects a position the exchange no longer has. It is
 * written when Bulk confirms a position open, read ONCE at startup to detect
 * what closed unobserved, and cleared as soon as it has been reconciled.
 */

const PREFIX = "tradash.openpos.v1:";

/**
 * Scoped to the wallet AND the Bulk network, for the same reason `agentStore`
 * and `builderStore` are: positions on testnet mean nothing on mainnet, and two
 * wallets on one device must not inherit each other's open positions. Unscoped,
 * switching either would backfill a phantom close against the wrong account.
 */
function key(wallet: string): string {
  return `${PREFIX}${config.bulk.network}:${wallet}`;
}

/**
 * The fields needed to reconstruct a completed trade, and nothing else.
 *
 * Deliberately a flat snapshot rather than the live `Position`: the parts that
 * only mean something in a running session (`pnlAnchor`, `priceAnchorMb`,
 * resting `protection`) would be stale on the next load and must not be
 * mistaken for current state.
 */
export interface StoredOpenPosition {
  symbol: MarketSymbol;
  direction: Direction;
  size: number;
  entryPrice: number;
  leverage: number;
  marginUsed: number;
  /** ms epoch the position opened, so the backfilled row keeps its duration. */
  openedAt: number;
  /**
   * Unrealized PnL when last seen. A fallback only: the reconciler prefers PnL
   * derived from the position's own exit price, because this figure is as old as
   * the last moment the tab was open.
   */
  unrealizedPnl: number;
  /** When this snapshot was written, for staleness checks. */
  seenAt: number;
  /**
   * The protective triggers resting on Bulk when we last looked.
   *
   * Stored because they are the ONLY on-device evidence of the price a
   * server-side close actually filled at. When a position we last saw with a
   * take-profit at 65,000 comes back flat, 65,000 is a far better exit than
   * "whatever the market happens to be now" — which, hours later, can be on the
   * wrong side of the entry and would record a LOSS for a trade that took
   * profit. The reconciler still can't know WHICH trigger fired, so it picks by
   * proximity to the first price it sees on this load; see `reconcileClose`.
   */
  triggers?: StoredTrigger[];
}

/** A resting protective trigger, reduced to what pricing an exit needs. */
export interface StoredTrigger {
  kind: ProtectionKind;
  triggerPrice: number;
}

type StoredMap = Partial<Record<MarketSymbol, StoredOpenPosition>>;

function read(wallet: string): StoredMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key(wallet));
    return raw ? (JSON.parse(raw) as StoredMap) : {};
  } catch {
    // Corrupt or unavailable storage (private mode, quota). Behave as empty:
    // losing a backfill is bad, but throwing here would break the account hook
    // on every load, which is worse.
    return {};
  }
}

function write(wallet: string, map: StoredMap) {
  if (typeof window === "undefined") return;
  try {
    const entries = Object.keys(map);
    if (entries.length === 0) window.localStorage.removeItem(key(wallet));
    else window.localStorage.setItem(key(wallet), JSON.stringify(map));
  } catch {
    /* non-fatal — the in-memory path still records normally */
  }
}

/** Snapshot the open positions Bulk currently reports for this wallet. */
export function rememberOpen(wallet: string, positions: Position[]) {
  const map: StoredMap = {};
  const seenAt = Date.now();
  for (const p of positions) {
    map[p.symbol] = {
      symbol: p.symbol,
      direction: p.direction,
      size: p.size,
      entryPrice: p.entryPrice,
      leverage: p.leverage,
      marginUsed: p.marginUsed,
      openedAt: p.openedAt,
      unrealizedPnl: p.unrealizedPnl,
      seenAt,
      // A trailing stop's trigger RATCHETS as price moves in your favour, so the
      // level stored here is only the one last seen, not necessarily the one it
      // fired at. Recorded anyway: a stale trail level is still far closer to
      // the true exit than an unrelated current market price.
      triggers: (p.protection ?? [])
        .filter((o) => Number.isFinite(o.triggerPrice) && o.triggerPrice > 0)
        .map((o) => ({ kind: o.kind, triggerPrice: o.triggerPrice })),
    };
  }
  write(wallet, map);
}

/** Read back everything we last saw open. */
export function readStoredOpen(wallet: string): StoredOpenPosition[] {
  return Object.values(read(wallet)).filter(
    (p): p is StoredOpenPosition => !!p && isValid(p)
  );
}

/** Drop one market's snapshot — called once its close has been reconciled. */
export function forgetOpen(wallet: string, symbol: MarketSymbol) {
  const map = read(wallet);
  if (!(symbol in map)) return;
  delete map[symbol];
  write(wallet, map);
}

/**
 * Guard against a hand-edited or half-written blob becoming a fabricated trade.
 * A backfilled row feeds stats and the PUBLIC leaderboard, so anything that
 * isn't a complete, positive-sized position is dropped rather than trusted.
 */
function isValid(p: StoredOpenPosition): boolean {
  return (
    typeof p.symbol === "string" &&
    (p.direction === "long" || p.direction === "short") &&
    Number.isFinite(p.size) &&
    p.size > 0 &&
    Number.isFinite(p.entryPrice) &&
    p.entryPrice > 0 &&
    Number.isFinite(p.openedAt) &&
    p.openedAt > 0
  );
}
