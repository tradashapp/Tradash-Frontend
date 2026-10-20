import type { SignalView } from "@/lib/api";

/**
 * Open a signal's confirm sheet in place. The trade screen listens and opens
 * it at once — no route change, so nothing waits on navigation (a push to the
 * mounted /trade route never re-ran its read of `?signal=`). `signal` is the
 * copy the caller already has, so the sheet can render before its own fetch.
 */
const EVENT = "tradash:open-signal";

export type OpenSignalDetail = { id: string; signal?: SignalView };

export const SIGNAL_ID_RE = /^[0-9a-f-]{36}$/i;

export function openSignal(id: string, signal?: SignalView) {
  window.dispatchEvent(new CustomEvent<OpenSignalDetail>(EVENT, { detail: { id, signal } }));
}

/** The signal id in an in-app URL like `/trade/BTC?signal=<id>`, else null. */
export function signalIdOf(url: string): string | null {
  const id = new URL(url, window.location.origin).searchParams.get("signal");
  return id && SIGNAL_ID_RE.test(id) ? id : null;
}

export function onOpenSignal(fn: (d: OpenSignalDetail) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<OpenSignalDetail>).detail);
  window.addEventListener(EVENT, h);
  return () => window.removeEventListener(EVENT, h);
}
