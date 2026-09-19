import { MARKETS } from "@/lib/markets";
import { assertDelegateSigned, signersOfRest } from "@/lib/phoenix/signers";
import { buildTransaction, signAndSend } from "@/lib/phoenix/submit";
import type { DelegateSigner } from "@/lib/phoenix/delegateSigner";
import { solanaRpcUrl } from "@/lib/config";
import type { MarketSymbol, ProtectionOrder } from "@/types";
import type {
  ExecutionVenue,
  OpenOrderRequest,
  ProtectionRequest,
  ReduceOrderRequest,
  VenueSigner,
} from "./types";

/**
 * Phoenix behind the `ExecutionVenue` seam — CROSS MARGIN.
 *
 * Tradash is cross-margin only: positions share one collateral pool and
 * `available` means free collateral across the account. Phoenix's REST order
 * routes are all ISOLATED (`/v1/ix/place-isolated-*` is the complete list, and
 * `marginType:"cross"` is silently ignored), so orders go through the SDK's
 * cross path instead — one instruction against the funded account, versus six
 * with collateral shuffled into a per-position subaccount.
 *
 * TP/SL still goes over REST: `place-position-conditional-order` attaches to
 * whatever position exists, so it is margin-model agnostic.
 *
 * SIGNING. Every build is checked before a key is touched: Phoenix drops
 * unknown request fields silently, so a mis-spelled `positionAuthority` yields
 * an OWNER-signed order with a 200 and no warning. `assertDelegateSigned`
 * turns that into a failure before signing rather than a wallet prompt the user
 * never expected.
 */

/**
 * Phoenix's symbol for a market, or a refusal.
 *
 * `MARKETS` is the intersection of Bulk and the MagicBlock oracle, so an entry
 * may have no Phoenix listing. Guessing the symbol would route an order at a
 * market that does not exist, so an absent mapping is an error.
 */
/**
 * The order builders are imported LAZILY, not at module scope.
 *
 * `crossOrders` pulls in the Rise SDK (~474KB, and ~920KB of emitted chunks).
 * A dynamic `import()` INSIDE that module is not enough on its own: if this
 * file imports it statically, the module stays reachable from the entry graph
 * and its chunks are emitted into every build — measured, 5.6MB → 6.5MB, even
 * with `venue` defaulting to Bulk. Deferring the import here keeps the whole
 * Phoenix order path out of the bundle until someone actually trades on it.
 */
const orderBuilders = () => import("@/lib/phoenix/crossOrders");
const protectionBuilder = () => import("@/lib/phoenix/orders");

function phoenixSymbol(symbol: MarketSymbol): string {
  const s = MARKETS[symbol]?.phoenixSymbol;
  if (!s) throw new Error(`${symbol} is not listed on Phoenix`);
  return s;
}

/**
 * Narrow the venue-neutral signer back to the Phoenix delegate.
 *
 * Safe because `PhoenixVenue` is only reachable from code paths that built
 * their signer with `makeDelegateSigner`. The Bulk adapter does the mirror of
 * this for its WASM signer.
 */
function asDelegate(signer: VenueSigner): DelegateSigner {
  const d = signer as DelegateSigner;
  if (!d.keypair) {
    throw new Error(
      "PhoenixVenue needs a delegate signer (lib/phoenix/delegateSigner), not a Bulk agent signer"
    );
  }
  return d;
}

/** Build → assert the signer set → sign → send. The only submit path. */
type BuiltIx = Awaited<
  ReturnType<Awaited<ReturnType<typeof orderBuilders>>["buildCrossMarketOrder"]>
>;

async function submit(d: DelegateSigner, instructions: BuiltIx): Promise<void> {
  assertDelegateSigned(signersOfRest(instructions), {
    delegate: d.pubkey,
    // The delegate is its own fee payer today. When the backend sponsor is
    // funded this becomes the sponsor and the delegate keeps only the
    // read-only authority slot; the assertion already accepts both shapes.
    feePayer: d.pubkey,
    owner: d.account,
  });

  const { tx, connection } = await buildTransaction({
    instructions,
    feePayer: d.pubkey,
    delegate: d.pubkey,
    owner: d.account,
    rpcUrl: solanaRpcUrl(),
  });
  await signAndSend(tx, connection, [d.keypair]);
}

