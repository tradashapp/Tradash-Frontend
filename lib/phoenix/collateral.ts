import { Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { api } from "@/lib/api";
import { uuid } from "@/lib/uuid";
import { PHOENIX_PROGRAM_ID } from "./config";
import { describeClientError, getPhoenixClient } from "./sdkClient";

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
   * Explicit fee payer, for callers outside the app (the CLI).
   *
   * In the app leave this unset: the backend sponsor is used automatically when
   * it is configured and healthy, so the user needs no SOL.
   */
  feePayer?: string;
  /**
   * Set false to skip backend sponsorship and have the owner pay their own fee.
   * Defaults to sponsoring, which is the Bulk-equivalent behaviour.
   */
  sponsored?: boolean;
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

  // SHARED, CACHED CLIENT — not a fresh one per transfer.
  //
  // This used to call `createPhoenixClient` + `exchange.ready()` on every
  // deposit and withdrawal. Each cold start can fan out to 85 concurrent
  // `getAccountInfo` calls if metadata falls back to the RPC source, which is
  // what produced `RPC getAccountInfo failed with 429` on wallet → trading
  // transfers, and why every retry made it worse. See `sdkClient.ts`.
  let client: { ixs: Record<string, unknown> };
  try {
    client = (await getPhoenixClient(p.rpcUrl)) as {
      ixs: Record<string, unknown>;
    };
  } catch (err) {
    // A bootstrap failure is almost always the network or the venue, not the
    // transfer. Say so plainly rather than surfacing the SDK's internal URL.
    const friendly = describeClientError(err);
    throw friendly ? new Error(friendly) : err;
  }

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
  const web3Ixs = list.map(toWeb3);

  // SPONSORED PATH — the default, and what makes Phoenix match Bulk's UX.
  //
  // The backend co-signs the fee so a user with no SOL can still move
  // collateral. It re-validates the instruction set against its allowlist
  // first, so sending it client-built bytes is safe: only `deposit_funds` and
  // `withdraw_funds` with the owner signing are accepted.
  //
  // A sponsor that is unconfigured, unfunded or unhealthy must NOT block the
  // transfer — the user can always pay their own fee — so a failure here falls
  // through to the self-paid path rather than surfacing as an error.
  if (p.sponsored !== false && !p.feePayer) {
    try {
      const prepared = await api.sponsorInstructions(
        web3Ixs.map((ix) => ({
          programId: ix.programId.toBase58(),
          data: Array.from(ix.data),
          keys: ix.keys.map((k) => ({
            pubkey: k.pubkey.toBase58(),
            isSigner: k.isSigner,
            isWritable: k.isWritable,
          })),
        }))
      );
      const sponsored = Transaction.from(
        Buffer.from(prepared.transaction, "base64")
      );
      const signed = await p.signTransaction({
        transaction: sponsored,
        connection,
      });
      // `submitTransfer` re-verifies the fee payer and instruction set server
      // side before broadcasting, so a transaction altered in between is
      // rejected there too.
      const { signature } = await api.submitTransfer(
        signed.serialize({ requireAllSignatures: false }).toString("base64"),
        p.amountUsd,
        build === "buildDepositFunds" ? "deposit" : "withdraw",
        // MUST be a UUID — the backend validates with `z.string().uuid()`.
        // A descriptive key is rejected as `ValidationError: Invalid uuid`.
        uuid()
      );
      return signature;
    } catch (e) {
      console.warn(
        `[phoenix] sponsorship unavailable, paying own fee: ${
          e instanceof Error ? e.message : "unknown"
        }`
      );
    }
  }

  const tx = new Transaction();
  for (const ix of web3Ixs) tx.add(ix);
  tx.feePayer = new PublicKey(p.feePayer ?? p.owner);
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;

  // Simulate before prompting: an insufficient balance, a missing token account
  // or a withdrawal blocked by account health all fail here, and the message is
  // far more useful before the user has signed than after.
  const sim = await connection.simulateTransaction(tx);
  if (sim.value.err) {
    const err = JSON.stringify(sim.value.err);
    // `AccountNotFound` here means the TRADER account does not exist — this
    // wallet has never used Phoenix. That is a setup gap, not a bad transfer,
    // and it is recoverable without bothering the user: registration needs no
    // owner signature (see `register.ts`). Only deposits self-heal; a
    // withdrawal from a non-existent account has nothing to withdraw.
    if (err.includes("AccountNotFound") && build === "buildDepositFunds") {
      throw new Error(
        "Your Phoenix trading account is not set up yet. Reconnect your " +
          "wallet to finish setup, then try the transfer again."
      );
    }
    throw new Error(
      `Phoenix ${build === "buildDepositFunds" ? "deposit" : "withdrawal"} would fail: ` +
        err
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
