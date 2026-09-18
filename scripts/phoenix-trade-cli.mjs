#!/usr/bin/env node
/**
 * Phoenix live-trade CLI — migration phase 4. See phoenix-trade-cli.md.
 *
 * MAINNET ONLY. Phoenix has no devnet. Every send here is a real trade with
 * real money. Every step simulates first and asks before broadcasting.
 *
 * Run:  node scripts/phoenix-trade-cli.mjs <command> [args]
 *
 * `@solana/web3.js` and `bs58` are already app dependencies. The Rise SDK is
 * NOT — it is only needed to derive the trader PDA and to build the delegate
 * registration instruction (the one flow with no REST route), and a large SDK
 * does not belong in a PWA bundle for a one-time setup step. It is therefore
 * loaded lazily, and only the commands that need it will ask for it:
 *
 *   npm i --no-save @ellipsis-labs/rise@0.5.23
 *
 * Remove it again afterwards; nothing in `lib/phoenix/*` depends on it.
 *
 * Commands:
 *   keygen                     generate a fresh delegate keypair
 *   status                     show account, delegate and balances
 *   register                   register the delegate (ONE owner signature)
 *   buy  <symbol> <qty>        market buy   (delegate signs)
 *   sell <symbol> <qty>        market sell  (delegate signs)
 *   close <symbol>             flatten the position
 *   tpsl <symbol> <tp> <sl>    set both protective legs in one instruction
 *
 * Secrets come from env, never argv (argv lands in shell history):
 *   OWNER_SECRET     base58 secret of the trader-account owner
 *   DELEGATE_SECRET  base58 secret of the session key
 *   SPONSOR_SECRET   optional; if unset the delegate pays its own fees
 *   SOLANA_RPC_URL   optional; defaults to public mainnet (rate-limited)
 */
import { createRequire } from "node:module";
import { createInterface } from "node:readline/promises";
const require = createRequire(import.meta.url);

const API = process.env.PHOENIX_API_URL ?? "https://perp-api.phoenix.trade";
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const PROGRAM = "EtrnLzgbS7nMMy5fbD42kXiUzGg8XQzJ972Xtk1cjWih";

const web3 = require("@solana/web3.js");
const bs58 = require("bs58").default ?? require("bs58");

const kp = (secret, label) => {
  if (!secret) throw new Error(`${label} is not set`);
  return web3.Keypair.fromSecretKey(bs58.decode(secret.trim()));
};

const owner = () => kp(process.env.OWNER_SECRET, "OWNER_SECRET");
const delegate = () => kp(process.env.DELEGATE_SECRET, "DELEGATE_SECRET");
const sponsor = () =>
  process.env.SPONSOR_SECRET ? kp(process.env.SPONSOR_SECRET, "SPONSOR_SECRET") : null;

