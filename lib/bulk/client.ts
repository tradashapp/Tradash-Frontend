import { config } from "@/lib/config";
import type {
  AccountQuery,
  AccountResponseItem,
  BulkFullAccount,
  OrderResponse,
} from "./types";

// Thin REST client over the Bulk API. `/order` takes a fully-signed envelope
// (built by the keychain WASM); `/account` is an unsigned read.

const BASE = config.bulk.restUrl;

// The keychain WASM returns actions as JS `Map`s (and may nest Maps). JSON
// stringifies a Map as `{}`, which would send EMPTY actions to Bulk — so we
// must deep-convert Maps to plain objects before serializing. This is required
// for EVERY signed request (orders, agent-wallet, builder-code, faucet, etc.).
function demap(v: unknown): unknown {
  if (v instanceof Map) {
    const o: Record<string, unknown> = {};
    for (const [k, val] of v) o[String(k)] = demap(val);
    return o;
  }
  if (Array.isArray(v)) return v.map(demap);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v)) o[k] = demap((v as Record<string, unknown>)[k]);
    return o;
  }
  return v;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  // Order acks can be slow (we've seen the gateway 504 while the order still
  // filled). Give it a long timeout; callers should reconcile via the account
  // WS / a follow-up /account read rather than trusting a timeout as failure.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(demap(body)),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Bulk ${path} ${res.status}: ${text.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * "rejectedRiskLimit" → "rejected risk limit", for when Bulk sends no reason.
 * Runs of capitals are kept together so acronyms survive: `cancelledIOC` reads
 * as "cancelled IOC", not "cancelled i o c".
 */
function humanizeStatusKey(key: string): string {
  return key
    .replace(/([A-Z]+)/g, (m) => ` ${m.length > 1 ? m : m.toLowerCase()}`)
    .trim();
}

/**
 * Submit a signed transaction envelope (order, agent-wallet, abc, etc.).
 *
 * CRITICAL: Bulk returns HTTP 200 even when the action FAILED — the real result
 * is inside `response.data.statuses[]` (e.g. `{error:{message:"unauthorized
 * signer"}}` or `{agentWalletFailed:{message}}`). We must inspect it and throw
 * on a failure status, otherwise onboarding/orders silently "succeed".
 */
export async function submitSigned(
  signedEnvelope: unknown,
  opts?: {
    /**
     * Status keys that mean SUCCESS for this action. A cancel's success is
     * `{ cancelled: { oid } }` (verified live), which the `cancelled*` rule
     * below would otherwise report as a rejection.
     */
    accept?: string[];
  }
): Promise<OrderResponse> {
  const res = await post<OrderResponse>("/order", signedEnvelope);
  // A signature rejection says nothing about WHICH action was rejected or what
  // was signed, and both an order and the leverage push travel this one
  // function — so without this the same opaque message can come from either.
  // Logs the envelope MINUS the signature, which is enough to compare the
  // preimage inputs (actions/nonce/account/signer) against a known-good call.
  const failed = res?.response?.data?.statuses?.[0] as
    | Record<string, unknown>
    | undefined;
  const failMsg = (failed?.error as { message?: string } | undefined)?.message;
  if (failMsg && /signature|signer/i.test(failMsg)) {
    const env = demap(signedEnvelope) as Record<string, unknown>;
    const { signature: _sig, ...rest } = env ?? {};
    console.error(
      `[bulk] "${failMsg}" for envelope:`,
      JSON.stringify(rest),
      "\nsignature length:",
      typeof env?.signature === "string" ? env.signature.length : "(not a string)"
    );
  }
  const status = res?.response?.data?.statuses?.[0] as
    | Record<string, unknown>
    | undefined;
  if (res?.status === "error" || (status && "error" in status)) {
    const msg =
      (status?.error as { message?: string } | undefined)?.message ??
      res?.error ??
      "Bulk request failed";
    throw new Error(`Bulk order error: ${msg}`);
  }
  if (status && "agentWalletFailed" in status) {
    const msg = (status.agentWalletFailed as { message?: string }).message;
    throw new Error(`Agent wallet authorization failed: ${msg}`);
  }
  // Any other `*Failed` status. Matched by SUFFIX for the same reason the
  // rejections below are matched by prefix: `transferFailed` was not handled
  // here, so a deposit that Bulk refused ("transfer source and destination must
  // differ") returned HTTP 200, fell through to `return res`, and the UI
  // reported a successful deposit that had moved nothing. Anything Bulk names
  // `<action>Failed` is a failure, including variants not seen yet.
  const failedKey = status
    ? Object.keys(status).find((k) => k.endsWith("Failed"))
    : undefined;
  if (failedKey && status) {
    const f = status[failedKey] as { message?: string; reason?: string };
    const msg = f?.message ?? f?.reason ?? humanizeStatusKey(failedKey);
    throw new Error(`Bulk order error: ${msg}`);
  }
  // An order can also be turned away with a `rejected*` / `cancelled*` status.
  // None of these are `error` statuses, so without this they read as SUCCESS:
  // the caller never threw, the loading toast never resolved, and the UI span
  // forever on "Opening long…" for an order that was never placed.
  //
  // Matched by PREFIX rather than by listing each name. Bulk has at least four
  // rejection and six cancellation variants (rejectedInvalid, rejectedRiskLimit,
  // rejectedCrossing, rejectedDuplicate; cancelledRiskLimit, cancelledIOC,
  // cancelledSelfCrossing, cancelledReduceOnly, cancelledRiskVault, cancelled)
  // and they have been added one at a time as each was hit in production —
  // every one of those was a spinner that never stopped. Prefix matching means
  // a variant we have never seen still surfaces as an error instead of hanging.
  //
  // `cancelled` is deliberately included: an order cancelled at submission
  // leaves no position, so treating it as success is the same failure.
  const rejectedKey = status
    ? Object.keys(status).find(
        (k) =>
          (k.startsWith("rejected") || k.startsWith("cancelled")) &&
          !opts?.accept?.includes(k)
      )
    : undefined;
  if (rejectedKey && status) {
    const r = status[rejectedKey] as { reason?: string; message?: string };
    const reason = r?.reason ?? r?.message;
    throw new Error(
      `Bulk order error: ${reason ?? humanizeStatusKey(rejectedKey)}`
    );
  }
  // Non-order actions (e.g. approveBuilderCode) answer with an `ack` that can
  // carry ok:false — also a failure dressed as HTTP 200.
  if (status && "ack" in status) {
    const ack = status.ack as { ok?: boolean; message?: string };
    if (ack?.ok === false) {
      throw new Error(`Bulk order error: ${ack.message ?? "request not acknowledged"}`);
    }
  }
  return res;
}

/**
 * Read full account state (unsigned): margin + positions. The API returns an
 * array `[{ fullAccount: {...} }]`. For an account that has never traded, Bulk
 * returns 500 with an empty body — we treat that as a flat/empty account rather
 * than an error, so a brand-new user's app doesn't break.
 */
export async function fetchAccount(
  user: string,
  symbol?: string
): Promise<BulkFullAccount | null> {
  const query: AccountQuery = { type: "fullAccount", user, symbol };
  try {
    const arr = await post<AccountResponseItem[]>("/account", query);
    return arr?.[0]?.fullAccount ?? null;
  } catch {
    // 500/empty = no account yet. Treat as flat.
    return null;
  }
}
