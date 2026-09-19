import { readAccount } from "./lib/phoenix/account.js";
const PDA="CPrGyHJbbKn7rytffKjJA1BUaUcBzTuVN91NycV6QKBX";
const a = await readAccount(PDA);
if (!a) { console.log("no account"); process.exit(1); }
console.log("balance:", JSON.stringify(a.balance));
console.log("positions:", a.positions.length);
for (const p of a.positions) console.log("  ", JSON.stringify(p));
console.log("\nraw risk:", a.raw.riskState, "/", a.raw.riskTier, " state:", a.raw.state);
// Cross-check against what the venue itself reports.
const rest = await (await fetch(`https://perp-api.phoenix.trade/v1/view/trader/${PDA}`)).json();
const venueEquity = rest.portfolioValue.value / 10**rest.portfolioValue.decimals;
console.log(`\nequity: ours ${a.balance.equity} vs venue ${venueEquity} ->`, a.balance.equity===venueEquity ? "✓ match" : "✗ MISMATCH");
