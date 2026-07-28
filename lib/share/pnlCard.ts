// Renders a shareable PnL card to a canvas at a FIXED size (landscape rectangle).
// Kept framework-free and imperative so the same routine backs the on-screen
// preview, the downloadable PNG, and — later — per-frame video export. Everything
// is drawn (dot grid + candle + progress curve + text + QR) so there's no
// DOM-capture dependency.

import type { Direction, MarketSymbol } from "@/types";
import { formatPrice } from "@/lib/format";

// Fixed card geometry — LANDSCAPE 16:9. Draw at high res; the DOM scales it down.
export const CARD_W = 1600;
export const CARD_H = 900;

const UP = "#72E912";
const DOWN = "#E6432D";
const BG = "#08090c";
const GRID = "#1a1d26";
const TEXT = "#e8eaed";
const MUTED = "#8b90a0";

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
}

const fmtUsd = (n: number) =>
  `${n >= 0 ? "+" : "−"}$${Math.abs(n).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const fmtPct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}%`;

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
  drawProgressCurve(ctx, profit);
  drawCandle(ctx, profit);

  const PAD = 90;
  let y = PAD + 20;

  // --- Market identity (top): icon + name + symbol. ---
  const iconSize = 84;
  if (assets.marketIcon) {
    ctx.save();
    roundRect(ctx, PAD, y, iconSize, iconSize, iconSize / 2);
    ctx.clip();
    ctx.drawImage(assets.marketIcon, PAD, y, iconSize, iconSize);
    ctx.restore();
  }
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = TEXT;
  ctx.font = "700 56px system-ui, sans-serif";
  ctx.fillText(data.marketLabel, PAD + iconSize + 28, y + 38);
  ctx.fillStyle = MUTED;
  ctx.font = "500 36px system-ui, sans-serif";
  ctx.fillText(`${data.symbol}-USD`, PAD + iconSize + 28, y + 80);

  // Direction pill (UP / DOWN, arrow + colour — never long/short), top-right.
  const pillLabel = up ? "UP" : "DOWN";
  const dirColor = up ? UP : DOWN;
  ctx.font = "700 34px system-ui, sans-serif";
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
  if (metric === "pnl" || metric === "both") {
    ctx.fillStyle = accent;
    ctx.font = "800 148px system-ui, sans-serif";
    ctx.textBaseline = "alphabetic";
    const pnlText = fmtUsd(data.pnl);
    ctx.fillText(pnlText, PAD, y);

    if (metric === "both") {
      // Small ROI chip to the right of the PnL, glass bg green/red, filled arrow.
      const pnlW = ctx.measureText(pnlText).width;
      drawRoiChip(ctx, PAD + pnlW + 40, y - 82, data.roiPct, profit);
    }
  } else {
    // ROI only, large.
    ctx.fillStyle = accent;
    ctx.font = "800 148px system-ui, sans-serif";
    ctx.fillText(fmtPct(data.roiPct), PAD, y);
  }

  y += 110;

  // --- Entry / Mark(or Exit) price rows. ---
  drawPriceRow(ctx, PAD, y, "Entry Price", `$${formatPrice(data.entryPrice)}`);
  y += 74;
  drawPriceRow(
    ctx,
    PAD,
    y,
    data.closed ? "Exit Price" : "Mark Price",
    `$${formatPrice(data.markPrice)}`
  );

  // --- Footer: [ ref text + link + logo ]  [ QR ]  in a flex row. ---
  drawFooter(ctx, data, assets, PAD);
}

// Small ROI chip: glass rounded bg (green/red), filled up/down arrow + ROI%.
function drawRoiChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  roiPct: number,
  profit: boolean
) {
  const color = profit ? UP : DOWN;
  const label = `${Math.abs(roiPct).toFixed(2)}%`;
  ctx.font = "700 40px system-ui, sans-serif";
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
}

function drawPriceRow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  value: string
) {
  ctx.fillStyle = MUTED;
  ctx.font = "500 40px system-ui, sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(label, x, y);
  ctx.fillStyle = TEXT;
  ctx.font = "700 44px system-ui, sans-serif";
  ctx.fillText(value, x + 320, y);
}

// Footer laid out as two columns in a flex row: the referral block on the left
// (label → link → Tradash logo underneath), and the QR code on the right.
function drawFooter(
  ctx: CanvasRenderingContext2D,
  data: PnlCardData,
  assets: CardAssets,
  PAD: number
) {
  const qrSize = 176;
  const qrX = CARD_W - PAD - qrSize;
  const qrY = CARD_H - PAD - qrSize;

  // QR (right column).
  if (assets.qr) {
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, qrX - 14, qrY - 14, qrSize + 28, qrSize + 28, 20);
    ctx.fill();
    ctx.drawImage(assets.qr, qrX, qrY, qrSize, qrSize);
  }

  // Referral block (left column), vertically anchored to the QR band.
  const leftX = PAD;
  let ly = qrY + 8;
  ctx.fillStyle = MUTED;
  ctx.font = "500 32px system-ui, sans-serif";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Trade & share your own", leftX, ly);

  ly += 52;
  ctx.fillStyle = TEXT;
  ctx.font = "700 44px system-ui, sans-serif";
  ctx.fillText(prettyUrl(data.referralUrl), leftX, ly);

  // Tradash logo UNDER the link (logo mark + wordmark).
  ly += 34;
  const logoSize = 60;
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
  ctx.font = "700 40px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("Tradash", leftX + logoSize + 20, ly + logoSize / 2 + 2);
  ctx.textBaseline = "alphabetic";
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
