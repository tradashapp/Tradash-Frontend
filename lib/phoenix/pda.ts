/**
 * Trader PDA derivation.
 *
 * `/v1/view/trader/{X}` takes the trader PDA, NOT the wallet — passing a wallet
 * returns `404 "Trader not found"`, which reads like "no account" but only means
 * "wrong key type". So every account read needs this first.
 *
 * Derivation is SDK-only: there is no REST route for it, and the seeds are not
 * documented. The import is dynamic to keep the SDK out of the initial bundle.
 *
 * Results are cached per (authority, pdaIndex, subaccountIndex): the derivation
 * is deterministic, and it is on the path of every account refresh.
 */

const cache = new Map<string, string>();

/**
 * The trader PDA for an authority's subaccount.
 *
 * `subaccountIndex` 0 is the CROSS account, which is the only one Tradash
 * trades. Any other index is an isolated subaccount with its own collateral.
 */
export async function deriveTraderPda(
  authority: string,
  pdaIndex = 0,
  subaccountIndex = 0
): Promise<string> {
  const key = `${authority}:${pdaIndex}:${subaccountIndex}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const rise = await import("@ellipsis-labs/rise");
  const addrs = await rise.deriveTraderAddresses(
    authority as Parameters<typeof rise.deriveTraderAddresses>[0],
    pdaIndex,
    subaccountIndex
  );
  // `deriveTraderAddresses` returns lazy THUNKS, not addresses — calling the
  // object's fields directly yields function source, not a pubkey.
  const pda = String(await addrs.traderAccount());

  cache.set(key, pda);
  return pda;
}
