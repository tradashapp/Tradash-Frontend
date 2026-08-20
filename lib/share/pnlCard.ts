// Renders a shareable PnL card to a canvas at a FIXED size (landscape rectangle).
// Kept framework-free and imperative so the same routine backs the on-screen
// preview, the downloadable PNG, and — later — per-frame video export. Everything
// is drawn (dot grid + candle + progress curve + text + QR) so there's no
// DOM-capture dependency.

import type { Direction, MarketSymbol } from "@/types";
import { formatPrice } from "@/lib/format";

// Fixed card geometry — LANDSCAPE 16:9. Draw at high res; the DOM scales it down.
export const CARD_W = 1600;
export const CARD_H = 1000;

const UP = "#72E912";
const DOWN = "#E6432D";
const BG = "#08090c";
const GRID = "#1a1d26";
const TEXT = "#e8eaed";
const MUTED = "#8b90a0";

// Match the app's typography on the canvas. Canvas text does NOT inherit CSS,
// so we name the same families next/font loads (Space Grotesk = UI sans,
// JetBrains Mono = tabular figures), falling back to the same stack as the app.
// SANS backs labels/names; MONO backs numeric values (PnL, ROI, prices).
const SANS = '"Space Grotesk", system-ui, sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, monospace';

// Card-wide outer padding. Shared so the mascot can align its bottom edge with
// the footer's margin rather than guessing at it.
const PAD_OUTER = 80;

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

export interface CardAssets {
  logo: HTMLImageElement | null;
  marketIcon: HTMLImageElement | null;
  qr: HTMLImageElement | null;
  /** Selected mascot artwork for the right-hand side. Null → that space stays empty. */
  mascot: HTMLImageElement | null;
}

