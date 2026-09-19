import { makeAgentSigner } from "@/lib/bulk/signing";
import { makeDelegateSigner } from "@/lib/phoenix/delegateSigner";
import type { ExecutionVenue, VenueSigner } from "./types";

/**
 * Build the session signer the active venue needs, from ONE stored secret.
 *
 * Both venues delegate trading to a session key held in the browser
 * (`lib/bulk/agentStore.ts`), and both give it the same security boundary: it
 * can open, close and protect positions but cannot move funds. What differs is
 * what it signs —
 *
 *   Bulk    signs an off-chain payload through the WASM keychain
 *   Phoenix signs an ordinary Solana transaction
 *
 * — so the same base58 secret yields two different signer objects. That is why
 * `venue` alone was not enough to flip: `useAgentWallet` builds a Bulk signer
 * unconditionally, and handing that to `PhoenixVenue` fails at the adapter
 * boundary (by design — `asDelegate` refuses it rather than misbehaving).
 *
 * Routing signer construction through the venue keeps the one-secret model and
 * makes the flag actually switchable.
 *
 * NOT MERGED INTO `useAgentWallet` YET, on purpose: that hook also verifies the
 * stored key against Bulk's `authorizedAgentWallets`, and Phoenix's equivalent
 * check reads the delegate off the on-chain trader account — a different call
 * with a different failure mode. Porting that verification is its own step;
 * until then this factory is the seam, and the Bulk path is untouched.
 */
export async function makeVenueSigner(
  v: ExecutionVenue,
  secretBase58: string,
  ownerAccount: string
): Promise<VenueSigner> {
  if (v.id === "phoenix") {
    // Synchronous, but the signature stays async so callers do not branch.
    return makeDelegateSigner(secretBase58, ownerAccount);
  }
  return makeAgentSigner(secretBase58, ownerAccount);
}
