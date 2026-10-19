/**
 * Risk-based position sizing for a signal trade — the confirm sheet and the
 * bot use the same numbers. PURE and dependency-free on purpose: this file is
 * copied verbatim into the web app (lib/signals/sizing.ts) and the mobile app
 * (src/lib/signals/sizing.ts); keep all three identical.
 *
 * The STOP comes from the market (the signal's ATR stop). The user's risk %
 * only decides the SIZE: size = risk $ ÷ (distance to the stop + round-trip
 * fees). The exit plan decides where profit is taken.
 */

export interface SizingLeg {
  /** Fraction of the position closed at this leg. */
  frac: number;
  /** Take-profit price; null = trailed (no fixed price). */
  price: number | null;
}

export interface SizingInput {
  direction: "long" | "short";
  /** Expected fill (the live mark). */
  entry: number;
  stop: number;
  legs: SizingLeg[];
  /** Trading balance the risk % applies to (collateral + open PnL). */
  equity: number;
  /** Free collateral right now. */
  availableMargin: number;
  /** Percent of equity to lose at the stop, e.g. 1. */
  riskPct: number;
  leverage: number;
  lotSize: number;
  /** Per-order minimum notional on Bulk. */
  minNotional: number;
  /** Per fill, e.g. 0.00085. */
  feeRate: number;
}

export interface Sizing {
  ok: boolean;
  /** Why it can't be placed (blocking). */
  error: string | null;
  /** Non-blocking notes (size was capped, etc.). */
  notes: string[];
  size: number;
  notional: number;
  margin: number;
  /** What the stop costs, fees included. */
  riskUsd: number;
  /** Profit per leg at its price, fees included (null for a trailed leg). */
  legRewardsUsd: (number | null)[];
  /** All fixed legs hit; a trailed leg is counted at its last fixed leg's price. */
  rewardUsd: number;
  /** rewardUsd ÷ riskUsd. */
  rr: number;
  feesUsd: number;
  /** Cross-margin estimate: where this position alone would exhaust the free collateral. */
  liquidation: number | null;
}

const floorTo = (x: number, step: number) => (step > 0 ? Math.floor(x / step + 1e-9) * step : x);

export function sizeSignalTrade(x: SizingInput): Sizing {
  const sign = x.direction === "long" ? 1 : -1;
  const empty = (error: string): Sizing => ({
    ok: false, error, notes: [], size: 0, notional: 0, margin: 0, riskUsd: 0, legRewardsUsd: [], rewardUsd: 0, rr: 0, feesUsd: 0, liquidation: null,
  });
  const stopDist = sign * (x.entry - x.stop);
  if (!(x.entry > 0) || !(stopDist > 0)) return empty("Price is already past the stop.");
  if (!(x.equity > 0)) return empty("No trading balance.");
  if (!(x.leverage > 0)) return empty("Set a leverage for this market.");
  const notes: string[] = [];

  // Risk per unit = the move to the stop + a fill on each side.
  const perUnitRisk = stopDist + (x.entry + x.stop) * x.feeRate;
  const riskBudget = (x.equity * x.riskPct) / 100;
  let size = riskBudget / perUnitRisk;

  // Margin cap: never more than ~95% of what's free.
  const maxByMargin = (Math.max(0, x.availableMargin) * 0.95 * x.leverage) / x.entry;
  if (size > maxByMargin) {
    size = maxByMargin;
    notes.push("Size capped by available margin. Raise leverage or lower risk.");
  }
  size = floorTo(size, x.lotSize);
  if (!(size > 0)) return empty("Not enough margin for one lot.");

  const notional = size * x.entry;
  if (notional < x.minNotional) {
    const needPct = ((x.minNotional / x.entry) * perUnitRisk * 100) / x.equity;
    return {
      ...empty(`Below Bulk's $${x.minNotional} minimum order. Needs about ${needPct.toFixed(2)}% risk.`),
      size,
      notional,
    };
  }

  const margin = notional / x.leverage;
  const riskUsd = size * perUnitRisk;
  const legRewardsUsd = x.legs.map((l) =>
    l.price === null ? null : l.frac * size * (sign * (l.price - x.entry) - (x.entry + l.price) * x.feeRate)
  );
  // A trailed runner: count it at the last fixed price (conservative).
  const lastFixed = [...x.legs].reverse().find((l) => l.price !== null)?.price ?? null;
  const rewardUsd = x.legs.reduce((sum, l, i) => {
    const px = l.price ?? lastFixed;
    if (px === null) return sum;
    return sum + (legRewardsUsd[i] ?? l.frac * size * (sign * (px - x.entry) - (x.entry + px) * x.feeRate));
  }, 0);
  const feesUsd = size * x.entry * x.feeRate * 2;

  // Cross margin: the account's free collateral is this position's loss budget.
  const budget = Math.max(0, x.availableMargin);
  const liquidation = budget > 0 ? x.entry - (sign * budget) / size : null;
  const stopBeyondLiq = liquidation !== null && (sign > 0 ? x.stop <= liquidation : x.stop >= liquidation);
  if (stopBeyondLiq) {
    return {
      ok: false, error: "The stop is past the liquidation price. Lower the size or add margin.", notes,
      size, notional, margin, riskUsd, legRewardsUsd, rewardUsd, rr: rewardUsd / riskUsd, feesUsd, liquidation,
    };
  }
  if (x.legs.some((l) => l.price !== null && sign * (l.price - x.entry) <= 0)) {
    return {
      ok: false, error: "Price already passed the first target.", notes,
      size, notional, margin, riskUsd, legRewardsUsd, rewardUsd, rr: rewardUsd / riskUsd, feesUsd, liquidation,
    };
  }
  return { ok: true, error: null, notes, size, notional, margin, riskUsd, legRewardsUsd, rewardUsd, rr: rewardUsd / riskUsd, feesUsd, liquidation };
}

/** Split a position across legs on the lot grid; the last leg takes the remainder. */
export function legSizes(size: number, fracs: number[], lotSize: number): number[] {
  const out: number[] = [];
  let left = size;
  fracs.forEach((f, i) => {
    const s = i === fracs.length - 1 ? left : Math.min(left, floorTo(size * f, lotSize));
    out.push(+s.toFixed(10));
    left -= s;
  });
  return out;
}
