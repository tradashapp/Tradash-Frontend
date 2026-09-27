import { PriceInterpolator } from "@/lib/oracle/interpolation";
import { CandleSeries, type Candle } from "./candles";
import { CandleGestures, CandleViewport } from "./candleViewport";
import { CanvasOdometer } from "./odometer";
import { PriceSeries } from "./priceSeries";
import { formatPrice, priceDecimals } from "@/lib/format";

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
  breakEvenLine: string; // net break-even (after fees + funding)
  tpLine: string; // resting take-profit
  slLine: string; // resting stop-loss
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
  // Amber: not a risk level like Liq, not the position's own entry — a cost
  // marker. Distinct hue so three dashed lines never read as the same thing.
  breakEvenLine: "rgba(245, 185, 10, 0.75)",
  // TP/SL borrow the app's up/down semantics — the take-profit is where the
  // trade wins, the stop is where it is cut — so they read instantly without a
  // legend. Solid-ish alpha keeps them distinct from the dimmer cost markers.
  tpLine: "rgba(114, 233, 18, 0.8)",
  slLine: "rgba(230, 67, 45, 0.8)",
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
  /**
   * Resting take-profit / stop-loss levels, in CHART space.
   *
   * These are where the position automatically exits, so they belong on the
   * chart next to the entry and liquidation lines the user already reads
   * against. Undefined when that side is not armed.
   */
  takeProfitPrice?: number;
  stopLossPrice?: number;
  /**
   * Net break-even: where closing nets zero AFTER fees and funding already
   * charged. Omitted when there is no cost data (demo, or a fresh position),
   * so it is never drawn sitting on top of the entry line.
   */
  breakEvenPrice?: number;
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
// Ruler ("-" ticks) running down the far right edge, right of the labels. Major
// ticks sit on each price label, minor ones subdivide the gap between them.
const RULER_EDGE = 3; // gap between the ruler and the canvas edge
const RULER_MAJOR = 6;
const RULER_MINOR = 3;
const RULER_SUBDIVISIONS = 5;
// Inset from the canvas's right edge for labels/tags/pill: clears the ruler.
const AXIS_RIGHT_INSET = RULER_EDGE + RULER_MAJOR + 5;
// LIVE scale = a fixed ruler. The price distance between labels is picked ONCE
// per market (from its price) and never changes, and exactly this many label
// gaps span the plot — so the scale never zooms, it only slides up and down as
// price moves. Moves past the edge simply run off-screen; the live price itself
// stays pinned at the middle.
const RULER_LABELS = 15;
// Price distance between labels as a fraction of price, before rounding to a
// 1/2/5 step: 0.01% → BTC $5, ETH $0.20, SOL $0.02. Raise it to zoom out.
const RULER_STEP_FRAC = 0.0001;
// Replay (driven mode) still fits its recorded path: at most this many labels,
// each with at least this many px (see tickStepFor).
const TICK_COUNT = 9;
const TICK_MIN_PX = 60;
// Labels fade out over this many px as they scroll into the plot edge or
// under the pinned price pill, instead of popping.
const LABEL_FADE_PX = 14;
// The left share of the plot over which the line (and everything else in the
// plot) fades out, so history dissolves instead of being cut off.
const LEFT_FADE_FRAC = 0.32;

// Candle body width as a share of its slot (spacing lives in CandleViewport).
const CANDLE_BODY_FRAC = 0.64;
// Scrolling within this many candles of the oldest loaded one asks for more.
const OLDER_HISTORY_MARGIN = 20;
// A view switch waits for the new view's data (candle history) before swapping,
// so the old view never blinks to empty — but never longer than this.
const VIEW_SWAP_TIMEOUT_MS = 2500;

/** What the live chart draws: the tick line, or candles at an interval. */
export type ChartView = "line" | "candles";

// Full Tradash logo (white on transparent), drawn faintly behind the plot.
const WATERMARK_SRC = "/images/logos/tradash-full.png";
const WATERMARK_ALPHA = 0.07;
const WATERMARK_MAX_W = 260;

// One image shared by every chart on the page. Loaded lazily (the engine is
// constructed client-side only); drawn once it has decoded.
let watermarkImg: HTMLImageElement | null = null;
function watermark(): HTMLImageElement | null {
  if (typeof Image === "undefined") return null;
  if (!watermarkImg) {
    watermarkImg = new Image();
    watermarkImg.src = WATERMARK_SRC;
  }
  return watermarkImg.complete && watermarkImg.naturalWidth > 0
    ? watermarkImg
    : null;
}

/**
 * Decimals a scale label needs: the price's usual format, or more when the step
 * is finer (PUMP's $0.0000005 step vs its 6-decimal price), so neighbouring
 * labels never read the same.
 */
function labelDecimalsFor(step: number, price: number): number {
  return Math.max(
    priceDecimals(price),
    Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
  );
}

