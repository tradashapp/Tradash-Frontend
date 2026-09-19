import { MARKETS } from "@/lib/markets";
import type { Balance, MarketSymbol, Position } from "@/types";
import { fetchTraderState } from "./client";
import { computeLiquidationPrices } from "./liquidation";
import { amountToNumber } from "./map";
import type { PhoenixPositionRow, PhoenixTraderState } from "./types";

/**
 * Read a Phoenix account into Tradash's domain types.
 *
 * VALUES COME FROM REST, NOT THE STREAM. The `traderState` websocket sends raw
 * state (collateral as an integer string, per subaccount) with no equity, margin
 * requirement, PnL or risk state; REST computes all of it. So the stream says
 * WHEN to read (see `accountWs.ts`) and this module says WHAT is true. Deriving
 * those numbers locally would mean reimplementing Phoenix's risk engine, and a
 * mismatch would render a wrong liquidation price.
 *
 * CROSS MARGIN ONLY. Tradash trades subaccount 0, so that is the only one read
 * here. A user who also traded on Phoenix's own UI may hold isolated positions
 * in subaccounts 1+; those are deliberately invisible rather than mixed into a
 * cross-margin balance, which would misreport available collateral.
 */

/** Phoenix symbol → Tradash symbol, for the markets Tradash lists. */
const SYMBOL_BY_PHOENIX: Record<string, MarketSymbol> = Object.fromEntries(
  (Object.values(MARKETS) as { symbol: MarketSymbol; phoenixSymbol?: string }[])
    .filter((m) => m.phoenixSymbol)
    .map((m) => [m.phoenixSymbol as string, m.symbol])
);

/** Tradash symbol → Phoenix symbol. The inverse of the map above. */
const PHOENIX_BY_SYMBOL: Partial<Record<MarketSymbol, string>> =
  Object.fromEntries(
    Object.entries(SYMBOL_BY_PHOENIX).map(([phoenix, symbol]) => [
      symbol,
      phoenix,
    ])
  );

/**
 * Account balance in Tradash's shape.
 *
 * `portfolioValue` already includes unrealized PnL, so it is the direct
 * analogue of Bulk's `equity`. `unrealizedPnl` rides along so the display layer
 * can subtract it and re-add its own interpolated figure without double
 * counting — the contract `Balance` already documents.
 *
 * `available` uses `initialMargin`, the requirement for OPENING, rather than
 * maintenance margin: it answers "how much can I put into a new position",
 * which is what the UI means by free collateral.
 */
export function toBalance(s: PhoenixTraderState): Balance {
  const equity = amountToNumber(s.portfolioValue);
  const marginUsed = amountToNumber(s.initialMargin);
  return {
    equity,
    available: Math.max(0, equity - marginUsed),
    marginUsed,
    unrealizedPnl: amountToNumber(s.unrealizedPnl),
  };
}

/**
 * One Phoenix position row → a domain `Position`, or null if flat/unknown.
 *
 * `liquidationPrice` is left at 0 and filled in by the caller from the SDK
 * margin calculator: Phoenix serves no liquidation price over REST or WS, and
 * the only honest sources are the calculator or nothing. `0` is a sentinel the
 * chart must treat as "unknown" and not draw — never as a real level.
 *
 * `leverage` is also 0: Phoenix stores no per-position leverage (margin comes
 * from size tiers), so there is nothing to read back. Effective leverage is
 * notional / collateral if a display needs it.
 */
