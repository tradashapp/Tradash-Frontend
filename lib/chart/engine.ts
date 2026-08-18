import { PriceInterpolator } from "@/lib/oracle/interpolation";
import { PriceSeries } from "./priceSeries";
import { formatPrice } from "@/lib/format";

// Brand palette. Up/profit = brand green; down/loss = red.
const UP = "#72E912";
const DOWN = "#E6432D";

export interface ChartTheme {
  line: string; // neutral line color when flat
  lineGlow: string;
  up: string;
  down: string;
  axisText: string;
  axisLine: string;
  entryLine: string; // neutral entry marker
  liqLine: string; // liquidation warning
}

const DEFAULT_THEME: ChartTheme = {
  line: UP,
  lineGlow: "rgba(114, 233, 18, 0.5)",
  up: UP,
  down: DOWN,
  axisText: "#8b90a0",
  axisLine: "rgba(255, 255, 255, 0.06)",
  entryLine: "rgba(232, 234, 237, 0.55)",
  liqLine: "rgba(230, 67, 45, 0.7)",
};

// Position overlay data the chart draws: entry line, mark-line color by PnL,
// gradient between entry and mark, and a liquidation line.
export interface PositionOverlay {
  entryPrice: number;
  liquidationPrice: number;
  /** Positive → profit (green), negative → loss (red). */
  pnl: number;
  /** Active trailing-stop price, drawn as a line that ratchets with price. */
  trailStopPrice?: number;
}

// Per-frame chart state other layers (e.g. the dot grid) can read.
export interface ChartFrame {
  price: number | null;
  /** Normalized 0..1 vertical position of the latest price in the window. */
  yNorm: number;
  /** Frame-over-frame price delta, for parallax reactions. */
  velocity: number;
  /**
   * Horizontal distance (px) the plot scrolled this frame. One sample is pushed
   * per frame into a fixed-capacity window stretched across the plot area, so
   * every frame the whole series slides left by exactly this much. Background
   * layers add it up to travel in lockstep with the price line.
   */
  scrollX: number;
}

// Right-hand gutter reserved for the price scale. Wide enough for the widest
// label (e.g. "$560,500.20") plus the pill, with breathing room from the edge.
const AXIS_WIDTH = 96;
// Inset from the canvas's right edge so labels/pill never touch the border.
const AXIS_RIGHT_INSET = 10;
// More gridlines for a denser scale.
const TICK_COUNT = 9;

/**
 * Custom canvas chart engine. Runs a single rAF loop: ease price → push sample
 * → redraw. No chart library, so we control styling, overlays, and 60fps
 * behavior under volatility directly.
 *
 * Design notes:
 * - The Y-scale keeps the *current* price pinned to the vertical center and
 *   auto-zooms to fit recent movement, so the line always waves around the
 *   middle. The half-range is eased between frames to kill rescale jitter.
 * - The line is drawn as a smooth Catmull-Rom curve (converted to beziers).
 * - A right-side price scale + a current-price marker point at the live value.
 */
export class ChartEngine {
  private ctx: CanvasRenderingContext2D;
  private canvas: HTMLCanvasElement;
  private interp = new PriceInterpolator();
  private series: PriceSeries;
  private raf = 0;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private theme: ChartTheme;
  private lastPrice: number | null = null;
  private seeded = false;
  private onFrame?: (f: ChartFrame) => void;
  private padding = { top: 28, bottom: 28 };

  // Eased scale state. `center` tracks the current price; `half` is half the
  // visible price span (so the window is center ± half). Both ease per frame.
  private center = 0;
  private half = 0;

