import { PHOENIX_API } from "./config";
import type { PhoenixTraderState } from "./types";

/**
 * Liquidation prices for Phoenix positions.
 *
 * Phoenix serves NO liquidation price over REST or WS — `/v1/view/trader/{pda}`
 * carries `maintenanceMargin`, `initialMargin`, `riskState` and `riskTier` and
 * nothing else. The only honest source is the SDK's margin calculator, run on
 * the same inputs the on-chain risk engine uses. So this module reimplements
 * nothing: it assembles inputs and asks the SDK.
 *
 * ## Why this looked impossible and was not
 *
 * The SDK's intended converter, `buildMarketParamsBySymbol`, wants a
 * `MarketSummary` — a shape with `units.tickSizeInQuoteLotsPerBaseLot`. The
 * REST markets row is an `ExchangeMarketConfig`, which has no `units` object,
 * and feeding it to the converter throws `Cannot read properties of undefined`.
 * That read as "the inputs are unreachable without decoding on-chain market
 * accounts".
 *
 * It is only a NAMING difference. The REST row carries every field the
 * calculator needs, flattened: `tickSize` is the tick size, `baseLotsDecimals`
 * the lot decimals, and `leverageTiers`/`riskFactors` are already there. So
 * `MarketParams` is built directly here and the converter is skipped entirely.
 *
 * ## The unit trap this file exists to contain
 *
 * `riskFactors.maintenance` is a PERCENTAGE (50 = 50%). The calculator wants
 * BASIS POINTS (5000 = 50%). Phoenix serves both: `maintenance` and
 * `maintenanceBps`. Reading the bare field would understate every margin
 * requirement by 100x and quote a liquidation price far beyond the real one —
 * a silent, dangerous wrong answer rather than an error. Only the `*Bps`
 * fields are read below, and a row missing them is skipped rather than guessed.
 *
 * Verified [LIVE] 2026-09-19 against the real exchange config: a synthetic
 * 1 SOL long on $12 collateral liquidates at 100.78, which matches an
 * independent closed-form calculation to 0.006 and re-prices to
 * `effectiveCollateral == maintenanceMargin` at that price — the definition of
 * the liquidation point. Longs come out below the mark, shorts above, and an
 * over-collateralised position returns `null`.
 */

/** Live market config row, `/v1/view/exchange/markets`. */
interface PhoenixMarketRow {
  symbol: string;
  assetId: number;
  tickSize: number;
  baseLotsDecimals: number;
  isolatedOnly: boolean;
  leverageTiers: {
    maxLeverage: number;
    maxSizeBaseLots: number;
    limitOrderRiskFactorBps?: number;
  }[];
  riskFactors: {
    maintenanceBps?: number;
    backstopBps?: number;
    highRiskBps?: number;
    upnlBps?: number;
    upnlForWithdrawalsBps?: number;
    cancelOrderBps?: number;
  };
}

/**
 * Market configuration, cached.
 *
 * Risk factors and tick sizes change on the order of protocol upgrades, not
 * minutes, and this sits on the path of every account refresh. Mark prices are
 * NOT cached with it — they are passed in per call, because they move every
 * second and a stale one would move the liquidation price with it.
 */
const MARKETS_TTL_MS = 5 * 60_000;
let marketsCache: { at: number; rows: PhoenixMarketRow[] } | null = null;