export function toPosition(
  row: PhoenixPositionRow,
  markPrice?: number
): Position | null {
  const phoenixSym = row.symbol;
  if (!phoenixSym) return null;
  const symbol = SYMBOL_BY_PHOENIX[phoenixSym];
  // A market Tradash does not list — a user may hold it from Phoenix's own UI.
  if (!symbol) return null;

  // `basePositionUnits` is the human size Phoenix already computed. Prefer it:
  // converting from lots needs Phoenix's OWN `baseLotsDecimals`, which differs
  // from Bulk's `lotSize` (Phoenix BTC is 0.0001, Bulk 0.000001), so reusing the
  // Bulk value here would misreport size by 100x. If units are absent the row
  // cannot be trusted, so it is skipped rather than converted from a guess.
  if (row.basePositionUnits == null) return null;
  const sizeSigned = Number(row.basePositionUnits);
  if (!Number.isFinite(sizeSigned) || sizeSigned === 0) return null;

  const entryPrice =
    row.entryPriceUsd != null ? Number(row.entryPriceUsd) : Number.NaN;
  if (!Number.isFinite(entryPrice)) return null;

  const size = Math.abs(sizeSigned);
  const direction = sizeSigned > 0 ? "long" : "short";

  // Phoenix reports funding separately from PnL, so unrealized PnL is derived
  // from the mark price when one is to hand. Without a mark there is no honest
  // figure, and 0 is the safe default — the display layer interpolates anyway.
  const unrealizedPnl =
    markPrice != null && Number.isFinite(markPrice)
      ? (direction === "long" ? 1 : -1) * (markPrice - entryPrice) * size
      : 0;

  return {
    symbol,
    direction,
    size,
    entryPrice,
    leverage: 0,
    liquidationPrice: 0,
    marginUsed: 0,
    unrealizedPnl,
    openedAt: 0,
    realizedPnl: Number(row.accumulatedFundingQuoteLots ?? 0) / 1e6,
  };
}

export interface PhoenixAccount {
  balance: Balance;
  positions: Position[];
  /** Raw state, for callers needing risk fields or the margin calculator. */
  raw: PhoenixTraderState;
}

/**
 * Read the cross-margin account: balance plus open positions.
 *
 * `traderPda` must be subaccount 0's PDA — `/v1/view/trader/{pda}` is scoped to
 * ONE subaccount, so passing another index silently reports a different
 * account's positions as if they were the cross ones.
 */
export async function readAccount(
  traderPda: string,
  markPrices?: Partial<Record<MarketSymbol, number>>
): Promise<PhoenixAccount | null> {
  const raw = await fetchTraderState(traderPda).catch(() => null);
  // A trader account that does not exist yet is flat, not an error — the user
  // has simply never funded Phoenix.
  if (!raw) return null;

  const positions = raw.positions
    .map((row) => {
      const sym = row.symbol ? SYMBOL_BY_PHOENIX[row.symbol] : undefined;
      return toPosition(row, sym ? markPrices?.[sym] : undefined);
    })
    .filter((p): p is Position => p !== null);

  // Liquidation price is computed, not served — see `liquidation.ts`. It needs
  // Phoenix-keyed marks, and the caller holds Tradash-keyed ones.
  //
  // Only markets the trader actually holds are priced. Cross margin means every
  // position influences every other's liquidation price, but a market the user
  // is not in cannot, so leaving the rest unpriced changes no answer while
  // keeping this independent of how many markets the app happens to list.
  const marksByPhoenix: Record<string, number> = {};
  if (markPrices) {
    for (const row of raw.positions) {
      const sym = row.symbol ? SYMBOL_BY_PHOENIX[row.symbol] : undefined;
      const px = sym ? markPrices[sym] : undefined;
      if (row.symbol && px != null && Number.isFinite(px)) {
        marksByPhoenix[row.symbol] = px;
      }
    }
  }

  if (positions.length > 0 && Object.keys(marksByPhoenix).length > 0) {
    // Never throws; an empty map just leaves the 0 sentinel in place.
    const liq = await computeLiquidationPrices(raw, marksByPhoenix);
    for (const p of positions) {
      const phoenixSym = PHOENIX_BY_SYMBOL[p.symbol];
      const price = phoenixSym ? liq[phoenixSym] : undefined;
      if (price != null && price > 0) p.liquidationPrice = price;
    }
  }

  return { balance: toBalance(raw), positions, raw };
}
