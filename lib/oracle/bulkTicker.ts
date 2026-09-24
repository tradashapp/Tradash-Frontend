import { config } from "@/lib/config";
import type { PriceCallback, Unsubscribe } from "./magicblock";

// Live price from Bulk's public `ticker` stream, for markets MagicBlock has no
// oracle feed for (see `priceSource` on MarketInfo). Verified live 2026-09-24
// on mainnet-ws1: `{method:"subscribe",subscription:[{type:"ticker",symbol}]}`
// → `{type:"ticker", topic:"ticker.<SYM>", data:{ticker:{markPrice,...}}}`,
// about 5 updates/sec. No signature needed.
//
// We emit `markPrice`: it's the price Bulk marks positions (PnL, liquidation)
// against, so the chart line and every Bulk-quoted level sit in one space.
//
// One socket is shared by every Bulk-priced market and opened only while at
// least one of them has a listener. The ticker also rides the account WS host,
// but on its OWN socket so a price drop and an account drop don't take each
// other down.

const RECONNECT_MS = 1500;

const listeners = new Map<string, Set<PriceCallback>>();
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function send(bulkSymbol: string) {
  if (ws?.readyState !== WebSocket.OPEN) return; // onopen subscribes the rest
  ws.send(
    JSON.stringify({
      method: "subscribe",
      subscription: [{ type: "ticker", symbol: bulkSymbol }],
    })
  );
}

function emit(bulkSymbol: string, price: number) {
  listeners.get(bulkSymbol)?.forEach((cb) => cb(price));
}

function handleMessage(raw: string) {
  let msg: {
    type?: string;
    data?: { ticker?: { symbol?: string; markPrice?: number } };
  };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (msg.type !== "ticker") return;
  const t = msg.data?.ticker;
  const price = t?.markPrice;
  if (!t?.symbol || price == null || !Number.isFinite(price) || price <= 0) {
    return;
  }
  emit(t.symbol, price);
}

function connect() {
  if (listeners.size === 0) return;
  const socket = new WebSocket(config.bulk.accountWsUrl);
  ws = socket;
  socket.onopen = () => listeners.forEach((_, sym) => send(sym));
  socket.onmessage = (e) => handleMessage(e.data as string);
  socket.onclose = () => {
    if (ws !== socket) return; // superseded or torn down on purpose
    ws = null;
    if (listeners.size > 0) reconnectTimer = setTimeout(connect, RECONNECT_MS);
  };
  socket.onerror = () => socket.close();
}

function disconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  const socket = ws;
  ws = null;
  socket?.close();
}

/** Seed a first value over REST so the chart doesn't wait for the first push. */
function seed(bulkSymbol: string, onPrice: PriceCallback) {
  fetch(`${config.bulk.restUrl}/ticker/${bulkSymbol}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((t: { markPrice?: number } | null) => {
      const p = t?.markPrice;
      if (p != null && Number.isFinite(p) && p > 0) onPrice(p);
    })
    .catch(() => {
      /* non-fatal; the stream will deliver */
    });
}

/** Subscribe to a Bulk market's live mark price, e.g. "PUMP-USD". */
export function subscribeToBulkPrice(
  bulkSymbol: string,
  onPrice: PriceCallback
): Unsubscribe {
  let set = listeners.get(bulkSymbol);
  const isNewSymbol = !set;
  if (!set) {
    set = new Set();
    listeners.set(bulkSymbol, set);
  }
  set.add(onPrice);

  if (!ws && !reconnectTimer) connect();
  else if (isNewSymbol) send(bulkSymbol);
  seed(bulkSymbol, onPrice);

  return () => {
    const s = listeners.get(bulkSymbol);
    if (!s) return;
    s.delete(onPrice);
    // Bulk's ticker has no verified unsubscribe; an orphaned symbol just
    // has no listeners to reach until the socket next reconnects.
    if (s.size === 0) listeners.delete(bulkSymbol);
    if (listeners.size === 0) disconnect();
  };
}
