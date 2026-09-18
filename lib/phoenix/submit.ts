import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type Keypair,
} from "@solana/web3.js";
import { PHOENIX_PROGRAM_ID } from "./config";
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

/** Convert a REST instruction into web3.js form, verifying it is Phoenix's. */
function toWeb3(ix: RestInstruction): TransactionInstruction {
  // A programId that is not Phoenix means the response was not what we think
  // it was; signing it would be signing an unknown program.
  if (ix.programId !== PHOENIX_PROGRAM_ID) {
    throw new Error(
      `Refusing to build: instruction targets ${ix.programId}, not Phoenix (${PHOENIX_PROGRAM_ID})`
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
