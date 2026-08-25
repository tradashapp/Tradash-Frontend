import type {
  Direction,
  MarketSymbol,
  ReplayGap,
  TradeEpisode,
  TradePath,
  TradingMode,
} from "@/types";

// Records the real price path of every open position so a completed trade can
// be replayed exactly as it happened.
//
// WHY A MODULE SINGLETON (not a hook): `recordClose` in lib/history.ts is the
// single funnel that all eleven close/add/reduce call sites across useTrade,
// useDemoPnl and useBulkAccount already pass through. Having that funnel query
// a singleton means replay recording needs ZERO changes at those call sites —
// threading a `path` argument through all of them would be invasive and one
// would inevitably be missed.
//
// WHY NOT SYNTHESIZE: a plausible-looking walk between entry and exit would be
// fiction presented to the user as their own trade. If we don't have the data,
// the row simply isn't replayable (see coverage below).

/** Target sample rate while recording. The oracle streams ~16 ticks/s. */
const BASE_HZ = 10;
/**
 * Max samples held per episode. At BASE_HZ this is 90s; beyond that the buffer
 * halves itself (see `downsample`) rather than dropping the head, so a long
 * hold still spans the WHOLE trade instead of keeping only its final 90s and
 * losing the entry — the single most interesting moment in the recording.
 */
const MAX_SAMPLES = 900;
/**
 * A silence longer than this counts as a gap (tab closed/backgrounded, oracle
 * dropped) rather than a slow tick. Generous enough that ordinary jitter or a
 * brief reconnect doesn't fragment an otherwise clean recording.
 */
const GAP_THRESHOLD_MS = 3_000;

/** An episode still being recorded. Sealed into a TradeEpisode on close. */
interface LiveEpisode {
  id: string;
  mode: TradingMode;
  symbol: MarketSymbol;
  direction: Direction;
  openedAt: number;
  entryLine: number;
  liqLine?: number;
  entry: number;
  tick: number;
  /** Absolute prices; encoded to deltas only when sealed. */
  samples: number[];
  /** ms epoch of the first sample. */
  t0: number;
  /** Current effective interval between samples (ms). Doubles on downsample. */
  intervalMs: number;
  /** ms epoch we last accepted a sample. */
  lastAt: number;
  gaps: ReplayGap[];
}

/** Per-symbol in-flight recordings. A position per market can record at once. */
const active = new Map<MarketSymbol, LiveEpisode>();

/**
 * Quantization step for a market's price deltas. Roughly 1e-5 of the price, so
 * BTC at ~$80k quantizes to ~$0.80 and SOL at ~$100 to ~$0.001 — far below a
 * visible pixel on the chart, while keeping the encoded integers small.
 */
function tickFor(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0.01;
  const mag = Math.pow(10, Math.floor(Math.log10(price)));
  return mag * 1e-5;
}

