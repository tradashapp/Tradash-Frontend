"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { api, type ReferralSummary } from "@/lib/api";
import { setMyReferralCode } from "@/lib/referral";

/**
 * The signed-in user's referral summary: their code, what they've earned, and
 * whether they can still enter a code.
 *
 * Module-level like useProfile: the account menu's row and the referral panel
 * show the same numbers, so they share one fetch and update together.
 */

interface State {
  data: ReferralSummary | null;
  loading: boolean;
  /** Privy DID `data` belongs to, so a re-login can't show the last user's. */
  owner: string | null;
}

let state: State = { data: null, loading: false, owner: null };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function accept(owner: string, data: ReferralSummary) {
  if (state.owner !== owner) return;
  setMyReferralCode(data.code);
  setState({ data, loading: false });
}

function load(owner: string): Promise<void> {
  if (inflight && state.owner === owner) return inflight;
  if (state.owner !== owner) setState({ data: null, owner });
  setState({ loading: true });
  inflight = api
    .fetchReferral(owner)
    .then((d) => accept(owner, d))
    .catch(() => {
      if (state.owner === owner) setState({ loading: false });
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => state;
const serverSnapshot = () => state;

export function useReferral() {
  const { user, authenticated } = usePrivy();
  const privyId = authenticated ? (user?.id ?? null) : null;
  const s = useSyncExternalStore(subscribe, snapshot, serverSnapshot);

  useEffect(() => {
    if (!privyId) {
      if (state.owner) setState({ data: null, owner: null, loading: false });
      setMyReferralCode(null);
      return;
    }
    if (state.owner !== privyId || (!state.data && !state.loading)) void load(privyId);
  }, [privyId]);

  const refresh = useCallback(() => (privyId ? load(privyId) : Promise.resolve()), [privyId]);

  /** Enter a code. Rejects with a message fit to show the user. */
  const apply = useCallback(
    async (code: string) => {
      if (!privyId) throw new Error("Sign in first.");
      accept(privyId, await api.applyReferralCode(privyId, code));
    },
    [privyId]
  );

  const mine = s.owner === privyId ? s : { data: null, loading: !!privyId };
  return { data: mine.data, loading: mine.loading, refresh, apply };
}
