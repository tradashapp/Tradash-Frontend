// Builds through the FULL adapter path and simulates. Signs nothing, sends nothing.
import { Keypair, Connection, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { buildCrossMarketOrder } from "./lib/phoenix/crossOrders.js";
import { assertDelegateSigned, signersOfRest } from "./lib/phoenix/signers.js";
const OWNER="23REC5Z6c9YAibQmzXDW5mqKLi3qeF7CW41f1HsVvG8E";
const DELEG="CR89yTx7QBcP3dXRhDdCTHaMEJJEb166RR7HYKixRP43";
const RPC="https://api.mainnet-beta.solana.com";

for (const [label, isBuy, ref] of [["open long",true,105.9],["close long",false,105.9]] as const) {
  const ixs = await buildCrossMarketOrder({
    authority: OWNER, positionAuthority: DELEG, symbol: "SOL",
    isBuy, size: 0.01, rpcUrl: RPC,
    priceLimitUsd: ref * (isBuy ? 1.1 : 0.9),
  });
  assertDelegateSigned(signersOfRest(ixs), { delegate: DELEG, feePayer: DELEG, owner: OWNER });
  const conn = new Connection(RPC, "confirmed");
  const tx = new Transaction();
  for (const ix of ixs) tx.add(new TransactionInstruction({
    programId: new PublicKey(ix.programId),
    keys: ix.keys.map(k=>({pubkey:new PublicKey(k.pubkey),isSigner:k.isSigner,isWritable:k.isWritable})),
    data: Buffer.from(ix.data),
  }));
  tx.feePayer = new PublicKey(DELEG);
  tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  const sim = await conn.simulateTransaction(tx, undefined, [new PublicKey(DELEG)]);
  console.log(`${label}: ${ixs.length} ix, signer-assert OK, sim ${sim.value.err ? "FAILED "+JSON.stringify(sim.value.err) : "✓ OK"} (${sim.value.unitsConsumed} CU)`);
}
