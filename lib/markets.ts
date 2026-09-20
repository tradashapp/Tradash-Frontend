import type { MarketCategory, MarketInfo, MarketSymbol } from "@/types";

// Markets are the intersection of two sources, both verified 2026-08-17:
//   1. Bulk's exchangeInfo (status "TRADING") — what we can actually trade on.
//   2. MagicBlock's oracle program — what we can actually price in real time.
// Bulk also lists LIT, MEGA, MON and XPL, but those four have a Pyth Lazer id
// with NO deployed price-feed PDA on the ER, so they'd render a dead price.
// They're deliberately excluded; re-probe before adding them back.
//
// phoenixSymbol is the same asset WITHOUT the quote suffix ("BTC", not
// "BTC-USD"). Every active market here is listed on Phoenix (verified live
// 2026-09-19), but the field is optional in MarketInfo on purpose: this list is
// the intersection of Bulk and the MagicBlock oracle, so a future addition may
// have no Phoenix counterpart, and the adapter must refuse to trade it rather
// than guess a symbol.
// pythLazerId + exponent come from MagicBlock's oracle-template
// (pyth_lazer_list.json): the feed PDA seed is the id as a string, and
// USD price = rawI64 * 10^exponent. maxLeverage mirrors Bulk's exchangeInfo.
export const MARKETS: Record<MarketSymbol, MarketInfo> = {
  BTC: {
    symbol: "BTC",
    bulkSymbol: "BTC-USD",
    phoenixSymbol: "BTC",
    label: "Bitcoin",
    pythLazerId: 1,
    exponent: -8,
    maxLeverage: 40,
    lotSize: 0.000001,
    phoenixLotSize: 0.0001,
    logo: "/images/crypto/btc.png",
    categories: ["crypto"],
  },
  ETH: {
    symbol: "ETH",
    bulkSymbol: "ETH-USD",
    phoenixSymbol: "ETH",
    label: "Ethereum",
    pythLazerId: 2,
    exponent: -8,
    maxLeverage: 25,
    lotSize: 0.0001,
    phoenixLotSize: 0.001,
    logo: "/images/crypto/eth.png",
    categories: ["crypto"],
  },
  SOL: {
    symbol: "SOL",
    bulkSymbol: "SOL-USD",
    phoenixSymbol: "SOL",
    label: "Solana",
    pythLazerId: 6,
    exponent: -8,
    maxLeverage: 20,
    lotSize: 0.0001,
    phoenixLotSize: 0.01,
    logo: "/images/crypto/sol.png",
    categories: ["crypto"],
  },
  // XRP: {
  //   symbol: "XRP",
  //   bulkSymbol: "XRP-USD",
  //   label: "XRP",
  //   pythLazerId: 14,
  //   exponent: -8,
  //   maxLeverage: 20,
  //   lotSize: 0.000001,
  //   logo: "/images/crypto/xrp.png",
  //   categories: ["crypto"],
  // },
  // BNB: {
  //   symbol: "BNB",
  //   bulkSymbol: "BNB-USD",
  //   label: "BNB",
  //   pythLazerId: 15,
  //   exponent: -8,
  //   maxLeverage: 10,
  //   lotSize: 0.000001,
  //   logo: "/images/crypto/bnb.png",
  //   categories: ["crypto"],
  // },
  // DOGE: {
  //   symbol: "DOGE",
  //   bulkSymbol: "DOGE-USD",
  //   label: "Dogecoin",
  //   pythLazerId: 13,
  //   exponent: -8,
  //   maxLeverage: 10,
  //   lotSize: 0.000001,
  //   logo: "/images/crypto/doge.png",
  //   categories: ["crypto"],
  // },
  // SUI: {
  //   symbol: "SUI",
  //   bulkSymbol: "SUI-USD",
  //   label: "Sui",
  //   pythLazerId: 11,
  //   exponent: -8,
  //   maxLeverage: 10,
  //   lotSize: 0.00000001,
  //   logo: "/images/crypto/sui.png",
  //   categories: ["crypto"],
  // },
  // NEAR: {
  //   symbol: "NEAR",
  //   bulkSymbol: "NEAR-USD",
  //   label: "NEAR Protocol",
  //   pythLazerId: 27,
  //   exponent: -8,
  //   maxLeverage: 10,
  //   lotSize: 0.00000001,
  //   logo: "/images/crypto/near.png",
  //   categories: ["crypto"],
  // },
  // AAVE: {
  //   symbol: "AAVE",
  //   bulkSymbol: "AAVE-USD",
  //   label: "Aave",
  //   pythLazerId: 29,
  //   exponent: -8,
  //   maxLeverage: 10,
  //   lotSize: 0.00000001,
  //   logo: "/images/crypto/aave.png",
  //   categories: ["crypto"],
  // },
  // TAO: {
  //   symbol: "TAO",
  //   bulkSymbol: "TAO-USD",
  //   label: "Bittensor",
  //   pythLazerId: 36,
  //   exponent: -8,
  //   maxLeverage: 10,
  //   lotSize: 0.00000001,
  //   logo: "/images/crypto/tao.png",
  //   categories: ["crypto"],
  // },
  ZEC: {
    symbol: "ZEC",
    bulkSymbol: "ZEC-USD",
    phoenixSymbol: "ZEC",
    label: "Zcash",
    pythLazerId: 66,
    exponent: -8,
    maxLeverage: 10,
    lotSize: 0.00000001,
    logo: "/images/crypto/zec.png",
    categories: ["crypto"],
  },
  // ENA: {
  //   symbol: "ENA",
  //   bulkSymbol: "ENA-USD",
  //   label: "Ethena",
  //   pythLazerId: 85,
  //   exponent: -8,
  //   maxLeverage: 10,
  //   lotSize: 0.00000001,
  //   logo: "/images/crypto/ena.png",
  //   categories: ["crypto"],
  // },
  // JTO: {
  //   symbol: "JTO",
  //   bulkSymbol: "JTO-USD",
  //   label: "Jito",
  //   pythLazerId: 91,
  //   exponent: -8,
  //   maxLeverage: 10,
  //   lotSize: 0.00000001,
  //   logo: "/images/crypto/jto.png",
  //   categories: ["crypto"],
  // },
  // JUP: {
  //   symbol: "JUP",
  //   bulkSymbol: "JUP-USD",
  //   label: "Jupiter",
  //   pythLazerId: 92,
  //   exponent: -8,
  //   maxLeverage: 10,
  //   lotSize: 0.00000001,
  //   logo: "/images/crypto/jup.png",
  //   categories: ["crypto"],
  // },
  HYPE: {
    symbol: "HYPE",
    bulkSymbol: "HYPE-USD",
    phoenixSymbol: "HYPE",
    label: "Hyperliquid",
    pythLazerId: 110,
    exponent: -8,
    maxLeverage: 10,
    lotSize: 0.00000001,
    logo: "/images/crypto/hype.png",
    categories: ["crypto"],
  },
  // FARTCOIN: {
  //   symbol: "FARTCOIN",
  //   bulkSymbol: "FARTCOIN-USD",
  //   label: "Fartcoin",
  //   pythLazerId: 182,
  //   exponent: -8,
  //   maxLeverage: 10,
  //   lotSize: 0.00000001,
  //   logo: "/images/crypto/fartcoin.png",
  //   categories: ["crypto"],
  // },
};

