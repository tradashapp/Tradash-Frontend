import { ensureKeychain } from "./keychain";
import { submitSigned } from "./client";
import { nonceNs, signatureDomain } from "@/lib/config";
import type { AgentSigner } from "./signing";
import type { OrderResponse } from "./types";

// Per-market leverage on the Bulk account.
//
// Leverage is NOT part of an order — Bulk stores it per symbol on the account
// (`fullAccount.leverageSettings[]`) and applies it to every fill in that
// market. So it must be pushed with its own `updateUserSettings` action BEFORE
// the order, otherwise Bulk margins the fill at whatever leverage the account
// last had, no matter what size we computed locally.
//
// The keychain exposes it as `prepareUpdateUserSettings(settings, options)`
// with settings shaped `{ max_leverage: [[symbol, leverage], ...] }`. Because
// `prepare*` accepts a `signer` distinct from `account`, the AGENT session key
// can sign this on the master's behalf — same path as orders, so changing
// leverage costs the user no wallet popup.

/**
 * Push per-market leverage to Bulk, signed by the agent session key.
 * `entries` are `[bulkSymbol, leverage]` pairs, e.g. `[["BTC-USD", 20]]`.
 */
export async function setLeverage(
  signer: AgentSigner,
  entries: [string, number][]
): Promise<OrderResponse> {
  const kc = await ensureKeychain();
  const prepared = kc.prepareUpdateUserSettings(
    { max_leverage: entries.map(([symbol, lev]) => [symbol, Math.round(lev)]) },
    {
      // account = master (whose settings), signer = agent (who signs). Nonce
      // must be an explicit nanosecond string — without one the WASM calls
      // SystemTime::now() and panics in the browser; a ms nonce is rejected as
      // `expired`. signatureDomain binds the signature to this network.
      account: signer.account,
      signer: signer.pubkey,
      nonce: nonceNs(),
      signatureDomain: signatureDomain(),
    }
  );
  return submitSigned(signer.signPrepared(prepared));
}

/** Convenience: set leverage for a single market. */
export function setMarketLeverage(
  signer: AgentSigner,
  bulkSymbol: string,
  leverage: number
): Promise<OrderResponse> {
  return setLeverage(signer, [[bulkSymbol, leverage]]);
}