async function fetchMarketRows(): Promise<PhoenixMarketRow[]> {
  const now = Date.now();
  if (marketsCache && now - marketsCache.at < MARKETS_TTL_MS) {
    return marketsCache.rows;
  }
  const res = await fetch(`${PHOENIX_API}/v1/view/exchange/markets`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Phoenix markets failed: ${res.status}`);
  const rows = (await res.json()) as PhoenixMarketRow[];
  marketsCache = { at: now, rows };
  return rows;
}

/** Test seam: drop the cached market config. */
export function resetMarketCache(): void {
  marketsCache = null;
}

/**
 * One REST market row → the calculator's `MarketParams`, or null if unusable.
 *
 * Returns null rather than throwing: one malformed market must not take down
 * the liquidation price of every other position. Missing `*Bps` fields are
 * treated as unusable for the reason in the module note — a percentage read as
 * basis points is off by 100x.
 */
function toMarketParams(
  row: PhoenixMarketRow,
  markPriceUsd: number,
  priceUsdToTicks: (
    price: number | string,
    units: { baseLotsDecimals: number; tickSizeInQuoteLotsPerBaseLot: number }
  ) => string
): Record<string, unknown> | null {
  if (!Number.isFinite(markPriceUsd) || markPriceUsd <= 0) return null;

  const rf = row.riskFactors;
  const bps = [
    rf.maintenanceBps,
    rf.backstopBps,
    rf.highRiskBps,
    rf.upnlBps,
    rf.upnlForWithdrawalsBps,
    rf.cancelOrderBps,
  ];
  if (bps.some((v) => v == null || !Number.isFinite(v))) return null;

  const tiers = row.leverageTiers ?? [];
  if (tiers.some((t) => t.limitOrderRiskFactorBps == null)) return null;

  try {
    return {
      symbol: row.symbol,
      assetId: row.assetId,
      markPriceTicks: priceUsdToTicks(markPriceUsd, {
        tickSizeInQuoteLotsPerBaseLot: row.tickSize,
        baseLotsDecimals: row.baseLotsDecimals,
      }),
      tickSize: String(row.tickSize),
      baseLotDecimals: row.baseLotsDecimals,
      leverageTiers: tiers.map((t) => ({
        upperBoundSize: String(t.maxSizeBaseLots),
        maxLeverage: String(t.maxLeverage),
        limitOrderRiskFactorBps: String(t.limitOrderRiskFactorBps),
      })),
      riskFactors: {
        maintenanceMarginFactorBps: String(rf.maintenanceBps),
        backstopMarginFactorBps: String(rf.backstopBps),
        highRiskMarginFactorBps: String(rf.highRiskBps),
      },
      cancelOrderRiskFactorBps: String(rf.cancelOrderBps),
      upnlRiskFactor: String(rf.upnlBps),
      upnlRiskFactorForWithdrawals: String(rf.upnlForWithdrawalsBps),
      isolatedOnly: row.isolatedOnly,
    };
  } catch {
    // `priceUsdToTicks` throws on a non-finite or negative price.
    return null;
  }
}

/** Liquidation price per PHOENIX symbol. `null` = not liquidatable. */
export type LiquidationBySymbol = Record<string, number | null>;

/**
 * Liquidation prices for every position in a trader state.
 *
 * `markPricesByPhoenixSymbol` must be keyed by PHOENIX symbols (the ones on the
 * market rows), not Tradash's. It only needs to cover markets the trader holds
 * a position in; the rest of the exchange is priced from the same map and
 * silently skipped when absent, which is correct — an unpriced market the user
 * is not in cannot affect their cross margin.
 *
 * CROSS MARGIN. Liquidation on Phoenix is a property of the whole subaccount,
 * not of one position: a second position changes the first's liquidation price.
 * That is why the entire trader state goes in at once rather than a position at
 * a time.
 *
 * Never throws. Liquidation price is a display, and a failed read must leave
 * the rest of the position card working rather than blanking it.
 */
export async function computeLiquidationPrices(
  state: PhoenixTraderState,
  markPricesByPhoenixSymbol: Record<string, number>
): Promise<LiquidationBySymbol> {
  const positions = state.positions ?? [];
  if (positions.length === 0) return {};

  try {
    const [rows, rise] = await Promise.all([
      fetchMarketRows(),
      import("@ellipsis-labs/rise"),
    ]);

    const { priceUsdToTicks, createMarginCalculator } = rise as unknown as {
      priceUsdToTicks: Parameters<typeof toMarketParams>[2];
      createMarginCalculator: (markets: unknown[]) => {
        computeTraderLiquidationPricesFromInputs: (inputs: unknown) => {
          subaccounts: {
            positions: { symbol: string; liquidationPriceUsd: number | null }[];
          }[];
        };
      };
    };

    const params = rows
      .map((row) => {
        const mark = markPricesByPhoenixSymbol[row.symbol];
        return mark == null ? null : toMarketParams(row, mark, priceUsdToTicks);
      })
      .filter((p): p is Record<string, unknown> => p !== null);

    if (params.length === 0) return {};
    const priced = new Set(params.map((p) => p.symbol as string));

    // A position in a market with no usable params cannot be priced, and
    // including it would make the calculator throw and lose every other row.
    const markets = positions
      .filter((p) => p.symbol && priced.has(p.symbol))
      .map((p) => ({
        symbol: p.symbol as string,
        position: {
          basePositionLots: String(p.basePositionLots),
          virtualQuotePositionLots: String(p.virtualQuotePositionLots),
          entryPriceTicks: String(p.entryPriceTicks),
          unsettledFundingQuoteLots: String(p.unsettledFundingQuoteLots ?? 0),
          accumulatedFundingQuoteLots: String(p.accumulatedFundingQuoteLots ?? 0),
        },
      }));

    if (markets.length === 0) return {};

    const calc = createMarginCalculator(params);
    const result = calc.computeTraderLiquidationPricesFromInputs({
      authority: state.authority,
      traderPdaIndex: state.traderPdaIndex,
      subaccounts: [
        {
          subaccountIndex: state.traderSubaccountIndex,
          collateralBalanceQuoteLots: String(state.collateralBalance.value),
          markets,
        },
      ],
    });

    const out: LiquidationBySymbol = {};
    for (const sub of result.subaccounts ?? []) {
      for (const p of sub.positions ?? []) {
        const v = p.liquidationPriceUsd;
        // A non-positive price is unreachable, not a level — same meaning as
        // null, and drawing a line at or below 0 would be wrong.
        out[p.symbol] = v != null && Number.isFinite(v) && v > 0 ? v : null;
      }
    }
    return out;
  } catch (err) {
    console.warn("[phoenix] liquidation price unavailable:", err);
    return {};
  }
}
