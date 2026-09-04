import type { MarketCategory, MarketInfo, MarketSymbol } from "@/types";

// Markets are the intersection of two sources, both verified 2026-08-17:
//   1. Bulk's exchangeInfo (status "TRADING") — what we can actually trade on.
//   2. MagicBlock's oracle program — what we can actually price in real time.
// Bulk also lists LIT, MEGA, MON and XPL, but those four have a Pyth Lazer id
// with NO deployed price-feed PDA on the ER, so they'd render a dead price.
// They're deliberately excluded; re-probe before adding them back.
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
    logo: "/images/crypto/sol.png",
    categories: ["crypto"],
  },
  XRP: {
    symbol: "XRP",
    bulkSymbol: "XRP-USD",
    label: "XRP",
    pythLazerId: 14,
    exponent: -8,
    maxLeverage: 20,
    logo: "/images/crypto/xrp.png",
    categories: ["crypto"],
  },
  BNB: {
    symbol: "BNB",
    bulkSymbol: "BNB-USD",
    label: "BNB",
    pythLazerId: 15,
    exponent: -8,
    maxLeverage: 10,
    logo: "/images/crypto/bnb.png",
    categories: ["crypto"],
  },
  DOGE: {
    symbol: "DOGE",
    bulkSymbol: "DOGE-USD",
    label: "Dogecoin",
    pythLazerId: 13,
    exponent: -8,
    maxLeverage: 10,
    logo: "/images/crypto/doge.png",
    categories: ["crypto"],
  },
  SUI: {
    symbol: "SUI",
    bulkSymbol: "SUI-USD",
    label: "Sui",
    pythLazerId: 11,
    exponent: -8,
    maxLeverage: 10,
    logo: "/images/crypto/sui.png",
    categories: ["crypto"],
  },
  NEAR: {
    symbol: "NEAR",
    bulkSymbol: "NEAR-USD",
    label: "NEAR Protocol",
    pythLazerId: 27,
    exponent: -8,
    maxLeverage: 10,
    logo: "/images/crypto/near.png",
    categories: ["crypto"],
  },
  AAVE: {
    symbol: "AAVE",
    bulkSymbol: "AAVE-USD",
    label: "Aave",
    pythLazerId: 29,
    exponent: -8,
    maxLeverage: 10,
    logo: "/images/crypto/aave.png",
    categories: ["crypto"],
  },
  TAO: {
    symbol: "TAO",
    bulkSymbol: "TAO-USD",
    label: "Bittensor",
    pythLazerId: 36,
    exponent: -8,
    maxLeverage: 10,
    logo: "/images/crypto/tao.png",
    categories: ["crypto"],
  },
  ZEC: {
    symbol: "ZEC",
    bulkSymbol: "ZEC-USD",
    label: "Zcash",
    pythLazerId: 66,
    exponent: -8,
    maxLeverage: 10,
    logo: "/images/crypto/zec.png",
    categories: ["crypto"],
  },
  ENA: {
    symbol: "ENA",
    bulkSymbol: "ENA-USD",
    label: "Ethena",
    pythLazerId: 85,
    exponent: -8,
    maxLeverage: 10,
    logo: "/images/crypto/ena.png",
    categories: ["crypto"],
  },
  JTO: {
    symbol: "JTO",
    bulkSymbol: "JTO-USD",
    label: "Jito",
    pythLazerId: 91,
    exponent: -8,
    maxLeverage: 10,
    logo: "/images/crypto/jto.png",
    categories: ["crypto"],
  },
  JUP: {
    symbol: "JUP",
    bulkSymbol: "JUP-USD",
    label: "Jupiter",
    pythLazerId: 92,
    exponent: -8,
    maxLeverage: 10,
    logo: "/images/crypto/jup.png",
    categories: ["crypto"],
  },
  HYPE: {
    symbol: "HYPE",
    bulkSymbol: "HYPE-USD",
    label: "Hyperliquid",
    pythLazerId: 110,
    exponent: -8,
    maxLeverage: 10,
    logo: "/images/crypto/hype.png",
    categories: ["crypto"],
  },
  FARTCOIN: {
    symbol: "FARTCOIN",
    bulkSymbol: "FARTCOIN-USD",
    label: "Fartcoin",
    pythLazerId: 182,
    exponent: -8,
    maxLeverage: 10,
    logo: "/images/crypto/fartcoin.png",
    categories: ["crypto"],
  },
};

export const MARKET_ORDER: MarketSymbol[] = [
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "BNB",
  "DOGE",
  "SUI",
  "NEAR",
  "AAVE",
  "TAO",
  "ZEC",
  "ENA",
  "JTO",
  "JUP",
  "HYPE",
  "FARTCOIN",
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
 * market, else the default — clamped either way, so a stored value can never
 * exceed a cap (e.g. after Bulk lowers one).
 */
export function leverageFor(
  symbol: MarketSymbol,
  byMarket: Partial<Record<MarketSymbol, number>>
): number {
  return clampLeverage(symbol, byMarket[symbol] ?? DEFAULT_LEVERAGE);
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
