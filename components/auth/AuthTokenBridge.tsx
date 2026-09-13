"use client";

import { useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { setAuthTokenProvider } from "@/lib/api";

/**
 * Hands the API client a way to mint Privy access tokens.
 *
 * `lib/api.ts` is plain TypeScript shared by hooks, the outbox and background
 * replays, so it cannot call a React hook itself. This component bridges the
 * two: mounted once inside the provider tree, it injects `getAccessToken` so
 * every backend request carries a live bearer token.
 *
 * Renders nothing.
 */
export function AuthTokenBridge() {
  const { getAccessToken } = usePrivy();

  useEffect(() => {
    // Privy caches and refreshes the token internally, so calling this per
    // request is cheap and always yields an unexpired one.
    setAuthTokenProvider(() => getAccessToken());
  }, [getAccessToken]);

  return null;
}
