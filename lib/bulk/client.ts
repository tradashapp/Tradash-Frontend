import { config } from "@/lib/config";
import type {
  AccountQuery,
  FullAccount,
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

/** Read full account state (unsigned): balance, margin, positions. */
export function fetchAccount(
  user: string,
  symbol?: string
): Promise<FullAccount> {
  const query: AccountQuery = { type: "fullAccount", user, symbol };
  return post<FullAccount>("/account", query);
}
