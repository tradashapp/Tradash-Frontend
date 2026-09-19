import { BulkVenue } from "./bulk";
import { PhoenixVenue } from "./phoenix";
import type { ExecutionVenue } from "./types";

export type {
  ExecutionVenue,
  VenueSigner,
  OpenOrderRequest,
  ReduceOrderRequest,
  ProtectionRequest,
} from "./types";

export { BulkVenue } from "./bulk";
export { PhoenixVenue } from "./phoenix";

/**
 * Which venue Tradash trades on.
 *
 * DEFAULTS TO BULK. Phoenix is opt-in via `NEXT_PUBLIC_VENUE=phoenix` while the
 * migration is in progress, so the deployed app keeps trading exactly as it
 * does today and a mistake in the Phoenix path cannot reach production by
 * accident.
 *
 * DELIBERATELY NOT PER-MARKET YET. The migration plan runs one market on
 * Phoenix before the rest, which sounds like a per-market switch — but the two
 * venues need DIFFERENT SIGNER TYPES (Bulk a WASM keychain signer, Phoenix a
 * Solana keypair), and `useTrade` holds one signer for the whole session. Until
 * the signer is resolved per venue, a per-market map would hand Phoenix a Bulk
 * signer and fail at the adapter boundary. One switch, honestly scoped.
 */
function selected(): ExecutionVenue {
  return process.env.NEXT_PUBLIC_VENUE === "phoenix" ? PhoenixVenue : BulkVenue;
}

export const venue: ExecutionVenue = selected();
