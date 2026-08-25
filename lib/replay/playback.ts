import type { TradeEpisode } from "@/types";
import { decodePath, type DecodedSample } from "./path";

// Turns a recorded episode into a watchable timeline.
//
// A trade's wall-clock duration is the wrong playback duration: a 12-second
// scalp padded to a minute is dead air, and a four-hour swing compressed
// uniformly is a blur. So playback targets a fixed span and warps time within
// it — the flat middle is compressed, and the moments that carry the story
// (entry, worst drawdown, each add/reduce, exit) are slowed down.

/** Shortest a replay should ever run. */
const MIN_DURATION_MS = 8_000;
/** Longest a replay should ever run — a Story, not a video. */
const MAX_DURATION_MS = 15_000;

/** A moment worth slowing down for, as a fraction (0..1) through the path. */
export interface ReplayBeat {
  /** Position along the path, 0..1. */
  at: number;
  kind: "entry" | "exit" | "drawdown" | "peak" | "add" | "reduce";
  /** ms epoch of the underlying sample, for matching history rows. */
  t: number;
  price: number;
}

export interface ReplayTimeline {
  samples: DecodedSample[];
  beats: ReplayBeat[];
  /** Total playback duration in ms. */
  durationMs: number;
  /** How much faster than real time, for the speed badge. */
  speed: number;
  /** Cumulative weight per sample index, normalized 0..1. */
  cumulative: number[];
}

/**
 * Pick a playback duration: short trades get the floor, long trades the
 * ceiling, and everything between scales on a log curve so a 2-minute and a
 * 2-hour trade don't both land at the same number.
 */
function durationFor(tradeMs: number): number {
  if (tradeMs <= 60_000) return MIN_DURATION_MS;
  const t = Math.min(1, Math.log10(tradeMs / 60_000) / Math.log10(120));
  return MIN_DURATION_MS + t * (MAX_DURATION_MS - MIN_DURATION_MS);
}

/**
 * Find the moments worth lingering on. Entry and exit always qualify; so does
 * the deepest drawdown against the position and the best excursion in its
 * favour, which together are what make a replay feel like a story rather than
 * a fast-forward.
 */
function findBeats(
  samples: DecodedSample[],
  episode: TradeEpisode
): ReplayBeat[] {
  if (samples.length < 2) return [];
  const dir = episode.direction === "long" ? 1 : -1;
  const entry = episode.entryLine;

  let worstIdx = 0;
  let bestIdx = 0;
  let worst = Infinity;
  let best = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    // Signed move in the position's favour.
    const move = (samples[i]!.p - entry) * dir;
    if (move < worst) {
      worst = move;
      worstIdx = i;
    }
    if (move > best) {
      best = move;
      bestIdx = i;
    }
  }

  const last = samples.length - 1;
  const beats: ReplayBeat[] = [
    { at: 0, kind: "entry", t: samples[0]!.t, price: samples[0]!.p },
    { at: 1, kind: "exit", t: samples[last]!.t, price: samples[last]!.p },
  ];
  // Only mark the extremes when they are actually interior and meaningful —
  // otherwise they duplicate entry/exit and the pacing gains nothing.
  if (worstIdx > 0 && worstIdx < last && worst < 0) {
    beats.push({
      at: worstIdx / last,
      kind: "drawdown",
      t: samples[worstIdx]!.t,
      price: samples[worstIdx]!.p,
    });
  }
  if (bestIdx > 0 && bestIdx < last && best > 0) {
    beats.push({
      at: bestIdx / last,
      kind: "peak",
      t: samples[bestIdx]!.t,
      price: samples[bestIdx]!.p,
    });
  }
  return beats.sort((a, b) => a.at - b.at);
}

/** Extra playback weight given to a sample near a beat. */
const BEAT_WEIGHT = 2.5;
/** How wide a beat's influence is, as a fraction of the path. */
const BEAT_RADIUS = 0.06;

/**
 * Build the warped timeline. Each sample gets a weight (higher near a beat),
 * and the cumulative weights become the mapping from playback progress to
 * sample index — so time passes slowly through the beats and quickly through
 * the flat stretches, while total duration stays fixed.
 */
export function buildTimeline(
  episode: TradeEpisode,
  extraBeats: ReplayBeat[] = []
): ReplayTimeline {
  const samples = decodePath(episode.path);
  const beats = [...findBeats(samples, episode), ...extraBeats].sort(
    (a, b) => a.at - b.at
  );

  const n = samples.length;
  const cumulative = new Array<number>(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const at = n > 1 ? i / (n - 1) : 0;
    let weight = 1;
    for (const beat of beats) {
      const d = Math.abs(at - beat.at);
      if (d < BEAT_RADIUS) {
        // Smooth falloff so the speed change eases rather than steps.
        weight += BEAT_WEIGHT * (1 - d / BEAT_RADIUS);
      }
    }
    total += weight;
    cumulative[i] = total;
  }
  for (let i = 0; i < n; i++) cumulative[i] = cumulative[i]! / total;

  const tradeMs =
    (episode.closedAt ?? samples[n - 1]?.t ?? 0) - episode.openedAt;
  const durationMs = durationFor(Math.max(0, tradeMs));

  return {
    samples,
    beats,
    durationMs,
    speed: tradeMs > 0 ? tradeMs / durationMs : 1,
    cumulative,
  };
}

/**
 * Map playback progress (0..1) to a fractional sample index. Inverts the
 * cumulative weights, so progress advances slowly through the weighted beats.
 */
export function indexAt(timeline: ReplayTimeline, progress: number): number {
  const { cumulative } = timeline;
  const n = cumulative.length;
  if (n === 0) return 0;
  const p = Math.max(0, Math.min(1, progress));

  // Binary search for the first cumulative value >= p.
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumulative[mid]! < p) lo = mid + 1;
    else hi = mid;
  }
  // Interpolate within the bucket so motion stays smooth between samples.
  const prev = lo > 0 ? cumulative[lo - 1]! : 0;
  const span = cumulative[lo]! - prev;
  const frac = span > 0 ? (p - prev) / span : 0;
  return Math.max(0, Math.min(n - 1, lo - 1 + frac));
}

/** Progress (0..1) at which a given ms-epoch moment appears. */
export function progressAtTime(
  timeline: ReplayTimeline,
  t: number
): number {
  const { samples, cumulative } = timeline;
  if (samples.length === 0) return 0;
  let idx = samples.findIndex((s) => s.t >= t);
  if (idx < 0) idx = samples.length - 1;
  return cumulative[idx] ?? 0;
}

/** Price at a fractional sample index, linearly interpolated. */
export function priceAtIndex(
  timeline: ReplayTimeline,
  index: number
): number {
  const { samples } = timeline;
  if (samples.length === 0) return 0;
  const i = Math.floor(index);
  const next = Math.min(samples.length - 1, i + 1);
  const frac = index - i;
  const a = samples[i]!.p;
  const b = samples[next]!.p;
  return a + (b - a) * frac;
}