/** Bulk's market id ("BTC-USD") → our MarketSymbol ("BTC"). */
export const BULK_TO_SYMBOL: Record<string, MarketSymbol> = Object.fromEntries(
  Object.values(MARKETS).map((m) => [m.bulkSymbol, m.symbol])
);

/**
 * Smallest tradable size increment for a Bulk market id, for flooring outgoing
 * order sizes (see `floorToLot` in lib/bulk/orders.ts).
 *
 * Falls back to the FINEST lot in the table for an unknown market: an unknown
 * symbol should not cause us to silently round a real size down to nothing, and
 * Bulk rejects a too-fine size loudly anyway.
 */
export function lotSizeForBulkSymbol(bulkSymbol: string): number {
  const sym = BULK_TO_SYMBOL[bulkSymbol];
  return sym ? MARKETS[sym].lotSize : 1e-8;
}

export const MARKET_ORDER: MarketSymbol[] = [
  "BTC",
  "ETH",
  "SOL",
  // "XRP",
  // "BNB",
  // "DOGE",
  // "SUI",
  // "NEAR",
  // "AAVE",
  // "TAO",
  "ZEC",
  // "ENA",
  // "JTO",
  // "JUP",
  "HYPE",
  // "FARTCOIN",
];

export const DEFAULT_MARKET: MarketSymbol = "BTC";

// --- Leverage ----------------------------------------------------------------
// Every market has its OWN ceiling on Bulk (see `maxLeverage` above, mirrored
// from exchangeInfo: BTC 40×, ETH 25×, SOL/XRP 20×, everything else 10×), so
// leverage is stored per market and always resolved through these helpers —
// never read raw. That keeps a value chosen on BTC from leaking onto a 10×
// market as an order Bulk would margin differently than the UI promised.

/** Leverage a market starts at before the user picks one. */
export const DEFAULT_LEVERAGE = 10;

/** Highest leverage Bulk accepts for this market. */
export function maxLeverageFor(symbol: MarketSymbol): number {
  return MARKETS[symbol]?.maxLeverage ?? DEFAULT_LEVERAGE;
}

