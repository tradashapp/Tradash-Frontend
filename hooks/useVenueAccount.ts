"use client";

import { useEffect, useState } from "react";
import { venue } from "@/lib/venue";
import { useBulkAccount } from "@/hooks/useBulkAccount";
import { usePhoenixAccount } from "@/hooks/usePhoenixAccount";

/**
 * Live account state from whichever venue is active.
 *
 * One call site in `TradeScreen`, so the screen never branches on venue. Both
 * hooks are ALWAYS called — React requires a stable hook order, and calling one
 * conditionally would break on a venue switch. Each no-ops when its arguments
 * are null, which is how only one of them ends up doing work.
 */
export function useVenueAccount(
  walletAddress: string | null,
  privyId: string | null
) {
  const isPhoenix = venue.id === "phoenix";

  // `/v1/view/trader/{X}` takes the trader PDA, not the wallet — a wallet
  // returns a misleading 404. Derivation needs the SDK, so it is async and
  // lazily imported; until it resolves the Phoenix hook stays idle.
  const [traderPda, setTraderPda] = useState<string | null>(null);
  useEffect(() => {
    if (!isPhoenix || !walletAddress) {
      setTraderPda(null);
      return;
    }
    let cancelled = false;
    void import("@/lib/phoenix/pda")
      .then(({ deriveTraderPda }) => deriveTraderPda(walletAddress))
      .then((pda) => {
        if (!cancelled) setTraderPda(pda);
      })
      .catch(() => {
        // Without a PDA the Phoenix hook cannot read anything; leaving it null
        // shows a flat account rather than a stale Bulk balance.
        if (!cancelled) setTraderPda(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isPhoenix, walletAddress]);

  useBulkAccount(isPhoenix ? null : walletAddress, isPhoenix ? null : privyId);
  usePhoenixAccount(isPhoenix ? walletAddress : null, isPhoenix ? traderPda : null);
}
