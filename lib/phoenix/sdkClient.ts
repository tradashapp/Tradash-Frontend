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
 * ## Why the RPC fallback is OFF rather than merely deprioritised
 *
 * The obvious middle ground — prefer the API, fall back to RPC — was tried and
 * MEASURED, and it does not work. With the API source forced to fail:
 *
 *     fallback engaged → 87 RPC calls, 85 concurrent → still threw
 *                        `RPC getAccountInfo failed with 429`
 *
 * The fallback cannot rescue a transfer on a rate-limited endpoint; it burns
 * ~2.5 extra seconds and replaces a clear "the API is unreachable" with the
 * confusing 429 that started this whole investigation. A fallback that fails
 * whenever it is needed is not redundancy.
 *
 * So it stays disabled, and an API outage is reported honestly instead
 * (`describeClientError` below). Tradash already reads markets over REST
 * elsewhere (`client.ts`, `marketStats.ts`, `liquidation.ts`), so the on-chain
 * scan is not load-bearing for anything else.
 *
 * ## The other two defences
 *
 * - **Cache the client.** `lib/phoenix/collateral.ts` used to build a fresh one
 *   per transfer, so every deposit — and every retry — paid a cold start.
 *   `crossOrders.ts` already cached for exactly this reason; this module is
 *   that cache, moved somewhere both can share.
 * - **Do not cache a failure.** A rejected bootstrap is evicted so the next
 *   attempt genuinely retries rather than replaying the same rejection.
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
    // Probe the metadata endpoint ourselves first.
    //
    // The SDK reports every transport failure as the same opaque
    // "Failed to fetch", which hides whether the request was blocked, timed
    // out, or refused — and that ambiguity cost real debugging time. A direct
    // fetch first means the console carries the actual cause before the SDK
    // flattens it.
    if (typeof window !== "undefined") {
      try {
        const probe = await fetch(`${PHOENIX_API}/v1/exchange/snapshot`, {
          headers: { accept: "application/json" },
        });
        if (!probe.ok) {
          console.warn(
            `[phoenix] metadata endpoint returned HTTP ${probe.status}`
          );
        }
      } catch (probeErr) {
        console.warn(
          "[phoenix] metadata endpoint unreachable from the browser:",
          probeErr,
          `\n  url: ${PHOENIX_API}/v1/exchange/snapshot` +
            "\n  run `localStorage.setItem(\"phoenix.debug\", \"1\")` and reload " +
            "for the SDK's own trace."
        );
      }
    }
    const client = rise.createPhoenixClient({
      apiUrl: PHOENIX_API,
      rpcUrl,
      // See the note above — measured, not assumed.
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

/**
 * Turn an SDK bootstrap failure into something a user can act on.
 *
 * The SDK reports a browser network failure as
 * `Failed to connect to the Phoenix HTTP API (GET .../v1/exchange/snapshot):
 * Failed to fetch`, which reads like an app bug. "Failed to fetch" is what a
 * browser says when the request never completed — offline, DNS, a blocked
 * connection, an extension or ad blocker, or the venue being unreachable — and
 * none of those are fixed by retrying the deposit.
 *
 * Returns null for anything unrecognised, so the original message survives
 * rather than being flattened into a generic one.
 */
export function describeClientError(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (!msg) return null;

  // CSP first: a blocked connection reports as a bare "Failed to fetch" with
  // the real reason only in the console, which is precisely how this was
  // misdiagnosed as a network and rate-limit problem for hours. Chrome appends
  // the CSP text to the TypeError message, so when it is there, say so.
  if (msg.includes("Content Security Policy") || msg.includes("Refused to connect")) {
    return (
      "Blocked by this app's Content Security Policy — perp-api.phoenix.trade " +
      "is not in `connect-src` (see next.config.mjs). Restart the dev server " +
      "after changing it."
    );
  }
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
    // Does NOT name a single cause. The browser gives no distinguishing detail
    // here, and guessing sends people to check things that are fine. The
    // console warning from `getPhoenixClient` carries the real one.
    return (
      "Could not reach Phoenix (perp-api.phoenix.trade). The request did not " +
      "complete — check the browser console, including for a Content Security " +
      "Policy violation."
    );
  }
  if (msg.includes("429")) {
    return (
      "Phoenix is rate limiting this connection. Wait a few seconds and try " +
      "again."
    );
  }
  if (msg.includes("aborted") || msg.includes("timeout")) {
    return "Phoenix took too long to respond. Try again in a moment.";
  }
  return null;
}
