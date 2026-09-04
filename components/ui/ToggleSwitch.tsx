"use client";

// Shared iOS-style on/off switch. On = brand green.
//
// The knob is BLACK, not white: on the brand green it reads as a deliberate
// cut-out at the app's own background colour, and it keeps the same contrast
// against the off state's pale track. A white knob on green washed out.
export function ToggleSwitch({
  on,
  onChange,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
        on ? "bg-up" : "bg-white/15"
      }`}
    >
      <span
        className={`absolute top-1 h-5 w-5 rounded-full bg-bg shadow transition-all ${
          on ? "left-6" : "left-1"
        }`}
      />
    </button>
  );
}