  // Active position overlay (null while flat).
  private position: PositionOverlay | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    opts: {
      theme?: Partial<ChartTheme>;
      capacity?: number;
      onFrame?: (f: ChartFrame) => void;
    } = {}
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas context unavailable");
    this.ctx = ctx;
    this.series = new PriceSeries(opts.capacity ?? 600);
    this.theme = { ...DEFAULT_THEME, ...opts.theme };
    this.onFrame = opts.onFrame;
    this.resize();
  }

  /** Feed the newest oracle price. */
  setPrice(price: number) {
    this.interp.setTarget(price);
  }

  setTheme(theme: Partial<ChartTheme>) {
    this.theme = { ...this.theme, ...theme };
  }

  /** Set (or clear) the active position overlay: entry/liq lines + PnL fill. */
  setPosition(overlay: PositionOverlay | null) {
    this.position = overlay;
  }

  /** Clear the window (e.g. on market switch) so the new feed starts fresh. */
  reset() {
    this.interp.reset();
    this.series.clear();
    this.lastPrice = null;
    this.seeded = false;
    this.center = 0;
    this.half = 0;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  start() {
    if (this.raf) return;
    const loop = () => {
      this.frame();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame() {
    const price = this.interp.tick();
    const now = performance.now();
    if (price != null) {
      if (!this.seeded) {
        this.seeded = true;
        for (let i = 0; i < this.series.capacity; i++) {
          this.series.push(now - (this.series.capacity - i) * 16, price);
        }
        this.center = price;
      }
      this.series.push(now, price);
    }
    const velocity =
      price != null && this.lastPrice != null ? price - this.lastPrice : 0;
    this.lastPrice = price;

    const yNorm = this.draw(price);
    // Samples fill the plot width evenly, so a single new sample shifts the
    // window left by one sample's worth of pixels. Reported unconditionally:
    // this is a property of the plot geometry, not of the feed, so background
    // layers keep scrolling even while the oracle is silent or reconnecting.
    const scrollX = (this.w - AXIS_WIDTH) / (this.series.capacity - 1);
    this.onFrame?.({ price, yNorm, velocity, scrollX });
  }

  /**
   * Draw the current window; returns the normalized Y of the latest price.
   * `price` is the eased live price used to center the scale.
   */
  private draw(price: number | null): number {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);

    // Reused buffer — must not be retained past this frame.
    const samples = this.series.view();
    const range = this.series.range();
    if (samples.length < 2 || !range || price == null) return 0.5;

    const plotW = w - AXIS_WIDTH;
    const top = this.padding.top;
    const bottom = h - this.padding.bottom;
    const usableH = bottom - top;

    // --- Eased, centered scale ------------------------------------------------
    // Half-range needed to contain recent movement around the current price,
    // with headroom so the wave never clips. A minimum floor (relative to price)
    // stops a nearly-flat window from zooming in so far that tiny ticks look like
    // huge spikes. Both center and half ease per frame so the scale glides
    // instead of snapping (this is what removes the zigzag jitter).
    const floor = price * 0.0005; // ~0.05% minimum visible half-range (zoomed in)
    // Scale ONLY to recent live-price movement — the entry/liq/trail lines are
    // NOT forced into view. Pinning them made the chart zoom out (squeeze) to
    // chase a static line as price ran away; instead we let those lines scroll
    // off and mark them at the top/bottom edge (see drawEdgeTag) so the live
    // price action always stays legible and zoomed to its own movement.
    const pos = this.position;
    const reach = Math.max(price - range.min, range.max - price);
    const needed = Math.max(reach * 1.15, floor);
    this.center += (price - this.center) * 0.06;
    const ease = needed > this.half ? 0.12 : 0.02;
    this.half += (needed - this.half) * ease;
    const half = Math.max(this.half, floor);

    const min = this.center - half;
    const span = half * 2 || 1;

    const xOf = (i: number) => (i / (samples.length - 1)) * plotW;
    const yOf = (p: number) => bottom - ((p - min) / span) * usableH;

    // Profit/loss determines the accent color for the line, fill, and marker.
    const inProfit = !pos || pos.pnl >= 0;
    const accent = inProfit ? this.theme.up : this.theme.down;

    const lx = xOf(samples.length - 1);
    const ly = yOf(price);

    // Trace the price line ONCE per frame. It's a 600-point Catmull-Rom→bezier
    // walk, and it was previously run twice whenever a position was open (once
    // for the gradient band, once for the stroke). Building a Path2D lets both
    // draws reuse the same geometry.
    const linePath = new Path2D();
    this.tracePath(samples, xOf, yOf, /*close*/ false, plotW, bottom, linePath);

    // --- Position overlay: gradient band between entry and mark lines ----------
    if (pos) {
      const entryY = yOf(pos.entryPrice);
      // Fill the band bounded by the price line on top/bottom and the entry
      // line: the traced line, then back along the entry line to close it.
      const band = new Path2D(linePath);
      band.lineTo(plotW, entryY);
      band.lineTo(0, entryY);
      band.closePath();
      const gTop = Math.min(ly, entryY);
      const gBot = Math.max(ly, entryY);
      const grad = ctx.createLinearGradient(0, gTop, 0, gBot);
      const fillCol = inProfit
        ? "rgba(114, 233, 18, 0.22)"
        : "rgba(230, 67, 45, 0.22)";
      const faded = inProfit
        ? "rgba(114, 233, 18, 0.02)"
        : "rgba(230, 67, 45, 0.02)";
      // Fade away from the mark line toward the entry line.
      grad.addColorStop(0, ly <= entryY ? fillCol : faded);
      grad.addColorStop(1, ly <= entryY ? faded : fillCol);
      ctx.fillStyle = grad;
      ctx.fill(band);

      // Entry / Liq / Trail lines. Each draws in place when on-screen, or as a
      // clamped edge marker (caret + price) at the top/bottom when it has
      // scrolled out of view — so the chart never squeezes to hold them.
      this.drawLineOrEdge(
        entryY, top, bottom, plotW, "Entry",
        pos.entryPrice, this.theme.entryLine, "#08090c", [4, 4], 1, false
      );
      this.drawLineOrEdge(
        yOf(pos.liquidationPrice), top, bottom, plotW, "Liq",
        pos.liquidationPrice, this.theme.liqLine, "#08090c", [2, 3], 1, false
      );
      if (pos.trailStopPrice != null) {
        this.drawLineOrEdge(
          yOf(pos.trailStopPrice), top, bottom, plotW, "Trail",
          pos.trailStopPrice, accent, "#08090c", [6, 3], 1.5, true
        );
      }
    }

    // --- Smooth price (mark) line ---------------------------------------------
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = accent;
    // The glow is by far the most expensive op in the frame (a full-canvas blur
    // of the stroked path). Draw it as a wide, translucent under-stroke of the
    // same path instead — visually near-identical, a fraction of the cost.
    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 6;
    ctx.stroke(linePath);
    ctx.restore();
    ctx.stroke(linePath);

    // --- Right price scale + current-price marker (with PnL when in a trade) ---
    this.drawScale(min, span, top, bottom, usableH, plotW);
    this.drawCurrentMarker(lx, ly, plotW, price, accent, pos?.pnl);

    return 1 - (ly - top) / usableH;
  }

  /** Draw a horizontal dashed line across the plot. */
  private drawHLine(
    y: number,
    plotW: number,
    color: string,
    dash: number[],
    width: number
  ) {
    const ctx = this.ctx;
    ctx.save();
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(plotW, y);
    ctx.stroke();
    ctx.restore();
  }

  /** Small right-aligned tag in the gutter (for entry/liq labels). */
  private drawTag(
    y: number,
    plotW: number,
    text: string,
    bg: string,
    fg: string,
    bold: boolean
  ) {
    const { ctx, w } = this;
    ctx.font = `${bold ? "700" : "600"} 10px ui-monospace, monospace`;
    const padX = 5;
    const tw = ctx.measureText(text).width;
    const bw = tw + padX * 2;
    const bh = 15;
    const x = w - AXIS_RIGHT_INSET - bw;
    ctx.fillStyle = bg;
    this.roundRect(x, y - bh / 2, bw, bh, 3);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + padX, y);
  }

  /**
   * Draw a reference line (entry/liq/trail) in place when it's within the plot,
   * or as a clamped edge marker when it has scrolled off. The marker sits flush
   * against the top or bottom edge and shows a caret (▲ above / ▼ below) plus the
   * label and price, so the level stays known without the scale zooming to hold it.
   */
  private drawLineOrEdge(
    lineY: number,
    top: number,
    bottom: number,
    plotW: number,
    label: string,
    price: number,
    color: string,
    fg: string,
    dash: number[],
    width: number,
    bold: boolean
  ) {
    if (lineY >= top - 2 && lineY <= bottom + 2) {
      this.drawHLine(lineY, plotW, color, dash, width);
      this.drawTag(lineY, plotW, label, color, fg, bold);
      return;
    }
    // Off-screen: clamp to the nearest edge and mark it there.
    const above = lineY < top; // line is above the visible window
    const y = above ? top + 9 : bottom - 9;
    this.drawEdgeTag(y, plotW, `${above ? "▲" : "▼"} ${label} $${formatPrice(price)}`, color, fg);
  }

  /** An edge marker: caret + label + price, right-aligned in the gutter. Used
   *  when a reference line has scrolled out of the visible price window. */
  private drawEdgeTag(
    y: number,
    plotW: number,
    text: string,
    bg: string,
    fg: string
  ) {
    const { ctx, w } = this;
    ctx.font = `700 10px ui-monospace, monospace`;
    const padX = 5;
    const tw = ctx.measureText(text).width;
    const bw = tw + padX * 2;
    const bh = 15;
    const x = w - AXIS_RIGHT_INSET - bw;
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = bg;
    this.roundRect(x, y - bh / 2, bw, bh, 3);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + padX, y);
    ctx.restore();
  }

  /**
   * Trace a smooth Catmull-Rom path through the samples (converted to cubic
   * beziers). When `close` is true, closes down to the baseline for a fill.
   */
  private tracePath(
    samples: readonly { p: number }[],
    xOf: (i: number) => number,
    yOf: (p: number) => number,
    close: boolean,
    plotW: number,
    bottom: number,
    // When given, the path is built here instead of in the canvas context, so
    // one trace can be reused for several draws (fill + stroke) in a frame.
    into?: Path2D
  ) {
    const ctx = into ?? this.ctx;
    const n = samples.length;
    if (!into) this.ctx.beginPath();
    if (close) ctx.moveTo(0, bottom);
    else ctx.moveTo(xOf(0), yOf(samples[0]!.p));

    if (close) ctx.lineTo(xOf(0), yOf(samples[0]!.p));

    for (let i = 0; i < n - 1; i++) {
      const p0 = samples[Math.max(0, i - 1)]!;
      const p1 = samples[i]!;
      const p2 = samples[i + 1]!;
      const p3 = samples[Math.min(n - 1, i + 2)]!;

      const x1 = xOf(i);
      const y1 = yOf(p1.p);
      const x2 = xOf(i + 1);
      const y2 = yOf(p2.p);

      // Catmull-Rom → Bezier control points (tension 1/6).
      const cp1x = x1 + (x2 - xOf(Math.max(0, i - 1))) / 6;
      const cp1y = y1 + (y2 - yOf(p0.p)) / 6;
      const cp2x = x2 - (xOf(Math.min(n - 1, i + 2)) - x1) / 6;
      const cp2y = y2 - (yOf(p3.p) - y1) / 6;

      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2);
    }

    if (close) {
      ctx.lineTo(plotW, bottom);
      ctx.closePath();
    }
  }

  private drawScale(
    min: number,
    span: number,
    top: number,
    bottom: number,
    usableH: number,
    plotW: number
  ) {
    const { ctx, w } = this;
    ctx.save();
    ctx.font =
      "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    // Right-align labels to a fixed inset so long numbers never clip.
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const labelX = w - AXIS_RIGHT_INSET;

    for (let i = 0; i <= TICK_COUNT; i++) {
      const frac = i / TICK_COUNT;
      const price = min + span * (1 - frac); // top = high price
      const y = top + usableH * frac;

      // Faint gridline across the plot.
      ctx.strokeStyle = this.theme.axisLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(plotW, y);
      ctx.stroke();

      // Label in the right gutter, right-aligned.
      ctx.fillStyle = this.theme.axisText;
      ctx.fillText(this.fmtPrice(price), labelX, y);
    }
    ctx.restore();
  }

  private drawCurrentMarker(
    lx: number,
    ly: number,
    plotW: number,
    price: number,
    accent: string,
    pnl?: number
  ) {
    const { ctx, w } = this;

    // Dashed leader from the line's leading point to the scale.
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(plotW, ly);
    ctx.stroke();
    ctx.restore();

    // Leading dot.
    ctx.beginPath();
    ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();

    // Marker pill on the mark line. When in a position, show the live PnL under
    // the price (this replaces the removed on-screen PnL card).
    const priceLabel = this.fmtPrice(price);
    const pnlLabel =
      pnl != null
        ? `${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`
        : null;

    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "700 15px ui-monospace, SFMono-Regular, Menlo, monospace";
    const priceW = ctx.measureText(priceLabel).width;
    ctx.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    const pnlW = pnlLabel ? ctx.measureText(pnlLabel).width : 0;

    const padX = 9;
    const pillW = Math.max(priceW, pnlW) + padX * 2;
    const pillH = pnlLabel ? 34 : 26;
    const pillX = w - AXIS_RIGHT_INSET - pillW;
    const pillY = ly - pillH / 2;

    ctx.fillStyle = accent;
    // rounded-full: radius = half the height so the ends are fully rounded.
    this.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fill();

    ctx.fillStyle = "#08090c";
    if (pnlLabel) {
      ctx.font = "700 14px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(priceLabel, pillX + padX, ly - 7);
      ctx.font = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(pnlLabel, pillX + padX, ly + 8);
    } else {
      ctx.font = "700 15px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(priceLabel, pillX + padX, ly);
    }
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private fmtPrice(p: number): string {
    // Shared magnitude-based formatting, with a leading "$" on the scale.
    return `$${formatPrice(p)}`;
  }
}
