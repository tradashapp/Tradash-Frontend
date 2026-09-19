import { MARKETS } from "@/lib/markets";
import type { MarketStats } from "@/lib/bulk/marketStats";
import type { MarketSymbol } from "@/types";
import { PHOENIX_API } from "./config";

/**
 * 24h market statistics from Phoenix.
 *
 * One request covers every market (`/v1/markets/stats/latest` returns all 82),
 * where Bulk needed a `GET /ticker/{symbol}` per market. Fields are snake_case
 * here and camelCase on the rest of the Phoenix API — the usual inconsistency.
 *
 * NO 24h HIGH/LOW. Phoenix reports `mark_price` and `prev_day_mark_price` but
 * no intraday extremes, so `highPrice`/`lowPrice` are reported as the current
 * mark rather than invented. A caller that draws a day range must fetch candles
 * instead; making up a range from two points would render a chart that is
 * quietly wrong.
 */

interface PhoenixStatsRow {
  symbol: string;
  mark_price: number;
  prev_day_mark_price: number;
  open_interest: number;
  day_volume_usd: number;
  day_volume_base: number;
  current_funding_rate: number;
}

/** Phoenix symbol → Tradash symbol, for the markets Tradash lists. */
const SYMBOL_BY_PHOENIX: Record<string, MarketSymbol> = Object.fromEntries(
  (Object.values(MARKETS) as { symbol: MarketSymbol; phoenixSymbol?: string }[])
    .filter((m) => m.phoenixSymbol)
    .map((m) => [m.phoenixSymbol as string, m.symbol])
);

/**
 * Stats for every market Tradash lists.
 *
 * Markets Phoenix carries but Tradash does not are dropped, so the result is
 * keyed by the app's own symbols.
 */
export async function fetchAllMarketStats(): Promise<MarketStats[]> {
  const res = await fetch(`${PHOENIX_API}/v1/markets/stats/latest`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Phoenix market stats failed: ${res.status}`);
  }
  const body = (await res.json()) as { markets?: PhoenixStatsRow[] };
  const rows = body.markets ?? [];

  const out: MarketStats[] = [];
  for (const r of rows) {
    const symbol = SYMBOL_BY_PHOENIX[r.symbol];
    if (!symbol) continue;

    const last = Number(r.mark_price);
    const prev = Number(r.prev_day_mark_price);
    if (!Number.isFinite(last)) continue;

    out.push({
      symbol,
      // Phoenix gives two points, not a percentage. A zero or missing previous
      // price would make this divide by zero, so it reports no change instead
      // of Infinity.
      changePercent:
        Number.isFinite(prev) && prev > 0 ? ((last - prev) / prev) * 100 : 0,
      lastPrice: last,
      // See the note above: Phoenix reports no intraday high/low.
      highPrice: last,
      lowPrice: last,
      quoteVolume: Number(r.day_volume_usd) || 0,
      openInterest: Number(r.open_interest) || 0,
    });
  }
  return out;
}
