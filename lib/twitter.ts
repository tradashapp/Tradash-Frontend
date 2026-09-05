import type { User } from "@privy-io/react-auth";

/**
 * The X (Twitter) profile picture for a signed-in user, at full size.
 *
 * Privy hands back the `_normal` variant, which is 48x48 — fine for a row in a
 * list, visibly soft in the 112px avatar on the account sheet. Twitter serves
 * the original by dropping that suffix, so we strip it before storing the image.
 * Returns null when no X account is linked or it has no picture.
 */
export function twitterAvatarUrl(user: User | null | undefined): string | null {
  const raw = user?.twitter?.profilePictureUrl;
  if (!raw) return null;
  return raw.replace(/_normal(?=\.[A-Za-z]+$|$)/, "");
}

/** The linked X handle, without the leading "@". Null when X isn't linked. */
export function twitterHandle(user: User | null | undefined): string | null {
  return user?.twitter?.username ?? null;
}
