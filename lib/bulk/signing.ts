import { ensureKeychain } from "./keychain";
import type { Keychain } from "./keychain";
import { nonceNs, signatureDomain } from "@/lib/config";
import { lotSizeForBulkSymbol } from "@/lib/markets";
import { floorToLot } from "./orders";

// One-tap trade signing with the agent session key. The agent signs orders on
// behalf of the MASTER account (agent-wallet flow): we `prepareOrder` with
// { account: master, signer: agent }, then the agent signs the prepared bytes
// via `signPrepared`. The WASM handles wincode encoding + the envelope.

export interface AgentSigner {
  /** Agent (session key) pubkey. */
  pubkey: string;
  /** Master account the agent trades for. */
  account: string;
  /**
   * Prepare a verbose order for the master account, sign it with the agent, and
   * return the finalized envelope ready to POST. Runs in the browser (the WASM
   * prepare* path needs the browser environment).
   */
  signOrderFor(order: unknown): unknown;
  /**
   * Sign an already-prepared message (built with `{ account: master, signer:
   * agent }`) and return the finalized envelope. Used by non-order actions the
   * agent may sign for the master — currently per-market leverage
   * (`prepareUpdateUserSettings`, see lib/bulk/leverage.ts).
   */
  signPrepared(prepared: unknown): unknown;
}

/**
 * Snap `order.size` to the market's lot, in place, when it isn't already.
 *
 * Mutates rather than throwing: a protective stop whose size is a few
 * fixed-point units off is still a stop the user needs resting, and refusing to
 * sign it would leave a position unprotected over a rounding error. Flooring
 * can only ever ask to close slightly LESS than the position holds, which is
 * safe; rounding up could flip a reduce-only order into opening the other side.
 *
 * A sub-lot size is left untouched — callers that care (`openMarket`) reject it
 * with a specific message, and `isDustSize` already describes the unclosable
 * case for the rest.
 */
function assertLotAligned(order: unknown): void {
  if (!order || typeof order !== "object") return;
  const o = order as { symbol?: unknown; size?: unknown };
  if (typeof o.symbol !== "string" || typeof o.size !== "number") return;
  const aligned = floorToLot(o.size, lotSizeForBulkSymbol(o.symbol));
  if (aligned > 0 && aligned !== o.size) {
    console.warn(
      `[bulk] size ${o.size} on ${o.symbol} is not a whole number of lots; ` +
        `signing ${aligned} instead (an unaligned size is rejected as "bad signature").`
    );
    (order as { size: number }).size = aligned;
  }
}

/** Build an agent signer bound to the master account it trades for. */
export async function makeAgentSigner(
  agentSecretBase58: string,
  masterAccount: string
): Promise<AgentSigner> {
  const kc: typeof Keychain = await ensureKeychain();
  // Since keychain 0.1.21+ the signer is bound to a network at construction:
  // `fromBase58` takes the signature domain as a required 2nd argument.
  const signer = kc.WasmSigner.fromBase58(agentSecretBase58, signatureDomain());
  return {
    pubkey: signer.pubkey,
    account: masterAccount,
    signOrderFor(order: unknown) {
      // LAST LINE OF DEFENCE for lot alignment.
      //
      // Sizes enter the signed preimage as fixed-point integers. A size that is
      // not a whole number of the market's lots gets re-quantised server-side,
      // the server rebuilds the preimage from the snapped value, and the
      // signature no longer matches — surfacing as `bad signature`, an error
      // that names neither the size nor the rounding.
      //
      // `openMarket` floors deliberately (and reports a sub-lot size as an
      // error rather than silently sending 0). This catches everything else —
      // protective triggers sized from a position, and any path added later —
      // because the cost of forgetting is a failure nobody can diagnose from
      // the message. Cancels and other size-less actions pass through untouched.
      assertLotAligned(order);
      // account = master (whose position), signer = agent (who signs).
      // Pass an explicit nonce — without it the WASM calls SystemTime::now()
      // which panics ("time not implemented") in the browser. It must be a
      // nanosecond string (see `nonceNs`); a ms nonce is rejected as `expired`.
      // `signatureDomain` binds the signature to this network (Bulk v1.0.17);
      // omitting it signs the old preimage → Bulk rejects with `bad signature`.
      const prepared = kc.prepareOrder(order, {
        account: masterAccount,
        signer: signer.pubkey,
        nonce: nonceNs(),
        signatureDomain: signatureDomain(),
      });
      return signer.signPrepared(prepared);
    },
    signPrepared(prepared: unknown) {
      // The caller built `prepared` with account = master, signer = this agent.
      return signer.signPrepared(prepared as Parameters<typeof signer.signPrepared>[0]);
    },
  };
}

/** Generate a fresh agent keypair (base58 secret + pubkey). Stored client-side. */
export async function generateAgentKeypair(): Promise<{
  secretBase58: string;
  pubkey: string;
}> {
  const kc = await ensureKeychain();
  const kp = new kc.WasmKeypair();
  return { secretBase58: kp.toBase58(), pubkey: kp.pubkey };
}
