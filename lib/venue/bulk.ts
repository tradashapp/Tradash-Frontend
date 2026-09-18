import { MARKETS } from "@/lib/markets";
import {
  openMarket as bulkOpenMarket,
  reduceMarket as bulkReduceMarket,
  isBuilderNotApprovedError as bulkIsBuilderNotApprovedError,
} from "@/lib/bulk/orders";
import { setMarketLeverage } from "@/lib/bulk/leverage";
import { cancelAllProtection as bulkCancelAllProtection } from "@/lib/bulk/protection";
import type { AgentSigner } from "@/lib/bulk/signing";
import type { MarketSymbol, ProtectionOrder } from "@/types";
import type {
  ExecutionVenue,
  OpenOrderRequest,
  ProtectionRequest,
  ReduceOrderRequest,
  VenueSigner,
} from "./types";

/**
 * Bulk behind the `ExecutionVenue` seam.
 *
 * This adapter is a TRANSLATION LAYER ONLY. It holds no policy: every rule
 * about dust, lot sizes, slippage bounds, builder codes and error dialects
 * stays in `lib/bulk/*` where it was learned, and this file just maps the
 * app's vocabulary onto it. Behaviour is intentionally identical to calling
 * `lib/bulk/*` directly — that is the point of the extraction step.
 *
 * SYMBOL TRANSLATION happens here and only here. Above this line the app says
 * "BTC"; Bulk wants "BTC-USD". `MARKETS[symbol].bulkSymbol` is the single
 * crossing point.
 */

/**
 * Bulk's signer is a live WASM object with methods, not plain data, so it
 * cannot be reconstructed from the `VenueSigner` shape. The app already holds
 * the real `AgentSigner` and passes it down; this narrows it back at the
 * boundary.
 *
 * Safe because `BulkVenue` is only ever reached from code paths that obtained
 * their signer from `useAgentWallet`, which produces exactly this type. The
 * Phoenix adapter will not need this — its signer is a plain keypair.
 */
function asAgentSigner(signer: VenueSigner): AgentSigner {
  return signer as AgentSigner;
}

export const BulkVenue: ExecutionVenue = {
  id: "bulk",

  async setLeverage(signer, symbol, leverage) {
    await setMarketLeverage(
      asAgentSigner(signer),
      MARKETS[symbol].bulkSymbol,
      leverage
    );
    // Bulk models leverage as a per-symbol account setting, so this is always
    // "applicable" here. Phoenix will return false (size tiers instead).
    return true;
  },

  async openMarket(signer: VenueSigner, req: OpenOrderRequest) {
    await bulkOpenMarket(asAgentSigner(signer), {
      bulkSymbol: MARKETS[req.symbol].bulkSymbol,
      isLong: req.isLong,
      size: req.size,
      refPrice: req.refPrice,
    });
  },

  async reduceMarket(signer: VenueSigner, req: ReduceOrderRequest) {
    await bulkReduceMarket(asAgentSigner(signer), {
      bulkSymbol: MARKETS[req.symbol].bulkSymbol,
      positionIsLong: req.positionIsLong,
      size: req.size,
      refPrice: req.refPrice,
    });
  },

  async setProtection(
    _signer: VenueSigner,
    _req: ProtectionRequest
  ): Promise<ProtectionOrder[]> {
    // NOT YET MOVED — deliberately.
    //
    // Bulk's TP/SL write is inseparable from its read-back verification loop
    // (4 × 700ms), because Bulk acks a malformed trigger with a real order id
    // and then discards it. That loop lives in `hooks/useProtection.ts` and is
    // wired into Redux and the toast system, so lifting it into a pure adapter
    // is a behaviour-change risk — exactly what this phase forbids.
    //
    // It moves in the phase that rewrites protection for Phoenix, where the
    // verification contract in `ExecutionVenue.setProtection` gets a real
    // implementation. Until then `useProtection` remains the entry point.
    throw new Error(
      "BulkVenue.setProtection: use hooks/useProtection until protection is migrated"
    );
  },

  async cancelAllProtection(
    signer: VenueSigner,
    symbol: MarketSymbol,
    existing: ProtectionOrder[] | undefined
  ) {
    await bulkCancelAllProtection(
      asAgentSigner(signer),
      MARKETS[symbol].bulkSymbol,
      existing
    );
  },

  isBuilderNotApprovedError(e: unknown) {
    return bulkIsBuilderNotApprovedError(e);
  },
};
