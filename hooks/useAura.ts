"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchAura, type Aura } from "@/lib/bulk/aura";

/**
 * The wallet's Bulk Aura. Fetched when the panel mounts (and on retry), so it
 * is fresh each time it's opened; the same stale-response guard as the
 * leaderboard keeps a slow earlier request from overwriting a later one.
 */
export function useAura(wallet: string | null) {
  const [aura, setAura] = useState<Aura | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!wallet) return;
    let live = true;
    setLoading(true);
    setError(false);
    fetchAura(wallet)
      .then((a) => {
        if (live) setAura(a);
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
  }, [wallet, nonce]);

  return { aura, loading, error, refresh };
}
