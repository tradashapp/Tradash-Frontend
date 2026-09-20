/**
 * A UUID for idempotency keys, with a fallback for non-secure contexts.
 *
 * The backend validates these with `z.string().uuid()` (`routes/withdrawals.ts`),
 * so a descriptive key like `phoenix-deposit-<wallet>-<amount>-<ts>` is
 * rejected with `ValidationError: idempotencyKey ["Invalid uuid"]` — which is
 * exactly what the Phoenix transfer path hit. Descriptive keys read better in
 * logs but are not what the contract accepts; use this everywhere instead.
 *
 * `crypto.randomUUID` is unavailable on plain-http origins (it needs a secure
 * context), so the fallback matters for LAN testing of the PWA.
 */
export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (
      Number(c) ^
      (crypto.getRandomValues(new Uint8Array(1))[0]! & (15 >> (Number(c) / 4)))
    ).toString(16)
  );
}
