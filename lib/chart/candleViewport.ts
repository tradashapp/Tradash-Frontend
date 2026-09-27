// Free-roam viewport for the candlestick view — pan, zoom and axis-scale like a
// normal exchange chart. The LINE view never uses this: it stays the pinned,
// non-interactive live chart.
//
// Two modes:
//   - Following (default): the newest candle sits at the right edge and the
//     live price is pinned to the vertical middle (the sliding ruler).
//   - Free: the user dragged, zoomed or scaled. The view holds wherever they
//     left it; the price pill tracks the real price (clamped to the plot
//     edges). `recenter()` glides back to following.
//
// Horizontal geometry: slot k counts candles back from the forming one (k = 0),
// drawn at x = plotW − spacing·(0.5 + k − offset). `offset` > 0 scrolls into
// history; < 0 leaves empty space right of the newest candle.

const TARGET_COUNT = 48;
const AUTO_MIN_SPACING = 5;
const AUTO_MAX_SPACING = 14;
const MIN_SPACING = 1.5;
const MAX_SPACING = 40;
/** How far past the newest candle the view may scroll, as a share of the width. */
const MAX_FUTURE_FRAC = 0.6;
/** Per-frame easing while gliding back to following. */
const RECENTER_EASE = 0.2;

export class CandleViewport {
  /** Candle slot width in px; null = derived from the plot width. */
  private spacing: number | null = null;
  offset = 0;
  free = false;
  yCenter = 0;
  yHalf = 0;
  recentering = false;

  // Geometry and scale from the last frame — gestures arrive between frames.
  plotW = 0;
  usableH = 1;
  price = 0;
  autoHalf = 0;
  /** Candles available to scroll through (closed + forming). */
  count = 0;

  /** Px the content moved left since the last `takeScroll` (for background layers). */
  private scrolled = 0;

  spacingFor(plotW: number): number {
    return (
      this.spacing ??
      Math.max(AUTO_MIN_SPACING, Math.min(AUTO_MAX_SPACING, plotW / TARGET_COUNT))
    );
  }

  get offCenter(): boolean {
    return this.free || Math.abs(this.offset) > 0.5;
  }

  /** The price window to draw this frame. */
  window(): { center: number; half: number } {
    return this.free
      ? { center: this.yCenter, half: this.yHalf }
      : { center: this.price, half: this.autoHalf };
  }

  /** Per-frame: record geometry, and advance a recenter glide. */
  frame(plotW: number, usableH: number, price: number, autoHalf: number, count: number) {
    this.plotW = plotW;
    this.usableH = Math.max(1, usableH);
    this.price = price;
    this.autoHalf = autoHalf;
    this.count = count;
    if (!this.recentering) return;
    const before = this.offset;
    this.offset += (0 - this.offset) * RECENTER_EASE;
    this.scrolled += (this.offset - before) * -this.spacingFor(plotW);
    if (this.free) {
      this.yCenter += (price - this.yCenter) * RECENTER_EASE;
      this.yHalf += (autoHalf - this.yHalf) * RECENTER_EASE;
    }
    const settled =
      Math.abs(this.offset) < 0.02 &&
      (!this.free ||
        (Math.abs(this.yCenter - price) < autoHalf * 0.002 &&
          Math.abs(this.yHalf - autoHalf) < autoHalf * 0.002));
    if (settled) {
      this.offset = 0;
      this.free = false;
      this.recentering = false;
    }
  }

  /** A new candle opened. Viewing history? Keep the same candles in view. */
  onRollover() {
    if (this.offset > 0.5) this.offset += 1;
  }

  recenter() {
    this.recentering = true;
  }

  /** Back to following at the default zoom (market or view change). */
  reset() {
    this.spacing = null;
    this.offset = 0;
    this.free = false;
    this.recentering = false;
    this.scrolled = 0;
  }

  takeScroll(): number {
    const s = this.scrolled;
    this.scrolled = 0;
    return s;
  }

  private ensureFree() {
    this.recentering = false;
    if (this.free) return;
    this.free = true;
    this.yCenter = this.price;
    this.yHalf = this.autoHalf;
  }

  private clampOffset() {
    const sp = this.spacingFor(this.plotW);
    const visible = this.plotW / sp;
    this.offset = Math.max(
      -visible * MAX_FUTURE_FRAC,
      Math.min(Math.max(0, this.count - 3), this.offset)
    );
  }

  /** Drag the plot by (dx, dy) px: content follows the finger. */
  pan(dx: number, dy: number) {
    this.ensureFree();
    const sp = this.spacingFor(this.plotW);
    const before = this.offset;
    this.offset += dx / sp;
    this.clampOffset();
    this.scrolled -= (this.offset - before) * sp;
    this.yCenter += dy * ((2 * this.yHalf) / this.usableH);
  }

  /** Horizontal-only pan (wheel / trackpad sideways). */
  panX(dx: number) {
    this.recentering = false;
    const sp = this.spacingFor(this.plotW);
    const before = this.offset;
    this.offset += dx / sp;
    this.clampOffset();
    this.scrolled -= (this.offset - before) * sp;
  }

  /** Scale the price axis; factor > 1 zooms out (more price on screen). */
  scaleY(factor: number) {
    this.ensureFree();
    const base = this.autoHalf || this.yHalf;
    this.yHalf = Math.max(base / 40, Math.min(base * 40, this.yHalf * factor));
  }

