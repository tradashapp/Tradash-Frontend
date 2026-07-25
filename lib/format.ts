// Shared price formatting so the chart scale and the header always agree.
// Decimals scale by magnitude (fewer decimals as the price grows):
//   >= 100,000 -> 1   (e.g. 560,500.2)
//   >= 1,000   -> 2   (e.g. 60,000.00)
//   >= 10      -> 3   (e.g. 80.345)
//   < 10       -> 4   (e.g. 1.3421, 0.2345)
export function priceDecimals(price: number): number {
  const p = Math.abs(price);
  if (p >= 100_000) return 1;
  if (p >= 1_000) return 2;
  if (p >= 10) return 3;
  return 4;
}

/** Format a price with grouping + magnitude-based decimals. No currency symbol. */
export function formatPrice(price: number): string {
  const d = priceDecimals(price);
  return price.toLocaleString(undefined, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

/** Same as formatPrice with a leading "$". */
export function formatUsd(price: number): string {
  return `$${formatPrice(price)}`;
}
