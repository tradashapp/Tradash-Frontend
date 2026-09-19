import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { PHOENIX_PROGRAM_ID } from "./config";

/**
 * Moving collateral in and out of a Phoenix trader account.
 *
 * SIMPLER THAN THE DOCS SUGGEST. The published flow describes a three-step
 * deposit (create token account → convert USDC to the Phoenix canonical token
 * via Ember → deposit) and a five-step withdrawal. Through the SDK both are a
 * SINGLE instruction: the Ember conversion is handled inside
 * (`EmberDeposit*`), so callers do not orchestrate it. Verified live
 * 2026-09-19.
 *
 * THE OWNER SIGNS, NEVER THE DELEGATE. `buildDepositFunds` and
 * `buildWithdrawFunds` put the owner in the signer slot, and that is the whole
 * point of the delegate boundary: a session key that can trade must not be able
 * to move funds. `ClientWithdrawInput` and `ClientDepositInput` carry no
 * `positionAuthority` field at all, so this is enforced by the venue, not just
 * by us.
 *
 * Use `client.ixs.*`, never the standalone `buildDepositFlow`/`buildWithdrawFlow`
 * exports — those need a `PhoenixInstructionClient` carrying `.addresses`,
 * which neither the client nor `client.ixs` exposes, and fail on
 * `client.addresses.globalConfigurationAddress`.
 */

/** USDC has 6 decimals; the SDK takes a raw bigint, not dollars. */
const USDC_DECIMALS = 6;

/** Dollars → raw units. `2` means $2, not 0.000002. */
export function usdcToRaw(usd: number): bigint {
  return BigInt(Math.round(usd * 10 ** USDC_DECIMALS));
}

/** Signs a transaction with the owner's wallet (Privy `useSignTransaction`). */
export type OwnerSignTransaction = (args: {
  transaction: Transaction;
  connection: Connection;
}) => Promise<Transaction>;

export interface CollateralParams {
  /** Owner wallet — the only signer, and the trader PDA's authority. */
  owner: string;
  /** Amount in USD. Converted to raw units here so callers stay in dollars. */
  amountUsd: number;
  rpcUrl: string;
  signTransaction: OwnerSignTransaction;
  /**
   * Optional sponsor for the transaction fee. The owner still signs the
   * instruction; this only covers the lamports, mirroring `feePayerService`.
   */
  feePayer?: string;
}

type SdkInstruction = {
  programAddress: string;
  data: Uint8Array;
  accounts: { address: string; role: number }[];
};

/** Convert an SDK instruction (role bitfield) to web3.js form. */
function toWeb3(ix: SdkInstruction): TransactionInstruction {
  const programAddress = String(ix.programAddress);
  if (programAddress !== PHOENIX_PROGRAM_ID) {
    throw new Error(
      `Refusing collateral instruction for ${programAddress}, not Phoenix`
    );
  }
  return new TransactionInstruction({
    programId: new PublicKey(programAddress),
    // role: 1 = writable, 2 = readonly signer, 3 = writable signer.
    keys: ix.accounts.map((a) => ({
      pubkey: new PublicKey(String(a.address)),
      isSigner: a.role === 2 || a.role === 3,
      isWritable: a.role === 1 || a.role === 3,
    })),
    data: Buffer.from(ix.data),
  });
}

async function submit(
  build: "buildDepositFunds" | "buildWithdrawFunds",
  p: CollateralParams
): Promise<string> {
  if (!(p.amountUsd > 0)) throw new Error("Amount must be greater than zero");

  const rise = await import("@ellipsis-labs/rise");
  const client = rise.createPhoenixClient({
    apiUrl: process.env.NEXT_PUBLIC_PHOENIX_API_URL ?? "https://perp-api.phoenix.trade",
    rpcUrl: p.rpcUrl,
  });
  await client.exchange.ready();

  const built = await (
    client.ixs as unknown as Record<
      string,
      (a: { authority: string; amount: bigint; traderPdaIndex: number }) =>
        Promise<SdkInstruction | SdkInstruction[] | { instructions: SdkInstruction[] }>
    >
  )[build]({
    authority: p.owner,
    amount: usdcToRaw(p.amountUsd),
    // Cross-margin account. Tradash trades only subaccount 0.
    traderPdaIndex: 0,
  });

  const list: SdkInstruction[] = Array.isArray(built)
    ? built
    : "instructions" in (built as object)
      ? (built as { instructions: SdkInstruction[] }).instructions
      : [built as SdkInstruction];

  const connection = new Connection(p.rpcUrl, "confirmed");
  const tx = new Transaction();
  for (const ix of list) tx.add(toWeb3(ix));
  tx.feePayer = new PublicKey(p.feePayer ?? p.owner);
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

  // Simulate before prompting: an insufficient balance, a missing token account
  // or a withdrawal blocked by account health all fail here, and the message is
  // far more useful before the user has signed than after.
  const sim = await connection.simulateTransaction(tx);
  if (sim.value.err) {
    throw new Error(
      `Phoenix ${build === "buildDepositFunds" ? "deposit" : "withdrawal"} would fail: ` +
        JSON.stringify(sim.value.err)
    );
  }

  const signed = await p.signTransaction({ transaction: tx, connection });
  const sig = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction(sig, "confirmed");
  return sig;
}

/** Move USDC from the owner's wallet into the Phoenix trader account. */
export function depositCollateral(p: CollateralParams): Promise<string> {
  return submit("buildDepositFunds", p);
}

/**
 * Move USDC out of the trader account back to the owner's wallet.
 *
 * Subject to Phoenix's account-health checks and its protocol withdraw queue,
 * so settlement is not necessarily immediate. The queue behaviour is documented
 * but not yet execution-verified.
 */
export function withdrawCollateral(p: CollateralParams): Promise<string> {
  return submit("buildWithdrawFunds", p);
}