/** Round `leverage` to a whole number inside [1, market cap]. */
export function clampLeverage(symbol: MarketSymbol, leverage: number): number {
  const max = maxLeverageFor(symbol);
  if (!Number.isFinite(leverage)) return Math.min(DEFAULT_LEVERAGE, max);
  return Math.min(max, Math.max(1, Math.round(leverage)));
}

/**
 * The leverage to actually trade a market at: the user's choice for that
 * market, else that market's OWN MAXIMUM — clamped either way, so a stored
 * value can never exceed a cap (e.g. after Bulk lowers one).
 *
 * The unset default is the cap rather than a flat 10× on purpose: this is a
 * one-tap degen app, and the market settings sheet presents leverage as
 * "maxed unless you pull it back". A flat 10× also silently MEANT different
 * things per market — the cap on an alt, a quarter of it on BTC.
 *
 * Note this only affects markets the user has never set. An explicit choice is
 * still honoured, which is why the sheet writes one as soon as it is touched.
 */
export function leverageFor(
  symbol: MarketSymbol,
  byMarket: Partial<Record<MarketSymbol, number>>
): number {
  return clampLeverage(symbol, byMarket[symbol] ?? maxLeverageFor(symbol));
}

/** Category filter pills shown above the market list, in display order. */
export const MARKET_CATEGORIES: { id: MarketCategory; label: string }[] = [
  { id: "favourites", label: "Favourites" },
  { id: "all", label: "All" },
  { id: "hot", label: "Hot 🔥" },
  { id: "crypto", label: "Crypto" },
  { id: "stocks", label: "Stocks" },
];

/** True if a market belongs to a STATIC category. Two categories are dynamic
 * and never match here — the caller resolves them:
 *   "favourites" — persisted user state (settings slice)
 *   "hot"        — computed from Bulk 24h stats (lib/bulk/marketStats)
 * "all" matches everything. */
export function inCategory(
  symbol: MarketSymbol,
  category: MarketCategory
): boolean {
  if (category === "all") return true;
  if (category === "favourites" || category === "hot") return false;
  return MARKETS[symbol]?.categories.includes(category) ?? false;
}

/** Type guard: is this string one of our supported markets? */
export function isMarketSymbol(value: string): value is MarketSymbol {
  return Object.prototype.hasOwnProperty.call(MARKETS, value);
}

// Market routes live under /trade/<MARKET> with the UPPERCASE symbol as the
// slug, e.g. /trade/BTC, /trade/ETH, /trade/HYPE.
/** Full path to a market's trade route, e.g. "/trade/BTC". */
export function marketPath(symbol: MarketSymbol): string {
  return `/trade/${symbol}`;
}

/** Resolve a URL slug (case-insensitive) to a market symbol, or null if unknown. */
export function marketFromSlug(slug: string): MarketSymbol | null {
  const s = slug.toUpperCase();
  return isMarketSymbol(s) ? s : null;
}

/** Per-market SEO copy for <title> / description / OG. */
export function marketMeta(symbol: MarketSymbol): {
  title: string;
  description: string;
} {
  const m = MARKETS[symbol];
  return {
    title: `${m.label} (${m.symbol}) | Tradash`,
    description: `Trade ${m.label} (${m.symbol}) perpetuals on Tradash. Watch the live chart and tap UP or DOWN to open a leveraged position instantly.`,
  };
}

/**
 * The smallest margin that can actually open a position in a market.
 *
 * ## Why this replaced a flat `MIN_MARGIN_USD = 5`
 *
 * That constant was derived from BULK's per-market `minNotional` ($50 on most
 * markets), and applying it to Phoenix blocked orders Phoenix would happily
 * accept — a $2 balance was told "Not enough margin" when it could open a SOL
 * position several times over.
 *
 * **Phoenix publishes no minimum notional at all** — there is no such field on
 * the market row. The only floor is ONE BASE LOT, confirmed live: exactly one
 * lot is accepted and half a lot is rejected with `ZeroBaseLots`, on every
 * market tested.
 *
 * So the true minimum is per-market and price-dependent:
 *
 *     margin = (lot x price) / leverage
 *
 * At 10x: SOL ~$0.11, ETH ~$0.26, BTC ~$0.81, ZEC ~$1.46. Nothing near $5.
 *
 * `price` is the mark price; pass the freshest one available. Returns `null`
 * when the market has no Phoenix lot size (not listed there) or the price is
 * unusable, so callers can fall back rather than compute a wrong bound.
 */
export function minMarginUsd(
  symbol: MarketSymbol,
  price: number,
  leverage: number
): number | null {
  const lot = MARKETS[symbol].phoenixLotSize;
  if (lot == null) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(leverage) || leverage <= 0) return null;
  return (lot * price) / leverage;
}
