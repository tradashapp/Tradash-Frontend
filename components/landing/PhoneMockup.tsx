"use client";

import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

// An iPhone shell for the live demo screen. Pure CSS: a dark bezel with a
// bright rim highlight, the Dynamic Island, side buttons, and a screen that
// clips its contents to the inner radius.
export function PhoneMockup({ children }: Props) {
  return (
    <div className="relative">
      {/* Ambient glow so the device separates from the dot grid behind it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-16 -inset-y-10 -z-10 rounded-[60px] opacity-70 blur-3xl"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 45%, rgba(114,233,18,0.16), transparent 70%)",
        }}
      />

      <div
        className="relative rounded-[3rem] p-[3px] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)]"
        style={{
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.28), rgba(255,255,255,0.05) 30%, rgba(255,255,255,0.02) 60%, rgba(255,255,255,0.16))",
        }}
      >
        {/* Side buttons */}
        <span
          aria-hidden
          className="absolute -left-[2px] top-[110px] h-8 w-[3px] rounded-l-sm bg-white/15"
        />
        <span
          aria-hidden
          className="absolute -left-[2px] top-[158px] h-14 w-[3px] rounded-l-sm bg-white/15"
        />
        <span
          aria-hidden
          className="absolute -left-[2px] top-[224px] h-14 w-[3px] rounded-l-sm bg-white/15"
        />
        <span
          aria-hidden
          className="absolute -right-[2px] top-[180px] h-20 w-[3px] rounded-r-sm bg-white/15"
        />

        <div className="relative overflow-hidden rounded-[2.85rem] bg-black p-[10px]">
          <div className="relative h-[560px] w-[272px] overflow-hidden rounded-[2.3rem] sm:h-[600px] sm:w-[292px]">
            {children}

            {/* Dynamic Island sits above the screen content. */}
            <div
              aria-hidden
              className="absolute left-1/2 top-2 z-30 h-[22px] w-[80px] -translate-x-1/2 rounded-full bg-black"
            />
            {/* Home indicator */}
            <div
              aria-hidden
              className="absolute bottom-1.5 left-1/2 z-30 h-[3px] w-[92px] -translate-x-1/2 rounded-full bg-white/40"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