export const PhoenixVenue: ExecutionVenue = {
  id: "phoenix",

  /**
   * Phoenix has NO per-user leverage setting — the ceiling is a function of
   * position size (`leverageTiers`), so there is nothing to push. Returning
   * false is the interface's "not applicable"; callers must not block a trade
   * on it.
   *
   * In practice the ladder is effectively one rung (BTC 40x up to ~735 BTC,
   * ETH/SOL 25x far beyond any Tradash size), so the visible ceiling matches
   * Bulk's and only the mechanism differs.
   */
  async setLeverage(): Promise<boolean> {
    return false;
  },

  async openMarket(signer: VenueSigner, req: OpenOrderRequest) {
    const d = asDelegate(signer);
    const { buildCrossMarketOrder } = await orderBuilders();
    const ixs = await buildCrossMarketOrder({
      authority: d.account,
      positionAuthority: d.pubkey,
      symbol: phoenixSymbol(req.symbol),
      isBuy: req.isLong,
      size: req.size,
      rpcUrl: solanaRpcUrl(),
      // Market orders are IOC: without a bound a thin book can fill far from
      // the price the user tapped. Mirrors Bulk's ±10% slippage bound.
      priceLimitUsd: req.refPrice * (req.isLong ? 1.1 : 0.9),
    });
    await submit(d, ixs);
  },

  async reduceMarket(signer: VenueSigner, req: ReduceOrderRequest) {
    const d = asDelegate(signer);
    const { buildCrossMarketOrder } = await orderBuilders();
    const ixs = await buildCrossMarketOrder({
      authority: d.account,
      positionAuthority: d.pubkey,
      symbol: phoenixSymbol(req.symbol),
      // Closing sends the opposite side.
      isBuy: !req.positionIsLong,
      size: req.size,
      rpcUrl: solanaRpcUrl(),
      priceLimitUsd: req.refPrice * (req.positionIsLong ? 0.9 : 1.1),
    });
    await submit(d, ixs);
  },

  /**
   * Place TP and SL as one conditional order against the open position.
   *
   * Simpler than Bulk, which needed cancel-all → place → a read-back
   * verification loop because it acked malformed triggers with a real order id
   * and then discarded them. Phoenix rejects a bad trigger at BUILD time with a
   * 400, so a successful build is already proof the order is well-formed.
   *
   * TRAILING IS NOT SUPPORTED HERE. Phoenix trigger orders are static — there
   * is no trail-offset field anywhere in the SDK or in live trader state. A
   * trailing stop must be driven by a watcher that cancels and re-places as the
   * price moves (migration phase 7). Silently dropping `trailBps` would leave a
   * user believing a ratcheting stop was armed when nothing was, so it throws.
   */
  async setProtection(
    signer: VenueSigner,
    req: ProtectionRequest
  ): Promise<ProtectionOrder[]> {
    const d = asDelegate(signer);

    if (req.trailBps != null && req.trailBps > 0) {
      throw new Error(
        "Phoenix has no native trailing stop — it needs the client-side watcher (migration phase 7)"
      );
    }
    if (req.takeProfit == null && req.stopLoss == null) {
      throw new Error("setProtection needs at least a take-profit or a stop-loss");
    }

    // The side that CLOSES the position: sell a long, buy a short.
    const side = req.positionIsLong ? ("sell" as const) : ("buy" as const);
    // For a long, TP is above and SL below; inverted for a short. Phoenix names
    // the legs by DIRECTION crossed, not by intent.
    const above = req.positionIsLong ? req.takeProfit : req.stopLoss;
    const below = req.positionIsLong ? req.stopLoss : req.takeProfit;

    // Execution price is set slightly through the trigger so the IOC actually
    // fills once armed, rather than resting exactly at an untouched price.
    const leg = (triggerPrice: number, isAbove: boolean) => ({
      side,
      orderKind: "ioc" as const,
      triggerPrice,
      executionPrice: triggerPrice * (isAbove ? 0.995 : 1.005),
    });

    const { buildProtection } = await protectionBuilder();
    const ixs = await buildProtection({
      authority: d.account,
      positionAuthority: d.pubkey,
      feePayer: d.pubkey,
      symbol: phoenixSymbol(req.symbol),
      traderPdaIndex: 0,
      ...(above != null ? { greaterTrigger: leg(above, true) } : {}),
      ...(below != null ? { lessTrigger: leg(below, false) } : {}),
      sizePercent: 100,
    });

    await submit(d, ixs);

    // The caller re-reads authoritative state from the account stream; this is
    // the local echo of what was just armed, not a claim about resting orders.
    const out: ProtectionOrder[] = [];
    if (req.takeProfit != null) {
      out.push({
        orderId: `phoenix-tp-${req.symbol}`,
        kind: "takeProfit",
        triggerPrice: req.takeProfit,
        isAbove: req.positionIsLong,
      });
    }
    if (req.stopLoss != null) {
      out.push({
        orderId: `phoenix-sl-${req.symbol}`,
        kind: "stop",
        triggerPrice: req.stopLoss,
        isAbove: !req.positionIsLong,
      });
    }
    return out;
  },

  /**
   * NOT IMPLEMENTED — deliberately left throwing.
   *
   * Cancelling needs `conditionalOrderIndex` plus an `executionDirection`
   * ("greater_than"/"less_than"), which must be read back from live trader
   * state rather than derived from the domain `ProtectionOrder` (whose
   * `orderId` is a Bulk concept). Wiring that read is part of porting the
   * account stream; guessing an index would cancel the wrong trigger.
   *
   * A no-op here would be worse: `useTrade` calls this after every close to
   * clear stale triggers, so silently doing nothing would leave a stop resting
   * against a flat account, ready to open a position the user never asked for.
   */
  async cancelAllProtection(
    _signer: VenueSigner,
    _symbol: MarketSymbol,
    _existing: ProtectionOrder[] | undefined
  ) {
    throw new Error(
      "PhoenixVenue.cancelAllProtection needs conditionalOrderIndex from live trader state (not yet ported)"
    );
  },

  /**
   * Phoenix attaches builder fees PER REQUEST (`flightBuilderAuthority`), so
   * there is no account-level approval that can be missing and no rejection to
   * detect. Bulk's entire builder-approval handshake has no analogue.
   */
  isBuilderNotApprovedError() {
    return false;
  },
};
