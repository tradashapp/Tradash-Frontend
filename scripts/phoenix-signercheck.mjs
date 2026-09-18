#!/usr/bin/env node
/**
 * Phoenix signer-set check — migration phase 3.
 *
 * Proves the one-tap delegate path: with `positionAuthority` + `feePayer`, the
 * owner's wallet signs NOTHING. Also proves the guard catches the silent-drop
 * trap, where a mis-spelled field yields an owner-signed order with a 200.
 *
 * READ-ONLY: builds unsigned instructions only. Never signs, never broadcasts,
 * never moves funds.
 *
 * Run:  node scripts/phoenix-signercheck.mjs [owner] [delegate] [sponsor]
 */
const API = process.env.NEXT_PUBLIC_PHOENIX_API_URL ?? "https://perp-api.phoenix.trade";
const OWNER = process.argv[2] ?? "23REC5Z6c9YAibQmzXDW5mqKLi3qeF7CW41f1HsVvG8E";
const DELEGATE = process.argv[3] ?? "37DDS2cZRpZKKApBVRuQLD1c2qPDJRTh9Dsf1uoU1m7o";
const SPONSOR = process.argv[4] ?? "8PCQoTwpYjLTwbEnyGfx4YnfFCscpib8t7dwimKSKbbn";

let failures = 0;
const short = (s) => (s ? s.slice(0, 8) + "…" : "-");

async function build(path, body) {
  const r = await fetch(API + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${r.status} ${t.slice(0, 120)}`);
  return JSON.parse(t);
}

const signers = (ixs) => {
  const w = [], ro = [];
  for (const ix of ixs) for (const k of ix.keys) if (k.isSigner) (k.isWritable ? w : ro).push(k.pubkey);
  return { writable: w, readonly: ro, all: [...w, ...ro] };
};

function check(name, cond, detail) {
  if (cond) console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  else { failures++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const ORDER = { symbol: "SOL", side: "buy", quantity: 0.1, traderPdaIndex: 0 };

console.log(`Phoenix signer check → ${API}`);
console.log(`owner=${short(OWNER)} delegate=${short(DELEGATE)} sponsor=${short(SPONSOR)}\n`);

console.log("market order — signer routing");
{
  const plain = await build("/v1/ix/place-isolated-market-order", { authority: OWNER, ...ORDER });
  const s = signers(plain);
  check("owner-only: owner signs", s.all.includes(OWNER), `${plain.length} ix, signers ${s.all.map(short).join(",")}`);

  const deleg = await build("/v1/ix/place-isolated-market-order", { authority: OWNER, positionAuthority: DELEGATE, ...ORDER });
  const d = signers(deleg);
  check("delegated: delegate authorises", d.readonly.includes(DELEGATE), `readonly=${d.readonly.map(short).join(",")}`);

  const full = await build("/v1/ix/place-isolated-market-order", { authority: OWNER, positionAuthority: DELEGATE, feePayer: SPONSOR, ...ORDER });
  const f = signers(full);
  check("ONE-TAP: owner signs nothing", !f.all.includes(OWNER), `writable=${f.writable.map(short).join(",")} readonly=${f.readonly.map(short).join(",")}`);
  check("ONE-TAP: sponsor pays", f.writable.includes(SPONSOR));
  check("ONE-TAP: delegate authorises", f.readonly.includes(DELEGATE));
}

console.log("\nsilent-drop trap — the guard must catch these");
for (const bad of ["position_authority", "delegate", "trader_wallet"]) {
  const ixs = await build("/v1/ix/place-isolated-market-order", { authority: OWNER, [bad]: DELEGATE, ...ORDER });
  const s = signers(ixs);
  // A dropped field means the OWNER signs — accepted with 200, no warning.
  check(`\`${bad}\` is dropped (owner signs) → guard fires`, s.all.includes(OWNER) && !s.all.includes(DELEGATE));
}

console.log("\nTP/SL bracket");
{
  const leg = (side, t, e) => ({ side, orderKind: "ioc", triggerPrice: t, executionPrice: e });
  const ixs = await build("/v1/ix/place-position-conditional-order", {
    authority: OWNER, positionAuthority: DELEGATE, feePayer: SPONSOR,
    symbol: "SOL", traderPdaIndex: 0,
    greaterTrigger: leg("sell", 300, 299), lessTrigger: leg("sell", 50, 49), sizePercent: 100,
  });
  const s = signers(ixs);
  check("TP+SL in ONE instruction", ixs.length === 1, `${ixs.length} ix, ${ixs[0].keys.length} accounts`);
  check("owner signs nothing", !s.all.includes(OWNER));

  // Wrong field names are the documented trap: the SDK's on-chain type uses
  // `greaterTriggerOrder`, but the wire wants `greaterTrigger`.
  let rejected = false;
  try {
    await build("/v1/ix/place-position-conditional-order", {
      authority: OWNER, positionAuthority: DELEGATE, symbol: "SOL", traderPdaIndex: 0,
      greaterTriggerOrder: leg("sell", 300, 299), sizePercent: 100,
    });
  } catch { rejected = true; }
  check("`greaterTriggerOrder` (SDK name) is rejected on the wire", rejected);
}

console.log("\nlot-size floor");
for (const [q, want] of [[0.00001, false], [0.0001, true]]) {
  let ok = true;
  try { await build("/v1/ix/place-isolated-market-order", { authority: OWNER, symbol: "BTC", side: "buy", quantity: q, traderPdaIndex: 0 }); }
  catch { ok = false; }
  check(`BTC quantity ${q} ${want ? "accepted" : "rejected (ZeroBaseLots)"}`, ok === want);
}

console.log(failures ? `\nFAILED: ${failures} check(s)` : "\nAll signer checks OK — one-tap path verified, nothing signed or sent");
process.exit(failures ? 1 : 0);
