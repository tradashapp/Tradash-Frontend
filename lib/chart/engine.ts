import { PriceInterpolator } from "@/lib/oracle/interpolation";
import { PriceSeries } from "./priceSeries";

export interface ChartTheme {
  line: string;
  lineGlow: string;
  fillTop: string;
  fillBottom: string;
}

const DEFAULT_THEME: ChartTheme = {
  line: "#16c784",
  lineGlow: "rgba(22, 199, 132, 0.55)",
  fillTop: "rgba(22, 199, 132, 0.18)",
  fillBottom: "rgba(22, 199, 132, 0.0)",
};

// Per-frame chart state other layers (e.g. the dot grid) can read.
export interface ChartFrame {
  price: number | null;
  /** Normalized 0..1 vertical position of the latest price in the window. */
  yNorm: number;
  /** Frame-over-frame price delta, for parallax reactions. */
  velocity: number;
}

/**
 * Custom canvas chart engine. Runs a single rAF loop: ease price → push sample
 * → redraw. No chart library, so we control styling, overlays, and 60fps
 * behavior under volatility directly.
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
  private onFrame?: (f: ChartFrame) => void;
  private padding = { top: 24, bottom: 24 };

  constructor(
    canvas: HTMLCanvasElement,
    opts: { theme?: Partial<ChartTheme>; capacity?: number; onFrame?: (f: ChartFrame) => void } = {}
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

  /** Clear the window (e.g. on market switch) so the new feed starts fresh. */
  reset() {
    this.interp.reset();
    this.series.clear();
    this.lastPrice = null;
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
      this.series.push(now, price);
    }
    const velocity = price != null && this.lastPrice != null ? price - this.lastPrice : 0;
    this.lastPrice = price;

    const yNorm = this.draw();
    this.onFrame?.({ price, yNorm, velocity });
  }

  /** Draw the current window; returns the normalized Y of the latest price. */
  private draw(): number {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);

    const samples = this.series.toArray();
    const range = this.series.range();
    if (samples.length < 2 || !range) return 0.5;

    // Pad the price range slightly so the line never touches the edges.
    const pad = (range.max - range.min) * 0.12 || range.max * 0.0005 || 1;
    const min = range.min - pad;
    const max = range.max + pad;
    const span = max - min || 1;

    const top = this.padding.top;
    const bottom = h - this.padding.bottom;
    const usableH = bottom - top;

    const xOf = (i: number) => (i / (samples.length - 1)) * w;
    const yOf = (p: number) => bottom - ((p - min) / span) * usableH;

    // Fill under the line.
    ctx.beginPath();
    ctx.moveTo(0, bottom);
    samples.forEach((s, i) => ctx.lineTo(xOf(i), yOf(s.p)));
    ctx.lineTo(w, bottom);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, top, 0, bottom);
    grad.addColorStop(0, this.theme.fillTop);
    grad.addColorStop(1, this.theme.fillBottom);
    ctx.fillStyle = grad;
    ctx.fill();

    // The line with a soft glow.
    ctx.beginPath();
    samples.forEach((s, i) => {
      const x = xOf(i);
      const y = yOf(s.p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    ctx.shadowColor = this.theme.lineGlow;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = this.theme.line;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Leading dot at the latest price.
    const last = samples[samples.length - 1]!;
    const lx = xOf(samples.length - 1);
    const ly = yOf(last.p);
    ctx.beginPath();
    ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = this.theme.line;
    ctx.fill();

    return 1 - (ly - top) / usableH;
  }
}
