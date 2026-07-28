// Renders a shareable PnL card to a canvas at a FIXED size (rectangle). Kept
// framework-free and imperative so the same routine backs the on-screen preview,
// the downloadable PNG, and — later — per-frame video export. Everything is drawn
// (dot grid + candle + text + QR) so there's no DOM-capture dependency.

import type { Direction, MarketSymbol } from "@/types";
import { formatPrice } from "@/lib/format";

// Fixed card geometry (portrait rectangle, share-friendly 4:5). Draw at 2× for
// crisp export; the DOM scales it down to fit.
export const CARD_W = 1080;
export const CARD_H = 1350;

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

// A single stylized candlestick whose body points up (profit) or down (loss),
// tinted the trade colour. Sits low-right as a watermark behind the QR area.
function drawCandle(ctx: CanvasRenderingContext2D, profit: boolean) {
  const color = profit ? UP : DOWN;
  const cx = CARD_W - 250;
  const bodyW = 120;
  const bodyH = 360;
  const top = profit ? 470 : 470;
  const bodyTop = top;
  const wickTop = bodyTop - 110;
  const wickBottom = bodyTop + bodyH + 110;

  ctx.save();
  ctx.globalAlpha = 0.14;
  // Wick.
  ctx.strokeStyle = color;
  ctx.lineWidth = 14;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, wickTop);
  ctx.lineTo(cx, wickBottom);
  ctx.stroke();
  // Body.
  ctx.fillStyle = color;
  roundRect(ctx, cx - bodyW / 2, bodyTop, bodyW, bodyH, 18);
  ctx.fill();
  ctx.restore();

  // A subtle directional arrow riding the candle to reinforce up/down.
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = color;
  ctx.lineWidth = 16;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const ax = cx;
  const ay = profit ? bodyTop - 40 : bodyTop + bodyH + 40;
  const dir = profit ? -1 : 1;
  ctx.beginPath();
  ctx.moveTo(ax, ay + dir * -60);
  ctx.lineTo(ax, ay + dir * 60);
  ctx.moveTo(ax - 34, ay + dir * -60 + dir * 40);
  ctx.lineTo(ax, ay + dir * -60);
  ctx.lineTo(ax + 34, ay + dir * -60 + dir * 40);
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

// --- Main render --------------------------------------------------------------

