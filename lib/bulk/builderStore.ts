import { config } from "@/lib/config";

// Local record of the builder-code (`abc`) approval, keyed by master wallet
// AND Bulk network (see `key()`).
//
// WHY THIS EXISTS: unlike the agent wallet — which we can verify against Bulk by
// reading `fullAccount.authorizedAgentWallets` — Bulk exposes NO readable
// builder-code approval state. Verified 2026-08-17 against
// exchange-api.bulk.trade: `fullAccount` carries no such field, and none of the
// eleven `/account` query types (fullAccount, openOrders, feeState, feeTier,
// fills, positions, fundingHistory, orderHistory, activityHistory, riskEvents,
// riskHistory) return builder approvals. The only authoritative signal is an
// order being rejected with "builder-code fee <n>bps not approved for <to>".
//
// So this cache is OPTIMISTIC, not a source of truth. It is written when an
// `abc` approval is acknowledged and CLEARED when an order rejection proves it
// wrong (see `clearApproval`, called from the order path). Treat a hit as "very
// likely approved"; treat a rejection as authoritative and re-onboard.
//
// The approval is bound to BOTH recipient and fee: Bulk approves a specific
// (recipient, maxFeeBps) pair, so raising NEXT_PUBLIC_BUILDER_FEE_BPS or
// changing the recipient invalidates a previous approval. We record both and
// only count a match when both agree.

const PREFIX = "tradash.builder.v1:";

export interface StoredBuilderApproval {
  /** Recipient pubkey the approval was granted to. */
  recipient: string;
  /** Fee cap in bps that was approved. */
  feeBps: number;
}

/**
 * Scoped to the BULK NETWORK as well as the wallet, for the same reason
 * `agentStore` is: an `abc` approval is granted on one network and means
 * nothing on another. Unscoped, switching networks left this cache claiming an
 * approval the new network had never been given — and because Bulk exposes no
 * readable approval state (see above), NOTHING could correct it except an order
 * rejection. Scoping makes the switch re-approve instead.
 */
function key(walletAddress: string) {
  return `${PREFIX}${config.bulk.network}:${walletAddress}`;
}

/** The approval recorded for this wallet, if any. */
export function loadApproval(
  walletAddress: string
): StoredBuilderApproval | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(walletAddress));
    return raw ? (JSON.parse(raw) as StoredBuilderApproval) : null;
  } catch {
    return null;
  }
}

export function saveApproval(
  walletAddress: string,
  approval: StoredBuilderApproval
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(walletAddress), JSON.stringify(approval));
  } catch {
    /* storage disabled — non-fatal, we just re-approve next session */
  }
}

/**
 * Forget the approval — call when Bulk rejects an order for an unapproved
 * builder code, so the UI stops claiming approval it doesn't have.
 */
export function clearApproval(walletAddress: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key(walletAddress));
}

/**
 * Whether this wallet has an approval matching the CURRENTLY configured
 * recipient + fee. A stored approval for a different recipient or a lower fee
 * cap does not count — Bulk would reject the order.
 */
export function hasApprovalFor(
  walletAddress: string,
  recipient: string,
  feeBps: number
): boolean {
  const stored = loadApproval(walletAddress);
  if (!stored) return false;
  return stored.recipient === recipient && stored.feeBps === feeBps;
}
