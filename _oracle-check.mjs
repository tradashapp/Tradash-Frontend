// Standalone check of the oracle integration against MagicBlock devnet:
// derive the BTC feed PDA, read the account, decode price, and watch a few ticks.
import { Connection, PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("PriCems5tHihc6UDXDjzjeawomAwBduWMGAi8ZUjppd");
const PRICE_OFFSET = 73;

const RPC_CANDIDATES = [
  "https://rpc.magicblock.app/devnet",
  "https://devnet.magicblock.app",
];

function feedAddress(pythLazerId) {
  const feedName = pythLazerId.toString();
  return PublicKey.findProgramAddressSync(
    [Buffer.from("price_feed"), Buffer.from("pyth-lazer"), Buffer.from(feedName)],
    PROGRAM_ID
  )[0];
}

function decode(data, exponent) {
  if (data.byteLength < PRICE_OFFSET + 8) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const raw = view.getBigInt64(PRICE_OFFSET, true);
  return Number(raw) * Math.pow(10, exponent);
}

const btc = feedAddress(1);
console.log("BTC feed PDA:", btc.toBase58());

for (const url of RPC_CANDIDATES) {
  try {
    const ws = url.replace(/^http/, "ws");
    const conn = new Connection(url, { wsEndpoint: ws });
    const info = await conn.getAccountInfo(btc, "confirmed");
    if (!info) {
      console.log(`[${url}] account not found`);
      continue;
    }
    console.log(`[${url}] account found, dataLen=${info.data.length}, owner=${info.owner.toBase58()}`);
    console.log(`[${url}] decoded BTC price = $${decode(info.data, -8)?.toLocaleString()}`);

    // Watch a few live updates.
    let ticks = 0;
    await new Promise((resolve) => {
      const sub = conn.onAccountChange(btc, (ai) => {
        const p = decode(ai.data, -8);
        console.log(`  tick ${++ticks}: $${p?.toLocaleString()}`);
        if (ticks >= 4) {
          conn.removeAccountChangeListener(sub).then(resolve);
        }
      }, "confirmed");
      setTimeout(() => { conn.removeAccountChangeListener(sub).then(resolve); }, 8000);
    });
    console.log(`[${url}] live ticks received: ${ticks}`);
    break; // first working endpoint is enough
  } catch (e) {
    console.log(`[${url}] error:`, e.message);
  }
}
process.exit(0);
