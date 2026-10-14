import { config, type ChartFeed } from "@/lib/config";
import type { MarketCategory, MarketInfo, MarketSymbol } from "@/types";

// Markets come from two sources, both verified 2026-08-17:
//   1. Bulk's exchangeInfo (status "TRADING") — what we can actually trade on.
//   2. A live price feed. Since 2026-09-27 every chart runs off Bulk's own
//      ticker (`config.chartFeed`, default "bulk"); the MagicBlock fields below
//      stay so NEXT_PUBLIC_CHART_FEED=magicblock can switch back.
//
// A market Bulk lists but MagicBlock has no LIVE feed for can still be added
// with `priceSource: "bulk"`: its chart then runs off Bulk's own ticker stream
// (lib/oracle/bulkTicker.ts) and needs no pythLazerId/exponent. PUMP is priced
// this way — its Pyth Lazer id (1578) has no price-feed PDA on either the
// devnet or mainnet ER (probed 2026-09-24). LIT (2921) and MON (2396) are
// priced the same way — no PDA on the devnet ER when they reopened on Bulk
// (probed 2026-10-14). MEGA and XPL are in the same position but still
// suspended; add them the same way once they reopen. Check the feed
// PDA's value, not just its existence — PAXG's (163) exists but reads 0.
//
// pythLazerId + exponent come from MagicBlock's oracle-template
// (pyth_lazer_list.json): the feed PDA seed is the id as a string, and
// USD price = rawI64 * 10^exponent. maxLeverage mirrors Bulk's exchangeInfo.
export const MARKETS: Record<MarketSymbol, MarketInfo> = {
  BTC: {
    symbol: "BTC",
    bulkSymbol: "BTC-USD",
    label: "Bitcoin",
    pythLazerId: 1,
    exponent: -8,
    maxLeverage: 40,
    lotSize: 0.000001,
    logo: "/images/crypto/btc.png",
    categories: ["crypto"],
  },
  ETH: {
    symbol: "ETH",
    bulkSymbol: "ETH-USD",
    label: "Ethereum",
    pythLazerId: 2,
    exponent: -8,
    maxLeverage: 25,
    lotSize: 0.0001,
    logo: "/images/crypto/eth.png",
    categories: ["crypto"],
  },
  SOL: {
    symbol: "SOL",
    bulkSymbol: "SOL-USD",
    label: "Solana",
    pythLazerId: 6,
    exponent: -8,
    maxLeverage: 20,
    lotSize: 0.0001,
    logo: "/images/crypto/sol.png",
    categories: ["crypto"],
  },
  XRP: {
    symbol: "XRP",
    bulkSymbol: "XRP-USD",
    label: "XRP",
    pythLazerId: 14,
    exponent: -8,
    maxLeverage: 10,
    lotSize: 0.000001,
    logo: "/images/crypto/xrp.png",
    categories: ["crypto"],
  },
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
  NEAR: {
    symbol: "NEAR",
    bulkSymbol: "NEAR-USD",
    label: "NEAR Protocol",
    pythLazerId: 27,
    exponent: -8,
    maxLeverage: 10,
    lotSize: 0.00000001,
    logo: "/images/crypto/near.png",
    categories: ["crypto"],
  },
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
    label: "Hyperliquid",
    pythLazerId: 110,
    exponent: -8,
    maxLeverage: 10,
    lotSize: 0.00000001,
    logo: "/images/crypto/hype.png",
    categories: ["crypto"],
  },
  // Bulk's PAXG-USD settles against spot gold (its exchangeInfo baseAsset is
  // "XAU"), and MagicBlock's own PAXG feed (id 163) is a dead PDA reading 0 —
  // so this prices off Metal.XAU/USD (id 346), which is live and tracks Bulk's
  // oracle. Note the -3 exponent, unlike every crypto feed's -8. Verified
  // 2026-09-24.
  PAXG: {
    symbol: "PAXG",
    bulkSymbol: "PAXG-USD",
    label: "Gold",
    pythLazerId: 346,
    exponent: -3,
    maxLeverage: 20,
    lotSize: 0.0001,
    logo: "/images/crypto/paxg.png",
    categories: ["commodities"],
  },
  PUMP: {
    symbol: "PUMP",
    bulkSymbol: "PUMP-USD",
    label: "Pump.fun",
    priceSource: "bulk",
    maxLeverage: 10,
    lotSize: 0.00000001,
    logo: "/images/crypto/pump.png",
    categories: ["crypto"],
  },
  LIT: {
    symbol: "LIT",
    bulkSymbol: "LIT-USD",
    label: "Lighter",
    priceSource: "bulk",
    maxLeverage: 10,
    lotSize: 0.00000001,
    logo: "/images/crypto/lit.png",
    categories: ["crypto"],
  },
  MON: {
    symbol: "MON",
    bulkSymbol: "MON-USD",
    label: "Monad",
    priceSource: "bulk",
    maxLeverage: 10,
    lotSize: 0.00000001,
    logo: "/images/crypto/mon.png",
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
  "XRP",
  // "BNB",
  // "DOGE",
  // "SUI",
  "NEAR",
  // "AAVE",
  // "TAO",
  "ZEC",
  // "ENA",
  // "JTO",
  // "JUP",
  "HYPE",
  "PAXG",
  "PUMP",
  "LIT",
  "MON",
  // "FARTCOIN",
];

