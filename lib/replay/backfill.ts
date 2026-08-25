import { config } from "@/lib/config";
import { MARKETS } from "@/lib/markets";
import type { MarketSymbol } from "@/types";

// Patches gaps in a replay recording using Bulk's klines endpoint, for spans
// where the app was closed or backgrounded and the recorder saw nothing.
//
// VERIFIED LIVE (2026-08-25) against exchange-api.bulk.trade:
//   - `GET /klines?symbol=BTC-USD&interval=1m&startTime=&endTime=` returns real
//     OHLC; startTime/endTime are respected.
//   - The finest interval is 1m. `1s`, `5s` and `15s` all return an EMPTY array
//     (as do `4h` and `1d`) — the menu is 1m/3m/5m/15m/30m/1h.
//   - Retention is a rolling ~192 MINUTES regardless of startTime: 190min ago
//     returns rows, 200min returns 2, and 210min+ returns none. A bare
//     `limit=1000` yields 192 rows.
//
// So this is a patch for SHORT absences (a lunch break, a backgrounded PWA) and
// emphatically not an archive. Anything older than ~3h stays a gap, and the
// coverage gate decides whether the trade is still replayable. Re-probe the
// retention window on mainnet before launch.

const BASE = config.bulk.restUrl;

/** Rolling retention of the klines endpoint, measured. Kept conservative. */
export const KLINE_RETENTION_MS = 180 * 60 * 1000;
/** Finest granularity the endpoint actually serves. */
const INTERVAL = "1m";
const INTERVAL_MS = 60_000;

interface Kline {
  /** Open time, ms epoch. */
  t: number;
  /** Close time, ms epoch. */
  T: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface BackfillSample {
  t: number;
  p: number;
}

/** True if a gap is recent enough to stand any chance of being backfilled. */
export function isBackfillable(gap: { from: number; to: number }): boolean {
  return Date.now() - gap.from < KLINE_RETENTION_MS;
}

/**
 * Fetch 1m closes covering [from, to]. Returns an empty array when the span is
 * outside retention or the request fails — backfill is strictly best-effort and
 * must never block or fail a close.
 */
export async function fetchGapPrices(
  symbol: MarketSymbol,
  from: number,
  to: number
): Promise<BackfillSample[]> {
  const bulkSymbol = MARKETS[symbol]?.bulkSymbol;
  if (!bulkSymbol) return [];
  if (!isBackfillable({ from, to })) return [];

  // Widen by a minute each side so the splice overlaps the recorded samples
  // rather than leaving a one-candle notch at each edge.
  const startTime = Math.floor(from - INTERVAL_MS);
  const endTime = Math.ceil(to + INTERVAL_MS);
  const limit = Math.min(
    1000,
    Math.max(2, Math.ceil((endTime - startTime) / INTERVAL_MS) + 2)
  );

  try {
    const url =
      `${BASE}/klines?symbol=${encodeURIComponent(bulkSymbol)}` +
      `&interval=${INTERVAL}&startTime=${startTime}&endTime=${endTime}&limit=${limit}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const rows = (await res.json()) as Kline[];
    if (!Array.isArray(rows)) return [];

    // Use each candle's CLOSE at its close time: the recorder stores point
    // samples, so a close is the directly comparable value. OHLC detail would
    // be invented precision at this granularity.
    return rows
      .filter((k) => Number.isFinite(k.c) && k.c > 0)
      .map((k) => ({ t: k.T ?? k.t + INTERVAL_MS, p: k.c }))
      .filter((s) => s.t >= from && s.t <= to)
      .sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
}
