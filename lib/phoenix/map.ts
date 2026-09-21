import type { PhoenixAmount, PhoenixMarket } from "./types";

/**
 * Phoenix wire shapes → Tradash domain types.
 *
 * Pure functions, no I/O, so they can be checked against a captured payload.
 * Kept separate from `client.ts` because the mapping is where venue semantics
 * actually differ, and that is worth reading on its own.
 */

/**
 * Phoenix amounts are integer + decimals. Divide here, once.
 *
 * `ui` is deliberately ignored: it is a formatted string, and parsing formatted
 * output back into a number is how rounding bugs start.
 */
export function amountToNumber(a: PhoenixAmount | undefined): number {
  if (!a) return 0;
  return a.value / 10 ** a.decimals;
}

/** Base lot size for a market: BTC baseLotsDecimals 4 → 0.0001 BTC. */
export function lotSizeOf(m: PhoenixMarket): number {
  return 10 ** -m.baseLotsDecimals;
}

/**
 * Max leverage available to a position of `sizeBase`.
 *
 * Phoenix has no per-user leverage setting: the ceiling is a function of size,
 * and `initial margin = notional / maxLeverage(tier)`. Tiers are ascending by
 * `maxSizeBaseLots`, so the first tier the size fits in is the binding one.
 *
 * In practice (verified live 2026-09-18) the ladder is effectively ONE usable
 * tier — BTC gives 40x up to 735 BTC (~$57M notional) and 1x beyond, with ETH
 * and SOL shaped the same. So for Tradash-sized positions this behaves like
 * Bulk's flat per-market cap, and the tier-crossing repricing described in the
 * feasibility report is unreachable in practice. Implemented properly anyway,
 * because the ladder is exchange-controlled and can be retuned without notice.
 */
export function maxLeverageForSize(m: PhoenixMarket, sizeBase: number): number {
  const lots = Math.abs(sizeBase) / lotSizeOf(m);
  const tiers = [...m.leverageTiers].sort(
    (a, b) => a.maxSizeBaseLots - b.maxSizeBaseLots
  );
  for (const t of tiers) if (lots <= t.maxSizeBaseLots) return t.maxLeverage;
  // Past the last rung: the most conservative tier is the honest answer.
  return tiers.length ? tiers[tiers.length - 1].maxLeverage : 1;
}

/** Headline max leverage for a market — the top rung, for display. */
export function headlineMaxLeverage(m: PhoenixMarket): number {
  return m.leverageTiers.reduce((hi, t) => Math.max(hi, t.maxLeverage), 1);
}
