import { config } from "@/lib/config";
import { api, type FeeArrangement } from "@/lib/api";
import type { BuilderCode } from "./types";

// The Tradash builder fee THIS user's orders carry.
//
// It used to be the env constant NEXT_PUBLIC_BUILDER_FEE_BPS for everyone. It
// is now decided by the backend per user (fee codes, a lowered default) and
// served from GET /users/:id/fee-arrangement; the client only applies it.
// Only the builder fee is ever affected — Bulk's venue fee is Bulk's.
//
// Two client-side invariants hold whatever the server says:
//   - the recipient is always the configured one (the one the user approved);
//   - the fee never exceeds NEXT_PUBLIC_BUILDER_FEE_BPS, the cap the user's
//     master wallet approved — Bulk would reject anything above it.
//
// If the arrangement can't be fetched, orders fall back to the last value we
// had, then to the configured default. The backend reconciles every trade
// against Bulk's ledger, so a fallback that overcharges a discounted user is
// flagged on the admin side rather than going unnoticed.

const FRESH_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 1500;

let owner: string | null = null;
let cached: {
  privyId: string;
  feeBps: number;
  /** The fee code behind a discounted rate, for display. */
  code: string | null;
  at: number;
} | null = null;
let inflight: Promise<number | null> | null = null;

// Screens that show the fee (market settings, the dock, the break-even line)
// re-render when the arrangement arrives or changes (a code redeemed).
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function subscribeFeeArrangement(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * The Tradash fee (bps) this user's opening orders carry, as last read from
 * the backend; the configured rate until then (and when signed out).
 * Synchronous, for display — orders still go through `resolveBuilderCode`.
 */
export function currentBuilderFeeBps(): number {
  if (cached && owner === cached.privyId) return cached.feeBps;
  return config.builder.recipient ? config.builder.feeBps : 0;
}

/** The fee code behind the current rate, if one is applied. */
export function currentFeeCode(): string | null {
  return cached && owner === cached.privyId ? cached.code : null;
}

/** Called once the Privy user is known (and with null on logout). */
export function setFeeArrangementOwner(privyId: string | null): void {
  if (privyId === owner) return;
  owner = privyId;
  cached = null;
  inflight = null;
  notify();
  if (privyId) void refreshFeeArrangement();
}

/** The signed-in user's Privy DID, for fire-and-forget reports. */
export function feeArrangementOwner(): string | null {
  return owner;
}

const clampToCap = (bps: number): number =>
  Math.max(0, Math.min(Math.floor(bps), config.builder.feeBps));

/** Fetch now. Resolves to the fee in bps, or null if it couldn't be read. */
export function refreshFeeArrangement(): Promise<number | null> {
  const privyId = owner;
  if (!privyId) return Promise.resolve(null);
  if (inflight) return inflight;
  inflight = api
    .feeArrangement(privyId)
    .then((a: FeeArrangement) => {
      const feeBps = clampToCap(a.effectiveFeeBps);
      if (owner === privyId) {
        cached = { privyId, feeBps, code: a.source === "code" ? a.code : null, at: Date.now() };
        notify();
      }
      return feeBps;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * The builder code to attach to an opening order, or undefined to attach none
 * (no recipient configured, or a 0 bps arrangement — Bulk rejects a null or
 * zero builder code, so "no fee" means omitting the field).
 */
export async function resolveBuilderCode(): Promise<BuilderCode | undefined> {
  const { recipient, feeBps: cap } = config.builder;
  if (!recipient || !cap) return undefined;

  let fee: number | null = null;
  if (cached && owner === cached.privyId && Date.now() - cached.at < FRESH_MS) {
    fee = cached.feeBps;
  } else if (owner) {
    fee = await Promise.race([
      refreshFeeArrangement(),
      new Promise<null>((r) => setTimeout(() => r(null), FETCH_TIMEOUT_MS)),
    ]);
    if (fee === null && cached && owner === cached.privyId) fee = cached.feeBps;
  }
  const bps = fee ?? cap;
  return bps > 0 ? { to: recipient, fee: bps } : undefined;
}
