"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { api } from "@/lib/api";
import { normalizeUsername } from "@/lib/username";

/**
 * The signed-in user's PUBLIC profile — the handle and avatar other people see
 * on the leaderboard.
 *
 * Distinct from the avatar in settings, which is local-only: a data-URL living
 * in this browser's localStorage that nobody else can render. When a photo is
 * uploaded here it goes to the storage bucket and the returned URL becomes the
 * shared identity.
 *
 * The state is MODULE-level rather than per-hook because several components
 * show the same identity at once — the account sheet's header and the balance
 * pill in the corner. With a copy each, renaming yourself in the sheet left the
 * pill showing the old initials until a reload, and every mount refetched the
 * same row. One store, one fetch, every consumer updated together.
 */
interface ProfileState {
  username: string | null;
  avatarUrl: string | null;
  /**
   * What is being written right now, if anything. Split by field rather than a
   * single `saving` flag because the edit panel shows the name and the photo
   * side by side: one boolean spun the username's tick while a PHOTO uploaded,
   * and disabled the save button with it.
   */
  savingUsername: boolean;
  savingAvatar: boolean;
  /**
   * True until the stored profile has been fetched (or failed) for this user.
   *
   * Consumers need this to tell "no avatar" from "avatar not loaded yet" —
   * without it the pill renders initials, or a blank circle, for the first beat
   * after login and then swaps to the real photo. A skeleton while `loading` is
   * both honest and stable.
   */
  loading: boolean;
}

const EMPTY: ProfileState = {
  username: null,
  avatarUrl: null,
  savingUsername: false,
  savingAvatar: false,
  loading: false,
};

let state: ProfileState = EMPTY;
/** The Privy DID `state` describes, so a re-login can't show the last user. */
let loadedFor: string | null = null;
const listeners = new Set<() => void>();

function setState(patch: Partial<ProfileState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => state;
// The server has no signed-in user, so it renders the empty profile. A separate
// constant (never reassigned) keeps this snapshot referentially stable.
const getServerSnapshot = () => EMPTY;

export function useProfile() {
  const { user, authenticated } = usePrivy();
  const privyId = user?.id ?? null;

  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  // Load the stored profile once we know who we are. Guarded on `loadedFor` so
  // the second consumer to mount reuses what the first fetched.
  useEffect(() => {
    if (!privyId || !authenticated) {
      if (loadedFor !== null) {
        loadedFor = null;
        setState(EMPTY);
      }
      return;
    }
    if (loadedFor === privyId) return;
    loadedFor = privyId;
    setState({ loading: true });
    api
      .fetchProfile(privyId)
      .then((p) => {
        // A logout mid-flight (or a switch to another account) invalidates this
        // response — dropping it keeps one user's name off another's screen.
        if (loadedFor !== privyId) return;
        setState({ username: p.username, avatarUrl: p.avatarUrl, loading: false });
      })
      .catch(() => {
        // Clear `loading` on failure too, or the UI shows a skeleton forever.
        // Falling back to the Privy-derived identity is right here: it's the
        // same person, just not the stored handle.
        if (loadedFor === privyId) setState({ loading: false });
      });
  }, [privyId, authenticated]);

  /**
   * Claim a handle. Resolves an outcome rather than throwing, because "taken"
   * is a normal answer the form has to render inline.
   */
  const claimUsername = useCallback(
    async (raw: string): Promise<"ok" | "taken" | "invalid" | "error"> => {
      if (!privyId) return "error";
      const name = normalizeUsername(raw.trim().replace(/^@/, ""));
      if (!name) return "invalid";
      setState({ savingUsername: true });
      try {
        const ok = await api.claimUsername(privyId, name);
        if (ok) setState({ username: name });
        return ok ? "ok" : "taken";
      } catch {
        return "error";
      } finally {
        setState({ savingUsername: false });
      }
    },
    [privyId]
  );

  /** Upload a photo (base64 data URL) and adopt the returned public URL. */
  const uploadAvatar = useCallback(
    async (dataUrl: string): Promise<boolean> => {
      if (!privyId) return false;
      setState({ savingAvatar: true });
      try {
        setState({ avatarUrl: await api.uploadAvatar(privyId, dataUrl) });
        return true;
      } catch {
        return false;
      } finally {
        setState({ savingAvatar: false });
      }
    },
    [privyId]
  );

  /**
   * Re-host a photo that lives on another server (the X profile picture) and
   * adopt the resulting bucket URL.
   */
  const importAvatar = useCallback(
    async (remoteUrl: string): Promise<boolean> => {
      if (!privyId) return false;
      setState({ savingAvatar: true });
      try {
        setState({ avatarUrl: await api.importAvatar(privyId, remoteUrl) });
        return true;
      } catch {
        return false;
      } finally {
        setState({ savingAvatar: false });
      }
    },
    [privyId]
  );

  return {
    username: snapshot.username,
    avatarUrl: snapshot.avatarUrl,
    loading: snapshot.loading,
    savingUsername: snapshot.savingUsername,
    savingAvatar: snapshot.savingAvatar,
    claimUsername,
    uploadAvatar,
    importAvatar,
  };
}

/**
 * Record an avatar adopted outside the hook — the X photo imported once at
 * login (see useAgentWallet) — so the pill and the sheet show it without
 * waiting for a reload.
 */
export function setProfileAvatar(avatarUrl: string) {
  setState({ avatarUrl });
}
