import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { PHOENIX_PROGRAM_ID } from "./config";
import { deriveTraderPda } from "./pda";

/**
 * Phoenix onboarding: register a delegate so the app can trade one-tap.
 *
 * ONE OWNER SIGNATURE, ONCE — and then never again. Compare Bulk, which needed
 * three master signatures (faucet claim, agent-wallet authorisation, builder-code
 * approval). Phoenix needs only `DelegateTrader`, because builder fees attach
 * per request rather than via an account-level approval, so that whole handshake
 * disappears.
 *
 * SDK-ONLY. This is the one flow with no REST route — grepping the SDK bundle
 * for `/v1/*delegat*` returns nothing. The import is dynamic so the SDK stays
 * out of the initial bundle; onboarding happens once, so the load cost is paid
 * at the moment the user opted into it.
 *
 * WHAT THE DELEGATE CAN DO, once registered: place and cancel orders and
 * conditional orders. What it CANNOT do: deposit, withdraw, or appoint another
 * delegate — those instructions have no `positionAuthority` field at all. Same
 * boundary as the Bulk agent key.
 */

/** Signs a transaction with the owner's wallet (Privy `useSignTransaction`). */
export type OwnerSignTransaction = (args: {
  transaction: Transaction;
  connection: Connection;
}) => Promise<Transaction>;

export interface RegisterDelegateParams {
  /** Owner wallet — authorises the delegation and is the only signer. */
  owner: string;
  /** The session key to appoint as `positionAuthority`. */
  delegate: string;
  /**
   * Who pays the fee. Defaults to the owner.
   *
   * Owner wallets are often EMPTY here — the value sits inside the Phoenix
   * trader account, not the wallet — so a fee payer with no SOL fails at
   * simulation with a confusing `AccountNotFound`. Pass the sponsor when one is
   * funded; the owner still signs either way, because only the owner can
   * delegate.
   */
  feePayer?: string;
  rpcUrl: string;
  signTransaction: OwnerSignTransaction;
}

/**
 * Build, sign and send the delegate registration.
 *
 * Returns the transaction signature. Throws with the venue's own message if
 * simulation or submission fails.
 */
export async function registerDelegate({
  owner,
  delegate,
  feePayer,
  rpcUrl,
  signTransaction,
}: RegisterDelegateParams): Promise<string> {
  const rise = await import("@ellipsis-labs/rise");
  const traderAccount = await deriveTraderPda(owner);

  const built = rise.buildDelegateTraderIx({
    traderWallet: owner as Parameters<typeof rise.buildDelegateTraderIx>[0]["traderWallet"],
    traderAccount: traderAccount as Parameters<typeof rise.buildDelegateTraderIx>[0]["traderAccount"],
    newPositionAuthority: delegate as Parameters<typeof rise.buildDelegateTraderIx>[0]["newPositionAuthority"],
  });
  const list = Array.isArray(built) ? built : [built];

  const connection = new Connection(rpcUrl, "confirmed");
  const tx = new Transaction();
  for (const ix of list) {
    const programAddress = String(ix.programAddress);
    // Signing an instruction for an unexpected program would be signing
    // something we have not reasoned about.
    if (programAddress !== PHOENIX_PROGRAM_ID) {
      throw new Error(
        `Refusing to register: instruction targets ${programAddress}, not Phoenix`
      );
    }
    tx.add(
      new TransactionInstruction({
        programId: new PublicKey(programAddress),
        // SDK instructions use a role bitfield: 2 = readonly signer,
        // 3 = writable signer, 1 = writable.
        keys: (ix.accounts as { address: string; role: number }[]).map((a) => ({
          pubkey: new PublicKey(String(a.address)),
          isSigner: a.role === 2 || a.role === 3,
          isWritable: a.role === 1 || a.role === 3,
        })),
        data: Buffer.from(ix.data),
      })
    );
  }

  tx.feePayer = new PublicKey(feePayer ?? owner);
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

  // Simulate before asking the user to sign: a failure here is our bug or an
  // unfunded fee payer, and either is better surfaced before a wallet prompt.
  const sim = await connection.simulateTransaction(tx);
  if (sim.value.err) {
    throw new Error(
      `Delegate registration would fail: ${JSON.stringify(sim.value.err)}` +
        (feePayer ? "" : " — the owner wallet may hold no SOL for fees")
    );
  }

  const signed = await signTransaction({ transaction: tx, connection });
  const sig = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}
