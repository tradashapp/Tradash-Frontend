#!/usr/bin/env node
/**
 * Phoenix liquidation-price check.
 *
 * Exercises the same construction `lib/phoenix/liquidation.ts` uses — live
 * market config → MarketParams → margin calculator — and asserts the result
 * two independent ways, because there is no venue-quoted number to diff
 * against (Phoenix serves none; that is the whole reason the module exists).
 *
 *   (a) self-consistency: re-price the market AT the returned liquidation price
 *       and assert effectiveCollateral == maintenanceMargin. That equality IS
 *       the definition of the liquidation point, so it catches a wrong answer
 *       that a plausible-looking number would hide.
 *   (b) closed form: solve the same equation by hand and compare.
 *
 * Also pins the UNIT TRAP: `riskFactors.maintenance` is a percentage and
 * `maintenanceBps` is basis points. Reading the wrong one is off by 100x and
 * quotes a liquidation price far beyond the real one — silently. The check
 * below fails loudly if the live API ever stops serving the `*Bps` fields.
 *
 * Read-only: never signs, never broadcasts.
 *
 * Run:  node scripts/phoenix-liqcheck.mjs [authority]
 */
const API = process.env.NEXT_PUBLIC_PHOENIX_API_URL ?? "https://perp-api.phoenix.trade";
const AUTHORITY = process.argv[2] ?? "23REC5Z6c9YAibQmzXDW5mqKLi3qeF7CW41f1HsVvG8E";

