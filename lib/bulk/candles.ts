import { config } from "@/lib/config";
import type { Candle } from "@/lib/chart/candles";

// Candle history for the chart's candlestick view, from Bulk's public klines.
//
// VERIFIED LIVE 2026-09-27 on mainnet-api1:
//   - `GET /klines?symbol=BTC-USD&interval=1m&startTime=&endTime=` (ms) returns
//     `[{t,T,o,h,l,c,v,n}]` oldest → newest, CLOSED candles only — the forming
//     one is built client-side (see lib/chart/candles.ts).
//   - Intervals served: 1m 3m 5m 15m 30m 1h 2h 4h 12h 1d. Sub-minute (1s–30s)
//     is rejected with an empty non-JSON body.
//   - Retention: ~13 days of 1m, ~26 days of every larger interval — far more
//     than testnet's ~3h, which is what lib/replay/backfill.ts was written for.
//   - Without startTime the whole retention comes back (~2MB at 1m), so always
//     pass a window.

export const CANDLE_INTERVALS = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "12h",
  "1d",
] as const;

export type CandleInterval = (typeof CANDLE_INTERVALS)[number];

export const DEFAULT_CANDLE_INTERVAL: CandleInterval = "1m";

const MINUTE = 60_000;
export const INTERVAL_MS: Record<CandleInterval, number> = {
  "1m": MINUTE,
  "3m": 3 * MINUTE,
  "5m": 5 * MINUTE,
  "15m": 15 * MINUTE,
  "30m": 30 * MINUTE,
  "1h": 60 * MINUTE,
  "2h": 120 * MINUTE,
  "4h": 240 * MINUTE,
  "12h": 720 * MINUTE,
  "1d": 1440 * MINUTE,
};

export function isCandleInterval(value: unknown): value is CandleInterval {
  return (
    typeof value === "string" &&
    (CANDLE_INTERVALS as readonly string[]).includes(value)
  );
}

interface KlineRow {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

/**
 * The newest `count` candles for a market, oldest first. Throws on a network
 * or HTTP failure so the caller can retry; malformed rows are dropped.
 */
export async function fetchCandles(
  bulkSymbol: string,
  interval: CandleInterval,
  count: number,
  signal?: AbortSignal
): Promise<Candle[]> {
  const end = Date.now();
  const start = end - count * INTERVAL_MS[interval];
  const res = await fetch(
    `${config.bulk.restUrl}/klines?symbol=${encodeURIComponent(bulkSymbol)}` +
      `&interval=${interval}&startTime=${start}&endTime=${end}`,
    { cache: "no-store", signal }
  );
  if (!res.ok) throw new Error(`klines ${res.status}`);
  const rows = (await res.json()) as KlineRow[];
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (r) =>
        Number.isFinite(r?.t) &&
        Number.isFinite(r.o) &&
        Number.isFinite(r.h) &&
        Number.isFinite(r.l) &&
        Number.isFinite(r.c)
    )
    .map((r) => ({ t: r.t, o: r.o, h: r.h, l: r.l, c: r.c }));
}
