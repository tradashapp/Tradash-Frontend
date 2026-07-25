import { PriceInterpolator } from "@/lib/oracle/interpolation";
import { PriceSeries } from "./priceSeries";

export interface ChartTheme {
  line: string;
  lineGlow: string;
  /** Fill colors used only while a position is open. */
  fillUp: string;
  fillDown: string;
  axisText: string;
  axisLine: string;
}

const DEFAULT_THEME: ChartTheme = {
  line: "#16c784",
  lineGlow: "rgba(22, 199, 132, 0.55)",
  fillUp: "rgba(22, 199, 132, 0.20)",
  fillDown: "rgba(234, 57, 67, 0.20)",
  axisText: "#8b90a0",
  axisLine: "rgba(255, 255, 255, 0.06)",
};

// Whether/how to fill under the line. Fill only appears while in a position:
// green when the position's PnL is positive, red when negative.
export type FillMode = "none" | "up" | "down";

// Per-frame chart state other layers (e.g. the dot grid) can read.
export interface ChartFrame {
  price: number | null;
  /** Normalized 0..1 vertical position of the latest price in the window. */
  yNorm: number;
  /** Frame-over-frame price delta, for parallax reactions. */
  velocity: number;
}

// Right-hand gutter reserved for the price scale.
const AXIS_WIDTH = 64;
const TICK_COUNT = 6;

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

  // Position-aware fill.
  private fillMode: FillMode = "none";

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

  /** Control the position-aware fill (none while flat; up/down while in a trade). */
  setFillMode(mode: FillMode) {
    this.fillMode = mode;
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
    this.onFrame?.({ price, yNorm, velocity });
  }

  /**
   * Draw the current window; returns the normalized Y of the latest price.
   * `price` is the eased live price used to center the scale.
   */
  private draw(price: number | null): number {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);

    const samples = this.series.toArray();
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
    const floor = price * 0.0012; // ~0.12% minimum visible half-range
    const needed = Math.max(
      Math.max(price - range.min, range.max - price) * 1.3,
      floor
    );
    this.center += (price - this.center) * 0.06;
    // Ease up quickly (so a real move fits) but zoom back in slowly (calm).
    const ease = needed > this.half ? 0.12 : 0.02;
    this.half += (needed - this.half) * ease;
    const half = Math.max(this.half, floor);

    const min = this.center - half;
    const span = half * 2 || 1;

    const xOf = (i: number) => (i / (samples.length - 1)) * plotW;
    const yOf = (p: number) => bottom - ((p - min) / span) * usableH;

    // --- Position-aware fill (only while in a trade) --------------------------
    if (this.fillMode !== "none") {
      this.tracePath(samples, xOf, yOf, /*close*/ true, plotW, bottom);
      const isUp = this.fillMode === "up";
      const grad = ctx.createLinearGradient(0, top, 0, bottom);
      grad.addColorStop(0, isUp ? this.theme.fillUp : this.theme.fillDown);
      grad.addColorStop(
        1,
        isUp ? "rgba(22,199,132,0)" : "rgba(234,57,67,0)"
      );
      ctx.fillStyle = grad;
      ctx.fill();
    }

    // --- Smooth line ----------------------------------------------------------
    this.tracePath(samples, xOf, yOf, /*close*/ false, plotW, bottom);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 2;
    ctx.shadowColor = this.theme.lineGlow;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = this.theme.line;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Latest point.
    const lx = xOf(samples.length - 1);
    const ly = yOf(price);

    // --- Right price scale + current-price marker -----------------------------
    this.drawScale(min, span, top, bottom, usableH, plotW);
    this.drawCurrentMarker(lx, ly, plotW, price);

    return 1 - (ly - top) / usableH;
  }

  /**
   * Trace a smooth Catmull-Rom path through the samples (converted to cubic
   * beziers). When `close` is true, closes down to the baseline for a fill.
   */
  private tracePath(
    samples: { p: number }[],
    xOf: (i: number) => number,
    yOf: (p: number) => number,
    close: boolean,
    plotW: number,
    bottom: number
  ) {
    const ctx = this.ctx;
    const n = samples.length;
    ctx.beginPath();
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
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

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

      // Label in the right gutter.
      ctx.fillStyle = this.theme.axisText;
      ctx.fillText(this.fmtPrice(price), plotW + 8, y);
    }
    ctx.restore();
  }

  private drawCurrentMarker(
    lx: number,
    ly: number,
    plotW: number,
    price: number
  ) {
    const { ctx } = this;

    // Dashed leader from the line's leading point to the scale.
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = this.theme.line;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(plotW, ly);
    ctx.stroke();
    ctx.restore();

    // Leading dot.
    ctx.beginPath();
    ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = this.theme.line;
    ctx.fill();

    // Price pill on the scale, pointing at the current price.
    const label = this.fmtPrice(price);
    ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    const padX = 6;
    const textW = ctx.measureText(label).width;
    const pillW = textW + padX * 2;
    const pillH = 18;
    const pillX = plotW + 2;
    const pillY = ly - pillH / 2;

    ctx.fillStyle = this.theme.line;
    this.roundRect(pillX, pillY, pillW, pillH, 4);
    ctx.fill();

    ctx.fillStyle = "#08090c";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, pillX + padX, ly);
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
    // Adaptive precision: whole-dollar for large assets, cents for small.
    const frac = p >= 1000 ? 0 : p >= 1 ? 2 : 4;
    return p.toLocaleString(undefined, {
      minimumFractionDigits: frac,
      maximumFractionDigits: frac,
    });
  }
}
