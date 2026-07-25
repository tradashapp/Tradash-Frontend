import { Connection, PublicKey } from "@solana/web3.js";
import { config } from "@/lib/config";
import { MARKETS } from "@/lib/markets";
import type { MarketSymbol } from "@/types";

// MagicBlock real-time pricing oracle client. Prices live in on-chain
// Ephemeral Rollup accounts updated every 50-200ms; we subscribe directly.
// Layout confirmed from github.com/magicblock-labs/oracle-template.

const PROGRAM_ID = new PublicKey(
  "PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd"
);

// Signed i64 (little-endian) price sits at this byte offset in the account data.
const PRICE_OFFSET = 73;

// The Ephemeral Rollup endpoint that streams the price accounts live. The
// price feeds are delegated to an ER, so the base-layer RPC only holds
// snapshots — we must read/subscribe on the ER host (verified ~16 ticks/sec).
const RPC_URL = config.magicblock.erUrl || "https://devnet.magicblock.app";
const WS_URL = RPC_URL.replace(/^http/, "ws");

let connection: Connection | null = null;
function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(RPC_URL, { wsEndpoint: WS_URL });
  }
  return connection;
}

// Encode ASCII seed strings without depending on Node's Buffer global (which
// isn't present in the browser).
const utf8 = (s: string) => new TextEncoder().encode(s);

/** Derive the price-feed PDA for a market. Seed is the feed id as a string. */
export function feedAddress(symbol: MarketSymbol): PublicKey {
  const feedName = MARKETS[symbol].pythLazerId.toString();
  return PublicKey.findProgramAddressSync(
    [utf8("price_feed"), utf8("pyth-lazer"), utf8(feedName)],
    PROGRAM_ID
  )[0];
}

/** Decode the raw account data into a USD price, or null if malformed. */
export function decodePrice(
  data: Uint8Array,
  exponent: number
): number | null {
  if (data.byteLength < PRICE_OFFSET + 8) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const raw = view.getBigInt64(PRICE_OFFSET, true);
  const price = Number(raw) * Math.pow(10, exponent);
  return Number.isFinite(price) && price > 0 ? price : null;
}

export type PriceCallback = (price: number) => void;
export type Unsubscribe = () => void;

/**
 * Subscribe to live price updates for a market. Immediately fetches the current
 * account so the chart has a starting value, then streams changes.
 */
export function subscribeToPrice(
  symbol: MarketSymbol,
  onPrice: PriceCallback
): Unsubscribe {
  const conn = getConnection();
  const address = feedAddress(symbol);
  const { exponent } = MARKETS[symbol];

  // Seed with the current value (non-blocking).
  conn
    .getAccountInfo(address, "confirmed")
    .then((info) => {
      if (info?.data) {
        const p = decodePrice(info.data, exponent);
        if (p != null) onPrice(p);
      }
    })
    .catch(() => {
      /* first-read failure is non-fatal; the subscription will still deliver */
    });

  const subId = conn.onAccountChange(
    address,
    (info) => {
      const p = decodePrice(info.data, exponent);
      if (p != null) onPrice(p);
    },
    "processed"
  );

  return () => {
    conn.removeAccountChangeListener(subId).catch(() => {});
  };
}
