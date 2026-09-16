import { config } from "@/lib/config";
import { MARKETS, MARKET_ORDER } from "@/lib/markets";
import { isDustSize } from "./orders";
import type { MarketSymbol, Balance, Position, Direction } from "@/types";
import { readMargin, type BulkMargin } from "./types";

// Subscribes to the Bulk account WebSocket (no signature required). Pushes live
// margin (balance/equity) and position deltas (entry, size, leverage, liq price,
// unrealized PnL) to the caller, who commits them into the user/position slices.
//
// The stream sends an initial `accountSnapshot` then typed delta messages. We
// normalize both into balance/position callbacks.

const bulkToSymbol: Record<string, MarketSymbol> = Object.fromEntries(
  MARKET_ORDER.map((s) => [MARKETS[s].bulkSymbol, s])
);

export interface AccountEvents {
  /**
   * Margin update. `snapshot` = authoritative full margin (replace); otherwise
   * it's a merged delta — see `emitBalance` for why deltas must not be treated
   * as complete.
   */
  onBalance?: (b: Balance, snapshot: boolean) => void;
  /** Full set of open positions (from a snapshot) — reconcile all markets. */
  onSnapshot?: (positions: Position[]) => void;
  /** A single market's position changed (delta). null = that market closed. */
  onPositionDelta?: (symbol: MarketSymbol, position: Position | null) => void;
}

// Real WS shapes (verified live 2026-07-26). Account messages arrive as
// { type:"account", data:{ type:"accountSnapshot"|<delta>, margin:{...}, positions:[...] } }
// Margin arrives under Bulk's CURRENT field names (`totalMargin` /
// `availableMargin`) — the old `totalBalance` / `availableBalance` spellings
// were retired. `readMargin` accepts either, so both shapes work.
type RawMargin = BulkMargin;

interface RawPosition {
  symbol?: string;
  size?: number;
  price?: number; // avg entry
  fairPrice?: number; // mark
  notional?: number;
  leverage?: number;
  liquidationPrice?: number;
  unrealizedPnl?: number;
  /** Fees/funding already charged against THIS position, signed (negative = paid). */
  realizedPnl?: number;
}

function toPosition(r: RawPosition): Position | null {
  const sym = r.symbol ? bulkToSymbol[r.symbol] : undefined;
  if (!sym || !r.size || r.size === 0 || r.price == null) return null;
  // Dust: a residue below one lot, left behind when a close fills a hair short.
  // It can never be closed (Bulk rejects a sub-lot size outright), holds no
  // meaningful margin or PnL, and would otherwise sit in the UI as an open
  // position the user cannot get rid of. Treat it as flat.
  if (isDustSize(r.size, MARKETS[sym].lotSize)) return null;
  const direction: Direction = r.size > 0 ? "long" : "short";
  const marginUsed =
    r.notional && r.leverage ? Math.abs(r.notional) / r.leverage : 0;
  return {
    symbol: sym,
    direction,
    size: Math.abs(r.size),
    entryPrice: r.price,
    leverage: r.leverage ?? 1,
    liquidationPrice: r.liquidationPrice ?? 0,
    marginUsed,
    unrealizedPnl: r.unrealizedPnl ?? 0,
    // Bulk's OWN mark for this market. Kept because it is the exact anchor for
    // translating Bulk-quoted prices (entry, liquidation) into the chart's
    // MagicBlock space — see lib/perp.ts `bulkToChartShift`.
    markPriceBulk: r.fairPrice,
    realizedPnl: r.realizedPnl,
    openedAt: Date.now(),
  };
}

export function subscribeAccount(
  user: string,
  events: AccountEvents
): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Last known margin, so PARTIAL deltas can be merged rather than replacing.
  // A `marginUpdate` delta carries only the fields that changed, so defaulting
  // the missing ones to 0 would blank out equity.
  let lastMargin: Balance | null = null;

  const emitBalance = (m: RawMargin, replace = false) => {
    const r = readMargin(m);
    // Nothing to merge into yet and no equity in this message → publishing it
    // would invent an equity the server never sent. Wait for the snapshot.
    if (!replace && !lastMargin && r.equity == null) return;
    const base = replace ? null : lastMargin;
    const next: Balance = {
      equity: r.equity ?? base?.equity ?? 0,
      available: r.available ?? base?.available ?? 0,
      marginUsed: r.marginUsed ?? base?.marginUsed ?? 0,
      unrealizedPnl: r.unrealizedPnl ?? base?.unrealizedPnl ?? 0,
    };
    lastMargin = next;
    events.onBalance?.(next, replace);
  };

  const handleMessage = (raw: string) => {
    let msg: { type?: string; data?: Record<string, unknown> };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Only account messages carry margin/positions; ignore subscriptionResponse etc.
    if (msg.type !== "account" || !msg.data) return;
    const data = msg.data;
    const kind = data.type as string | undefined;

    switch (kind) {
      // Full snapshot: margin nested + positions array → reconcile ALL markets.
      case "accountSnapshot": {
        const margin = data.margin as RawMargin | undefined;
        if (margin) emitBalance(margin, true); // authoritative → replace
        const positions = data.positions as RawPosition[] | undefined;
        if (positions && events.onSnapshot) {
          const open = positions
            .map(toPosition)
            .filter((p): p is Position => p !== null);
          events.onSnapshot(open);
        }
        break;
      }

      // Delta: margin fields are directly on `data` (no nesting).
      case "marginUpdate": {
        emitBalance(data as RawMargin);
        break;
      }

      // Delta: a SINGLE market's position directly on `data`. size 0 = that
      // market closed. We still need its symbol to clear the right one.
      case "positionUpdate": {
        if (!events.onPositionDelta) break;
        const raw = data as RawPosition;
        const sym = raw.symbol ? bulkToSymbol[raw.symbol] : undefined;
        if (!sym) break;
        events.onPositionDelta(sym, !raw.size ? null : toPosition(raw));
        break;
      }

      // fill / orderUpdate / feeTierUpdate etc. carry no balance/position we use.
      default:
        break;
    }
  };

  const connect = () => {
    if (closed) return;
    // A new socket re-sends a snapshot; drop the old merge base so a stale
    // margin can never leak across a reconnect.
    lastMargin = null;
    ws = new WebSocket(config.bulk.accountWsUrl);

    ws.onopen = () => {
      ws?.send(
        JSON.stringify({
          method: "subscribe",
          subscription: [{ type: "account", user }],
        })
      );
    };
    ws.onmessage = (e) => handleMessage(e.data as string);
    ws.onclose = () => {
      if (closed) return;
      // Reconnect with a small backoff.
      reconnectTimer = setTimeout(connect, 1500);
    };
    ws.onerror = () => ws?.close();
  };

  connect();

  return () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  };
}