export function drawPnlCard(
  ctx: CanvasRenderingContext2D,
  data: PnlCardData,
  assets: CardAssets,
  metric: ShareMetric
) {
  const profit = data.pnl >= 0;
  const accent = profit ? UP : DOWN;

  // Base.
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  drawDotGrid(ctx);
  drawCandle(ctx, profit);

  const PAD = 80;
  let y = 90;

  // Logo (top-left). Lightning "T" on brand-green rounded square.
  const logoSize = 92;
  if (assets.logo) {
    ctx.save();
    roundRect(ctx, PAD, y, logoSize, logoSize, 22);
    ctx.clip();
    ctx.drawImage(assets.logo, PAD, y, logoSize, logoSize);
    ctx.restore();
  } else {
    ctx.fillStyle = UP;
    roundRect(ctx, PAD, y, logoSize, logoSize, 22);
    ctx.fill();
  }
  ctx.fillStyle = TEXT;
  ctx.font = "700 46px system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("Tradash", PAD + logoSize + 26, y + logoSize / 2);

  y += logoSize + 70;

  // Market icon + name + symbol.
  const iconSize = 76;
  if (assets.marketIcon) {
    ctx.save();
    roundRect(ctx, PAD, y, iconSize, iconSize, iconSize / 2);
    ctx.clip();
    ctx.drawImage(assets.marketIcon, PAD, y, iconSize, iconSize);
    ctx.restore();
  }
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = TEXT;
  ctx.font = "700 52px system-ui, sans-serif";
  ctx.fillText(data.marketLabel, PAD + iconSize + 24, y + 36);
  ctx.fillStyle = MUTED;
  ctx.font = "500 34px system-ui, sans-serif";
  ctx.fillText(`${data.symbol}-USD`, PAD + iconSize + 24, y + 74);

  // Direction pill (UP / DOWN, arrow + colour — never long/short).
  const pillLabel = data.direction === "long" ? "UP" : "DOWN";
  const dirProfitColor = data.direction === "long" ? UP : DOWN;
  ctx.font = "700 32px system-ui, sans-serif";
  const pillTextW = ctx.measureText(pillLabel).width;
  const pillW = pillTextW + 96;
  const pillH = 56;
  const pillX = CARD_W - PAD - pillW;
  const pillY = y + 8;
  ctx.fillStyle = hexA(dirProfitColor, 0.14);
  roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
  ctx.fill();
  // Arrow.
  drawDirArrow(ctx, pillX + 34, pillY + pillH / 2, data.direction === "long", dirProfitColor);
  ctx.fillStyle = dirProfitColor;
  ctx.textBaseline = "middle";
  ctx.fillText(pillLabel, pillX + 58, pillY + pillH / 2 + 2);
  ctx.textBaseline = "alphabetic";

  y += iconSize + 120;

  // Big PnL / ROI (selectable). Colour by profit / loss.
  ctx.fillStyle = accent;
  if (metric === "pnl" || metric === "both") {
    ctx.font = "800 132px system-ui, sans-serif";
    ctx.fillText(fmtUsd(data.pnl), PAD, y);
    y += metric === "both" ? 100 : 0;
  }
  if (metric === "roi" || metric === "both") {
    if (metric === "both") {
      ctx.font = "800 88px system-ui, sans-serif";
      ctx.fillStyle = accent;
      ctx.fillText(fmtPct(data.roiPct), PAD, y);
    } else {
      ctx.font = "800 132px system-ui, sans-serif";
      ctx.fillText(fmtPct(data.roiPct), PAD, y);
    }
  }
  // Sub-label: leverage.
  ctx.fillStyle = MUTED;
  ctx.font = "600 36px system-ui, sans-serif";
  y += 56;
  ctx.fillText(`${data.leverage}× ${data.direction === "long" ? "Long" : "Short"}`, PAD, y);

  y += 90;

  // Entry / Mark(or Exit) price rows.
  drawPriceRow(ctx, PAD, y, "Entry Price", `$${formatPrice(data.entryPrice)}`);
  y += 78;
  drawPriceRow(
    ctx,
    PAD,
    y,
    data.closed ? "Exit Price" : "Mark Price",
    `$${formatPrice(data.markPrice)}`
  );

  // Footer: referral link + QR.
  const qrSize = 190;
  const qrX = CARD_W - PAD - qrSize;
  const qrY = CARD_H - PAD - qrSize;
  if (assets.qr) {
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, qrX - 16, qrY - 16, qrSize + 32, qrSize + 32, 22);
    ctx.fill();
    ctx.drawImage(assets.qr, qrX, qrY, qrSize, qrSize);
  }
  ctx.fillStyle = MUTED;
  ctx.font = "500 30px system-ui, sans-serif";
  ctx.fillText("Trade & share your own", PAD, CARD_H - PAD - qrSize + 40);
  ctx.fillStyle = TEXT;
  ctx.font = "700 40px system-ui, sans-serif";
  ctx.fillText(prettyUrl(data.referralUrl), PAD, CARD_H - PAD - qrSize + 96);
}

function drawPriceRow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  value: string
) {
  ctx.fillStyle = MUTED;
  ctx.font = "500 38px system-ui, sans-serif";
  ctx.fillText(label, x, y);
  ctx.fillStyle = TEXT;
  ctx.font = "700 44px system-ui, sans-serif";
  const vw = ctx.measureText(value).width;
  ctx.fillText(value, CARD_W - 80 - 260 - vw, y);
}

function drawDirArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  up: boolean,
  color: string
) {
  const s = 14;
  const d = up ? -1 : 1;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 8;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, cy + d * s);
  ctx.lineTo(cx, cy - d * s);
  ctx.moveTo(cx - s * 0.7, cy - d * s + d * s * 0.8);
  ctx.lineTo(cx, cy - d * s);
  ctx.lineTo(cx + s * 0.7, cy - d * s + d * s * 0.8);
  ctx.stroke();
  ctx.restore();
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
