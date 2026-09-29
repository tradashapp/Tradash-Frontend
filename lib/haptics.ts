// Haptic feedback, gated by the user's hapticsEnabled setting.
//
// Two delivery paths, because iOS is a special case:
//
//   1. Vibration API (navigator.vibrate) — Android/Chrome, and reportedly some
//      recent iOS builds. Free, supports patterns.
//   2. Safari "switch" trick — Safari 17.4+ shipped <input type=checkbox switch>,
//      which plays a real system haptic when toggled. Clicking the associated
//      <label> from script triggers it; clicking the input directly does NOT.
//      This is the only way to get haptics in iOS Safari, which has never
//      shipped a usable Vibration API.
//
// We try (1) and fall back to (2). Neither is guaranteed: Apple has tightened
// the switch behaviour across releases, and iOS gives no way to feature-detect
// whether a haptic actually played. So this is best-effort by design — it must
// never throw or block the interaction it accompanies.

export type HapticKind =
  | "tap"
  | "tick"
  | "open"
  | "close"
  | "move"
  | "surge"
  | "mega"
  | "slump"
  | "warn";

const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 8,
  // The lightest pulse: detents while scrubbing the chart crosshair, which can
  // fire many times a second, so it must stay barely-there.
  tick: 3,
  open: [12, 20, 12],
  close: 20,
  // Momentum feedback (useMomentumFeedback). A favorable step fires every
  // second or so in a trend, so it sits just above a detent.
  move: 6,
  // The market ripping your way: a rolling triple, then the full surge.
  surge: [25, 35, 25, 35, 45],
  mega: [40, 30, 40, 30, 40, 30, 80],
  // Against you: one dull thud, not a celebration in reverse.
  slump: 35,
  // Close to liquidation — two long pulses, distinct from every other kind.
  warn: [80, 60, 80],
};

// Kinds strong enough to be worth several iOS switch ticks in a row. The iOS
// path has no intensity control, so "strong" can only mean "more ticks".
const IOS_PULSES: Partial<Record<HapticKind, number>> = {
  surge: 3,
  mega: 5,
  warn: 2,
};
const IOS_PULSE_GAP_MS = 70;

let enabledGetter: () => boolean = () => true;

// The hidden label/input pair used for the iOS path. Created lazily on first
// use so we never touch the DOM during module init (SSR-safe).
let switchLabel: HTMLLabelElement | null = null;

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as a Mac, so also check for touch support.
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

/** Build (once) the offscreen switch control that Safari will haptic on. */
function getSwitchLabel(): HTMLLabelElement | null {
  if (typeof document === "undefined") return null;
  if (switchLabel?.isConnected) return switchLabel;

  const input = document.createElement("input");
  input.type = "checkbox";
  // The Safari-only attribute that turns a checkbox into a haptic switch.
  input.setAttribute("switch", "");
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");

  const label = document.createElement("label");
  // Must stay rendered and hit-testable-ish: Safari skips the haptic for
  // display:none / visibility:hidden controls. Park it offscreen instead.
  label.style.cssText =
    "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
  label.setAttribute("aria-hidden", "true");
  label.appendChild(input);
  document.body.appendChild(label);

  switchLabel = label;
  return label;
}

export function initHaptics(isEnabled: () => boolean) {
  enabledGetter = isEnabled;
  // Pre-build the switch on iOS so the first haptic isn't delayed by a DOM
  // insert (and so any layout cost lands at startup, not mid-trade).
  if (isIos()) {
    try {
      getSwitchLabel();
    } catch {
      /* non-fatal */
    }
  }
}

export function haptic(kind: HapticKind) {
  if (!enabledGetter()) return;
  if (typeof navigator === "undefined") return;

  // Path 1: the real Vibration API. navigator.vibrate() returns false when the
  // request is rejected (and iOS Safari historically lacks it entirely), so
  // treat a falsy return as "didn't fire" and fall through.
  try {
    if (typeof navigator.vibrate === "function") {
      if (navigator.vibrate(PATTERNS[kind])) return;
    }
  } catch {
    /* fall through to the iOS path */
  }

  // Path 2: iOS switch trick. Discrete ticks only — the API has no intensity
  // or pattern control, so strong kinds repeat the tick (IOS_PULSES) instead.
  // Toggling the checkbox is a side effect we don't care about (nothing reads
  // its value).
  try {
    const label = getSwitchLabel();
    label?.click();
    const extra = (IOS_PULSES[kind] ?? 1) - 1;
    for (let i = 1; i <= extra; i++) {
      setTimeout(() => label?.click(), i * IOS_PULSE_GAP_MS);
    }
  } catch {
    /* unsupported — give up silently */
  }
}
