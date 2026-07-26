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

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Bulk ${path} ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

/** Submit a signed transaction envelope (order, agent-wallet, abc, etc.). */
export function submitSigned(signedEnvelope: unknown): Promise<OrderResponse> {
  return post<OrderResponse>("/order", signedEnvelope);
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