const fmtUsd = (n: number) =>
  `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const fmtPct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;

// The exact (weight, family) pairs the card draws with. Canvas only renders a
// web font if it's already loaded, so we prime these before the first paint —
// otherwise the card silently falls back to the system font.
const CARD_FONTS = [
  `500 16px ${SANS}`,
  `700 16px ${SANS}`,
  `800 16px ${SANS}`,
  `500 16px ${MONO}`,
  `700 16px ${MONO}`,
  `800 16px ${MONO}`,
];

/** Ensure the card's fonts are loaded so canvas text renders in them, not a
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

/** Load an image (crypto logo / rendered QR) as a promise, tolerating failure. */
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// --- Background pieces --------------------------------------------------------

function drawDotGrid(ctx: CanvasRenderingContext2D) {
  const spacing = 46;
  const r = 2.2;
  ctx.fillStyle = GRID;
  for (let x = spacing / 2; x < CARD_W; x += spacing) {
    for (let y = spacing / 2; y < CARD_H; y += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// A progress "chart" curve sweeping across the lower half of the card, rising
// (profit) or falling (loss) toward the right, with a soft gradient fill beneath.
// Colour follows the trade result. Purely decorative — evokes the position's run.
function drawProgressCurve(ctx: CanvasRenderingContext2D, profit: boolean) {
  const color = profit ? UP : DOWN;
  const x0 = 60;
  const x1 = CARD_W - 60;
  // Start / end heights: rise to the right when in profit, fall when in loss.
  const yStart = profit ? CARD_H - 250 : CARD_H - 470;
  const yEnd = profit ? CARD_H - 560 : CARD_H - 210;

  // A gentle S-curve via two cubic segments with a little wobble.
  const mid = (x0 + x1) / 2;
  const yMid = (yStart + yEnd) / 2 + (profit ? 40 : -40);

  const path = new Path2D();
  path.moveTo(x0, yStart);
  path.bezierCurveTo(
    x0 + (mid - x0) * 0.5,
    yStart,
    mid - (mid - x0) * 0.4,
    yMid,
    mid,
    yMid
  );
  path.bezierCurveTo(
    mid + (x1 - mid) * 0.4,
    yMid,
    x1 - (x1 - mid) * 0.5,
    yEnd,
    x1,
    yEnd
  );

  // Gradient fill under the curve.
  const fill = new Path2D(path);
  fill.lineTo(x1, CARD_H);
  fill.lineTo(x0, CARD_H);
  fill.closePath();
  const grad = ctx.createLinearGradient(0, Math.min(yStart, yEnd) - 40, 0, CARD_H);
  grad.addColorStop(0, hexA(color, 0.16));
  grad.addColorStop(1, hexA(color, 0));
  ctx.save();
  ctx.fillStyle = grad;
  ctx.fill(fill);

  // The line itself.
  ctx.strokeStyle = hexA(color, 0.55);
  ctx.lineWidth = 6;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(path);
  ctx.restore();
}

// A single stylized candlestick whose body points up (profit) or down (loss),
// tinted the trade colour, with a directional arrow. Sits behind the right side.
function drawCandle(ctx: CanvasRenderingContext2D, profit: boolean) {
  const color = profit ? UP : DOWN;
  const cx = CARD_W - 470;
  const bodyW = 100;
  const bodyH = 300;
  const bodyTop = 300;
  const wickTop = bodyTop - 90;
  const wickBottom = bodyTop + bodyH + 90;

  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.strokeStyle = color;
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, wickTop);
  ctx.lineTo(cx, wickBottom);
  ctx.stroke();
  ctx.fillStyle = color;
  roundRect(ctx, cx - bodyW / 2, bodyTop, bodyW, bodyH, 16);
  ctx.fill();
  ctx.restore();

  // Directional arrow riding the candle — points UP for profit, DOWN for loss.
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = color;
  ctx.lineWidth = 14;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const ax = cx;
  const ac = profit ? bodyTop - 30 : bodyTop + bodyH + 30; // arrow centre
  const head = profit ? ac - 50 : ac + 50; // tip on the pointing side
  const tail = profit ? ac + 50 : ac - 50; // opposite end of the shaft
  const barb = profit ? head + 34 : head - 34; // barbs sit below/above the tip
  ctx.beginPath();
  ctx.moveTo(ax, tail);
  ctx.lineTo(ax, head);
  ctx.moveTo(ax - 30, barb);
  ctx.lineTo(ax, head);
  ctx.lineTo(ax + 30, barb);
  ctx.stroke();
  ctx.restore();
}


// The mascot fills the right-hand side — the space the old decorative
// candle/curve used to fill. It reaches down to the footer's baseline so it
// reads as standing on the card, with the same breathing room from the bottom
// edge that the footer has.
//
// The obstacles sit in two different vertical bands: the PnL/price text column
// occupies the UPPER part of the card, the QR + referral footer the LOWER part.
// Fitting one rectangle against the wider of the two would waste all the space
// beside the narrower one, so we instead try both bands and keep whichever
// yields the larger mascot:
//
//   • "tall"  — full height, but only as wide as BOTH obstacles allow.
//   • "short" — starts below the text column, so it may run much further left,
//               needing only to clear the footer.
//
// Sizing is always "contain": ONE uniform scale from whichever axis binds
// first, so the art never stretches and a taller fit can never push the width
// left into the text.
interface MascotBounds {
  /** Right edge of the big PnL row (incl. the ROI chip in "both" mode). */
  pnlRowRight: number;
  /** Baseline of the PnL row — nothing wide sits below this line. */
  pnlRowBottom: number;
  /** Right edge of the (much narrower) Entry / Mark price rows. */
  priceRowsRight: number;
  /** Baseline of the lowest price row. */
  contentBottom: number;
  /** Right edge of the QR + referral footer. */
  footerRight: number;
}

function drawMascot(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  bounds: MascotBounds
) {
  const GAP = 56; // clearance from the text column / footer
  const TOP = 200; // clears the direction pill
  // Bottom edge mirrors the footer's own margin, so both sit on one baseline.
  const BOTTOM = CARD_H - PAD_OUTER;
  // A slight bleed into the right margin — the art is transparent-padded.
  const RIGHT = CARD_W - PAD_OUTER + 40;

  const ar = img.naturalWidth / img.naturalHeight;

  // Every candidate spans down to BOTTOM; they differ in how high they start
  // and therefore how far left they may reach. Taking the largest by area lets
  // the mascot grow into whichever pocket of empty card is actually biggest.
  const candidates = [
    // Full height — must clear the widest obstacle at every level.
    fitBox(
      Math.max(bounds.pnlRowRight, bounds.priceRowsRight, bounds.footerRight) +
        GAP,
      TOP,
      RIGHT,
      BOTTOM,
      ar
    ),
    // Starts just under the PnL row's baseline, so only the much narrower price
    // rows and the footer limit its width. Usually the winner: the empty band
    // beside the price rows is the widest pocket on the card.
    fitBox(
      Math.max(bounds.priceRowsRight, bounds.footerRight) + GAP,
      bounds.pnlRowBottom,
      RIGHT,
      BOTTOM,
      ar
    ),
    // Starts below all the text: only the footer constrains the width.
    fitBox(
      bounds.footerRight + GAP,
      bounds.contentBottom + GAP,
      RIGHT,
      BOTTOM,
      ar
    ),
  ];

  const box = candidates.reduce((best, c) =>
    c.w * c.h > best.w * best.h ? c : best
  );
  if (box.w <= 0 || box.h <= 0) return;

  ctx.drawImage(img, box.x, box.y, box.w, box.h);
}

// Contain-fit an aspect ratio into a rectangle: centred horizontally in any
// leftover slack, bottom-anchored vertically so mascots of differing shapes all
// stand on the same ground line.
function fitBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ar: number
): { x: number; y: number; w: number; h: number } {
  const boxW = x1 - x0;
  const boxH = y1 - y0;
  if (boxW <= 0 || boxH <= 0) return { x: x0, y: y0, w: 0, h: 0 };
  // Width-bound vs height-bound — the smaller result is the one that fits.
  let w = boxW;
  let h = w / ar;
  if (h > boxH) {
    h = boxH;
    w = h * ar;
  }
  return { x: x0 + (boxW - w) / 2, y: y1 - h, w, h };
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// A filled triangle arrow (up / down) — used inside the ROI chip & direction pill.
// up=true → apex points UP (toward smaller y); down → apex points DOWN.
function drawFilledArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  up: boolean,
  color: string
) {
  // Apex on the pointing side, base on the opposite side.
  const apexY = up ? cy - size : cy + size;
  const baseY = up ? cy + size * 0.7 : cy - size * 0.7;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, apexY);
  ctx.lineTo(cx - size * 0.9, baseY);
  ctx.lineTo(cx + size * 0.9, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// --- Main render --------------------------------------------------------------

export function drawPnlCard(
  ctx: CanvasRenderingContext2D,
  data: PnlCardData,
  assets: CardAssets,
  metric: ShareMetric
) {
  const profit = data.pnl >= 0;
  const accent = profit ? UP : DOWN;
  const up = data.direction === "long";

  // Base + background art.
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  drawDotGrid(ctx);
  // drawProgressCurve(ctx, profit);
  // drawCandle(ctx, profit);

  const PAD = PAD_OUTER;
  let y = PAD;

  // --- Market identity (top): icon + name + symbol. ---
  const iconSize = 80;
  if (assets.marketIcon) {
    ctx.save();
    roundRect(ctx, PAD, y, iconSize, iconSize, iconSize / 2);
    ctx.clip();
    ctx.drawImage(assets.marketIcon, PAD, y, iconSize, iconSize);
    ctx.restore();
  }
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = TEXT;
  ctx.font = `700 52px ${SANS}`;
  ctx.fillText(data.marketLabel, PAD + iconSize + 28, y + 38);
  ctx.fillStyle = MUTED;
  ctx.font = `500 32px ${MONO}`;
  ctx.fillText(`${data.symbol}-USD`, PAD + iconSize + 28, y + 80);

  // Direction pill (UP / DOWN, arrow + colour — never long/short) with the
  // leverage used appended, e.g. "Up/40x". Top-right.
  const pillLabel = `${up ? "Up" : "Down"}/${data.leverage}x`;
  const dirColor = up ? UP : DOWN;
  ctx.font = `700 34px ${SANS}`;
  const pillTextW = ctx.measureText(pillLabel).width;
  const pillW = pillTextW + 104;
  const pillH = 60;
  const pillX = CARD_W - PAD - pillW;
  const pillY = y + 12;
  ctx.fillStyle = hexA(dirColor, 0.14);
  roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fill();
  drawFilledArrow(ctx, pillX + 38, pillY + pillH / 2, 16, up, dirColor);
  ctx.fillStyle = dirColor;
  ctx.textBaseline = "middle";
  ctx.fillText(pillLabel, pillX + 64, pillY + pillH / 2 + 2);
  ctx.textBaseline = "alphabetic";

  // Extra breathing room so the big PnL never crowds the market name/symbol.
  y += iconSize + 190;

  // --- Big PnL / ROI. ---
  // In "both" mode: big PnL with the ROI as a small glass chip to its right.
  // In single modes: just the one metric, large.
  // How far right each band of the left-hand text column reaches. The big PnL
  // row is far wider than the price rows beneath it, so the mascot tracks them
  // separately and can tuck into the space beside the narrower rows.
  let pnlRowRight = 0;
  let priceRowsRight = 0;

  if (metric === "pnl" || metric === "both") {
    ctx.fillStyle = accent;
    ctx.font = `800 120px ${MONO}`;
    ctx.textBaseline = "alphabetic";
    const pnlText = fmtUsd(data.pnl);
    ctx.fillText(pnlText, PAD, y);

    const pnlW = ctx.measureText(pnlText).width;
    pnlRowRight = PAD + pnlW;

    if (metric === "both") {
      // Small ROI chip to the right of the PnL, glass bg green/red, filled arrow.
      pnlRowRight = drawRoiChip(
        ctx,
        PAD + pnlW + 40,
        y - 82,
        data.roiPct,
        profit
      );
    }
  } else {
    // ROI only, large.
    ctx.fillStyle = accent;
    ctx.font = `800 120px ${MONO}`;
    const roiText = fmtPct(data.roiPct);
    ctx.fillText(roiText, PAD, y);
    pnlRowRight = PAD + ctx.measureText(roiText).width;
  }

  // Baseline of the PnL row: below this line only the narrow price rows sit.
  const pnlRowBottom = y;

  y += 110;

  // --- Entry / Mark(or Exit) price rows. ---
  priceRowsRight = Math.max(
    priceRowsRight,
    drawPriceRow(ctx, PAD, y, "Entry Price", `$${formatPrice(data.entryPrice)}`)
  );
  y += 74;
  priceRowsRight = Math.max(
    priceRowsRight,
    drawPriceRow(
      ctx,
      PAD,
      y,
      data.closed ? "Exit Price" : "Mark Price",
      `$${formatPrice(data.markPrice)}`
    )
  );
  // Baseline of the lowest text row.
  const contentBottom = y;

  // --- Footer: [ QR ]  [ ref text + link + logo ]  flexed as one left-aligned
  // row. It reports how far right it reaches so the mascot can claim the rest. ---
  const footerRight = drawFooter(ctx, data, assets, PAD);

  // Mascot last: it needs the footer's measured extent to size itself, and it's
  // drawn over the (empty) background on the right, never over any text.
  if (assets.mascot) {
    drawMascot(ctx, assets.mascot, {
      pnlRowRight,
      pnlRowBottom,
      priceRowsRight,
      contentBottom,
      footerRight,
    });
  }
}

// Small ROI chip: glass rounded bg (green/red), filled up/down arrow + ROI%.
function drawRoiChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  roiPct: number,
  profit: boolean
): number {
  const color = profit ? UP : DOWN;
  const label = `${Math.abs(roiPct).toFixed(2)}%`;
  ctx.font = `700 40px ${MONO}`;
  const textW = ctx.measureText(label).width;
  const chipH = 68;
  const arrowGap = 44;
  const chipW = arrowGap + textW + 44;
  ctx.fillStyle = hexA(color, 0.16);
  roundRect(ctx, x, y, chipW, chipH, chipH / 2);
  ctx.fill();
  drawFilledArrow(ctx, x + 28, y + chipH / 2, 15, profit, color);
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(label, x + arrowGap + 8, y + chipH / 2 + 2);
  ctx.textBaseline = "alphabetic";
  return x + chipW;
}

function drawPriceRow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  value: string
): number {
  ctx.fillStyle = MUTED;
  ctx.font = `500 40px ${SANS}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText(label, x, y);
  ctx.fillStyle = TEXT;
  ctx.font = `700 40px ${MONO}`;
  ctx.fillText(value, x + 320, y);
  return x + 320 + ctx.measureText(value).width;
}

