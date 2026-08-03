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
 * Submit a signed transaction envelope (order, agent-wallet, abc, etc.).
 *
 * CRITICAL: Bulk returns HTTP 200 even when the action FAILED — the real result
 * is inside `response.data.statuses[]` (e.g. `{error:{message:"unauthorized
 * signer"}}` or `{agentWalletFailed:{message}}`). We must inspect it and throw
 * on a failure status, otherwise onboarding/orders silently "succeed".
 */
export async function submitSigned(
  signedEnvelope: unknown
): Promise<OrderResponse> {
  const res = await post<OrderResponse>("/order", signedEnvelope);
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
  // An order can also be turned away with `rejectedInvalid` (e.g. "builder-code
  // fee 10bps not approved for <recipient>"). It is NOT an `error` status, so
  // without this it read as success: the caller never threw, the loading toast
  // never resolved, and the UI span forever on "Opening long…".
  if (status && "rejectedInvalid" in status) {
    const r = status.rejectedInvalid as { reason?: string };
    throw new Error(`Bulk order error: ${r?.reason ?? "order rejected"}`);
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
