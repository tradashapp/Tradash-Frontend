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

  constructor(capacity = 600) {
    this.capacity = capacity;
    this.buf = new Array<Sample>(capacity);
  }

  push(t: number, p: number) {
    this.buf[this.head] = { t, p };
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** Samples in chronological order (oldest → newest). */
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
