// Smooths discrete oracle ticks (50-200ms apart) into a continuous per-frame
// value so the chart line glides instead of stepping. The chart reads
// `current()` every animation frame; the oracle pushes targets via `setTarget`.
//
// This buffer is intentionally OUTSIDE Redux — it's read on the render loop at
// 60fps. A separate throttled path commits a sampled value into Redux for
// connected UI (see useLivePrice), keeping the store live but not thrashing.

export class PriceInterpolator {
  private value: number | null = null;
  private target: number | null = null;
  /** Easing factor per frame (0..1). Higher = snappier, lower = smoother. */
  private readonly smoothing: number;

  constructor(smoothing = 0.18) {
    this.smoothing = smoothing;
  }

  /** Newest price from the oracle. */
  setTarget(price: number) {
    this.target = price;
    // First value: snap immediately so the chart doesn't animate from zero.
    if (this.value == null) this.value = price;
  }

  /** Advance one frame toward the target and return the eased value. */
  tick(): number | null {
    if (this.value == null || this.target == null) return this.value;
    const diff = this.target - this.value;
    // Snap when close enough to avoid perpetual sub-cent easing.
    if (Math.abs(diff) < this.value * 1e-7) {
      this.value = this.target;
    } else {
      this.value += diff * this.smoothing;
    }
    return this.value;
  }

  current(): number | null {
    return this.value;
  }

  reset() {
    this.value = null;
    this.target = null;
  }
}
