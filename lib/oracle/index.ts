import { MARKETS } from "@/lib/markets";
import type { MarketSymbol } from "@/types";
import { subscribeToBulkPrice } from "./bulkTicker";
import {
  subscribeToMagicBlockPrice,
  type PriceCallback,
  type Unsubscribe,
} from "./magicblock";

export type { PriceCallback, Unsubscribe };

/**
 * Subscribe to a market's live chart price, from whichever feed that market is
 * priced off (`priceSource` in lib/markets.ts). Every price consumer goes
 * through here, so a market can move feeds without any caller changing.
 */
export function subscribeToPrice(
  symbol: MarketSymbol,
  onPrice: PriceCallback
): Unsubscribe {
  const market = MARKETS[symbol];
  if (market.priceSource === "bulk") {
    return subscribeToBulkPrice(market.bulkSymbol, onPrice);
  }
  return subscribeToMagicBlockPrice(market.pythLazerId, market.exponent, onPrice);
}
