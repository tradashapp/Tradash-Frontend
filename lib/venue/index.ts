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
 * DEFAULTS TO PHOENIX (changed 2026-09-19). Bulk remains reachable by setting
 * `NEXT_PUBLIC_VENUE=bulk`, which is the rollback: it is one environment
 * variable and needs no code change or redeploy of a different build.
 *
 * The default flipped once Phoenix covered the whole trading loop — orders,
 * TP/SL, deposits and withdrawals with sponsorship, in-app delegate onboarding,
 * market stats, server-side history, on-chain delegate verification and
 * liquidation prices. ONE KNOWN GAP REMAINS: trailing stops. Phoenix has no
 * native trailing stop, and `PhoenixVenue.setProtection` THROWS on `trailBps`
 * rather than silently accepting it, so a user is told the feature is
 * unavailable instead of being shown a ratcheting stop that was never armed.
 * Anyone who depends on trailing stops should stay on Bulk until the watcher
 * ships.
 *
 * DELIBERATELY NOT PER-MARKET YET. The migration plan runs one market on
 * Phoenix before the rest, which sounds like a per-market switch — but the two
 * venues need DIFFERENT SIGNER TYPES (Bulk a WASM keychain signer, Phoenix a
 * Solana keypair), and `useTrade` holds one signer for the whole session. Until
 * the signer is resolved per venue, a per-market map would hand Phoenix a Bulk
 * signer and fail at the adapter boundary. One switch, honestly scoped.
 */
function selected(): ExecutionVenue {
  // Explicit opt-out only. An unset or unrecognised value gets Phoenix, so a
  // missing environment variable cannot quietly route real orders to the venue
  // the app is migrating away from.
  return process.env.NEXT_PUBLIC_VENUE === "bulk" ? BulkVenue : PhoenixVenue;
}

export const venue: ExecutionVenue = selected();
