// Node-compatible init: pass the wasm bytes directly (browser uses fetch, which
// Turbopack serves — this just proves the signing logic works).
import { readFile } from "node:fs/promises";
import initWasm, * as KC from "bulk-keychain-wasm";

const wasmBytes = await readFile(
  new URL("./node_modules/bulk-keychain-wasm/bulk_keychain_wasm_bg.wasm", import.meta.url)
);
await initWasm({ module_or_path: wasmBytes });
console.log("wasm init OK (bytes)");

const kp = new KC.WasmKeypair();
console.log("keypair pubkey:", kp.pubkey);

const signer = KC.WasmSigner.fromBase58(kp.toBase58());
const master = kp.pubkey;

const prep = KC.prepareAgentWallet(kp.pubkey, false, { account: master });
console.log("agentWallet prepared, messageBytes:", prep.messageBytes.length, "signer:", prep.signer);

const abc = KC.prepareApproveBuilderCode("X73jTVcoq1p9uCAeZVPCVPA8VGqstGzkjFMMzfyBDLD", 5, { account: master });
console.log("abc prepared, messageBytes:", abc.messageBytes.length);

const signed = signer.sign({ m: { c: "BTC-USD", b: true, sz: 0.01, r: false, i: true } }, Date.now());
console.log("signed order envelope keys:", Object.keys(signed));
console.log(JSON.stringify(signed).slice(0, 260));
console.log("ALL OK");
