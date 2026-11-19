"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { api, type PointsSummary } from "@/lib/api";

/**
 * The signed-in user's points. Module-level like useReferral: the account
 * menu row and the Points panel show the same numbers from one fetch.
 */

interface State {
  data: PointsSummary | null;
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

function load(owner: string): Promise<void> {
  if (inflight && state.owner === owner) return inflight;
  if (state.owner !== owner) setState({ data: null, owner });
  setState({ loading: true });
  inflight = api
    .fetchPoints(owner)
    .then((data) => {
      if (state.owner === owner) setState({ data, loading: false });
    })
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

export function usePoints() {
  const { user, authenticated } = usePrivy();
  const privyId = authenticated ? (user?.id ?? null) : null;
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    if (!privyId) {
      if (state.owner) setState({ data: null, owner: null, loading: false });
      return;
    }
    if (state.owner !== privyId || (!state.data && !state.loading)) void load(privyId);
  }, [privyId]);

  const refresh = useCallback(() => (privyId ? load(privyId) : Promise.resolve()), [privyId]);

  const mine = s.owner === privyId ? s : { data: null, loading: !!privyId };
  return { data: mine.data, loading: mine.loading, refresh };
}
