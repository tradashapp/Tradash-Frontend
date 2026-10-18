import { api } from "@/lib/api";

/**
 * Browser push for this device: permission, the PushManager subscription, and
 * its registration with the backend.
 *
 * Needs the service worker, which only runs in PRODUCTION builds (RegisterSW
 * unregisters it in dev so stale bundles can't be served) — in `next dev`
 * `pushState()` reports "no-worker". iOS only offers push to the installed
 * app (Add to Home Screen), never to a Safari tab.
 */

const CHANNEL_KEY = "tradash.push.channel.v1";

export type PushState = "unsupported" | "ios-install" | "no-worker" | "denied" | "off" | "on";

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function standalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

function savedChannel(): string | null {
  try {
    return localStorage.getItem(CHANNEL_KEY);
  } catch {
    return null;
  }
}

function saveChannel(id: string | null): void {
  try {
    if (id) localStorage.setItem(CHANNEL_KEY, id);
    else localStorage.removeItem(CHANNEL_KEY);
  } catch {
    /* private mode: the subscription still works, we just can't remove it by id */
  }
}

export async function pushState(): Promise<PushState> {
  if (typeof window === "undefined") return "unsupported";
  if (isIos() && !standalone()) return "ios-install";
  if (!("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await registration();
  if (!reg) return "no-worker";
  const sub = await reg.pushManager.getSubscription();
  return sub && savedChannel() ? "on" : "off";
}

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (key.length % 4)) % 4);
  const raw = atob((key + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Ask permission (must run from a tap), subscribe, and register. */
export async function enablePush(privyId: string, publicKey: string): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const reg = await registration();
  if (!reg) return "no-worker";
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another VAPID key can't be reused.
  const current = sub?.options.applicationServerKey;
  if (sub && current && base64url(current) !== publicKey) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const { id } = await api.registerWebPush(privyId, sub.toJSON());
  saveChannel(id);
  return "on";
}

export async function disablePush(privyId: string): Promise<PushState> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  await sub?.unsubscribe().catch(() => false);
  const id = savedChannel();
  saveChannel(null);
  if (id) await api.removeNotificationChannel(privyId, id).catch(() => undefined);
  return "off";
}
