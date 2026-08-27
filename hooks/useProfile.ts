"use client";

import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { api } from "@/lib/api";
import { normalizeUsername } from "@/lib/username";

/**
 * The signed-in user's PUBLIC profile — the handle and avatar other people see
 * on the leaderboard.
 *
 * Distinct from the avatar in settings, which is local-only: that one is an
 * emoji or a data-URL living in this browser's localStorage and can't be
 * rendered by anyone else. When a photo is uploaded here it goes to the storage
 * bucket and the returned URL becomes the shared identity.
 */
export function useProfile() {
  const { user, authenticated } = usePrivy();
  const privyId = user?.id ?? null;

  const [username, setUsername] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Load the stored profile once we know who we are.
  useEffect(() => {
    if (!privyId || !authenticated) {
      setUsername(null);
      setAvatarUrl(null);
      return;
    }
    let live = true;
    api
      .fetchProfile(privyId)
      .then((p) => {
        if (!live) return;
        setUsername(p.username);
        setAvatarUrl(p.avatarUrl);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
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
      setSaving(true);
      try {
        const ok = await api.claimUsername(privyId, name);
        if (ok) setUsername(name);
        return ok ? "ok" : "taken";
      } catch {
        return "error";
      } finally {
        setSaving(false);
      }
    },
    [privyId]
  );

  /** Upload a photo (base64 data URL) and adopt the returned public URL. */
  const uploadAvatar = useCallback(
    async (dataUrl: string): Promise<boolean> => {
      if (!privyId) return false;
      setSaving(true);
      try {
        setAvatarUrl(await api.uploadAvatar(privyId, dataUrl));
        return true;
      } catch {
        return false;
      } finally {
        setSaving(false);
      }
    },
    [privyId]
  );

  return { username, avatarUrl, saving, claimUsername, uploadAvatar };
}
