#!/usr/bin/env node
/**
 * Phoenix read-path check — migration phase 2.
 *
 * Exercises every READ the adapter depends on against the live API and prints
 * what came back. Read-only: it never signs, never broadcasts, and never sends
 * a request that could move funds.
 *
 * Run:  node scripts/phoenix-readcheck.mjs [authority] [traderPda]
 *
 * This exists because the docs were wrong about the route prefix and the wire
 * shapes, so "does this still work?" has to be answerable by execution rather
 * than by reading. Run it before trusting any Phoenix code after an SDK or API
 * bump.
 */
const API = process.env.NEXT_PUBLIC_PHOENIX_API_URL ?? "https://perp-api.phoenix.trade";
const AUTHORITY = process.argv[2] ?? "23REC5Z6c9YAibQmzXDW5mqKLi3qeF7CW41f1HsVvG8E";
const TRADER_PDA = process.argv[3] ?? "CPrGyHJbbKn7rytffKjJA1BUaUcBzTuVN91NycV6QKBX";

const TRACKED = ["BTC", "ETH", "SOL"];
let failures = 0;

async function get(path) {
  const r = await fetch(API + path, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
  return r.json();
}

async function step(name, fn) {
  try {
    const out = await fn();
    console.log(`  ✓ ${name}${out ? ` — ${out}` : ""}`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${name} — ${e.message}`);
  }
}

const amt = (a) => (a ? a.value / 10 ** a.decimals : 0);

console.log(`Phoenix read check → ${API}\n`);

console.log("exchange");
let markets = [];
await step("status", async () => {
  const s = await get("/v1/view/exchange/status");
  return `active=${s.active} gated=${s.gated} withdrawals=${s.withdrawalsAvailable}`;
});
await step("markets", async () => {
  markets = await get("/v1/view/exchange/markets");
  const active = markets.filter((m) => m.marketStatus === "active").length;
  return `${markets.length} markets, ${active} active`;
});
await step("tracked markets present", async () => {
  const missing = TRACKED.filter((s) => !markets.some((m) => m.symbol === s));
  if (missing.length) throw new Error(`missing: ${missing.join(", ")}`);
  return TRACKED.map((s) => {
    const m = markets.find((x) => x.symbol === s);
    const lev = Math.max(...m.leverageTiers.map((t) => t.maxLeverage));
    return `${s} ${lev}x lot=${10 ** -m.baseLotsDecimals}`;
  }).join("  ");
});

console.log("\ntrader");
await step("state by PDA", async () => {
  const s = await get(`/v1/view/trader/${TRADER_PDA}`);
  return `${amt(s.portfolioValue).toFixed(6)} USDC, ${s.positions.length} positions, ${s.riskState}`;
});
await step("portfolio by authority", async () => {
  const s = await get(`/v1/trader/state/${AUTHORITY}`);
  return `pdaIndex=${s.traderPdaIndex}`;
});
await step("trades history", async () => {
  const r = await get(`/v1/trader/${AUTHORITY}/trades-history?limit=50`);
  const rows = r.data ?? [];
  const subs = [...new Set(rows.map((t) => t.subaccountIndex))].sort();
  // Positions are per-subaccount; a trader active on subaccount 1 reads as
  // empty on subaccount 0. Surfacing this prevents "looks inactive" mistakes.
  return `${rows.length} fills, subaccounts [${subs.join(",")}]`;
});

console.log("\nmarket data");
await step("candles (ms timestamps)", async () => {
  const now = Date.now();
  const r = await get(`/v1/candles_v2/BTC?timeframe=1m&from=${now - 86400000}&to=${now}`);
  if (!r.bars?.length) throw new Error("no bars — are timestamps in seconds?");
  return `${r.bars.length} bars/24h, mark OHLC present=${r.bars[0].markClose != null}`;
});
await step("candles reject seconds (regression guard)", async () => {
  const now = Math.floor(Date.now() / 1000);
  const r = await get(`/v1/candles_v2/BTC?timeframe=1m&from=${now - 86400}&to=${now}`);
  // Documenting the trap: seconds return 200 with an EMPTY bar set, not an error.
  return r.bars?.length ? `unexpected: ${r.bars.length} bars` : "empty as expected";
});
await step("collateral assets", async () => {
  const r = await get("/v1/collateral/assets");
  return r.assets.map((a) => `${a.symbol}(${a.decimals}dp)`).join(" ");
});

// The delegate is NOT served by REST or WS — it lives in the on-chain trader
// account. This is the read that replaced trusting localStorage optimistically.
console.log("\ndelegate (on-chain)");
const RPC = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
if (!RPC) {
  console.log("  - skipped: set NEXT_PUBLIC_SOLANA_RPC_URL to check");
} else {
  await step("trader account decodes to a delegate", async () => {
    const r = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "getAccountInfo",
        params: [TRADER_PDA, { encoding: "base64" }],
      }),
    });
    const body = await r.json();
    const v = body.result?.value;
    if (!v?.data) throw new Error("trader account not found");
    if (v.owner !== "EtrnLzgbS7nMMy5fbD42kXiUzGg8XQzJ972Xtk1cjWih") {
      throw new Error(`owned by ${v.owner}, not Phoenix`);
    }
    const rise = await import("@ellipsis-labs/rise");
    const t = rise.decodeTrader(Uint8Array.from(atob(v.data[0]), (c) => c.charCodeAt(0)));
    const delegate = String(t.positionAuthority);
    // The whole point: the delegate must be a DIFFERENT key from the owner.
    // If they were equal, one-tap trading would be signing with the owner.
    if (delegate === String(t.authority)) throw new Error("delegate == owner (not registered)");
    return `positionAuthority=${delegate.slice(0, 8)}… authority=${String(t.authority).slice(0, 8)}…`;
  });
}

console.log(failures ? `\nFAILED: ${failures} check(s)` : "\nAll read paths OK");
process.exit(failures ? 1 : 0);
