import { BulkVenue } from "./bulk";
import type { ExecutionVenue } from "./types";

export type {
  ExecutionVenue,
  VenueSigner,
  OpenOrderRequest,
  ReduceOrderRequest,
  ProtectionRequest,
} from "./types";

/**
 * The venue the app trades on.
 *
 * One export, one place to change. When PhoenixVenue lands this becomes a
 * selection — most likely per-market and flag-driven, so one market can move
 * while the rest stay on Bulk (see PHOENIX_MIGRATION_FEASIBILITY.md §17,
 * phase 5). Today there is exactly one venue, and pretending otherwise would
 * be scaffolding for a decision not yet made.
 */
export const venue: ExecutionVenue = BulkVenue;
