/**
 * Shared points copy. The disclaimer is shown wherever points are (Points
 * panel, the points board's "?" tip): points are an allocation record, not a
 * promise of anything.
 */
export const POINTS_DISCLAIMER =
  "Points have no cash value and are not a promise of a token, airdrop or any other reward. Tradash may change how points are earned and remove points gained through abuse.";

/** $5,000 → "$5K", $1,250,000 → "$1.25M". */
export function compactUsd(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`;
  if (v >= 1e3) return `$${(v / 1e3).toLocaleString(undefined, { maximumFractionDigits: 1 })}K`;
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/** 1.25 → "1.25×", 2 → "2×". */
export const multiplierText = (m: number) =>
  `${m.toLocaleString(undefined, { maximumFractionDigits: 2 })}×`;
