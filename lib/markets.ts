import type { MarketInfo, MarketSymbol } from "@/types";

// MVP markets. Bulk symbol format confirmed from docs: "<ASSET>-USD".
// pythLazerId + exponent from MagicBlock's oracle-template (pyth_lazer_list.json):
// the feed PDA seed is the id as a string, and USD price = rawI64 * 10^exponent.
export const MARKETS: Record<MarketSymbol, MarketInfo> = {
  BTC: {
    symbol: "BTC",
    bulkSymbol: "BTC-USD",
    label: "Bitcoin",
    pythLazerId: 1,
    exponent: -8,
    logo: "/images/crypto/bitcoin.png",
  },
  ETH: {
    symbol: "ETH",
    bulkSymbol: "ETH-USD",
    label: "Ethereum",
    pythLazerId: 2,
    exponent: -8,
    logo: "/images/crypto/ethereum.svg",
  },
  SOL: {
    symbol: "SOL",
    bulkSymbol: "SOL-USD",
    label: "Solana",
    pythLazerId: 6,
    exponent: -8,
    logo: "/images/crypto/solana.jpeg",
  },
};

export const MARKET_ORDER: MarketSymbol[] = ["BTC", "ETH", "SOL"];

export const DEFAULT_MARKET: MarketSymbol = "BTC";

// Market routes live under /trade/<MARKET> with the UPPERCASE symbol as the slug,
// e.g. /trade/BTC, /trade/ETH, /trade/SOL.
export const MARKET_SLUGS: Record<MarketSymbol, string> = {
  BTC: "BTC",
  ETH: "ETH",
  SOL: "SOL",
};

/** Full path to a market's trade route, e.g. "/trade/BTC". */
export function marketPath(symbol: MarketSymbol): string {
  return `/trade/${MARKET_SLUGS[symbol]}`;
}

/** Resolve a URL slug (case-insensitive) to a market symbol, or null if unknown. */
export function marketFromSlug(slug: string): MarketSymbol | null {
  const s = slug.toUpperCase();
  for (const sym of MARKET_ORDER) {
    if (MARKET_SLUGS[sym] === s) return sym;
  }
  return null;
}

/** Per-market SEO copy for <title> / description / OG. */
export function marketMeta(symbol: MarketSymbol): {
  title: string;
  description: string;
} {
  const m = MARKETS[symbol];
  return {
    title: `${m.label} (${m.symbol}) — Tradash`,
    description: `Trade ${m.label} (${m.symbol}) perpetuals on Tradash. Watch the live chart and tap UP or DOWN to open a leveraged position instantly.`,
  };
}
