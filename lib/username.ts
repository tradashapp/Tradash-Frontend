import type { User } from "@privy-io/react-auth";

/**
 * A handle suggestion derived from the Privy login. Privy has no single
 * username field, so we take the best identity the login method gave us —
 * Twitter/Discord/GitHub handle, then email local-part.
 *
 * Returns a bare handle with NO leading "@", normalized to the charset the
 * backend accepts (3-20 of [A-Za-z0-9_]), or null when nothing usable is
 * available — a wallet address is deliberately NOT used here: the backend
 * already falls back to a shortened address for display, and claiming one as a
 * `username` would burn the unique handle on a string the user never chose.
 */
export function suggestedUsername(user: User | null | undefined): string | null {
  if (!user) return null;
  const raw =
    user.twitter?.username ??
    user.discord?.username?.split("#")[0] ??
    user.github?.username ??
    (user.email?.address ?? user.google?.email)?.split("@")[0] ??
    null;
  return raw ? normalizeUsername(raw) : null;
}

/**
 * Coerce a candidate into the backend's charset. Anything outside
 * [A-Za-z0-9_] is dropped (dots in email local-parts are the common case) and
 * the result is truncated to 20. Returns null when too little survives to make
 * a valid 3-character handle.
 */
export function normalizeUsername(raw: string): string | null {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "").slice(0, 20);
  return cleaned.length >= 3 ? cleaned : null;
}

/** Client-side mirror of the backend's username rule, for inline validation. */
export const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;
