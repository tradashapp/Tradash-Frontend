// Referral links: tradash.xyz/?ref=<code>.
//
// A visitor usually arrives logged out, so the code is held in localStorage
// until the login sync carries it to the backend, which decides whether it
// applies (new accounts only, never your own code, one referrer for life).
// The latest link clicked wins; a code older than REF_TTL_MS is dropped.

const KEY = "tradash.ref";
const REF_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_RE = /^[A-Za-z0-9_]{3,20}$/;

interface Stored {
  code: string;
  at: number;
}

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Stored;
    if (!s?.code || !CODE_RE.test(s.code) || Date.now() - s.at > REF_TTL_MS) return null;
    return s;
  } catch {
    return null;
  }
}

/**
 * Read `?ref=` from the current URL, remember it, and drop it from the address
 * bar so a visitor who re-shares the page doesn't pass someone else's code on.
 */
export function captureReferralFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const code = url.searchParams.get("ref")?.trim() ?? "";
  if (!code) return pendingReferral();
  url.searchParams.delete("ref");
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  if (!CODE_RE.test(code)) return pendingReferral();
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() } satisfies Stored));
  } catch {
    // Storage blocked: the code can still be typed in from the app.
  }
  return code;
}

/** The code waiting to be sent with the login sync, if any. */
export function pendingReferral(): string | null {
  if (typeof window === "undefined") return null;
  return read()?.code ?? null;
}

export function clearPendingReferral(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

// The signed-in user's own code, for share links built outside the referral
// panel (the PnL card). Filled whenever the referral summary loads.
let myCode: string | null = null;

export function setMyReferralCode(code: string | null): void {
  myCode = code;
}

export function myReferralCode(): string | null {
  return myCode;
}
