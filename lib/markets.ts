import type { MarketInfo, MarketSymbol } from "@/types";

// MVP markets. Bulk symbol format confirmed from docs: "<ASSET>-USD".
export const MARKETS: Record<MarketSymbol, MarketInfo> = {
  BTC: { symbol: "BTC", bulkSymbol: "BTC-USD", label: "Bitcoin" },
  ETH: { symbol: "ETH", bulkSymbol: "ETH-USD", label: "Ethereum" },
  SOL: { symbol: "SOL", bulkSymbol: "SOL-USD", label: "Solana" },
};

export const MARKET_ORDER: MarketSymbol[] = ["BTC", "ETH", "SOL"];

export const DEFAULT_MARKET: MarketSymbol = "BTC";