export const DEFAULT_MARKET: MarketSymbol = "BTC";

// --- Leverage ----------------------------------------------------------------
// Every market has its OWN ceiling on Bulk (see `maxLeverage` above, mirrored
// from exchangeInfo: BTC 40×, ETH 25×, SOL/PAXG 20×, everything else 10×), so
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

// --- Order sizing ------------------------------------------------------------
// Bulk rejects any order whose NOTIONAL is under $50. Notional is
// margin × leverage, so the smallest margin a market can trade at is
// 50 / leverage — which differs per market because every market has its own
// leverage ceiling (BTC 40× → $1.25, ETH 25× → $2, SOL 20× → $2.50, 10× → $5).
//
// Sizing is expressed in MARGIN everywhere in the UI (the slider, the dock,
// `defaultPositionSize`), so these helpers are the single place that converts
// the exchange's notional floor into the margin floor the UI enforces.

/** Bulk's minimum order notional, in USD. Below this an order is rejected. */
export const MIN_NOTIONAL_USD = 50;

/**
 * Safety pad over the exact minimum, so an order can never land at $49.99.
 *
 * The exact floor (50 / leverage) is a knife edge: the price moves between the
 * tap and the fill, `floorToLot` rounds the base size DOWN to the market's lot,
 * and the notional Bulk computes is therefore a hair under the one we intended.
 * 1% of headroom costs nothing and turns a rejected order into a filled one.
 */
const MIN_NOTIONAL_PAD = 1.01;

/**
 * Smallest margin that can open a position on this market, in USD.
 *
 * Rounded UP at 4 decimals: rounding to cents would round $1.2625 down to
 * $1.26 on some markets and back under the floor, which is the exact failure
 * this guards against. Four decimals is also what `setSize` preserves.
 */
export function minSizeFor(
  symbol: MarketSymbol,
  byMarket: Partial<Record<MarketSymbol, number>> = {}
): number {
  const lev = leverageFor(symbol, byMarket);
  const exact = (MIN_NOTIONAL_USD * MIN_NOTIONAL_PAD) / lev;
  return Math.ceil(exact * 10_000) / 10_000;
}

/** Fraction of the available trading balance a default order risks. */
export const DEFAULT_SIZE_FRACTION = 0.05;

/**
 * The size an order should default to on this market: 5% of the available
 * trading balance, or the market's minimum when 5% doesn't reach it.
 *
 * This is a DEFAULT, not a clamp — it is what the size becomes while the user
 * has never set one by hand. An explicit choice in the settings sheet wins and
 * is never recomputed. With an unknown balance there is nothing to take 5% of,
 * so the minimum stands in.
 */
export function defaultSizeFor(
  symbol: MarketSymbol,
  available: number | null,
  byMarket: Partial<Record<MarketSymbol, number>> = {}
): number {
  const min = minSizeFor(symbol, byMarket);
  if (available == null || !Number.isFinite(available) || available <= 0) {
    return min;
  }
  const pct = available * DEFAULT_SIZE_FRACTION;
  return pct > min ? +pct.toFixed(4) : min;
}

/** Category filter pills shown above the market list, in display order. */
export const MARKET_CATEGORIES: { id: MarketCategory; label: string }[] = [
  { id: "favourites", label: "Favourites" },
  { id: "all", label: "All" },
  { id: "hot", label: "Hot 🔥" },
  { id: "crypto", label: "Crypto" },
  { id: "commodities", label: "Commodities" },
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

/**
 * The feed this market's chart actually runs off: the app-wide
 * `config.chartFeed`, except that a market with no MagicBlock feed
 * (`priceSource: "bulk"`) is always on Bulk.
 */
export function chartFeedFor(symbol: MarketSymbol): ChartFeed {
  if (MARKETS[symbol]?.priceSource === "bulk") return "bulk";
  return config.chartFeed;
}

/**
 * True if this market's chart is priced off Bulk's own ticker rather than the
 * MagicBlock oracle — i.e. the chart and Bulk's quotes share one price space.
 */
export function isBulkPriced(symbol: MarketSymbol): boolean {
  return chartFeedFor(symbol) === "bulk";
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