  /**
   * Spread (factor > 1) or squeeze the candles, keeping the candle under
   * `anchorX` in place — so a pinch or wheel zooms around the finger/cursor.
   */
  zoomX(factor: number, anchorX: number) {
    this.recentering = false;
    const sp = this.spacingFor(this.plotW);
    const next = Math.max(MIN_SPACING, Math.min(MAX_SPACING, sp * factor));
    if (next === sp) return;
    const fromRight = this.plotW - anchorX;
    const k = fromRight / sp - 0.5 + this.offset;
    this.spacing = next;
    this.offset = k - fromRight / next + 0.5;
    this.clampOffset();
  }
}

/**
 * Pointer / wheel gestures for a canvas, routed to a CandleViewport. Inert
 * unless `active()` — the line view never reacts to touch.
 *
 *   drag on the plot        → pan (both axes)
 *   drag on the price scale → scale the price axis (down = zoom out)
 *   pinch                   → spread / squeeze candles around the fingers
 *   wheel / trackpad pinch  → the same, around the cursor; sideways = pan
 *   wheel over the scale    → scale the price axis
 *   double-tap / click      → recenter
 */
export class CandleGestures {
  private pointers = new Map<number, { x: number; y: number }>();
  private mode: "pan" | "axis" | "pinch" | null = null;
  private pinchDist = 0;
  private lastTap = { t: 0, x: 0, y: 0 };
  private downAt = { t: 0, x: 0, y: 0 };
  private moved = false;
  private readonly detach: () => void;

  constructor(
    private canvas: HTMLCanvasElement,
    private vp: CandleViewport,
    private active: () => boolean
  ) {
    const opts = { passive: false } as const;
    const down = (e: PointerEvent) => this.onDown(e);
    const move = (e: PointerEvent) => this.onMove(e);
    const up = (e: PointerEvent) => this.onUp(e);
    const wheel = (e: WheelEvent) => this.onWheel(e);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", wheel, opts);
    this.detach = () => {
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointercancel", up);
      canvas.removeEventListener("wheel", wheel);
    };
  }

  dispose() {
    this.detach();
  }

  /** Touch scrolling/zooming the page must be off while candles are live. */
  setEnabled(enabled: boolean) {
    this.canvas.style.touchAction = enabled ? "none" : "";
    this.canvas.style.cursor = enabled ? "grab" : "";
    if (!enabled) {
      this.pointers.clear();
      this.mode = null;
    }
  }

  private local(e: { clientX: number; clientY: number }) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown(e: PointerEvent) {
    if (!this.active()) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* capture is best-effort */
    }
    if (this.pointers.size === 1) {
      this.mode = p.x > this.vp.plotW ? "axis" : "pan";
      this.downAt = { t: performance.now(), x: p.x, y: p.y };
      this.moved = false;
      this.canvas.style.cursor = this.mode === "axis" ? "ns-resize" : "grabbing";
    } else if (this.pointers.size === 2) {
      this.mode = "pinch";
      this.pinchDist = this.spread();
      this.moved = true;
    }
  }

  private spread(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private onMove(e: PointerEvent) {
    const prev = this.pointers.get(e.pointerId);
    if (!prev || !this.active()) return;
    const p = this.local(e);
    const dx = p.x - prev.x;
    const dy = p.y - prev.y;
    this.pointers.set(e.pointerId, p);
    if (Math.hypot(p.x - this.downAt.x, p.y - this.downAt.y) > 4) this.moved = true;

    if (this.mode === "pan") {
      this.vp.pan(dx, dy);
    } else if (this.mode === "axis") {
      // Drag down → zoom out, up → zoom in.
      this.vp.scaleY(Math.exp(dy * 0.006));
    } else if (this.mode === "pinch" && this.pointers.size >= 2) {
      const dist = this.spread();
      if (this.pinchDist > 0 && dist > 0) {
        const [a, b] = [...this.pointers.values()];
        this.vp.zoomX(dist / this.pinchDist, (a!.x + b!.x) / 2);
      }
      this.pinchDist = dist;
    }
  }

  private onUp(e: PointerEvent) {
    if (!this.pointers.delete(e.pointerId)) return;
    if (this.pointers.size === 1) {
      // Pinch → one finger left: carry on panning from where it is.
      this.mode = "pan";
      return;
    }
    if (this.pointers.size > 0) return;
    const wasTap =
      !this.moved && this.mode !== "pinch" && performance.now() - this.downAt.t < 300;
    this.mode = null;
    if (this.active()) this.canvas.style.cursor = "grab";
    if (!wasTap) return;
    const now = performance.now();
    const p = this.downAt;
    if (
      now - this.lastTap.t < 320 &&
      Math.hypot(p.x - this.lastTap.x, p.y - this.lastTap.y) < 24
    ) {
      this.vp.recenter();
      this.lastTap = { t: 0, x: 0, y: 0 };
    } else {
      this.lastTap = { t: now, x: p.x, y: p.y };
    }
  }

  private onWheel(e: WheelEvent) {
    if (!this.active()) return;
    e.preventDefault();
    const p = this.local(e);
    // Lines (Firefox) vs pixels: normalise so a notch is ~100px everywhere.
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (p.x > this.vp.plotW) {
      this.vp.scaleY(Math.exp(dy * 0.002));
    } else if (!e.ctrlKey && Math.abs(dx) > Math.abs(dy)) {
      this.vp.panX(-dx);
    } else {
      // Wheel down / pinch in → squeeze (see more candles).
      this.vp.zoomX(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), p.x);
    }
  }
}
