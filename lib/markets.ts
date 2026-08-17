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
    categories: ["crypto", "hot"],
  },
  ETH: {
    symbol: "ETH",
    bulkSymbol: "ETH-USD",
    label: "Ethereum",
    pythLazerId: 2,
    exponent: -8,
    maxLeverage: 25,
    logo: "/images/crypto/eth.png",
    categories: ["crypto", "hot"],
  },
  SOL: {
    symbol: "SOL",
    bulkSymbol: "SOL-USD",
    label: "Solana",
    pythLazerId: 6,
    exponent: -8,
    maxLeverage: 20,
    logo: "/images/crypto/sol.png",
    categories: ["crypto", "hot"],
  },
  XRP: {
    symbol: "XRP",
    bulkSymbol: "XRP-USD",
    label: "XRP",
    pythLazerId: 14,
    exponent: -8,
    maxLeverage: 20,
    logo: "/images/crypto/xrp.png",
    categories: ["crypto", "hot"],
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
    categories: ["crypto", "hot"],
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
    categories: ["crypto", "hot"],
  },
  ZEC: {
    symbol: "ZEC",
    bulkSymbol: "ZEC-USD",
    label: "Zcash",
    pythLazerId: 66,
    exponent: -8,
    maxLeverage: 10,
    logo: "/images/crypto/zec.png",
    categories: ["crypto", "hot"],
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
    categories: ["crypto", "hot"],
  },
  FARTCOIN: {
    symbol: "FARTCOIN",
    bulkSymbol: "FARTCOIN-USD",
    label: "Fartcoin",
    pythLazerId: 182,
    exponent: -8,
    maxLeverage: 10,
    logo: "/images/crypto/fartcoin.png",
    categories: ["crypto", "hot"],
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

/** Category filter pills shown above the market list, in display order. */
export const MARKET_CATEGORIES: { id: MarketCategory; label: string }[] = [
  { id: "favourites", label: "Favourites" },
  { id: "all", label: "All" },
  { id: "hot", label: "Hot 🔥" },
  { id: "crypto", label: "Crypto" },
  { id: "stocks", label: "Stocks" },
];

/** True if a market belongs to a category. "all" matches everything;
 * "favourites" is caller-supplied state, so it never matches here. */
export function inCategory(
  symbol: MarketSymbol,
  category: MarketCategory
): boolean {
  if (category === "all") return true;
  if (category === "favourites") return false;
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
