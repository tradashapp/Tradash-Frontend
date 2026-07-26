// Haptic feedback via the Vibration API (mobile). Gated by the user's
// hapticsEnabled setting. No-op where unsupported (desktop / iOS Safari).

export type HapticKind = "tap" | "open" | "close";

const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 8,
  open: [12, 20, 12],
  close: 20,
};

let enabledGetter: () => boolean = () => true;

export function initHaptics(isEnabled: () => boolean) {
  enabledGetter = isEnabled;
}

export function haptic(kind: HapticKind) {
  if (!enabledGetter()) return;
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    /* unsupported — ignore */
  }
}
