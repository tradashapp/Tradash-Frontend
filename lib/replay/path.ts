import type { ReplayGap, TradeEpisode, TradePath } from "@/types";

// Decoding + quality helpers for a recorded episode. Kept separate from the
// recorder so the player, the history list and (later) the share card can read
// paths without pulling in the recording machinery.

export interface DecodedSample {
  /** ms epoch. */
  t: number;
  /** USD price. */
  p: number;
}

/** Expand a stored path back into absolute {t, p} samples. */
export function decodePath(path: TradePath): DecodedSample[] {
  const step = 1000 / path.hz;
  return path.d.map((delta, i) => ({
    t: path.t0 + i * step,
    p: path.entry + delta * path.tick,
  }));
}

/** Wall-clock span the samples cover, in ms. */
export function pathDurationMs(path: TradePath): number {
  if (path.d.length < 2) return 0;
  return ((path.d.length - 1) * 1000) / path.hz;
}

/** Min/max price across the path, for framing the replay's Y scale. */
export function pathRange(path: TradePath): { min: number; max: number } | null {
  if (path.d.length === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const delta of path.d) {
    if (delta < lo) lo = delta;
    if (delta > hi) hi = delta;
  }
  return {
    min: path.entry + lo * path.tick,
    max: path.entry + hi * path.tick,
  };
}

/** Minimum fraction of a position's duration we must hold to offer a replay. */
export const MIN_COVERAGE = 0.6;
/** Below this many samples there is nothing worth animating. */
export const MIN_SAMPLES = 30;
/**
 * Fraction at each end of the trade that must be present. A gap in the dead
 * middle of a long hold barely matters; a missing entry or exit guts the replay,
 * because those are the moments people actually want to see.
 */
const EDGE_FRACTION = 0.1;

/** True when `gaps` leave the first and last EDGE_FRACTION of the span intact. */
function edgesIntact(episode: TradeEpisode): boolean {
  const { openedAt, closedAt, gaps } = episode;
  const end = closedAt ?? openedAt;
  const span = end - openedAt;
  if (span <= 0) return true;
  const edge = span * EDGE_FRACTION;
  const headEnd = openedAt + edge;
  const tailStart = end - edge;
  return !gaps.some(
    (g) => !g.filled && (g.from < headEnd || g.to > tailStart)
  );
}

/**
 * Whether a completed trade can be replayed honestly.
 *
 * Deliberately a COVERAGE test, not an age test: any trade we recorded well is
 * replayable however old it is, and any trade we recorded poorly is not,
 * however recent. A replay that is mostly "no data" is worse than no button.
 */
export function isReplayable(episode: TradeEpisode | null | undefined): boolean {
  if (!episode) return false;
  if (episode.path.d.length < MIN_SAMPLES) return false;
  if (episode.coverage < MIN_COVERAGE) return false;
  return edgesIntact(episode);
}

/** Coverage as a user-facing percentage, e.g. "94% recorded". */
export function coverageLabel(episode: TradeEpisode): string {
  return `${Math.round(episode.coverage * 100)}% recorded`;
}

/** Unfilled gaps, for the player to draw as breaks in the line. */
export function openGaps(episode: TradeEpisode): ReplayGap[] {
  return episode.gaps.filter((g) => !g.filled);
}
