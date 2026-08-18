// A fixed-capacity ring buffer of recent price samples that the chart engine
// draws. One sample is pushed per animation frame (the interpolated value), so
// the window represents the last N frames (~N/60 seconds).

export interface Sample {
  t: number; // ms epoch
  p: number; // price
}

export class PriceSeries {
  private buf: Sample[];
  private head = 0;
  private count = 0;
  readonly capacity: number;

  /**
   * Scratch array reused by `view()`. The chart calls it every frame at 60fps,
   * so allocating a fresh array (and GCing the old one) each time is pure
   * garbage-collector pressure — enough to cause visible hitching under load.
   */
  private out: Sample[] = [];

  constructor(capacity = 600) {
    this.capacity = capacity;
    this.buf = new Array<Sample>(capacity);
  }

  push(t: number, p: number) {
    // Recycle the slot's object once the ring has wrapped, so steady-state
    // pushing allocates nothing.
    const slot = this.buf[this.head];
    if (slot) {
      slot.t = t;
      slot.p = p;
    } else {
      this.buf[this.head] = { t, p };
    }
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /**
   * Samples in chronological order, in a REUSED array — valid only until the
   * next call. For the per-frame render path, where allocating is too costly.
   * Callers that need to retain the result must use `toArray()` instead.
   */
  view(): readonly Sample[] {
    const out = this.out;
    out.length = this.count;
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) {
      out[i] = this.buf[(start + i) % this.capacity]!;
    }
    return out;
  }

  /** Samples in chronological order (oldest → newest), as a fresh array. */
  toArray(): Sample[] {
    const out: Sample[] = new Array(this.count);
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) {
      out[i] = this.buf[(start + i) % this.capacity]!;
    }
    return out;
  }

  get length() {
    return this.count;
  }

  /** Min/max price across the window, for auto-scaling the Y axis. */
  range(): { min: number; max: number } | null {
    if (this.count === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) {
      const p = this.buf[(start + i) % this.capacity]!.p;
      if (p < min) min = p;
      if (p > max) max = p;
    }
    return { min, max };
  }

  clear() {
    this.head = 0;
    this.count = 0;
  }
}
