// Candle state for the chart's candlestick view: Bulk's closed history plus the
// candle currently forming, which is built HERE from live ticks.
//
// Why build it client-side: Bulk's `candle` WS stream pushes about once a
// minute (verified 2026-09-27 on mainnet-ws1), so it can't animate a live
// candle. Bulk's candles are built from its MARK price — the same `markPrice`
// the ticker (and so the chart line) runs on — so a candle grown from ticks
// joins its history seamlessly. When a bucket closes, the caller re-fetches
// the last few rows and `merge`s them, so a locally-built candle is replaced by
// Bulk's official one within seconds.
//
// Buckets are epoch-aligned (a 1m candle opens on the minute, 1d at 00:00 UTC),
// matching Bulk's `t` values.

export interface Candle {
  /** Open time, ms epoch. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

/** Most closed candles kept — well past the widest chart's visible count. */
const MAX_CANDLES = 400;

export class CandleSeries {
  readonly intervalMs: number;
  /** Closed candles, oldest → newest. */
  closed: Candle[] = [];
  /** The candle still forming, or null before the first price. */
  forming: Candle | null = null;
  /**
   * Leftward slide after a rollover, in candle widths: 1 the instant a new
   * candle opens, easing to 0. The renderer offsets every candle by it, so the
   * row glides one slot left instead of jumping.
   */
  slide = 0;

  constructor(intervalMs: number) {
    this.intervalMs = intervalMs;
  }

  private bucket(now: number): number {
    return Math.floor(now / this.intervalMs) * this.intervalMs;
  }

  /** Load history. A row for the CURRENT bucket (if any) seeds the forming candle. */
  setHistory(rows: readonly Candle[], now: number) {
    const current = this.bucket(now);
    const sorted = [...rows].sort((a, b) => a.t - b.t);
    this.closed = sorted.filter((r) => r.t < current).slice(-MAX_CANDLES);
    const seed = sorted.find((r) => r.t === current);
    if (seed) {
      this.forming = { ...seed };
    } else if (this.forming && this.forming.t !== current) {
      this.forming = null;
    }
  }

  /**
   * Fold in re-fetched rows (reconciliation after a close). Closed rows replace
   * the local build for the same bucket or fill a gap; a row for the forming
   * bucket only corrects its open and widens its range — its close stays live.
   */
  merge(rows: readonly Candle[]) {
    const byT = new Map(this.closed.map((c) => [c.t, c]));
    for (const r of rows) {
      if (this.forming && r.t === this.forming.t) {
        this.forming.o = r.o;
        this.forming.h = Math.max(this.forming.h, r.h);
        this.forming.l = Math.min(this.forming.l, r.l);
        continue;
      }
      if (this.forming && r.t > this.forming.t) continue;
      byT.set(r.t, { t: r.t, o: r.o, h: r.h, l: r.l, c: r.c });
    }
    this.closed = [...byT.values()]
      .sort((a, b) => a.t - b.t)
      .slice(-MAX_CANDLES);
  }

  /**
   * Advance with the newest raw tick (`raw`, for the true high/low/close) and
   * the eased chart price (`shown`, so the body grows as smoothly as the line).
   */
  update(raw: number, shown: number, now: number) {
    const current = this.bucket(now);
    const f = this.forming;
    if (!f) {
      const open = this.closed[this.closed.length - 1]?.c ?? raw;
      this.forming = {
        t: current,
        o: open,
        h: Math.max(open, raw),
        l: Math.min(open, raw),
        c: shown,
      };
    } else if (current > f.t) {
      // Rollover: the forming candle closes on its last real tick, and the
      // next one opens there.
      f.c = raw;
      this.closed.push(f);
      if (this.closed.length > MAX_CANDLES) this.closed.shift();
      this.forming = { t: current, o: raw, h: raw, l: raw, c: shown };
      this.slide = 1;
    } else {
      f.h = Math.max(f.h, raw);
      f.l = Math.min(f.l, raw);
      f.c = shown;
    }

    if (this.slide > 0) {
      this.slide *= 0.86;
      if (this.slide < 0.002) this.slide = 0;
    }
  }

  /**
   * Low/high of the candle BODIES (open/close) across the newest `count`
   * candles, forming included. Bodies, not wicks: one spike wick (BTC printed a
   * $600 one on mainnet) would otherwise set the zoom and squash every other
   * candle flat. A wick past the edge just runs off-screen.
   */
  bodyRange(count: number): { min: number; max: number } | null {
    let min = Infinity;
    let max = -Infinity;
    const take = (c: Candle) => {
      min = Math.min(min, c.o, c.c);
      max = Math.max(max, c.o, c.c);
    };
    if (this.forming) take(this.forming);
    const from = Math.max(0, this.closed.length - count);
    for (let i = from; i < this.closed.length; i++) take(this.closed[i]!);
    return Number.isFinite(min) ? { min, max } : null;
  }
}
