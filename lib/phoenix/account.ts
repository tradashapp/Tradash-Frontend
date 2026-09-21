import { MARKETS } from "@/lib/markets";
import type { Balance, MarketSymbol, Position } from "@/types";
import { fetchTraderState } from "./client";
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
 * READS `PhoenixAmount` OBJECTS, NOT STRINGS. The flat-string fields this used
 * to parse (`basePositionUnits`, `entryPriceUsd`) no longer exist; see
 * `PhoenixPositionRow`. Because every gate below returned null on a missing
 * field, the whole position disappeared from the UI while `toBalance` — which
 * reads unchanged top-level fields — kept reporting its margin and PnL.
 *
 * `liquidationPrice`, `marginUsed` and `unrealizedPnl` all come straight from
 * the API now. `leverage` remains derived: Phoenix stores no per-position
 * leverage (margin comes from size tiers), so effective leverage is
 * notional / margin, which is what the UI means by the number.
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

  // `positionSize` is signed and already in human units (decimals applied), so
  // there is no lot conversion to get wrong here — the old path had to use
  // Phoenix's `baseLotsDecimals` and would misreport size by 100x if it reached
  // for Bulk's `lotSize` instead.
  const sizeSigned = amountToNumber(row.positionSize);
  if (!Number.isFinite(sizeSigned) || sizeSigned === 0) return null;

  const entryPrice = amountToNumber(row.entryPrice);
  if (!Number.isFinite(entryPrice) || entryPrice === 0) return null;

  const size = Math.abs(sizeSigned);
  const direction = sizeSigned > 0 ? "long" : "short";

  // Phoenix's own figure is authoritative and already accounts for funding.
  // The mark-derived fallback only covers a row served without one, so PnL
  // never silently reads 0 on an open position.
  const served = row.unrealizedPnl ? amountToNumber(row.unrealizedPnl) : null;
  const unrealizedPnl =
    served != null && Number.isFinite(served)
      ? served
      : markPrice != null && Number.isFinite(markPrice)
        ? (direction === "long" ? 1 : -1) * (markPrice - entryPrice) * size
        : 0;

  // Margin locked by THIS position. `positionInitialMargin` is the per-position
  // figure; the row's `initialMargin` can fold in limit-order margin, which is
  // not money this position is using.
  const marginUsed = amountToNumber(
    row.positionInitialMargin ?? row.initialMargin
  );

  // Effective leverage. Guarded: a zero margin would divide to Infinity and
  // render as a nonsense multiplier.
  const notional = size * entryPrice;
  const leverage = marginUsed > 0 ? notional / marginUsed : 0;

  // 0 stays the "unknown" sentinel the chart must not draw — so a null or
  // zero from the API is preserved as 0 rather than invented.
  const liquidationPrice = row.liquidationPrice
    ? amountToNumber(row.liquidationPrice)
    : 0;

  return {
    symbol,
    direction,
    size,
    entryPrice,
    leverage,
    liquidationPrice,
    marginUsed,
    unrealizedPnl,
    openedAt: 0,
    // Funding already charged, signed as Phoenix reports it (negative = paid).
    // Drives the true break-even line, like Bulk's `realizedPnl`.
    realizedPnl:
      amountToNumber(row.accumulatedFunding) +
      amountToNumber(row.unsettledFunding),
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

  // Liquidation price is SERVED per position (`row.liquidationPrice`) and
  // `toPosition` has already applied it, so nothing is computed here.
  //
  // The SDK margin-calculator fallback that used to live at this point is gone:
  // it fed the calculator raw lot integers (`basePositionLots`,
  // `entryPriceTicks`, …) that this endpoint no longer serves, so it could only
  // have produced NaN. Verified 2026-09-21 that the served price matches the
  // closed-form liquidation point to 0.004 on a live SOL long (106.88 vs
  // 106.8840, where equity meets maintenance margin).

  return { balance: toBalance(raw), positions, raw };
}
