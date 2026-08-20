// Mascot artwork for the share PnL card.
//
// The mascots live as plain files in /public/images/pnl-card, named
// `pnl-win-<n>.png` and `pnl-lose-<n>.png` with n starting at 1. There is no
// manifest to keep in sync: dropping `pnl-win-2.png` into that folder is enough
// for it to show up in the picker. We discover them by probing n = 1, 2, 3…
// until the first miss, so the cost is exactly (found + 1) image requests, all
// of which the browser caches for the actual render.

/** Hard stop on probing, so a stray gap in numbering can't loop forever. */
const MAX_PROBE = 40;

export type MascotOutcome = "win" | "lose";

export interface Mascot {
  /** Stable id — also the filename stem, e.g. "pnl-win-2". */
  id: string;
  src: string;
  outcome: MascotOutcome;
  index: number;
}

export const mascotSrc = (outcome: MascotOutcome, index: number) =>
  `/images/pnl-card/pnl-${outcome}-${index}.png`;

/** Resolve one candidate: an <img> that loads means the file exists. */
function probe(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Discovery is per-outcome and identical for every card, so cache the in-flight
// promise: opening the share modal a second time costs nothing.
const cache = new Map<MascotOutcome, Promise<Mascot[]>>();

/**
 * List the mascots available for a win or a loss, in numeric order.
 * Probes sequentially from 1 and stops at the first missing index.
 */
export function listMascots(outcome: MascotOutcome): Promise<Mascot[]> {
  const hit = cache.get(outcome);
  if (hit) return hit;

  const run = (async () => {
    const found: Mascot[] = [];
    for (let i = 1; i <= MAX_PROBE; i++) {
      const src = mascotSrc(outcome, i);
      const img = await probe(src);
      if (!img) break;
      found.push({ id: `pnl-${outcome}-${i}`, src, outcome, index: i });
    }
    return found;
  })();

  cache.set(outcome, run);
  return run;
}
