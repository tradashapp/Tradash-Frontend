// Tiny pub/sub between useMomentumFeedback (which decides a reaction happened)
// and the chart overlay (which draws it). Deliberately outside Redux: these are
// fire-and-forget moments, and a store round-trip per callout would re-render
// every connected component on the trade screen for a bubble that lives 1.5s.

import type { Callout } from "@/lib/momentum";

export type Reaction =
  | { kind: "callout"; callout: Callout }
  /** A surge: flash the chart's edges green (with you) or red (against). */
  | { kind: "flash"; favorable: boolean; mega: boolean };

type Listener = (r: Reaction) => void;
const listeners = new Set<Listener>();

export function emitReaction(r: Reaction) {
  listeners.forEach((l) => l(r));
}

export function onReaction(l: Listener): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
