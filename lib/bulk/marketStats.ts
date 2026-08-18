import { config } from "@/lib/config";
import { MARKETS, MARKET_ORDER } from "@/lib/markets";
import type { MarketSymbol } from "@/types";

// 24h market statistics from Bulk, used to rank the "Hot" category and to show
// 24h change in the market list.
//
// Source: GET /ticker/{symbol}. This is the ONLY endpoint that carries price
// change — /stats has volume + open interest but no change field, and /klines
// reports v:0.0 per candle (no per-candle volume), so a shorter window can't be
// liquidity-checked. 24h is therefore the window we actually have, not a
// preference. One request per market; they run in parallel (~1.2s for 16).

const BASE = config.bulk.restUrl;

export interface MarketStats {
  symbol: MarketSymbol;
  /** 24h change as a percent, signed (e.g. -1.89). */
  changePercent: number;
  lastPrice: number;
  highPrice: number;
  lowPrice: number;
  /** 24h volume denominated in USD. */
  quoteVolume: number;
  /** Open interest in base units. */
  openInterest: number;
}

interface TickerResponse {
  symbol: string;
  priceChangePercent: number;
  lastPrice: number;
  highPrice: number;
  lowPrice: number;
  quoteVolume: number;
  openInterest: number;
}

/** Fetch 24h stats for one market, or null if the request fails. */
async function fetchTicker(symbol: MarketSymbol): Promise<MarketStats | null> {
  const bulkSymbol = MARKETS[symbol]?.bulkSymbol;
  if (!bulkSymbol) return null;
  try {
    const res = await fetch(`${BASE}/ticker/${bulkSymbol}`, {
      // Stats are a nice-to-have; never let them sit in a cache we can't bust.
      cache: "no-store",
    });
    if (!res.ok) return null;
    const t = (await res.json()) as TickerResponse;
    return {
      symbol,
      changePercent: t.priceChangePercent ?? 0,
      lastPrice: t.lastPrice ?? 0,
      highPrice: t.highPrice ?? 0,
      lowPrice: t.lowPrice ?? 0,
      quoteVolume: t.quoteVolume ?? 0,
      openInterest: t.openInterest ?? 0,
    };
  } catch {
    return null;
  }
}

/** Fetch 24h stats for every supported market, keyed by symbol. Markets whose
 * request fails are simply absent — callers must tolerate a partial map. */
export async function fetchAllMarketStats(): Promise<
  Partial<Record<MarketSymbol, MarketStats>>
> {
  const results = await Promise.all(MARKET_ORDER.map(fetchTicker));
  const out: Partial<Record<MarketSymbol, MarketStats>> = {};
  for (const r of results) {
    if (r) out[r.symbol] = r;
  }
  return out;
}

// --- "Hot" ranking -----------------------------------------------------------

// A market only counts as Hot if it has real trading behind the move. Without
// this floor the list is dominated by noise: measured live, JUP traded ~$0 and
// DOGE ~$103 over 24h, yet their percentage moves rank alongside BTC's. A move
// on a market nobody is trading isn't hot, it's a rounding error.
const MIN_24H_VOLUME_USD = 50_000;

// How many markets the Hot pill shows at most.
const HOT_LIMIT = 6;

/**
 * Movement score. Deliberately NOT multiplied by volume: BTC/ETH carry ~99% of
 * volume here, so any volume weighting pins them to the top permanently and
 * "Hot" stops meaning anything. Liquidity is a gate (above), not a booster.
 *
 * We take the larger of:
 *   - |24h change| — net directional move, and
 *   - intraday range × 0.6 — catches a market that swung hard and came back,
 *     which a close-to-close change of ~0% would otherwise hide.
 * The 0.6 keeps a wide range from outranking an equivalent decisive move.
 */
export function hotScore(s: MarketStats): number {
  const change = Math.abs(s.changePercent);
  const range =
    s.lastPrice > 0 ? ((s.highPrice - s.lowPrice) / s.lastPrice) * 100 : 0;
  return Math.max(change, range * 0.6);
}

/**
 * The Hot set: liquid markets ranked by movement, capped at HOT_LIMIT.
 * Returns an empty set when stats are unavailable — callers should fall back
 * rather than render an empty category.
 */
export function computeHotMarkets(
  stats: Partial<Record<MarketSymbol, MarketStats>>
): Set<MarketSymbol> {
  const eligible = Object.values(stats)
    .filter((s): s is MarketStats => !!s)
    .filter((s) => s.quoteVolume >= MIN_24H_VOLUME_USD)
    .sort((a, b) => hotScore(b) - hotScore(a))
    .slice(0, HOT_LIMIT);
  return new Set(eligible.map((s) => s.symbol));
}