/** Round a raw price step to a 1 / 2 / 5 × 10^n "nice" step. */
function niceStep(raw: number): number {
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}

/**
 * Custom canvas chart engine. Runs a single rAF loop: ease price → push sample
 * → redraw. No chart library, so we control styling, overlays, and 60fps
 * behavior under volatility directly.
 *
 * Design notes:
 * - The Y-scale keeps the *current* price pinned EXACTLY to the vertical
 *   center, so the live-price pill never moves — only its odometer digits
 *   roll. The scale does the moving instead: price labels sit on round values
 *   and scroll past the pill as price drifts, and the half-range auto-zooms
 *   (eased) whenever a spike or drop reaches past the visible window.
 * - The line is drawn as a smooth Catmull-Rom curve (converted to beziers),
 *   growing at the right edge and dissolving toward the left.
 * - A right-side price scale with a tick ruler, and a faint logo watermark.
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
  private onViewportChange?: (offCenter: boolean) => void;
  private onNeedOlder?: (intervalMs: number, beforeT: number) => void;
  private padding = { top: 28, bottom: 28 };

  // Eased scale state. `center` tracks the current price; `half` is half the
  // visible price span (so the window is center ± half). Both ease per frame.
  private center = 0;
  private half = 0;

  // Price-label spacing, in price units. Live: fixed on the first price after a
  // reset (the ruler). Replay: re-picked only when the fitted zoom drifts too
  // far from it, so labels don't reshuffle every frame.
  private tickStep = 0;
  // Decimals the live labels need so neighbours never read the same — PUMP's
  // $0.0000005 step is finer than its 6-decimal price format. null = default.
  private labelDecimals: number | null = null;

  // Rolling digits for the pinned pill: the live price, and PnL in a position.
  private priceOdo = new CanvasOdometer();
  private pnlOdo = new CanvasOdometer();

  // Active position overlay (null while flat).
  private position: PositionOverlay | null = null;

  // --- Line / candles view ----------------------------------------------------
  private view: ChartView = "line";
  private candles: CandleSeries | null = null;
  // The candle view's ruler step: fitted to the loaded history once, then fixed
  // (same sliding-ruler rule as the line). 0 = not fitted yet.
  private candleStep = 0;
  // Leftward px the candles moved this frame (rollover slide), for onFrame, and
  // the slide offset it's measured from.
  private candleScroll = 0;
  private candleOffset = 0;
  // A requested view change, held until its data arrives (`rows`) so the swap
  // is one clean crossfade rather than old view → empty → new view.
  private pending: {
    view: ChartView;
    intervalMs: number;
    since: number;
    rows: readonly Candle[] | null;
  } | null = null;
  // Candle view pan / zoom / axis-scale, and the gestures that drive it.
  private vp = new CandleViewport();
  private gestures: CandleGestures;
  private lastFormingT: number | null = null;
  private offCenterShown = false;
  // Oldest candle we've already asked `onNeedOlder` to extend past.
  private olderRequestedFor: number | null = null;
  // Canvas opacity for the crossfade, and the value last written to the DOM.
  private opacity = 1;
  private shownOpacity = 1;

  /**
   * Driven mode: the caller supplies samples explicitly instead of the engine
   * pulling from the oracle interpolator once per animation frame. Used by
   * trade replay, which has to advance a RECORDED path at its own (variable)
   * rate and scrub backwards — neither of which the wall-clock live path can do.
   * Everything else (scale easing, overlays, gradient, glow) is shared.
   */
  private driven = false;

  constructor(
    canvas: HTMLCanvasElement,
    opts: {
      theme?: Partial<ChartTheme>;
      capacity?: number;
      onFrame?: (f: ChartFrame) => void;
      /** Candle view: the user moved away from following / came back. */
      onViewportChange?: (offCenter: boolean) => void;
      /** Candle view: scrolled near the oldest loaded candle; load older ones. */
      onNeedOlder?: (intervalMs: number, beforeT: number) => void;
    } = {}
  ) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d canvas context unavailable");
    this.ctx = ctx;
    this.series = new PriceSeries(opts.capacity ?? 600);
    this.theme = { ...DEFAULT_THEME, ...opts.theme };
    this.onFrame = opts.onFrame;
    this.onViewportChange = opts.onViewportChange;
    this.onNeedOlder = opts.onNeedOlder;
    this.gestures = new CandleGestures(
      canvas,
      this.vp,
      () => this.view === "candles" && !this.driven && this.candles != null
    );
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
    // A new position shouldn't roll up from the last one's PnL.
    if (!overlay || !this.position) this.pnlOdo.reset();
    this.position = overlay;
  }

  /**
   * Switch to driven mode: the engine stops pulling oracle prices and renders
   * only what `seed`/`pushSample` supply. Irreversible for the instance's
   * lifetime in practice — a replay chart is never reused as a live chart.
   */
  setDriven(driven: boolean) {
    this.driven = driven;
    if (driven) {
      this.interp.reset();
      this.series.clear();
      this.lastPrice = null;
      this.seeded = false;
    }
  }

  /**
   * Replace the whole window with an explicit set of samples (a replay seeking
   * or scrubbing). The scale is snapped rather than eased so a seek lands
   * immediately instead of gliding in from the previous position.
   */
  seed(samples: readonly { t: number; p: number }[]) {
    this.series.clear();
    if (samples.length === 0) {
      this.lastPrice = null;
      return;
    }
    // Keep at most the ring's capacity, preferring the most recent samples.
    const start = Math.max(0, samples.length - this.series.capacity);
    for (let i = start; i < samples.length; i++) {
      const s = samples[i]!;
      this.series.push(s.t, s.p);
    }
    const last = samples[samples.length - 1]!;
    this.lastPrice = last.p;
    this.seeded = true;

    // Snap the scale to fit what we just seeded, so a scrub doesn't animate the
    // zoom on every frame the user drags.
    const range = this.series.range();
    if (range) {
      this.center = last.p;
      const reach = Math.max(last.p - range.min, range.max - last.p);
      this.half = Math.max(reach * 1.15, last.p * 0.0005);
    }
  }

  /** Append one sample in driven mode. */
  pushSample(t: number, p: number) {
    this.series.push(t, p);
    this.lastPrice = p;
    this.seeded = true;
  }

  /**
   * Switch between the tick line and candles (at `intervalMs`). The line swaps
   * in straight away; candles wait for `setCandleHistory` (or a timeout), then
   * the canvas fades out and back in on the new view.
   */
  setView(view: ChartView, intervalMs: number) {
    const p = this.pending;
    if (p && p.view === view && (view === "line" || p.intervalMs === intervalMs)) {
      return;
    }
    if (
      !p &&
      view === this.view &&
      (view === "line" || this.candles?.intervalMs === intervalMs)
    ) {
      return;
    }
    this.pending = {
      view,
      intervalMs,
      since: performance.now(),
      rows: view === "line" ? [] : null,
    };
  }

  /** History for a candle view — completes a pending switch, else reloads. */
  setCandleHistory(intervalMs: number, rows: readonly Candle[]) {
    const p = this.pending;
    if (p && p.view === "candles" && p.intervalMs === intervalMs) {
      p.rows = rows;
    } else if (this.candles?.intervalMs === intervalMs) {
      // A reload of the SAME view (e.g. the tab came back): keep the ruler's
      // zoom — only a fresh view or market is fitted.
      this.candles.setHistory(rows, Date.now());
    }
  }

  /** Reconcile freshly fetched rows into the live candle view. */
  mergeCandles(intervalMs: number, rows: readonly Candle[]) {
    if (this.candles?.intervalMs === intervalMs) this.candles.merge(rows);
  }

  /** Candle view: glide back to the newest candle with price centered. */
  recenter() {
    this.vp.recenter();
  }

  /** Detach input listeners (the render loop is stopped separately). */
  destroy() {
    this.stop();
    this.gestures.dispose();
  }

  /** Clear the window (e.g. on market switch) so the new feed starts fresh. */
  reset() {
    this.vp.reset();
    this.lastFormingT = null;
    this.olderRequestedFor = null;
    // A candle view can't show the old market's candles for even a frame:
    // they're in another price space. Hide until the new history lands.
    if (this.view === "candles" || this.pending?.view === "candles") {
      const intervalMs =
        this.pending?.view === "candles"
          ? this.pending.intervalMs
          : this.candles?.intervalMs ?? 60_000;
      this.candles = null;
      this.view = "candles";
      this.pending = {
        view: "candles",
        intervalMs,
        since: performance.now(),
        rows: null,
      };
      this.opacity = 0;
    }
    this.candleStep = 0;
    this.interp.reset();
    this.series.clear();
    this.lastPrice = null;
    this.seeded = false;
    this.center = 0;
    this.half = 0;
    this.tickStep = 0;
    this.labelDecimals = null;
    this.priceOdo.reset();
    this.pnlOdo.reset();
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
    // In driven mode the caller owns the series (see pushSample/seed) — pulling
    // from the interpolator here would overwrite the replayed path with the
    // live oracle value.
    const price = this.driven ? this.lastPrice : this.interp.tick();
    const now = performance.now();
    if (!this.driven && price != null) {
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
    if (!this.driven) this.lastPrice = price;

    this.stepView(now);
    if (!this.driven && this.candles && price != null) {
      this.candles.update(this.interp.latest() ?? price, price, Date.now());
    }

    const yNorm = this.draw(price);
    // Line: samples fill the plot width evenly, so a single new sample shifts
    // the window left by one sample's worth of pixels. Reported unconditionally:
    // this is a property of the plot geometry, not of the feed, so background
    // layers keep scrolling even while the oracle is silent or reconnecting.
    // Candles only move on a rollover, so they report just that slide.
    const inCandles = this.view === "candles" && !this.driven;
    const scrollX = inCandles
      ? this.candleScroll + this.vp.takeScroll()
      : this.plotWidth() / (this.series.capacity - 1);
    this.onFrame?.({ price, yNorm, velocity, scrollX });

    const offCenter = inCandles && this.vp.offCenter;
    if (offCenter !== this.offCenterShown) {
      this.offCenterShown = offCenter;
      this.onViewportChange?.(offCenter);
    }
  }

  /**
   * Run a pending view switch as a crossfade: once its data is in (or the
   * timeout passes), fade the canvas out, swap, and fade back in.
   */
  private stepView(now: number) {
    const p = this.pending;
    if (p) {
      const ready = p.rows != null || now - p.since > VIEW_SWAP_TIMEOUT_MS;
      if (ready) {
        this.opacity += (0 - this.opacity) * 0.35;
        if (this.opacity < 0.04) {
          this.opacity = 0;
          this.view = p.view;
          this.candleStep = 0;
          this.candleScroll = 0;
          this.vp.reset();
          this.lastFormingT = null;
          this.olderRequestedFor = null;
          this.gestures.setEnabled(p.view === "candles");
          if (p.view === "candles") {
            this.candles = new CandleSeries(p.intervalMs);
            this.candles.setHistory(p.rows ?? [], Date.now());
          } else {
            this.candles = null;
          }
          this.pending = null;
        }
      }
    } else if (this.opacity < 1) {
      this.opacity += (1 - this.opacity) * 0.2;
      if (this.opacity > 0.99) this.opacity = 1;
    }
    if (Math.abs(this.opacity - this.shownOpacity) > 0.005) {
      this.shownOpacity = this.opacity;
      this.canvas.style.opacity = this.opacity === 1 ? "" : this.opacity.toFixed(3);
    }
  }

  /**
   * Draw the current window; returns the normalized Y of the latest price.
   * `price` is the eased live price used to center the scale.
   */
  private draw(price: number | null): number {
    const { ctx, w, h } = this;
    ctx.clearRect(0, 0, w, h);

    if (this.view === "candles" && !this.driven) {
      const candles = this.candles;
      if (!candles?.forming || price == null) {
        this.drawWatermark(this.plotWidth());
        return 0.5;
      }
      return this.drawCandleView(price, candles);
    }

    // Reused buffer — must not be retained past this frame.
    const samples = this.series.view();
    const range = this.series.range();
    if (samples.length < 2 || !range || price == null) {
      this.drawWatermark(this.plotWidth());
      return 0.5;
    }

    const plotW = this.plotWidth();
    const top = this.padding.top;
    const bottom = h - this.padding.bottom;
    const usableH = bottom - top;

    const pos = this.position;
    // Pinned, not eased: the live price IS the center, so its pill holds still.
    // `price` is already smoothed by the interpolator, so the scale slides
    // vertically without stepping.
    this.center = price;

    let half: number;
    let step: number;
    if (!this.driven) {
      // --- Live: a fixed ruler that only slides ------------------------------
      // The label step is chosen once and the zoom never changes, so the scale
      // moves up and down like a ruler instead of expanding and re-labelling.
      // The entry/liq/trail lines aren't forced into view either — off-screen
      // they become edge markers (see drawLineOrEdge).
      if (!(this.tickStep > 0)) {
        this.tickStep = niceStep(price * RULER_STEP_FRAC);
      }
      step = this.tickStep;
      half = (step * RULER_LABELS) / 2;
      this.labelDecimals = labelDecimalsFor(step, price);
    } else {
      ({ half, step } = this.fitScale(price, range, usableH));
      this.labelDecimals = null;
    }

    const min = this.center - half;
    const span = half * 2 || 1;

    const xOf = (i: number) => (i / (samples.length - 1)) * plotW;
    const yOf = (p: number) => bottom - ((p - min) / span) * usableH;

    // Profit/loss determines the accent color for the line, fill, and marker.
    const inProfit = !pos || pos.pnl >= 0;
    const accent = inProfit ? this.theme.up : this.theme.down;

    const lx = xOf(samples.length - 1);
    const ly = yOf(price); // always the vertical middle — the scale is pinned

    // Faint gridlines on the scale's round values, under everything else.
    this.drawGrid(min, span, step, top, bottom, yOf, plotW);

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
      ctx.fillStyle = this.pnlBandFill(ly, entryY, inProfit);
      ctx.fill(band);
      this.drawPositionLines(pos, yOf, top, bottom, plotW, accent);
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

    this.finishFrame(plotW, min, span, step, top, bottom, yOf, ly, price, accent, lx);
    return 1 - (ly - top) / usableH;
  }

  /**
   * The candlestick view. Following (the default) it frames like the line —
   * newest candle at the right edge, price pinned at the middle, sliding ruler.
   * Once the user pans, zooms or scales (see CandleViewport) the view holds
   * where they put it and the pill tracks the real price instead.
   */
  private drawCandleView(price: number, candles: CandleSeries): number {
    const { ctx, h } = this;
    const plotW = this.plotWidth();
    const top = this.padding.top;
    const bottom = h - this.padding.bottom;
    const usableH = bottom - top;
    const pos = this.position;
    const vp = this.vp;
    const spacing = vp.spacingFor(plotW);
    const visible = plotW / spacing;
    const forming = candles.forming!;

    // A new candle opened: tell the viewport, so history stays put if that's
    // what the user is looking at.
    if (this.lastFormingT != null && forming.t > this.lastFormingT) vp.onRollover();
    this.lastFormingT = forming.t;

    // Following-mode ruler step: fitted once to the candles on screen (so a 1d
    // chart isn't measured in $5 steps), then fixed — it slides, it never
    // re-zooms. Provisional (stored negative) until history arrives.
    if (!(this.candleStep > 0)) {
      const r = candles.bodyRange(Math.ceil(visible) + 1);
      const reach = r ? Math.max(price - r.min, r.max - price) : 0;
      const fit = niceStep(
        Math.max(reach * 2 * 1.15, price * RULER_STEP_FRAC * RULER_LABELS) /
          RULER_LABELS
      );
      this.candleStep = candles.closed.length > 0 ? fit : -fit;
    }
    const autoStep = Math.abs(this.candleStep);
    vp.frame(plotW, usableH, price, (autoStep * RULER_LABELS) / 2, candles.closed.length + 1);
    const { center, half } = vp.window();
    this.center = center;
    // Free: labels re-space with the zoom, ~15 on screen whatever the scale.
    const step = vp.free ? niceStep((2 * half) / RULER_LABELS) : autoStep;
    this.labelDecimals = labelDecimalsFor(step, price);
    const min = center - half;
    const span = half * 2 || 1;
    const yOf = (p: number) => bottom - ((p - min) / span) * usableH;
    const ly = yOf(price);

    const inProfit = !pos || pos.pnl >= 0;
    const accent = inProfit ? this.theme.up : this.theme.down;

    this.drawGrid(min, span, step, top, bottom, yOf, plotW);

    if (pos) {
      const entryY = yOf(pos.entryPrice);
      ctx.fillStyle = this.pnlBandFill(ly, entryY, inProfit);
      ctx.fillRect(0, Math.min(ly, entryY), plotW, Math.abs(entryY - ly));
      this.drawPositionLines(pos, yOf, top, bottom, plotW, accent);
    }

    // Current-price line across the plot, into the pill.
    if (ly >= top && ly <= bottom) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.moveTo(0, ly);
      ctx.lineTo(plotW, ly);
      ctx.stroke();
      ctx.restore();
    }

    // --- Candles ---------------------------------------------------------------
    // Slot k counts back from the forming candle (k = 0). While following, a
    // rollover's `slide` eases the row one slot left instead of jumping.
    const following = vp.offset <= 0.5 && !vp.recentering;
    const slidePx = following ? candles.slide * spacing : 0;
    this.candleScroll = Math.max(0, this.candleOffset - slidePx);
    this.candleOffset = slidePx;
    const xOfSlot = (k: number) => plotW - spacing * (0.5 + k - vp.offset) + slidePx;
    const bodyW = Math.max(1, Math.round(spacing * CANDLE_BODY_FRAC));
    const upBodies = new Path2D();
    const downBodies = new Path2D();
    const upWicks = new Path2D();
    const downWicks = new Path2D();
    const add = (c: Candle, cx: number) => {
      const up = c.c >= c.o;
      const yo = yOf(c.o);
      const yc = yOf(c.c);
      const wicks = up ? upWicks : downWicks;
      wicks.moveTo(cx, yOf(c.h));
      wicks.lineTo(cx, yOf(c.l));
      const bodyH = Math.max(1, Math.abs(yc - yo));
      (up ? upBodies : downBodies).rect(cx - bodyW / 2, Math.min(yo, yc), bodyW, bodyH);
    };
    // Only the slots that can be on screen — history can run to thousands.
    const kFirst = Math.max(0, Math.floor(vp.offset - 1));
    const kLast = Math.min(candles.closed.length, Math.ceil(vp.offset + visible + 1));
    for (let k = kFirst; k <= kLast; k++) {
      const c = k === 0 ? forming : candles.closed[candles.closed.length - k];
      if (c) add(c, xOfSlot(k));
    }
    ctx.save();
    // The newest candle slides in from under the pill; keep it inside the plot.
    ctx.beginPath();
    ctx.rect(0, 0, plotW, h);
    ctx.clip();
    ctx.lineWidth = 1;
    ctx.strokeStyle = this.theme.up;
    ctx.stroke(upWicks);
    ctx.fillStyle = this.theme.up;
    ctx.fill(upBodies);
    ctx.strokeStyle = this.theme.down;
    ctx.stroke(downWicks);
    ctx.fillStyle = this.theme.down;
    ctx.fill(downBodies);
    ctx.restore();

    // Scrolled near the oldest loaded candle: ask for the ones before it (once
    // per oldest candle, so an exhausted history doesn't re-ask every frame).
    const oldest = candles.closed[0];
    if (
      oldest &&
      vp.offset + visible > candles.closed.length - OLDER_HISTORY_MARGIN &&
      this.olderRequestedFor !== oldest.t
    ) {
      this.olderRequestedFor = oldest.t;
      this.onNeedOlder?.(candles.intervalMs, oldest.t);
    }

    // The pill follows the real price, stuck to the plot edge when it's out of
    // view — while following it is simply the middle.
    const pillH = pos ? 34 : 26;
    const pillY = Math.max(top + pillH / 2, Math.min(bottom - pillH / 2, ly));
    this.finishFrame(plotW, min, span, step, top, bottom, yOf, pillY, price, accent, null);
    return 1 - (pillY - top) / usableH;
  }

  /** Vertical PnL gradient: strongest at the mark, fading toward entry. */
  private pnlBandFill(ly: number, entryY: number, inProfit: boolean): CanvasGradient {
    const grad = this.ctx.createLinearGradient(
      0,
      Math.min(ly, entryY),
      0,
      Math.max(ly, entryY)
    );
    const fillCol = inProfit ? "rgba(114, 233, 18, 0.22)" : "rgba(230, 67, 45, 0.22)";
    const faded = inProfit ? "rgba(114, 233, 18, 0.02)" : "rgba(230, 67, 45, 0.02)";
    grad.addColorStop(0, ly <= entryY ? fillCol : faded);
    grad.addColorStop(1, ly <= entryY ? faded : fillCol);
    return grad;
  }

  /**
   * Entry / B/E / TP / SL / Liq / Trail. Each draws in place when on-screen, or
   * as a clamped edge marker (caret + price) at the top/bottom when it has
   * scrolled out of view — so the chart never squeezes to hold them.
   */
  private drawPositionLines(
    pos: PositionOverlay,
    yOf: (p: number) => number,
    top: number,
    bottom: number,
    plotW: number,
    accent: string
  ) {
    this.drawLineOrEdge(
      yOf(pos.entryPrice), top, bottom, plotW, "Entry",
      pos.entryPrice, this.theme.entryLine, "#08090c", [4, 4], 1, false
    );
    // Net break-even — where closing actually gets out even once fees and
    // funding are covered. Drawn BEFORE Liq so that if the two ever coincide
    // the liquidation warning stays on top; it is the more urgent one.
    if (pos.breakEvenPrice != null) {
      this.drawLineOrEdge(
        yOf(pos.breakEvenPrice), top, bottom, plotW, "B/E",
        pos.breakEvenPrice, this.theme.breakEvenLine, "#08090c", [1, 3], 1, false
      );
    }
    // Automatic exits. Drawn before Liq for the same reason B/E is: if a stop
    // sits near the liquidation price, the liquidation warning must stay the
    // one on top.
    if (pos.takeProfitPrice != null) {
      this.drawLineOrEdge(
        yOf(pos.takeProfitPrice), top, bottom, plotW, "TP",
        pos.takeProfitPrice, this.theme.tpLine, "#08090c", [5, 3], 1.5, false
      );
    }
    if (pos.stopLossPrice != null) {
      this.drawLineOrEdge(
        yOf(pos.stopLossPrice), top, bottom, plotW, "SL",
        pos.stopLossPrice, this.theme.slLine, "#08090c", [5, 3], 1.5, false
      );
    }
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

  /**
   * Shared tail of every view: fade the plot toward the left, lay the
   * watermark behind it, then the price scale and the pinned pill on top.
   */
  private finishFrame(
    plotW: number,
    min: number,
    span: number,
    step: number,
    top: number,
    bottom: number,
    yOf: (p: number) => number,
    ly: number,
    price: number,
    accent: string,
    lx: number | null
  ) {
    const { ctx, h } = this;
    // Erase with a gradient rather than fading each stroke, so the line (or
    // candles), the PnL band, gridlines and reference lines all dissolve
    // together. The gutter (labels, tags, pill) is right of the fade.
    const fadeW = plotW * LEFT_FADE_FRAC;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    const fade = ctx.createLinearGradient(0, 0, fadeW, 0);
    fade.addColorStop(0, "rgba(0, 0, 0, 1)");
    fade.addColorStop(0.45, "rgba(0, 0, 0, 0.55)");
    fade.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, fadeW, h);
    ctx.restore();

    // Behind everything drawn so far, and after the fade so it stays whole.
    this.drawWatermark(plotW);

    const pos = this.position;
    const pillH = pos ? 34 : 26;
    this.drawScale(min, span, step, top, bottom, yOf, ly, pillH);
    this.drawCurrentMarker(lx, ly, plotW, price, accent, pillH, pos?.pnl);
  }

  /**
   * Width of the plot area. Normally everything left of the scale gutter, but
   * pulled in so the line ends just LEFT of the pinned pill: a long price
   * ("$67,420.50") makes the pill wider than the gutter, and it would otherwise
   * cover the leading dot where new segments appear. Sized off the price
   * string's length only, so it holds steady tick to tick.
   */
  private plotWidth(): number {
    const { ctx, w } = this;
    const chars = this.priceOdo.label.length;
    if (chars === 0) return w - AXIS_WIDTH;
    ctx.font = "700 15px ui-monospace, SFMono-Regular, Menlo, monospace";
    const pillW = ctx.measureText("0").width * chars + 18;
    return Math.max(0, Math.min(w - AXIS_WIDTH, w - AXIS_RIGHT_INSET - pillW - 10));
  }

  /**
   * Replay only: zoom to fit the recorded path around the current price, with
   * headroom. A floor (relative to price) stops a nearly flat window zooming in
   * so far that tiny ticks look like spikes. Grows fast, shrinks slowly, so the
   * zoom glides instead of jittering.
   */
  private fitScale(
    price: number,
    range: { min: number; max: number },
    usableH: number
  ): { half: number; step: number } {
    const floor = price * 0.0005; // ~0.05% minimum half-range
    const reach = Math.max(price - range.min, range.max - price);
    const needed = Math.max(reach * 1.15, floor);
    const ease = needed > this.half ? 0.12 : 0.02;
    this.half += (needed - this.half) * ease;
    const half = Math.max(this.half, floor);
    return { half, step: this.tickStepFor(half * 2 || 1, usableH) };
  }

  /**
   * Replay's price distance between labels. Re-picked only when the current one would
   * leave the labels too crowded or too sparse — so a slowly easing zoom keeps
   * the same round values scrolling by instead of re-labelling every frame.
   */
  private tickStepFor(span: number, usableH: number): number {
    const target = Math.max(3, Math.min(TICK_COUNT, Math.round(usableH / TICK_MIN_PX)));
    const count = this.tickStep > 0 ? span / this.tickStep : 0;
    const px = this.tickStep > 0 ? (usableH * this.tickStep) / span : 0;
    if (
      !(this.tickStep > 0) ||
      count < target * 0.55 ||
      count > target * 1.8 ||
      px < 22
    ) {
      this.tickStep = niceStep(span / target);
    }
    return this.tickStep;
  }

  /** Visit every multiple of `step` (and its ruler subdivisions) in view. */
  private forEachTick(
    min: number,
    span: number,
    step: number,
    fn: (price: number, major: boolean) => void
  ) {
    const minor = step / RULER_SUBDIVISIONS;
    const first = Math.floor(min / minor);
    const last = Math.ceil((min + span) / minor);
    // A runaway count means a degenerate span; skip rather than spin.
    if (last - first > 400) return;
    for (let k = first; k <= last; k++) {
      fn(k * minor, k % RULER_SUBDIVISIONS === 0);
    }
  }

  private drawGrid(
    min: number,
    span: number,
    step: number,
    top: number,
    bottom: number,
    yOf: (p: number) => number,
    plotW: number
  ) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = this.theme.axisLine;
    ctx.lineWidth = 1;
    ctx.beginPath();
    this.forEachTick(min, span, step, (p, major) => {
      if (!major) return;
      // Unrounded on purpose: the grid scrolls with price every frame, and
      // snapping to whole pixels would make it step instead of glide.
      const y = yOf(p);
      if (y < top || y > bottom) return;
      ctx.moveTo(0, y);
      ctx.lineTo(plotW, y);
    });
    ctx.stroke();
    ctx.restore();
  }

  /** Draw the logo watermark centered in the plot, behind what's drawn. */
  private drawWatermark(plotW: number) {
    const img = watermark();
    if (!img || plotW <= 0) return;
    const ww = Math.min(plotW * 0.5, WATERMARK_MAX_W);
    const wh = (ww * img.naturalHeight) / img.naturalWidth;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = "destination-over";
    ctx.globalAlpha = WATERMARK_ALPHA;
    ctx.drawImage(img, (plotW - ww) / 2, (this.h - wh) / 2, ww, wh);
    ctx.restore();
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
    step: number,
    top: number,
    bottom: number,
    yOf: (p: number) => number,
    mid: number,
    pillH: number
  ) {
    const { ctx, w } = this;
    ctx.save();
    ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
    // Right-align labels to a fixed inset so long numbers never clip.
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.strokeStyle = this.theme.axisText;
    ctx.fillStyle = this.theme.axisText;
    ctx.lineWidth = 1;
    const labelX = w - AXIS_RIGHT_INSET;
    const rulerX = w - RULER_EDGE;
    // Labels give way to the pinned pill as they scroll past it.
    const pillClear = pillH / 2 + 4;

    this.forEachTick(min, span, step, (price, major) => {
      const y = yOf(price);
      if (y < top || y > bottom) return;
      // Fade in/out over the last few px at the plot edges, so labels scroll
      // in rather than pop.
      const edge = Math.min(y - top, bottom - y) / LABEL_FADE_PX;
      const alpha = Math.min(1, edge);

      // The ruler tick ("-") right of the label.
      ctx.globalAlpha = alpha * (major ? 0.9 : 0.45);
      ctx.beginPath();
      ctx.moveTo(rulerX - (major ? RULER_MAJOR : RULER_MINOR), y);
      ctx.lineTo(rulerX, y);
      ctx.stroke();

      if (!major) return;
      const underPill = Math.abs(y - mid) - pillClear;
      const labelAlpha = alpha * Math.max(0, Math.min(1, underPill / LABEL_FADE_PX));
      if (labelAlpha <= 0) return;
      ctx.globalAlpha = labelAlpha;
      ctx.fillText(this.fmtLabel(price), labelX, y);
    });
    ctx.restore();
  }

  /**
   * The live-price pill, pinned at the right edge on the vertical middle (the
   * scale keeps the current price there). It never moves — the digits roll.
   * Shows the raw latest tick rather than the eased line value, so the readout
   * is the real price and settles instead of creeping.
   */
  private drawCurrentMarker(
    lx: number | null,
    ly: number,
    plotW: number,
    price: number,
    accent: string,
    pillH: number,
    pnl?: number
  ) {
    const { ctx, w } = this;

    // Line view: dashed leader from the line's leading point to the scale,
    // and the leading dot. (Candles draw their own full-width price line.)
    if (lx != null) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = accent;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(plotW, ly);
      ctx.stroke();
      ctx.restore();

      ctx.beginPath();
      ctx.arc(lx, ly, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
    }

    const readout = this.driven ? price : this.interp.latest() ?? price;
    this.priceOdo.set(this.fmtPrice(readout), readout);
    const inTrade = pnl != null;
    if (inTrade) {
      this.pnlOdo.set(
        `${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`,
        pnl
      );
    }

    const priceFont = `700 ${inTrade ? 14 : 15}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    const pnlFont = "700 11px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.font = priceFont;
    const priceW = this.priceOdo.width(ctx);
    ctx.font = pnlFont;
    const pnlW = inTrade ? this.pnlOdo.width(ctx) : 0;

    const padX = 9;
    const pillW = Math.max(priceW, pnlW) + padX * 2;
    const pillX = w - AXIS_RIGHT_INSET - pillW;
    const pillY = ly - pillH / 2;
    const textRight = pillX + padX + Math.max(priceW, pnlW);

    ctx.save();
    ctx.fillStyle = accent;
    // rounded-full: radius = half the height so the ends are fully rounded.
    this.roundRect(pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fill();
    // Digits roll in and out through the pill's edge, not over the chart.
    ctx.clip();

    ctx.fillStyle = "#08090c";
    if (inTrade) {
      // Each row clips to its own half so a rolling price digit can't slide
      // over the PnL beneath it (or vice versa).
      const split = ly + 1;
      ctx.save();
      ctx.beginPath();
      ctx.rect(pillX, pillY, pillW, split - pillY);
      ctx.clip();
      ctx.font = priceFont;
      this.priceOdo.draw(ctx, textRight, ly - 7, 16);
      ctx.restore();

      ctx.beginPath();
      ctx.rect(pillX, split, pillW, pillY + pillH - split);
      ctx.clip();
      ctx.font = pnlFont;
      this.pnlOdo.draw(ctx, textRight, ly + 8, 14);
    } else {
      ctx.font = priceFont;
      this.priceOdo.draw(ctx, textRight, ly, 20);
    }
    ctx.restore();
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

  /** A scale label: price format, but fine enough for the ruler's step. */
  private fmtLabel(p: number): string {
    const d = this.labelDecimals;
    if (d == null) return this.fmtPrice(p);
    return `$${p.toLocaleString(undefined, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    })}`;
  }

  private fmtPrice(p: number): string {
    // Shared magnitude-based formatting, with a leading "$" on the scale.
    return `$${formatPrice(p)}`;
  }
}
