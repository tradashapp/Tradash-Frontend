// Shared vocabulary for the shareable PnL card: its fixed geometry, the data it
// renders from, and the font primer both the preview and the PNG export depend on.
//
// The card itself used to be drawn imperatively onto a canvas from this file —
// every dot of the grid, every glyph, the QR plate, the mascot's fit. It is now
// ordinary DOM in `components/share/PnlCard.tsx`, which means it inherits the
// app's real typography and CSS gradients instead of re-implementing them, and
// the PNG comes out of html-to-image rather than `canvas.toDataURL`. What's left
// here is the part both the card and the modal need to agree on.

import type { Direction, MarketSymbol } from "@/types";

// Fixed card geometry — LANDSCAPE 16:10. The card renders at exactly this size
// and is scaled down for the preview, so the exported PNG is always the same
// rectangle regardless of the screen it was shared from.
export const CARD_W = 1600;
export const CARD_H = 1000;

export type ShareMetric = "pnl" | "roi" | "both";

export interface PnlCardData {
  symbol: MarketSymbol;
  marketLabel: string;
  direction: Direction;
  leverage: number;
  pnl: number;
  roiPct: number;
  entryPrice: number;
  /** Live mark price (open position) OR exit price (closed trade). */
  markPrice: number;
  /** true → position is closed, so the mark line is labeled "Exit". */
  closed: boolean;
  referralUrl: string;
}

// The exact (weight, family) pairs the card renders with. html-to-image embeds
// whatever the cloned node resolves to at capture time, so an unloaded web font
// exports as a system fallback even when the live preview looks right — hence
// priming them before the first paint.
const SANS = '"Space Grotesk", system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

const CARD_FONTS = [
  `500 16px ${SANS}`,
  `700 16px ${SANS}`,
  `800 16px ${SANS}`,
  `500 16px ${MONO}`,
  `700 16px ${MONO}`,
  `800 16px ${MONO}`,
];

/** Ensure the card's fonts are loaded so it paints (and exports) in them, not a
 *  system fallback. Resolves even if the Font Loading API is unavailable. */
export async function ensureCardFonts(): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  try {
    await Promise.all(CARD_FONTS.map((f) => document.fonts.load(f)));
    await document.fonts.ready;
  } catch {
    /* fall back to whatever's available */
  }
}
