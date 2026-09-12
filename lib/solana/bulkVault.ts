import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { config, solanaRpcUrl, usdcMint } from "@/lib/config";

/**
 * Deposits into (and withdrawal intents against) Bulk's on-chain vault program.
 *
 * This is the rail that actually moves a user's USDC into their Bulk trading
 * collateral, and it is NOT a signed Bulk API action. Bulk's REST `transfer`
 * action moves margin BETWEEN EXISTING BULK ACCOUNTS -- passing the same pubkey
 * as both ends (which is what a naive "deposit to myself" looks like) is
 * rejected with `transferFailed: "transfer source and destination must differ"`.
 * Money ENTERS the protocol by an on-chain instruction to the vault program,
 * signed by the user's wallet. That asymmetry is also why the keychain WASM has
 * no deposit function while it does have `prepareWithdraw`: Bulk must authorize
 * funds LEAVING its vault, but anyone may send funds in.
 *
 * Layout below is ported from Bulk's own client SDK
 * (github.com/Bulk-trade/bulk-client, crates/api-rust/src/solana/{pda,ix}.rs).
 * Verified against mainnet: the program is deployed and executable, and the
 * derived vault ATA is the live one holding the exchange's USDC.
 */

/** Bulk's Solana vault program. */
const PROGRAM_ID = new PublicKey("BULK2CNYn3mbgfYXEXiBBFxmmDChznpjQ4oRfce8w6R4");

/**
 * Vault PDA seed: ASCII "vault" padded to 8 bytes with NULs.
 *
 * The padding is load-bearing -- `b"vault\0\0\0"` in the SDK, not `b"vault"`.
 * A bare "vault" seed derives a DIFFERENT address, and depositing to it would
 * send real USDC to an address nothing controls.
 */
const VAULT_SEED = new Uint8Array([0x76, 0x61, 0x75, 0x6c, 0x74, 0, 0, 0]);
const VAULT_ATA_SEED = new TextEncoder().encode("vault_ata");

/** Instruction discriminators (first byte of the data blob). */
const IX_DEPOSIT = 2;
const IX_REQUEST_WITHDRAW = 4;

/** USDC has 6 decimals; amounts on the wire are base units. */
const USDC_DECIMALS = 6;

/** The vault PDA for a mint: seeds [VAULT_SEED, mint]. */
export function vaultPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, mint.toBuffer()],
    PROGRAM_ID
  )[0];
}

/** The vault's token account for a mint: seeds ["vault_ata", mint]. */
export function vaultTokenAccount(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [VAULT_ATA_SEED, mint.toBuffer()],
    PROGRAM_ID
  )[0];
}

/**
 * Encode a u8 opcode followed by a little-endian u64 amount.
 *
 * Written against DataView / Uint8Array rather than Node's Buffer. In the
 * browser `Buffer` is a bundler polyfill, and the one Next ships does NOT
 * implement `writeBigUInt64LE` — calling it threw
 * "data.writeBigUInt64LE is not a function" at deposit time, which is a
 * runtime-only failure that typechecks perfectly (the @types/node signature
 * exists even though the shipped polyfill lacks the method).
 *
 * `setBigUint64` is native in every browser that supports BigInt, and
 * TransactionInstruction takes a Uint8Array, so nothing here needs a polyfill.
 */
function ixData(opcode: number, baseUnits: bigint): Buffer {
  const data = new Uint8Array(9);
  data[0] = opcode;
  // littleEndian: true — the program reads the amount as LE u64.
  new DataView(data.buffer).setBigUint64(1, baseUnits, true);
  // web3.js types `TransactionInstruction.data` as Buffer, but Buffer IS a
  // Uint8Array subclass and the runtime only ever reads it as bytes (verified:
  // a plain Uint8Array serializes to the SDK's exact instruction bytes). The
  // cast keeps the value polyfill-free while satisfying that stale signature.
  return data as Buffer;
}

/** Whole USDC (12.5) -> base units (12_500_000), rounded to the mint's decimals. */
function toBaseUnits(amount: number): bigint {
  return BigInt(Math.round(amount * 10 ** USDC_DECIMALS));
}

/**
 * The deposit instruction: transfers `amount` USDC from the user's token
 * account into the vault's.
 *
 * Account order is fixed by the program:
 *   [payer(signer,w), userTokenAccount(w), vault, mint, vaultTokenAccount(w), tokenProgram]
 */
export function depositInstruction(
  owner: PublicKey,
  mint: PublicKey,
  amount: number
): TransactionInstruction {
  const userTokenAccount = getAssociatedTokenAddressSync(mint, owner);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: vaultPda(mint), isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: vaultTokenAccount(mint), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: ixData(IX_DEPOSIT, toBaseUnits(amount)),
  });
}

/**
 * The withdrawal-intent instruction. A SIGNAL ONLY -- it moves no tokens; Bulk
 * observes it and pays out from the vault separately. Note the account list is
 * five entries (no token program) and the user's token account is read-only.
 */
export function withdrawIntentInstruction(
  owner: PublicKey,
  mint: PublicKey,
  amount: number
): TransactionInstruction {
  const userTokenAccount = getAssociatedTokenAddressSync(mint, owner);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: false },
      { pubkey: vaultPda(mint), isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: vaultTokenAccount(mint), isSigner: false, isWritable: false },
    ],
    data: ixData(IX_REQUEST_WITHDRAW, toBaseUnits(amount)),
  });
}

/** Does `owner` have a USDC token account yet? */
export async function hasUsdcAccount(
  conn: Connection,
  owner: PublicKey,
  mint: PublicKey
): Promise<boolean> {
  const ata = getAssociatedTokenAddressSync(mint, owner);
  return (await conn.getAccountInfo(ata)) !== null;
}

/**
 * Build the deposit transaction, ready for the wallet to sign and send.
 *
 * Returns the transaction rather than sending it, because sending belongs to
 * the Privy hook in React-land. The blockhash is fetched here so the caller
 * doesn't have to know it is required.
 */
export async function buildDepositTx(
  owner: PublicKey,
  amount: number
): Promise<{ tx: Transaction; connection: Connection }> {
  if (config.bulk.network !== "mainnet") {
    throw new Error("Vault deposits are mainnet-only (testnet uses the faucet).");
  }
  const connection = new Connection(solanaRpcUrl(), "confirmed");
  const mint = new PublicKey(usdcMint());

  // A user with no USDC token account has no USDC to deposit. Caught here so
  // the message says that, rather than the program failing on a missing account.
  if (!(await hasUsdcAccount(connection, owner, mint))) {
    throw new Error("No USDC in this wallet yet — fund it first.");
  }

  const tx = new Transaction().add(depositInstruction(owner, mint, amount));
  tx.feePayer = owner;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  return { tx, connection };
}

/** Build the withdrawal-intent transaction. See `withdrawIntentInstruction`. */
export async function buildWithdrawIntentTx(
  owner: PublicKey,
  amount: number
): Promise<{ tx: Transaction; connection: Connection }> {
  if (config.bulk.network !== "mainnet") {
    throw new Error("Vault withdrawals are mainnet-only.");
  }
  const connection = new Connection(solanaRpcUrl(), "confirmed");
  const mint = new PublicKey(usdcMint());
  const tx = new Transaction().add(
    withdrawIntentInstruction(owner, mint, amount)
  );
  tx.feePayer = owner;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  return { tx, connection };
}

export { PROGRAM_ID as BULK_VAULT_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID };
