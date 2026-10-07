// Lazily initialize the bulk-keychain WASM module. Everything that signs must
// await ensureKeychain() first. The default export runs WebAssembly.instantiate;
// we cache the promise so it initializes exactly once.
//
// ⚠️ THE VERSION IS PINNED EXACTLY in package.json ("0.1.30", no caret), and
// must stay that way.
//
// 0.1.29 did it AGAIN, but only for trigger orders: takeProfit / stop / trl
// gained the "bulk-actions" prefix (version byte 04) plus two extra zero bytes,
// while market/limit orders, cancels, trig, leverage and every onboarding
// action stayed byte-identical. On 0.1.28 trades opened fine and every TP/SL /
// trailing stop came back `bad signature` (2026-10-07).
//
// This package defines the SIGNING PREIMAGE, so a version bump can silently
// invalidate every signature the app produces. 0.1.28 did exactly that: it
// prepends a domain-separation prefix that 0.1.26/0.1.27 did not —
//
//   ff ff ff ff ff ff ff ff | "bulk-actions" | 03 | <actions…>
//   (u64 sentinel)            (tag)            (version byte)
//
// — and adds a trailing byte after the builder fee. Mainnet moved to the new
// format while the app was on 0.1.26, so every order was signed over the old
// bytes and rejected as `bad signature`. Nothing in that message mentions a
// version, and the API surface is UNCHANGED between the two, so a typecheck and
// a build both pass while no order can be placed.
//
// Before changing this version, diff the preimage:
//   Buffer.from(prepareOrder(order, opts).messageBytes).toString("hex")
// against the installed version, and confirm the API the server expects.
// Testnet and mainnet can be on different formats — verify against BOTH.
import initWasm, * as Keychain from "bulk-keychain-wasm";

let ready: Promise<typeof Keychain> | null = null;

export async function ensureKeychain(): Promise<typeof Keychain> {
  if (!ready) {
    ready = initWasm().then(() => Keychain);
  }
  return ready;
}

export type { Keychain };