async function api(path, init) {
  const r = await fetch(API + path, {
    ...init,
    headers: { accept: "application/json", ...(init?.headers ?? {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} → ${r.status}: ${t.slice(0, 220)}`);
  return t ? JSON.parse(t) : null;
}

/** Signers of REST-built instructions, split by slot. Mirrors lib/phoenix/signers.ts. */
function signersOf(ixs) {
  const writable = [], readonly = [];
  for (const ix of ixs) for (const k of ix.keys) if (k.isSigner) (k.isWritable ? writable : readonly).push(k.pubkey);
  return { writable, readonly, all: [...writable, ...readonly] };
}

/**
 * The one-tap invariant. Phoenix drops unknown fields silently, so a mis-spelled
 * `positionAuthority` yields an owner-signed order with a 200 and no warning.
 */
function assertDelegateSigned(s, { delegate, feePayer, owner }) {
  if (s.all.includes(owner))
    throw new Error(`owner ${owner} is a required signer — positionAuthority was probably dropped`);
  if (!s.readonly.includes(delegate))
    throw new Error(`delegate ${delegate} is not an authorising signer (got: ${s.all.join(", ") || "none"})`);
  if (feePayer && !s.writable.includes(feePayer))
    throw new Error(`fee payer ${feePayer} is not in the writable signer slot`);
}

function toIx(ix) {
  if (ix.programId !== PROGRAM) throw new Error(`instruction targets ${ix.programId}, not Phoenix`);
  return new web3.TransactionInstruction({
    programId: new web3.PublicKey(ix.programId),
    keys: ix.keys.map((k) => ({
      pubkey: new web3.PublicKey(k.pubkey),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    data: Buffer.from(ix.data),
  });
}

async function confirmPrompt(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  return a === "y" || a === "yes";
}

/** Simulate, show the outcome, ask, then send. Never sends unprompted. */
async function submit(ixs, signers, feePayerPk, label) {
  const conn = new web3.Connection(RPC, "confirmed");
  const tx = new web3.Transaction();
  for (const ix of ixs) tx.add(toIx(ix));
  tx.feePayer = new web3.PublicKey(feePayerPk);
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;

  const sim = await conn.simulateTransaction(tx);
  if (sim.value.err) {
    console.error(`\n✗ simulation failed: ${JSON.stringify(sim.value.err)}`);
    for (const l of (sim.value.logs ?? []).slice(-12)) console.error("   " + l);
    process.exit(1);
  }
  console.log(`✓ simulated ok (${ixs.length} instruction(s), ${sim.value.unitsConsumed ?? "?"} CU)`);

  if (!(await confirmPrompt(`\nSEND ${label} to MAINNET? This spends real money.`))) {
    console.log("aborted — nothing sent");
    return null;
  }
  tx.sign(...signers);
  const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await conn.confirmTransaction(sig, "confirmed");
  console.log(`\n✓ ${label} confirmed\n  https://solscan.io/tx/${sig}`);
  return sig;
}

function loadRise() {
  try {
    return require("@ellipsis-labs/rise");
  } catch {
    throw new Error(
      "this command needs the Rise SDK, which is deliberately not an app dependency.\n" +
        "  Install it just for this run:  npm i --no-save @ellipsis-labs/rise@0.5.23"
    );
  }
}

async function traderPda(authority) {
  const rise = loadRise();
  const r = await rise.deriveTraderAddresses(authority, 0, 0);
  return String(await r.traderAccount());
}

const CMD = {
  /**
   * Generate a delegate (session) keypair.
   *
   * Printed once and never stored: put the secret in an env file you control.
   * A delegate can trade but CANNOT withdraw or appoint another delegate, so
   * its blast radius is bounded — but it can still open and close positions,
   * so treat it like any other key.
   */
  async keygen() {
    const k = web3.Keypair.generate();
    console.log(`DELEGATE_SECRET=${bs58.encode(k.secretKey)}`);
    console.log(`# pubkey: ${k.publicKey.toBase58()}`);
    console.log(`#`);
    console.log(`# Fund this address with a little SOL (~0.01) unless SPONSOR_SECRET is set —`);
    console.log(`# without a sponsor the delegate pays its own transaction fees.`);
  },

  async status() {
    const o = owner().publicKey.toBase58();
    const d = delegate().publicKey.toBase58();
    const pda = await traderPda(o);
    console.log(`owner    ${o}`);
    console.log(`delegate ${d}`);
    console.log(`trader   ${pda}\n`);
    const st = await api(`/v1/view/trader/${pda}`).catch(() => null);
    if (!st) return console.log("no Phoenix trader account yet — fund it at phoenix.trade first");
    const amt = (a) => (a ? (a.value / 10 ** a.decimals).toFixed(6) : "0");
    console.log(`collateral ${amt(st.collateralBalance)} USDC   portfolio ${amt(st.portfolioValue)}`);
    console.log(`state ${st.state}   risk ${st.riskState}/${st.riskTier}   positions ${st.positions.length}`);
    for (const p of st.positions)
      console.log(`   ${p.symbol ?? "?"} ${p.basePositionUnits ?? p.basePositionLots} @ ${p.entryPriceUsd ?? "?"}`);
    const conn = new web3.Connection(RPC, "confirmed");
    for (const [n, k] of [["owner", o], ["delegate", d]]) {
      const sol = (await conn.getBalance(new web3.PublicKey(k))) / 1e9;
      console.log(`${n} SOL: ${sol.toFixed(6)}${sol === 0 && n === "delegate" ? "  (needs SOL unless a sponsor pays)" : ""}`);
    }
  },

  /** One owner signature. After this the owner key is not needed to trade. */
  async register() {
    const rise = loadRise();
    const ow = owner(), de = delegate(), sp = sponsor();
    const pda = await traderPda(ow.publicKey.toBase58());
    const built = rise.buildDelegateTraderIx({
      traderWallet: ow.publicKey.toBase58(),
      traderAccount: pda,
      newPositionAuthority: de.publicKey.toBase58(),
    });
    // SDK instructions use a role bitfield; convert to web3.js booleans.
    const list = (Array.isArray(built) ? built : [built]).map((x) => ({
      programId: String(x.programAddress),
      data: Array.from(x.data),
      keys: x.accounts.map((a) => ({
        pubkey: String(a.address),
        isSigner: a.role === 2 || a.role === 3,
        isWritable: a.role === 1 || a.role === 3,
      })),
    }));
    // The owner AUTHORISES the delegation, but it need not PAY for it. Owner
    // wallets here are typically empty — all value sits inside the Phoenix
    // trader account — so making the owner the fee payer fails at simulation
    // with no SOL. The sponsor pays when configured; otherwise the delegate
    // does, since it has to hold SOL for trading anyway. Either way the owner
    // signs (it must, to delegate) but does not fund.
    const payer = (sp ?? de).publicKey.toBase58();
    const conn = new web3.Connection(RPC, "confirmed");
    if ((await conn.getBalance(new web3.PublicKey(payer))) === 0) {
      throw new Error(
        `fee payer ${payer} holds 0 SOL.\n` +
          `  Send it ~0.01 SOL (it pays for registration and, without a sponsor, for trades).`
      );
    }
    console.log(`registering ${de.publicKey.toBase58()} as position authority for ${pda}`);
    console.log(`  owner signs the delegation; ${sp ? "sponsor" : "delegate"} ${payer.slice(0, 8)}… pays the fee`);
    // Both sign: the owner to authorise, the payer to fund. They are the same
    // key only when a sponsor is absent AND the owner happens to be funded.
    const signerSet = payer === ow.publicKey.toBase58() ? [ow] : [ow, sp ?? de];
    await submit(list, signerSet, payer, "delegate registration");
  },

  async buy(symbol, qty) { return order(symbol, "buy", qty); },
  async sell(symbol, qty) { return order(symbol, "sell", qty); },

  /** Flatten by sending the opposite side for the full position size. */
  async close(symbol) {
    const ow = owner().publicKey.toBase58();
    const st = await api(`/v1/view/trader/${await traderPda(ow)}`);
    const pos = st.positions.find((p) => p.symbol === symbol);
    if (!pos) return console.log(`no open ${symbol} position`);
    const size = Number(pos.basePositionUnits ?? pos.basePositionLots);
    console.log(`closing ${symbol} ${size}`);
    return order(symbol, size > 0 ? "sell" : "buy", Math.abs(size));
  },

  async tpsl(symbol, tp, sl) {
    const ow = owner(), de = delegate(), sp = sponsor();
    const feePayer = (sp ?? de).publicKey.toBase58();
    const st = await api(`/v1/view/trader/${await traderPda(ow.publicKey.toBase58())}`);
    const pos = st.positions.find((p) => p.symbol === symbol);
    if (!pos) return console.log(`no open ${symbol} position to protect`);
    const isLong = Number(pos.basePositionUnits ?? pos.basePositionLots) > 0;
    const side = isLong ? "sell" : "buy";
    // For a long: TP above (greater), SL below (less). Inverted for a short.
    const body = {
      authority: ow.publicKey.toBase58(),
      positionAuthority: de.publicKey.toBase58(),
      feePayer,
      symbol, traderPdaIndex: 0, sizePercent: 100,
      greaterTrigger: { side, orderKind: "ioc", triggerPrice: Number(isLong ? tp : sl), executionPrice: Number(isLong ? tp : sl) * (isLong ? 0.995 : 1.005) },
      lessTrigger:    { side, orderKind: "ioc", triggerPrice: Number(isLong ? sl : tp), executionPrice: Number(isLong ? sl : tp) * (isLong ? 0.995 : 1.005) },
    };
    const ixs = await api("/v1/ix/place-position-conditional-order", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    assertDelegateSigned(signersOf(ixs), {
      delegate: de.publicKey.toBase58(), feePayer, owner: ow.publicKey.toBase58(),
    });
    console.log(`✓ signer set verified — owner signs nothing (TP ${tp} / SL ${sl}, one instruction)`);
    await submit(ixs, sp ? [sp, de] : [de], feePayer, `TP/SL on ${symbol}`);
  },
};

/**
 * USDC has 6 decimals and `transferAmount` is passed to the program RAW — the
 * API does no scaling, so `2` means 0.000002 USDC, not $2. Getting this wrong
 * silently funds the isolated account with dust and the order then fails on
 * chain with `InsufficientFunds`, which reads like "you are broke" rather than
 * "your units are wrong". Verified live 2026-09-18.
 */
const usdcRaw = (usd) => Math.round(usd * 1e6);

/**
 * How much collateral to move from the cross account into the isolated
 * subaccount that `place-isolated-market-order` trades from.
 *
 * This endpoint ALWAYS trades an isolated subaccount (`isIsolated:false` and
 * `traderSubaccountIndex:0` do not change that), and that subaccount starts
 * empty even when the cross account is funded. Without `transferAmount` there
 * is nothing to margin against.
 */
const DEFAULT_TRANSFER_USD = 2;

async function order(symbol, side, qty) {
  const ow = owner(), de = delegate(), sp = sponsor();
  const feePayer = (sp ?? de).publicKey.toBase58();
  if (!sp) {
    // Without a sponsor the delegate holds BOTH signer slots (writable payer
    // and readonly authority). That is a valid one-tap set — the owner is
    // still absent — but the delegate must hold SOL to pay.
    const conn = new web3.Connection(RPC, "confirmed");
    const sol = await conn.getBalance(de.publicKey);
    if (sol === 0) {
      throw new Error(
        `no SPONSOR_SECRET set, so the delegate pays fees — but ${de.publicKey.toBase58()} holds 0 SOL.\n` +
          `  Send it ~0.01 SOL, or set SPONSOR_SECRET to a funded key.`
      );
    }
  }
  const ixs = await api("/v1/ix/place-isolated-market-order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      authority: ow.publicKey.toBase58(),
      positionAuthority: de.publicKey.toBase58(),
      feePayer,
      symbol, side, quantity: Number(qty),
      // NOTE: the field is `pdaIndex`, not `traderPdaIndex`, on this endpoint.
      // Unknown fields are dropped silently, so the wrong name is not an error.
      pdaIndex: 0,
      transferAmount: usdcRaw(Number(process.env.TRANSFER_USD ?? DEFAULT_TRANSFER_USD)),
    }),
  });
  assertDelegateSigned(signersOf(ixs), {
    delegate: de.publicKey.toBase58(), feePayer, owner: ow.publicKey.toBase58(),
  });
  console.log(`✓ signer set verified — owner signs nothing`);
  console.log(`  ${ixs.length} instructions, ${sp ? "sponsor" : "delegate"} ${feePayer.slice(0, 8)}… pays`);
  console.log(`  moving $${process.env.TRANSFER_USD ?? DEFAULT_TRANSFER_USD} collateral cross → isolated for this position`);
  await submit(ixs, sp ? [sp, de] : [de], feePayer, `${side} ${qty} ${symbol}`);
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd || !CMD[cmd]) {
  console.log("commands: status | register | buy <sym> <qty> | sell <sym> <qty> | close <sym> | tpsl <sym> <tp> <sl>");
  process.exit(1);
}
try {
  await CMD[cmd](...args);
} catch (e) {
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
}
