import { Connection, PublicKey } from "@solana/web3.js";
import { solanaRpcUrl, usdcMint } from "@/lib/config";

// Read the user's OWN USDC balance from their Privy wallet on the Solana BASE
// layer (token accounts live on the base layer, not the MagicBlock ER). This is
// the "wallet" side of the two-balance model: wallet USDC vs Bulk trading
// collateral. Deposits move wallet → Bulk; withdrawals move Bulk → wallet.

// Base-layer RPC for account reads. Resolved lazily (not at module load) so the
// mainnet "no RPC configured" error surfaces at the call site, where the caller
// can show it, rather than as an import-time crash. `solanaRpcUrl()` throws on
// mainnet when unset — never silently fall back to devnet here, or the mainnet
// USDC mint resolves against devnet and every balance reads as $0.
let connection: Connection | null = null;
function getConnection(): Connection {
  if (!connection) connection = new Connection(solanaRpcUrl(), "confirmed");
  return connection;
}

/**
 * The USDC balance (in whole USDC, e.g. 12.5) held by `owner`'s wallet. Sums all
 * of the owner's token accounts for the active-network USDC mint (usually one).
 * Returns 0 if there is no token account, and throws only on an RPC failure the
 * caller should surface. `owner` is a base58 Solana address.
 */
export async function readUsdcBalance(owner: string): Promise<number> {
  const conn = getConnection();
  const mint = new PublicKey(usdcMint());
  const res = await conn.getParsedTokenAccountsByOwner(new PublicKey(owner), {
    mint,
  });
  let total = 0;
  for (const { account } of res.value) {
    // getParsedTokenAccountsByOwner already scales by decimals into uiAmount.
    const amt =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (account.data as any)?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
    total += amt;
  }
  return total;
}
