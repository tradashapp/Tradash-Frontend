import type { MarketSymbol, ProtectionOrder } from "@/types";
import type {
  ExecutionVenue,
  OpenOrderRequest,
  ProtectionRequest,
  ReduceOrderRequest,
  VenueSigner,
} from "./types";

/**
 * Phoenix behind the `ExecutionVenue` seam — WRITE PATHS NOT YET IMPLEMENTED.
 *
 * Phase 2 of the migration builds and proves the READ paths (markets, trader
 * state, history, candles) with no funds at risk; those live in
 * `lib/phoenix/*` and are exercised directly. This adapter exists so the seam
 * has a second implementation to typecheck against, and so the remaining work
 * is explicit rather than implied.
 *
 * Every method below throws deliberately. A silent no-op or a plausible-looking
 * default would be far worse here: it would let a wiring mistake route a real
 * trade into a stub and report success. If you can reach one of these in the
 * running app, the venue selection is wrong — that is the bug this surfaces.
 *
 * WHAT MUST BE TRUE BEFORE THESE ARE FILLED IN (see PHOENIX_MIGRATION_FEASIBILITY.md):
 *  - Orders are Solana TRANSACTIONS, not signed payloads. A market order builds
 *    as FIVE instructions (realloc_trader, sync_parent_to_child,
 *    place_market_order, and two collateral sweeps) that must be submitted
 *    atomically — `openMarket` is no longer a single POST.
 *  - One-tap requires `positionAuthority` (delegate) + `feePayer` (sponsor) on
 *    the request, which together remove the owner from the signer set.
 *  - `positionAuthority` is camelCase while siblings are snake_case, and
 *    UNKNOWN FIELDS ARE DROPPED SILENTLY — a typo yields an owner-signed order
 *    with no error. The implementation MUST assert the returned signer set
 *    before broadcasting. This is a security control, not a nicety.
 */

const NOT_READY = (op: string) =>
  new Error(
    `PhoenixVenue.${op} is not implemented yet (migration phase 2 covers read paths only)`
  );

export const PhoenixVenue: ExecutionVenue = {
  id: "phoenix",

  /**
   * Phoenix has NO per-user leverage setting — the ceiling is a function of
   * position size (`leverageTiers`). Returning false is the honest answer the
   * interface is designed for, not a failure: callers must not block a trade
   * on it. See `lib/phoenix/map.ts#maxLeverageForSize` for the real lookup.
   */
  async setLeverage(): Promise<boolean> {
    return false;
  },

  async openMarket(_signer: VenueSigner, _req: OpenOrderRequest) {
    throw NOT_READY("openMarket");
  },

  async reduceMarket(_signer: VenueSigner, _req: ReduceOrderRequest) {
    throw NOT_READY("reduceMarket");
  },

  async setProtection(
    _signer: VenueSigner,
    _req: ProtectionRequest
  ): Promise<ProtectionOrder[]> {
    throw NOT_READY("setProtection");
  },

  async cancelAllProtection(
    _signer: VenueSigner,
    _symbol: MarketSymbol,
    _existing: ProtectionOrder[] | undefined
  ) {
    throw NOT_READY("cancelAllProtection");
  },

  /**
   * Phoenix attaches builder fees PER REQUEST (`flightBuilderAuthority`), so
   * there is no account-level approval that can be missing — the entire
   * Bulk builder-approval handshake has no analogue here.
   */
  isBuilderNotApprovedError() {
    return false;
  },
};
