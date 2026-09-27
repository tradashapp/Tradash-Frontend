// Bridges the live chart's candle viewport to controls rendered elsewhere in
// the layout (the re-center button sits in the toolbar row on mobile, beside
// the scale on desktop). One live chart is mounted at a time, so this is a
// single module-level slot rather than React context threaded through layouts.

type Listener = () => void;

let offCenter = false;
let recenterHandler: (() => void) | null = null;
const listeners = new Set<Listener>();

export const chartViewport = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** True while the candle view has been panned / zoomed away from live. */
  isOffCenter(): boolean {
    return offCenter;
  },
  setOffCenter(next: boolean) {
    if (next === offCenter) return;
    offCenter = next;
    listeners.forEach((l) => l());
  },
  /** The mounted chart registers how to recenter; null on unmount. */
  setRecenterHandler(handler: (() => void) | null) {
    recenterHandler = handler;
    if (!handler) chartViewport.setOffCenter(false);
  },
  recenter() {
    recenterHandler?.();
  },
};
