// Lazily initialize the bulk-keychain WASM module. Everything that signs must
// await ensureKeychain() first. The default export runs WebAssembly.instantiate;
// we cache the promise so it initializes exactly once.
import initWasm, * as Keychain from "bulk-keychain-wasm";

let ready: Promise<typeof Keychain> | null = null;

export async function ensureKeychain(): Promise<typeof Keychain> {
  if (!ready) {
    ready = initWasm().then(() => Keychain);
  }
  return ready;
}

export type { Keychain };
