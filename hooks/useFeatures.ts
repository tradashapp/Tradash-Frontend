"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { api, type FeatureView } from "@/lib/api";

/**
 * Gated features for the signed-in user: the Grid bot and Signals betas.
 *
 * Module-level like useReferral: the account menu's row and the Grid panel
 * read the same answer and update together after an application.
 *
 * Display only. Every grid route re-checks access on the backend, so a stale
 * or tampered answer here can show a row, never grant anything.
 */

interface State {
  gridBot: FeatureView | null;
  /** Null until known, and on a backend without migration 018 (fail closed). */
  signalBot: FeatureView | null;
  loading: boolean;
  /** Privy DID the data belongs to, so a re-login can't show the last user's. */
  owner: string | null;
}

let state: State = { gridBot: null, signalBot: null, loading: false, owner: null };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function load(owner: string): Promise<void> {
  if (inflight && state.owner === owner) return inflight;
  if (state.owner !== owner) setState({ gridBot: null, signalBot: null, owner });
  setState({ loading: true });
  inflight = api
    .fetchFeatures(owner)
    .then((d) => {
      if (state.owner === owner) setState({ gridBot: d.gridBot, signalBot: d.signalBot ?? null, loading: false });
    })
    .catch(() => {
      // Fail closed: no answer = no Grid row (a backend without migration 015
      // lands here too).
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

export function useFeatures() {
  const { user, authenticated } = usePrivy();
  const privyId = authenticated ? (user?.id ?? null) : null;
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    if (!privyId) {
      if (state.owner) setState({ gridBot: null, signalBot: null, owner: null, loading: false });
      return;
    }
    if (state.owner !== privyId || (!state.gridBot && !state.loading)) void load(privyId);
  }, [privyId]);

  const refresh = useCallback(() => (privyId ? load(privyId) : Promise.resolve()), [privyId]);

  /** Apply for the Grid beta. Rejects with a message fit to show the user. */
  const applyGridBeta = useCallback(async () => {
    if (!privyId) throw new Error("Sign in first.");
    const { gridBot } = await api.applyGridBeta(privyId);
    if (state.owner === privyId) setState({ gridBot });
    return gridBot;
  }, [privyId]);

  /** Apply for the Signals beta. Rejects with a message fit to show the user. */
  const applySignalBeta = useCallback(async () => {
    if (!privyId) throw new Error("Sign in first.");
    const { signalBot } = await api.applySignalBeta(privyId);
    if (state.owner === privyId) setState({ signalBot });
    return signalBot;
  }, [privyId]);

  const mine = s.owner === privyId ? s : { gridBot: null, signalBot: null, loading: !!privyId };
  return { gridBot: mine.gridBot, signalBot: mine.signalBot, loading: mine.loading, refresh, applyGridBeta, applySignalBeta };
}
