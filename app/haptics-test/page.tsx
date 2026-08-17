"use client";

/**
 * TEMPORARY diagnostic page — /haptics-test
 *
 * iOS Safari has never shipped the Vibration API in a way we can rely on, and
 * the community workarounds keep getting patched. Rather than guess which
 * technique this device supports, this page tries each one in isolation so we
 * can see what actually fires on real hardware. Delete once we've picked one.
 */

import { useEffect, useRef, useState } from "react";

export default function HapticsTest() {
  const [log, setLog] = useState<string[]>([]);
  const [ua, setUa] = useState("");
  const switchRef = useRef<HTMLInputElement>(null);
  const labelRef = useRef<HTMLLabelElement>(null);

  useEffect(() => {
    setUa(navigator.userAgent);
    setLog([
      `"vibrate" in navigator: ${"vibrate" in navigator}`,
      `typeof navigator.vibrate: ${typeof navigator.vibrate}`,
      `maxTouchPoints: ${navigator.maxTouchPoints}`,
      `standalone (PWA): ${
        (window.navigator as unknown as { standalone?: boolean }).standalone ??
        "n/a"
      }`,
      `switch attr supported: ${"switch" in document.createElement("input")}`,
    ]);
  }, []);

  const say = (m: string) =>
    setLog((l) => [...l, `${new Date().toISOString().slice(14, 23)} ${m}`]);

  // A: the standard Vibration API.
  const testVibrate = () => {
    if (!("vibrate" in navigator)) return say("A: navigator.vibrate ABSENT");
    const ok = navigator.vibrate(30);
    say(`A: navigator.vibrate(30) returned ${ok}`);
  };

  // B: click the <label> bound to a switch checkbox (Safari 17.4+ trick).
  const testLabel = () => {
    labelRef.current?.click();
    say("B: label.click() fired");
  };

  // C: click the switch input directly (expected to NOT haptic, for contrast).
  const testInput = () => {
    switchRef.current?.click();
    say("C: input.click() fired");
  };

  return (
    <div className="min-h-dvh overflow-y-auto bg-bg p-5 text-text">
      <h1 className="mb-1 text-lg font-semibold">Haptics diagnostic</h1>
      <p className="mb-4 text-xs text-text-muted">
        Tap each button on the iPhone. Note which ones you actually FEEL.
      </p>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={testVibrate}
          className="rounded-2xl bg-up py-4 font-semibold text-black active:scale-95"
        >
          A — navigator.vibrate(30)
        </button>

        <button
          type="button"
          onClick={testLabel}
          className="rounded-2xl bg-up py-4 font-semibold text-black active:scale-95"
        >
          B — label.click() → switch
        </button>

        <button
          type="button"
          onClick={testInput}
          className="rounded-2xl bg-white/10 py-4 font-semibold active:scale-95"
        >
          C — input.click() direct
        </button>

        {/* D: a REAL switch you toggle by hand. This is the control: if this
            doesn't buzz, the device/OS gives no web haptics at all and no
            amount of scripting will change that. */}
        <label className="flex items-center justify-between rounded-2xl bg-white/10 px-4 py-4 font-semibold">
          D — toggle this switch by hand
          {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
          {/* @ts-expect-error — `switch` is a Safari-only attribute */}
          <input type="checkbox" switch="" className="h-7 w-12" />
        </label>
      </div>

      {/* Hidden pair used by B and C. Kept in the layout (not display:none) —
          Safari ignores haptics for fully hidden controls. */}
      <label
        ref={labelRef}
        className="pointer-events-none absolute opacity-0"
        aria-hidden="true"
      >
        {/* @ts-expect-error — `switch` is a Safari-only attribute */}
        <input ref={switchRef} type="checkbox" switch="" tabIndex={-1} />
      </label>

      <pre className="mt-5 whitespace-pre-wrap break-all rounded-xl bg-white/5 p-3 text-[10px] leading-relaxed text-text-muted">
        {ua}
        {"\n\n"}
        {log.join("\n")}
      </pre>
    </div>
  );
}
