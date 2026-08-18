// Tracks whether the boot splash is still covering the screen.
//
// The splash lives in the root layout while the chart lives deep in the page
// tree, so they can't share React state without threading a provider through
// everything in between. This is a module-level store instead: the splash
// publishes its state, and the chart subscribes so it can stay paused while it
// is completely hidden (see useSplashDone).
//
// Deliberately NOT in Redux — this flips exactly twice per session and is read
// by a 60fps render loop, so it shouldn't go through the store.

let done = false;
const listeners = new Set<() => void>();

/** True once the splash has fully dismissed and the app is visible. */
export function isSplashDone(): boolean {
  return done;
}

/** Called by the splash when it finishes its exit animation. */
export function markSplashDone() {
  if (done) return;
  done = true;
  for (const fn of listeners) fn();
}

export function subscribeToSplash(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
