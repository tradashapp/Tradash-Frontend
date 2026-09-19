import { PHOENIX_WS } from "./config";

/**
 * Phoenix account stream — a CHANGE NOTIFIER, not a data source.
 *
 * WHY IT IS ONLY A TRIGGER. Bulk's account websocket pushed computed margin
 * (equity, available, marginUsed, unrealizedPnl), so the client could render
 * straight from the stream. Phoenix's `traderState` channel sends RAW state
 * instead: `subaccounts[].collateral` as an integer string in 1e6 units, with no
 * equity, no margin requirement, no unrealized PnL and no risk state. REST
 * `/v1/view/trader/{pda}` computes all of that.
 *
 * Deriving those numbers in the browser would mean reimplementing Phoenix's
 * risk engine from mark prices and position notionals — and a mismatch would
 * show the user a wrong liquidation price, which is the worst thing this app
 * can get wrong. So the stream answers only "something changed", and the values
 * always come from the venue.
 *
 * The cost is one REST read per account change. That is cheap: the channel only
 * fires on fills, deposits and withdrawals, not on every price tick.
 *
 * KEYED BY AUTHORITY, NOT PDA. One subscription covers every subaccount, so
 * there is no per-subaccount fan-out. All three subscription fields are
 * required; the server names whichever is missing.
 */

export interface AccountStreamHandlers {
  /** Something about the account changed — re-read authoritative state. */
  onChange: (info: { slot: number; messageType: string }) => void;
  /** Transport state, for a connection indicator. */
  onStatus?: (connected: boolean) => void;
}

/** Reconnect backoff, matching `lib/bulk/accountWs.ts`. */
const RECONNECT_MS = 1_500;

/**
 * Subscribe to an account's change stream.
 *
 * Returns an unsubscribe function. Safe to call in a React effect: the socket is
 * closed and reconnection cancelled on teardown.
 */
export function subscribeAccount(
  authority: string,
  handlers: AccountStreamHandlers,
  traderPdaIndex = 0
): () => void {
  let ws: WebSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const connect = () => {
    if (closed) return;
    ws = new WebSocket(PHOENIX_WS);

    ws.onopen = () => {
      handlers.onStatus?.(true);
      ws?.send(
        JSON.stringify({
          type: "subscribe",
          subscription: { channel: "traderState", authority, traderPdaIndex },
        })
      );
    };

    ws.onmessage = (ev) => {
      let msg: {
        channel?: string;
        slot?: number;
        messageType?: string;
        error?: string;
      };
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }

      // The server reports a malformed subscription on this channel rather than
      // closing, so surface it — a silent dead subscription looks like an idle
      // account, which is exactly the bug this stream exists to prevent.
      if (msg.channel === "error") {
        console.warn(`[phoenix] account stream error: ${msg.error ?? "unknown"}`);
        return;
      }
      if (msg.channel !== "traderState") return;

      handlers.onChange({
        slot: msg.slot ?? 0,
        messageType: msg.messageType ?? "unknown",
      });
    };

    ws.onclose = () => {
      handlers.onStatus?.(false);
      if (closed) return;
      // A dropped account stream means missed fills, so reconnect rather than
      // waiting for the next user action to notice.
      timer = setTimeout(connect, RECONNECT_MS);
    };

    ws.onerror = () => ws?.close();
  };

  connect();

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    ws?.close();
  };
}