function newId(): string {
  return `ep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Halve the sample count in place, keeping every other sample, and double the
 * effective interval. Called when the buffer fills, so the recording keeps
 * spanning the entire position at a progressively coarser rate: 10Hz for the
 * first 90s, then 5Hz, 2.5Hz, and so on. A 2-hour hold still lands under 900
 * samples with its entry, exit and every add/reduce intact.
 */
function downsample(ep: LiveEpisode) {
  const out: number[] = [];
  for (let i = 0; i < ep.samples.length; i += 2) out.push(ep.samples[i]!);
  ep.samples = out;
  ep.intervalMs *= 2;
}

/**
 * Begin recording a position, or return the existing recording if one is
 * already in flight for this market (an add/reduce must NOT restart it — the
 * whole lifecycle is one continuous path).
 */
export function startEpisode(opts: {
  mode: TradingMode;
  symbol: MarketSymbol;
  direction: Direction;
  openedAt: number;
  /** Break-even MagicBlock price — where the chart actually draws entry. */
  entryLine: number;
  liqLine?: number;
  /** Current price, used to seed the buffer so a replay starts at the entry. */
  price: number;
}): string {
  const existing = active.get(opts.symbol);
  if (existing) return existing.id;

  const now = Date.now();
  const ep: LiveEpisode = {
    id: newId(),
    mode: opts.mode,
    symbol: opts.symbol,
    direction: opts.direction,
    openedAt: opts.openedAt,
    entryLine: opts.entryLine,
    liqLine: opts.liqLine,
    entry: opts.price,
    tick: tickFor(opts.price),
    samples: [opts.price],
    t0: now,
    intervalMs: 1000 / BASE_HZ,
    lastAt: now,
    gaps: [],
  };
  active.set(opts.symbol, ep);
  return ep.id;
}

/**
 * Offer a price tick. Sampling is time-gated to the episode's current interval,
 * so this can safely be called on every oracle tick (~16/s) — surplus ticks are
 * dropped rather than buffered.
 */
export function record(symbol: MarketSymbol, price: number) {
  const ep = active.get(symbol);
  if (!ep || !Number.isFinite(price) || price <= 0) return;

  const now = Date.now();
  const since = now - ep.lastAt;
  if (since < ep.intervalMs) return;

  // A long silence is a hole in the recording, not a slow tick. Record it so
  // the player can draw the gap instead of interpolating across it.
  if (since > GAP_THRESHOLD_MS) {
    ep.gaps.push({ from: ep.lastAt, to: now });
  }

  ep.samples.push(price);
  ep.lastAt = now;
  if (ep.samples.length >= MAX_SAMPLES) downsample(ep);
}

/** The in-flight episode id for a market, if it is being recorded. */
export function episodeIdFor(symbol: MarketSymbol): string | undefined {
  return active.get(symbol)?.id;
}

/** True while a market has an in-flight recording. */
export function isRecording(symbol: MarketSymbol): boolean {
  return active.has(symbol);
}

/**
 * Splice backfilled prices into a gap. Klines only reach ~3.2h back at 1m
 * granularity, so this is a best-effort patch for short absences (a lunch
 * break, a backgrounded PWA) rather than an archive — see lib/replay/backfill.
 *
 * The recorder stores samples positionally (index -> t0 + i*interval), so a
 * backfilled span has to be resampled onto that same grid: we walk the gap at
 * the episode's current interval and linearly interpolate between the 1m
 * closes. That is honest at this granularity — the endpoint genuinely has no
 * sub-minute detail — and it keeps the encoded path a flat array.
 *
 * Returns true if the gap was filled.
 */
export function fillGap(
  symbol: MarketSymbol,
  gap: ReplayGap,
  prices: { t: number; p: number }[]
): boolean {
  const ep = active.get(symbol);
  if (!ep || prices.length === 0) return false;
  const match = ep.gaps.find((g) => g.from === gap.from && g.to === gap.to);
  if (!match || match.filled) return false;

  // How many slots the gap occupies on the episode's sampling grid. The
  // recorder pushed nothing during the gap, so these have to be inserted.
  const slots = Math.floor((gap.to - gap.from) / ep.intervalMs);
  if (slots < 1) {
    match.filled = true;
    return true;
  }

  const sorted = [...prices].sort((a, b) => a.t - b.t);
  const filled: number[] = [];
  for (let i = 0; i < slots; i++) {
    filled.push(sampleAt(sorted, gap.from + i * ep.intervalMs));
  }

  // Splice at the boundary: everything recorded before the gap, the backfill,
  // then everything after. `index` is where the post-gap samples begin.
  const index = Math.max(
    0,
    Math.min(ep.samples.length, Math.round((gap.from - ep.t0) / ep.intervalMs) + 1)
  );
  ep.samples = [
    ...ep.samples.slice(0, index),
    ...filled,
    ...ep.samples.slice(index),
  ];
  match.filled = true;

  while (ep.samples.length >= MAX_SAMPLES) downsample(ep);
  return true;
}

/** Linear interpolation of a sparse series at time `t` (clamped at the ends). */
function sampleAt(series: { t: number; p: number }[], t: number): number {
  if (t <= series[0]!.t) return series[0]!.p;
  const last = series[series.length - 1]!;
  if (t >= last.t) return last.p;
  for (let i = 1; i < series.length; i++) {
    const b = series[i]!;
    if (b.t >= t) {
      const a = series[i - 1]!;
      const span = b.t - a.t;
      if (span <= 0) return b.p;
      return a.p + ((t - a.t) / span) * (b.p - a.p);
    }
  }
  return last.p;
}

/** Unfilled gaps of an in-flight recording, for the backfill pass to attempt. */
export function pendingGaps(symbol: MarketSymbol): ReplayGap[] {
  const ep = active.get(symbol);
  if (!ep) return [];
  return ep.gaps.filter((g) => !g.filled).map((g) => ({ ...g }));
}

/**
 * Encode the buffered absolute prices as tick-quantized deltas against entry.
 * This is what keeps an episode at ~1.2-4.3KB of JSON instead of ~15KB, which
 * is what makes storing demo replays in localStorage viable.
 */
function encode(ep: LiveEpisode): TradePath {
  const d = ep.samples.map((p) => Math.round((p - ep.entry) / ep.tick));
  return {
    t0: ep.t0,
    hz: 1000 / ep.intervalMs,
    entry: ep.entry,
    tick: ep.tick,
    d,
  };
}

/**
 * Fraction of the position's wall-clock duration we actually hold data for.
 * This — not the trade's age — is what gates whether a row is replayable: a
 * three-month-old trade watched start to finish is perfectly replayable, while
 * an hour-old trade the user walked away from is not.
 */
function computeCoverage(ep: LiveEpisode, closedAt: number): number {
  const span = closedAt - ep.openedAt;
  if (span <= 0) return 1;
  const missing = ep.gaps
    .filter((g) => !g.filled)
    .reduce((sum, g) => sum + Math.max(0, g.to - g.from), 0);
  return Math.max(0, Math.min(1, (span - missing) / span));
}

/**
 * Seal the recording for a market and return the finished episode. Called when
 * the position goes flat; an add/reduce must NOT seal (the path continues).
 * Returns null when nothing was recorded.
 */
export function sealEpisode(
  symbol: MarketSymbol,
  closedAt: number = Date.now()
): TradeEpisode | null {
  const ep = active.get(symbol);
  if (!ep) return null;
  active.delete(symbol);
  if (ep.samples.length < 2) return null;

  return {
    id: ep.id,
    mode: ep.mode,
    symbol: ep.symbol,
    direction: ep.direction,
    openedAt: ep.openedAt,
    closedAt,
    entryLine: ep.entryLine,
    liqLine: ep.liqLine,
    path: encode(ep),
    gaps: ep.gaps,
    coverage: computeCoverage(ep, closedAt),
  };
}

/** Drop an in-flight recording without sealing it (e.g. on sign-out). */
export function abortEpisode(symbol: MarketSymbol) {
  active.delete(symbol);
}

/** Drop every in-flight recording. */
export function abortAll() {
  active.clear();
}
