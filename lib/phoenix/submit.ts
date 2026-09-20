import { ComputeBudgetProgram, Connection, PublicKey, Transaction, TransactionInstruction, type Keypair } from "@solana/web3.js";
import { FLIGHT_PROGRAM_ID, PHOENIX_PROGRAM_ID } from "./config";
import {
  assertDelegateSigned,
  signersOfRest,
  type RestInstruction,
} from "./signers";

/**
 * Turn Phoenix's REST-built instructions into a Solana transaction, and send it.
 *
 * ATOMICITY IS THE POINT. A Phoenix market order arrives as FIVE instructions
 * (realloc_trader · sync_parent_to_child · place_market_order · two collateral
 * sweeps). They belong in ONE transaction: splitting them would let the order
 * land while a collateral sweep failed, leaving the account in a state no part
 * of the app models. So they are added in the order the API returned them and
 * never reordered.
 *
 * WHAT THIS FILE WILL NOT DO. It refuses to build a transaction whose signer
 * set is wrong (see `signers.ts`): Phoenix drops unknown request fields
 * silently, so a mis-spelled `positionAuthority` yields an OWNER-signed order
 * with a 200 and no warning. Asserting here means a wiring mistake fails before
 * a wallet is ever prompted, rather than after.
 */

/**
 * Programs a trading instruction may legitimately target.
 *
 * Flight is the builder-fee proxy: with builder fees enabled, both orders and
 * TP/SL come back targeting it rather than Phoenix directly
 * (see `FLIGHT_PROGRAM_ID`). Anything else is refused — signing an instruction
 * for an unrecognised program would be signing something we have not reasoned
 * about.
 */
/**
 * Compute-unit budget for a Phoenix order.
 *
 * Solana's DEFAULT IS 200,000 CU and Phoenix orders sit right on that line —
 * measured 150k–200k for the same order across runs, because cost scales with
 * how much of the book the fill walks. With builder fees on, the Flight wrap
 * adds a CPI layer and pushes it over: the transaction dies with
 * *"exceeded CUs meter at BPF instruction"* / *"Program failed to complete"*.
 *
 * That variance is why it looked intermittent rather than broken.
 *
 * 400,000 is roughly double the observed ceiling. Raising the limit is close to
 * free: the fee is charged on units CONSUMED, not units requested, so an
 * unused headroom costs nothing. The cap per instruction is 1.4M.
 */
const ORDER_COMPUTE_UNITS = 400_000;

const ALLOWED_TRADING_PROGRAMS = new Set([
  PHOENIX_PROGRAM_ID,
  FLIGHT_PROGRAM_ID,
]);

/** Convert a REST instruction into web3.js form, verifying its program. */
function toWeb3(ix: RestInstruction): TransactionInstruction {
  if (!ALLOWED_TRADING_PROGRAMS.has(ix.programId)) {
    throw new Error(
      `Refusing to build: instruction targets ${ix.programId}: not Phoenix ` +
        `(${PHOENIX_PROGRAM_ID}) or Flight (${FLIGHT_PROGRAM_ID})`
    );
  }
  return new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.keys.map((k) => ({
      pubkey: new PublicKey(k.pubkey),
      isSigner: k.isSigner,
      isWritable: k.isWritable,
    })),
    data: Buffer.from(ix.data),
  });
}

export interface BuildTxParams {
  instructions: RestInstruction[];
  /** Pays fees and rent — Tradash's sponsor, so the user needs no SOL. */
  feePayer: string;
  /** Session key authorising the trade. */
  delegate: string;
  /** Owner wallet, asserted ABSENT from the signer set. */
  owner: string;
  rpcUrl: string;
}

/**
 * Assemble an unsigned transaction from built instructions.
 *
 * Throws if the signer set is not {sponsor pays, delegate authorises, owner
 * absent} — the one-tap invariant.
 */
export async function buildTransaction({
  instructions,
  feePayer,
  delegate,
  owner,
  rpcUrl,
}: BuildTxParams): Promise<{ tx: Transaction; connection: Connection }> {
  if (instructions.length === 0) {
    throw new Error("Refusing to build a transaction with no instructions");
  }

  assertDelegateSigned(signersOfRest(instructions), {
    delegate,
    feePayer,
    owner,
  });

  const connection = new Connection(rpcUrl, "confirmed");
  const tx = new Transaction();
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: ORDER_COMPUTE_UNITS })
  );
  for (const ix of instructions) tx.add(toWeb3(ix));
  tx.feePayer = new PublicKey(feePayer);
  tx.recentBlockhash = (
    await connection.getLatestBlockhash("confirmed")
  ).blockhash;
  return { tx, connection };
}

/**
 * Dry-run a transaction without broadcasting.
 *
 * Solana simulates against current chain state, so this catches a bad account
 * list, a failing program assertion or insufficient collateral — everything a
 * real send would hit except the send itself. Run it before the first live
 * order on any new code path; it costs nothing and risks nothing.
 */
export async function simulate(
  tx: Transaction,
  connection: Connection
): Promise<{ ok: boolean; logs: string[]; error?: string }> {
  const sim = await connection.simulateTransaction(tx);
  const logs = sim.value.logs ?? [];
  if (sim.value.err) {
    return { ok: false, logs, error: JSON.stringify(sim.value.err) };
  }
  return { ok: true, logs };
}

/**
 * Sign with local keypairs and broadcast.
 *
 * THIS MOVES REAL MONEY. Phoenix perps are mainnet-only — there is no devnet to
 * rehearse on — so every successful call here is a live trade.
 *
 * Intended for the CLI test path, where the delegate and sponsor keys are held
 * locally. In the app the delegate signs in the browser and the sponsor
 * partial-signs on the backend (mirroring `feePayerService`), so this is not
 * the production submit path.
 */
export async function signAndSend(
  tx: Transaction,
  connection: Connection,
  signers: Keypair[]
): Promise<string> {
  tx.sign(...signers);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    // The signer set is asserted at build time, so a simulation failure here
    // would be about chain state, not our construction — and preflight gives a
    // clearer error than a dropped transaction.
    skipPreflight: false,
  });
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}
