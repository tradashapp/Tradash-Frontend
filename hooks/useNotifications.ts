"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { api, type NotificationItem } from "@/lib/api";

/**
 * The signed-in user's notification inbox and unread count.
 *
 * Module-level (like useFeatures) so the bell's badge and the inbox panel read
 * one copy. The unread count is polled while the tab is visible and refreshed
 * whenever it becomes visible again — a push that arrived while away shows up
 * as soon as the user is back.
 */

interface State {
  owner: string | null;
  unread: number;
  items: NotificationItem[];
  loading: boolean;
  /** No older page left. */
  end: boolean;
}

let state: State = { owner: null, unread: 0, items: [], loading: false, end: false };
const listeners = new Set<() => void>();
const POLL_MS = 60_000;

function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => state;

async function refreshUnread(owner: string) {
  try {
    const { unread } = await api.notificationsUnread(owner);
    if (state.owner === owner) setState({ unread });
  } catch {
    // A backend without migration 017 (or offline) = no badge, not an error.
  }
}

export function useNotifications() {
  const { user, authenticated } = usePrivy();
  const privyId = authenticated ? (user?.id ?? null) : null;
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    if (!privyId) {
      if (state.owner) setState({ owner: null, unread: 0, items: [], end: false });
      return;
    }
    if (state.owner !== privyId) setState({ owner: privyId, unread: 0, items: [], end: false });
    void refreshUnread(privyId);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshUnread(privyId);
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshUnread(privyId);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [privyId]);

  /** First page (replaces the list). */
  const load = useCallback(async () => {
    if (!privyId) return;
    setState({ loading: true });
    try {
      const page = await api.notifications(privyId);
      if (state.owner === privyId) setState({ items: page.items, unread: page.unread, end: page.items.length < 30 });
    } finally {
      setState({ loading: false });
    }
  }, [privyId]);

  const loadMore = useCallback(async () => {
    const last = state.items[state.items.length - 1];
    if (!privyId || !last || state.end || state.loading) return;
    setState({ loading: true });
    try {
      const page = await api.notifications(privyId, last.createdAt);
      if (state.owner === privyId) setState({ items: [...state.items, ...page.items], end: page.items.length < 30 });
    } finally {
      setState({ loading: false });
    }
  }, [privyId]);

  const markAllRead = useCallback(async () => {
    if (!privyId || state.unread === 0) return;
    setState({ unread: 0, items: state.items.map((n) => ({ ...n, read: true })) });
    await api.notificationsRead(privyId, "all").catch(() => refreshUnread(privyId));
  }, [privyId]);

  return { ...s, privyId, load, loadMore, markAllRead };
}
