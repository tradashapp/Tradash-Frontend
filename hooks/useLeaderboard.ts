"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { api } from "@/lib/api";
import type {
  Leaderboard,
  LeaderboardMetric,
  LeaderboardPeriod,
} from "@/types";

/**
 * Fetches the standings for the selected metric + period.
 *
 * Refetches on every filter change, and once whenever `enabled` flips true (the
 * sheet opening) so a board left open from an earlier session isn't stale. The
 * request is guarded by a generation counter rather than an AbortController —
 * flipping filters quickly is the common case, and all we need is for the last
 * response to win rather than whichever happens to land last.
 */
export function useLeaderboard(
  metric: LeaderboardMetric,
  period: LeaderboardPeriod,
  enabled: boolean
) {
  const { user } = usePrivy();
  const privyId = user?.id ?? null;

  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // Bumped to force a refetch of the same filters (pull-to-refresh / retry).
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setLoading(true);
    setError(false);
    api
      .fetchLeaderboard(metric, period, privyId)
      .then((b) => {
        if (live) setBoard(b);
      })
      .catch(() => {
        if (live) setError(true);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [metric, period, privyId, enabled, nonce]);

  return { board, loading, error, refresh };
}
