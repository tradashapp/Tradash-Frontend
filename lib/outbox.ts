"use client";

/**
 * A durable retry queue for writes that must not be lost when the backend is
 * unreachable.
 *
 * The problem this solves: trades execute against BULK, not against our API.
 * So an order can fill perfectly while our own backend is down, and the trade
 * row — the thing that feeds history, stats and the leaderboard — would just
 * vanish. Every one of these calls used to be `api.recordTrade(...).catch(() => {})`,
 * which is fire-and-forget: the failure was swallowed and the trade was gone
 * for good.
 *
 * The standard answer is an outbox: persist the intent, then retry it in the
 * background until the server acknowledges it.
 *
 *   - Queued in localStorage, so a reload or a crash mid-outage doesn't drop it.
 *   - Retried with exponential backoff, and again on `online` / tab-focus, both
 *     of which are far better signals than a timer that a dead network is back.
 *   - Given up on only for a 4xx, which means the server understood us and
 *     refused — retrying that forever would just be a poison message. 5xx and
 *     network errors retry, because those are the recoverable ones.
 *
 * Writes go through here; READS do not. A failed read is retried simply by
 * asking again, and stale reads should surface as a loading or error state
 * rather than being replayed later.
 */

const KEY = "tradash.outbox.v1";
/** Cap the queue so a long outage can't grow localStorage without bound. */
const MAX_ITEMS = 200;
/** Stop retrying an item after this long — beyond it the data is stale anyway. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 5 * 60 * 1000;

export interface OutboxItem {
  id: string;
  /** Path relative to the API base, e.g. `/users/abc/trades`. */
  path: string;
  method: "POST" | "PUT" | "PATCH";
  body: unknown;
  /** Attempts made so far — drives the backoff. */
  attempts: number;
  /** When it was first queued (ms epoch), for the age cap. */
  queuedAt: number;
  /** Earliest ms epoch to try again. */
  nextAt: number;
}

type Sender = (item: OutboxItem) => Promise<void>;

let sender: Sender | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
const listeners = new Set<() => void>();

function read(): OutboxItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as OutboxItem[]) : [];
  } catch {
    // Corrupt or unavailable storage (private mode, quota) — behave as empty
    // rather than taking the app down over a background retry queue.
    return [];
  }
}

function write(items: OutboxItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(items.slice(-MAX_ITEMS)));
  } catch {
    // Full or blocked storage: the in-flight retry still runs this session.
  }
  for (const l of listeners) l();
}

/** Number of writes still waiting to reach the server. */
export function pendingCount(): number {
  return read().length;
}

export function subscribeOutbox(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Register how an item is actually sent. Called once by the api module. */
export function setOutboxSender(fn: Sender) {
  sender = fn;
}

/**
 * Try `send` now; if it fails in a retryable way, persist it and keep trying in
 * the background. Resolves true when the write landed immediately.
 */
export async function enqueue(
  path: string,
  method: OutboxItem["method"],
  body: unknown
): Promise<boolean> {
  const item: OutboxItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    path,
    method,
    body,
    attempts: 0,
    queuedAt: Date.now(),
    nextAt: 0,
  };
  if (!sender) {
    persist(item);
    return false;
  }
  try {
    await sender(item);
    return true;
  } catch (e) {
    // A 4xx means the server rejected the CONTENT — replaying it can only fail
    // the same way, so drop it rather than queue a poison message forever.
    if (isPermanent(e)) return false;
    persist(item);
    schedule();
    return false;
  }
}

function persist(item: OutboxItem) {
  const items = read();
  items.push(item);
  write(items);
}

/** True for an error the server will answer identically no matter how often we ask. */
function isPermanent(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  return typeof status === "number" && status >= 400 && status < 500;
}

function delayFor(attempts: number): number {
  // Exponential with full jitter, so a fleet of clients coming back online
  // together doesn't retry in lockstep and knock the API over again.
  const capped = Math.min(BASE_DELAY_MS * 2 ** attempts, MAX_DELAY_MS);
  return Math.random() * capped;
}

function schedule() {
  if (typeof window === "undefined" || timer) return;
  const items = read();
  if (items.length === 0) return;
  const soonest = Math.min(...items.map((i) => i.nextAt));
  const wait = Math.max(0, soonest - Date.now());
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, wait);
}

/**
 * Attempt every due item, oldest first. Ordering matters: trade rows are
 * replayed in the order they happened, so history doesn't come back scrambled.
 */
export async function flush(): Promise<void> {
  if (flushing || !sender || typeof window === "undefined") return;
  if (!navigator.onLine) return;
  flushing = true;
  try {
    let items = read();
    const now = Date.now();
    const keep: OutboxItem[] = [];

    for (const item of items) {
      if (now - item.queuedAt > MAX_AGE_MS) continue; // too stale to matter
      if (item.nextAt > now) {
        keep.push(item);
        continue;
      }
      try {
        await sender(item);
        // Landed — drop it by simply not keeping it.
      } catch (e) {
        if (isPermanent(e)) continue; // rejected on content; stop retrying
        item.attempts += 1;
        item.nextAt = Date.now() + delayFor(item.attempts);
        keep.push(item);
      }
    }
    items = keep;
    write(items);
  } finally {
    flushing = false;
    schedule();
  }
}

/**
 * Start the background retry loop. Idempotent, so every mount can call it.
 *
 * `online` and tab-focus are the two events worth listening to: a queue that
 * failed because the network was gone will succeed the moment it returns, and
 * waiting out a backoff timer to discover that wastes the user's session.
 */
export function startOutbox() {
  if (typeof window === "undefined") return;
  const onBack = () => void flush();
  window.addEventListener("online", onBack);
  window.addEventListener("focus", onBack);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flush();
  });
  void flush();
}
