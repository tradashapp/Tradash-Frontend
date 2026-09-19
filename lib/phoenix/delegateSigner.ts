import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

/**
 * The delegate (session key) that signs Phoenix orders in the browser.
 *
 * DIRECT ANALOGUE OF THE BULK AGENT KEY. Tradash already stores a base58 agent
 * secret in localStorage (`lib/bulk/agentStore.ts`) so a trade needs no wallet
 * prompt. Phoenix's `positionAuthority` is the same idea with the same
 * security boundary: it can open, close and protect positions, but it CANNOT
 * withdraw, deposit, or appoint another delegate — those instructions have no
 * `positionAuthority` field at all.
 *
 * So the same secret can serve both venues. The difference is what it signs:
 * Bulk signs an off-chain payload through a WASM keychain, Phoenix signs an
 * ordinary Solana transaction. Hence a Keypair here rather than a wrapper.
 *
 * SECURITY NOTE, inherited unchanged from the Bulk path: this is a bearer
 * secret sitting in browser storage. Moving it to encrypted server-side custody
 * with per-session retrieval is the planned hardening, and is no harder for
 * Phoenix than for Bulk.
 */
export interface DelegateSigner {
  /** Delegate public key — the `positionAuthority` on every order. */
  pubkey: string;
  /** Owner wallet the delegate trades for. Must never sign an order. */
  account: string;
  /** The signing keypair. */
  keypair: Keypair;
}

/**
 * Build a delegate signer from a stored base58 secret.
 *
 * Throws on a malformed secret rather than returning null: a broken key means
 * one-tap is silently dead, and a caller that treats that as "not set up yet"
 * would loop the user through setup forever.
 */
export function makeDelegateSigner(
  secretBase58: string,
  ownerAccount: string
): DelegateSigner {
  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecretKey(bs58.decode(secretBase58));
  } catch (e) {
    throw new Error(
      `Stored delegate key is not a valid base58 Solana secret: ${
        e instanceof Error ? e.message : "unknown error"
      }`
    );
  }
  return {
    pubkey: keypair.publicKey.toBase58(),
    account: ownerAccount,
    keypair,
  };
}