let failures = 0;
const check = (name, ok, detail = "") => {
  if (ok) console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  else { failures++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
};

const get = async (p) => {
  const r = await fetch(API + p, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} @ ${p}`);
  return r.json();
};

const rise = await import("@ellipsis-labs/rise");
const { priceUsdToTicks, createMarginCalculator } = rise;

console.log(`Phoenix liquidation check → ${API}\n`);

const markets = await get("/v1/view/exchange/markets");
const stats = await get("/v1/markets/stats/latest");
const markBySymbol = Object.fromEntries(
  (stats.markets ?? stats)
    .filter((s) => s.mark_price != null)
    .map((s) => [s.symbol, Number(s.mark_price)])
);

console.log("inputs");
check("markets config", markets.length > 0, `${markets.length} markets`);
check("mark prices", Object.keys(markBySymbol).length > 0, `${Object.keys(markBySymbol).length} priced`);

// The unit trap, pinned.
const withBps = markets.filter((m) => m.riskFactors?.maintenanceBps != null);
check("riskFactors.*Bps present", withBps.length === markets.length,
  `${withBps.length}/${markets.length}`);
const btc = markets.find((m) => m.symbol === "BTC");
check("Bps is 100x the percentage field",
  btc.riskFactors.maintenanceBps === btc.riskFactors.maintenance * 100,
  `${btc.riskFactors.maintenance}% vs ${btc.riskFactors.maintenanceBps}bps`);

const bps = (row, name) => String(row[`${name}Bps`]);
const toMarketParams = (m, mark) => ({
  symbol: m.symbol,
  assetId: m.assetId,
  markPriceTicks: priceUsdToTicks(mark, {
    tickSizeInQuoteLotsPerBaseLot: m.tickSize,
    baseLotsDecimals: m.baseLotsDecimals,
  }),
  tickSize: String(m.tickSize),
  baseLotDecimals: m.baseLotsDecimals,
  leverageTiers: m.leverageTiers.map((t) => ({
    upperBoundSize: String(t.maxSizeBaseLots),
    maxLeverage: String(t.maxLeverage),
    limitOrderRiskFactorBps: String(t.limitOrderRiskFactorBps),
  })),
  riskFactors: {
    maintenanceMarginFactorBps: bps(m.riskFactors, "maintenance"),
    backstopMarginFactorBps: bps(m.riskFactors, "backstop"),
    highRiskMarginFactorBps: bps(m.riskFactors, "highRisk"),
  },
  cancelOrderRiskFactorBps: bps(m.riskFactors, "cancelOrder"),
  upnlRiskFactor: bps(m.riskFactors, "upnl"),
  upnlRiskFactorForWithdrawals: bps(m.riskFactors, "upnlForWithdrawals"),
  isolatedOnly: m.isolatedOnly,
});

const buildParams = (overrides = {}) =>
  markets
    .filter((m) => markBySymbol[m.symbol] != null)
    .map((m) => toMarketParams(m, overrides[m.symbol] ?? markBySymbol[m.symbol]));

console.log("\nconstruction");
let params;
try {
  params = buildParams();
  check("MarketParams built from the REST row", params.length === markets.length,
    `${params.length} markets, converter skipped`);
} catch (e) {
  check("MarketParams built from the REST row", false, e.message);
  process.exit(1);
}
const calc = createMarginCalculator(params);
check("calculator created", Object.keys(calc.markets).length === params.length);

// ---- synthetic position, per market ----
console.log("\nliquidation math (synthetic 1-unit long, ~9x leverage)");
for (const sym of ["BTC", "ETH", "SOL"]) {
  const m = markets.find((x) => x.symbol === sym);
  const mark = markBySymbol[sym];
  const lots = 10 ** m.baseLotsDecimals; // 1 unit
  const notional = mark;
  const collateral = notional / 9;
  const inputs = {
    authority: "SyntheticAuthority",
    traderPdaIndex: 0,
    subaccounts: [{
      subaccountIndex: 0,
      collateralBalanceQuoteLots: String(Math.round(collateral * 1e6)),
      markets: [{
        symbol: sym,
        position: {
          basePositionLots: String(lots),
          virtualQuotePositionLots: String(-Math.round(notional * 1e6)),
          entryPriceTicks: String(priceUsdToTicks(mark, {
            tickSizeInQuoteLotsPerBaseLot: m.tickSize,
            baseLotsDecimals: m.baseLotsDecimals,
          })),
          unsettledFundingQuoteLots: "0",
          accumulatedFundingQuoteLots: "0",
        },
      }],
    }],
  };

  const pos = calc.computeTraderLiquidationPricesFromInputs(inputs).subaccounts[0].positions[0];
  const liq = pos.liquidationPriceUsd;
  if (liq == null) { check(`${sym} liquidation price`, false, "null on a 9x position"); continue; }

  check(`${sym} liq below mark (long)`, liq < mark, `liq ${liq} < mark ${mark}`);

  // (a) self-consistency
  const at = createMarginCalculator(buildParams({ [sym]: liq }))
    .computeTraderMarginFromInputs(inputs).subaccounts[0].margin;
  const ec = Number(at.effectiveCollateralQuoteLots) / 1e6;
  const mm = Number(at.maintenanceMarginQuoteLots) / 1e6;
  const tickUsd = (m.tickSize / 1e6) * 10 ** m.baseLotsDecimals;
  check(`${sym} effectiveCollateral == maintenanceMargin at liq`,
    Math.abs(ec - mm) <= Math.max(tickUsd, 0.01),
    `${ec.toFixed(4)} vs ${mm.toFixed(4)} (tol ${Math.max(tickUsd, 0.01).toFixed(4)})`);

  // (b) closed form
  const mmFrac = (m.riskFactors.maintenanceBps / 10000) / m.leverageTiers[0].maxLeverage;
  const hand = (collateral - mark) / (mmFrac - 1);
  check(`${sym} matches closed form`, Math.abs(hand - liq) <= Math.max(tickUsd, mark * 1e-4),
    `hand ${hand.toFixed(4)} vs sdk ${liq}`);
}

// direction + unreachable
console.log("\nedge cases");
{
  const m = markets.find((x) => x.symbol === "SOL");
  const mark = markBySymbol.SOL;
  const lots = 10 ** m.baseLotsDecimals;
  const mk = (baseLots, quote, collateralUsd) => ({
    authority: "S", traderPdaIndex: 0,
    subaccounts: [{
      subaccountIndex: 0,
      collateralBalanceQuoteLots: String(Math.round(collateralUsd * 1e6)),
      markets: [{ symbol: "SOL", position: {
        basePositionLots: String(baseLots),
        virtualQuotePositionLots: String(quote),
        entryPriceTicks: String(priceUsdToTicks(mark, {
          tickSizeInQuoteLotsPerBaseLot: m.tickSize, baseLotsDecimals: m.baseLotsDecimals })),
        unsettledFundingQuoteLots: "0", accumulatedFundingQuoteLots: "0" } }],
    }],
  });
  const short = calc.computeTraderLiquidationPricesFromInputs(
    mk(-lots, Math.round(mark * 1e6), mark / 9)
  ).subaccounts[0].positions[0];
  check("short liq sits ABOVE the mark", short.liquidationPriceUsd > mark,
    `${short.liquidationPriceUsd} > ${mark}`);

  const rich = calc.computeTraderLiquidationPricesFromInputs(
    mk(lots, -Math.round(mark * 1e6), 1_000_000)
  ).subaccounts[0].positions[0];
  check("over-collateralised => null (not 0)", rich.liquidationPriceUsd === null,
    String(rich.liquidationPriceUsd));
}

// real account
console.log("\nreal account");
const addrs = await rise.deriveTraderAddresses(AUTHORITY, 0, 0);
const pda = String(await addrs.traderAccount());
const st = await get(`/v1/view/trader/${pda}`);
check("trader state read", !!st.authority, `${st.positions?.length ?? 0} positions, collateral ${st.collateralBalance?.ui}`);
if ((st.positions?.length ?? 0) === 0) {
  console.log("    (flat — the synthetic cases above are what proves the math)");
} else {
  const inputs = {
    authority: st.authority,
    traderPdaIndex: st.traderPdaIndex,
    subaccounts: [{
      subaccountIndex: st.traderSubaccountIndex,
      collateralBalanceQuoteLots: String(st.collateralBalance.value),
      markets: st.positions.filter((p) => markBySymbol[p.symbol] != null).map((p) => ({
        symbol: p.symbol,
        position: {
          basePositionLots: String(p.basePositionLots),
          virtualQuotePositionLots: String(p.virtualQuotePositionLots),
          entryPriceTicks: String(p.entryPriceTicks),
          unsettledFundingQuoteLots: String(p.unsettledFundingQuoteLots ?? 0),
          accumulatedFundingQuoteLots: String(p.accumulatedFundingQuoteLots ?? 0),
        },
      })),
    }],
  };
  // Against a REAL position the venue's own maintenance margin is a hard diff.
  const mine = calc.computeTraderMarginFromInputs(inputs).subaccounts[0].margin;
  const ours = Number(mine.maintenanceMarginQuoteLots);
  const theirs = Number(st.maintenanceMargin.value);
  check("maintenanceMargin matches the venue", Math.abs(ours - theirs) <= Math.max(2, theirs * 0.001),
    `ours ${ours} vs venue ${theirs}`);
  for (const p of calc.computeTraderLiquidationPricesFromInputs(inputs).subaccounts[0].positions) {
    console.log(`    ${p.symbol}: liq ${p.liquidationPriceUsd ?? "null (unreachable)"} (entry ${p.entryPriceUsd})`);
  }
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
