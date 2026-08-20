// Simulated price feed for the landing-page phone mockup.
//
// The real app pipes MagicBlock oracle ticks into ChartEngine.setPrice(). Here
// there is no oracle: this generator fabricates a plausible BTC tape that the
// demo can STEER, because the landing page promises an outcome the market
// cannot be trusted to deliver — every demo trade must close in profit.
//
// It is a random walk with a bias term. `drift` is the per-tick pull applied in
// the position's favour; noise keeps the line alive so a steered run still
// looks like a market rather than a ramp. While flat, drift is 0 and the walk
// wanders freely.

export interface SimFeedOptions {
  /** Starting price. */
  start: number;
  /** Std-dev of the per-tick random component, as a fraction of price. */
  volatility?: number;
}

export class SimFeed {
  private price: number;
  private readonly startPrice: number;
  private vol: number;
  /** Signed per-tick bias as a fraction of price. +ve pushes up. */
  private drift = 0;
  /** 0..1 — how much of the noise is suppressed. Used for the pullback beats. */
  private calm = 0;

  constructor({ start, volatility = 0.00022 }: SimFeedOptions) {
    this.price = start;
    this.startPrice = start;
    this.vol = volatility;
  }

  /** Bias the walk. `d` is a per-tick fraction: 0.0004 ≈ +0.04% per tick. */
  setDrift(d: number) {
    this.drift = d;
  }

  /** Temporarily damp noise (0 = full noise, 1 = nearly smooth). */
  setCalm(c: number) {
    this.calm = Math.max(0, Math.min(1, c));
  }

  getPrice(): number {
    return this.price;
  }

  getStartPrice(): number {
    return this.startPrice;
  }

  reset(to?: number) {
    this.price = to ?? this.startPrice;
    this.drift = 0;
    this.calm = 0;
  }

  /**
   * Advance one tick and return the new price. Box–Muller gives a normal
   * sample so the tape has occasional larger moves instead of the flat,
   * obviously-fake texture of a uniform random.
   */
  tick(): number {
    const u = Math.max(Number.EPSILON, Math.random());
    const v = Math.random();
    const gauss = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    const noise = gauss * this.vol * (1 - this.calm);
    this.price = this.price * (1 + this.drift + noise);
    return this.price;
  }
}
