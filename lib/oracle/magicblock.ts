import { Connection, PublicKey } from "@solana/web3.js";
import { config } from "@/lib/config";

// MagicBlock real-time pricing oracle client. Prices live in on-chain
// Ephemeral Rollup accounts updated every 50-200ms; we subscribe directly.
// Layout confirmed from github.com/magicblock-labs/oracle-template.
//
// Callers should go through `subscribeToPrice` in ./index, which routes each
// market to its feed — not every market is priced by MagicBlock.

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

/** Derive the price-feed PDA for a Pyth Lazer id. Seed is the id as a string. */
export function feedAddress(pythLazerId: number): PublicKey {
  const feedName = pythLazerId.toString();
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
 * Subscribe to live price updates for one oracle feed. Immediately fetches the
 * current account so the chart has a starting value, then streams changes.
 */
export function subscribeToMagicBlockPrice(
  pythLazerId: number,
  exponent: number,
  onPrice: PriceCallback
): Unsubscribe {
  const conn = getConnection();
  const address = feedAddress(pythLazerId);
  let active = true;

  // Seed with the current value (non-blocking) — unless the caller already
  // unsubscribed, or a stale price lands on whatever market replaced it.
  conn
    .getAccountInfo(address, "confirmed")
    .then((info) => {
      if (active && info?.data) {
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
    active = false;
    conn.removeAccountChangeListener(subId).catch(() => {});
  };
}
