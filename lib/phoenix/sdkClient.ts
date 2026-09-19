import { PHOENIX_API } from "./config";

/**
 * The Rise SDK client — created once per session and shared by every caller.
 *
 * ## Why this module exists (the 429 bug, 2026-09-20)
 *
 * `createPhoenixClient` + `exchange.ready()` loads exchange metadata. It has
 * two sources, and the difference between them is dramatic:
 *
 * | source | RPC calls | peak concurrency |
 * |--------|-----------|------------------|
 * | `api`  | **0**     | 0                |
 * | `rpc`  | **87**    | **85**           |
 *
 * The RPC source does `Promise.all` over every market (82 of them), fetching
 * accounts for each with **no batching and no concurrency cap**
 * (`exchange-cache/_metadataShared.ts`, the `perpAssetMap.metadata.entries.map`
 * block). 85 simultaneous `getAccountInfo` calls is a thundering herd that any
 * rate-limited RPC rejects — measured 50 of 87 returning 429 against a healthy
 * key that serves the rest of the app without trouble.
 *
 * That is what produced `RPC getAccountInfo failed with 429` on wallet →
 * trading transfers. It was never sustained load or a weak key: it was one
 * burst from one `exchange.ready()`.
 *
 * ## Two defences, because either alone is insufficient
 *
 * 1. **Pin metadata to the API source and disable the RPC fallback.** Tradash
 *    already reads markets over REST (`client.ts`, `marketStats.ts`,
 *    `liquidation.ts`), so the on-chain fan-out buys nothing here and can only
 *    hurt. `enabled: false` means a slow API surfaces as a slow load rather
 *    than silently degrading into 85 concurrent requests.
 * 2. **Cache the client.** `lib/phoenix/collateral.ts` used to build a fresh
 *    one per transfer, so every deposit — and every retry — paid a cold start.
 *    `crossOrders.ts` already cached for exactly this reason; this module is
 *    that cache, moved somewhere both can share.
 *
 * The import stays dynamic so the SDK is not in the initial bundle.
 */

/**
 * Keyed by RPC URL so a changed endpoint builds a new client rather than
 * silently reusing one pointed at the old host.
 */
const clients = new Map<string, Promise<unknown>>();

/**
 * The shared client for `rpcUrl`, creating it on first use.
 *
 * Awaits `exchange.ready()` before returning: market params (tick size, lot
 * decimals) are needed to turn a human size into an order packet, and without
 * this the first order races metadata loading.
 */
export async function getPhoenixClient(rpcUrl: string): Promise<unknown> {
  const hit = clients.get(rpcUrl);
  if (hit) return hit;

  const created = (async () => {
    const rise = await import("@ellipsis-labs/rise");
    const client = rise.createPhoenixClient({
      apiUrl: PHOENIX_API,
      rpcUrl,
      // See the note above — this is the whole fix for the 429.
      exchangeMetadata: {
        priority: "api",
        rpc: { enabled: false },
      },
    } as Parameters<typeof rise.createPhoenixClient>[0]);
    await client.exchange.ready();
    return client;
  })();

  // A failed bootstrap must not be cached, or every later call replays the
  // same rejected promise and the session never recovers.
  created.catch(() => clients.delete(rpcUrl));

  clients.set(rpcUrl, created);
  return created;
}

/** Test seam: drop cached clients. */
export function resetPhoenixClients(): void {
  clients.clear();
}
