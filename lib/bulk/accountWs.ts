import { config } from "@/lib/config";
import { MARKETS, MARKET_ORDER } from "@/lib/markets";
import type { MarketSymbol, Balance, Position, Direction } from "@/types";

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
  onBalance?: (b: Balance) => void;
  onPosition?: (p: Position | null) => void;
}

interface RawMargin {
  equity?: number;
  available?: number;
  marginUsed?: number;
}

interface RawPosition {
  symbol?: string;
  size?: number;
  price?: number;
  leverage?: number;
  liquidationPrice?: number;
  unrealizedPnl?: number;
}

function toPosition(r: RawPosition): Position | null {
  const sym = r.symbol ? bulkToSymbol[r.symbol] : undefined;
  if (!sym || !r.size || r.size === 0 || r.price == null) return null;
  const direction: Direction = r.size > 0 ? "long" : "short";
  return {
    symbol: sym,
    direction,
    size: Math.abs(r.size),
    entryPrice: r.price,
    leverage: r.leverage ?? 1,
    liquidationPrice: r.liquidationPrice ?? 0,
    marginUsed: 0,
    unrealizedPnl: r.unrealizedPnl ?? 0,
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

  const handleMessage = (raw: string) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Margin channel → balance.
    const margin = (msg.margin ?? msg.marginUpdate) as RawMargin | undefined;
    if (margin && events.onBalance) {
      events.onBalance({
        equity: margin.equity ?? 0,
        available: margin.available ?? 0,
        marginUsed: margin.marginUsed ?? 0,
      });
    }

    // Snapshot carries an array of positions; deltas carry one.
    const snapshotPositions = (msg.positions ??
      (msg.accountSnapshot as { positions?: RawPosition[] } | undefined)
        ?.positions) as RawPosition[] | undefined;
    if (snapshotPositions && events.onPosition) {
      // MVP: one position at a time — take the first open one for the account.
      const open = snapshotPositions.map(toPosition).find((p) => p !== null);
      events.onPosition(open ?? null);
    } else {
      const single = (msg.position ?? msg.positionUpdate) as
        | RawPosition
        | undefined;
      if (single && events.onPosition) {
        events.onPosition(toPosition(single));
      }
    }
  };

  const connect = () => {
    if (closed) return;
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
