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