// Footer laid out as two columns in a flex row: the referral block on the left
// (label → link → Tradash logo underneath), and the QR code on the right.
function drawFooter(
  ctx: CanvasRenderingContext2D,
  data: PnlCardData,
  assets: CardAssets,
  PAD: number
): number {
  const qrSize = 176;
  const plate = 14; // white padding around the QR bitmap
  const qrX = PAD + plate;
  const qrY = CARD_H - PAD - qrSize;

  // QR (left), with the referral block flexed to its right.
  if (assets.qr) {
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, qrX - plate, qrY - plate, qrSize + plate * 2, qrSize + plate * 2, 20);
    ctx.fill();
    ctx.drawImage(assets.qr, qrX, qrY, qrSize, qrSize);
  }

  // Referral column, sitting to the right of the QR plate.
  const leftX = qrX + qrSize + plate + 20;
  let ly = qrY + 6;
  let widest = 0;



  // Tradash logo + wordmark UNDER the link.
  const logoSize = 50;
  if (assets.logo) {
    ctx.save();
    roundRect(ctx, leftX, ly, logoSize, logoSize, 16);
    ctx.clip();
    ctx.drawImage(assets.logo, leftX, ly, logoSize, logoSize);
    ctx.restore();
  } else {
    ctx.fillStyle = UP;
    roundRect(ctx, leftX, ly, logoSize, logoSize, 16);
    ctx.fill();
  }
  ctx.fillStyle = TEXT;
  ctx.font = `700 40px ${SANS}`;
  ctx.textBaseline = "middle";
  ctx.fillText("Tradash", leftX + logoSize + 20, ly + logoSize / 2 + 2);
  ctx.textBaseline = "alphabetic";
  widest = Math.max(widest, logoSize + 20 + ctx.measureText("Tradash").width);

  ly += 110;
  ctx.fillStyle = MUTED;
  ctx.font = `500 32px ${SANS}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Trade & share your own", leftX, ly);
  widest = Math.max(widest, ctx.measureText("Trade & share your own").width);

  ly += 58;
  ctx.fillStyle = TEXT;
  ctx.font = `700 38px ${SANS}`;
  const link = prettyUrl(data.referralUrl);
  ctx.fillText(link, leftX, ly);
  widest = Math.max(widest, ctx.measureText(link).width);

  // Right edge of everything the footer occupies — the mascot must clear it.
  return leftX + widest;
}

function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
