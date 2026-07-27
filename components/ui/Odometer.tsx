"use client";

import { memo } from "react";

// Odometer / slot-machine number roll. Each DIGIT is a vertical strip of 0-9
// that slides (translateY) to its target. Non-digit chars ($ , . % + −) are
// static. Only digits whose value changed visibly move, and the whole thing is
// pure CSS transforms (no per-frame React), so it stays smooth under fast ticks.
//
// Pass an already-formatted string (e.g. "$63,891.20", "+$42.50", "−1.3%").

const DIGITS = "0123456789";
// One "cell" tall per digit; the strip is 10 cells and we offset by the value.
const CELL_EM = 1.1;

interface Props {
  value: string;
  className?: string;
  /** Roll duration in ms. */
  duration?: number;
}

export const Odometer = memo(function Odometer({
  value,
  className,
  duration = 260,
}: Props) {
  return (
    <span
      className={`tabular inline-flex items-center overflow-hidden leading-none ${className ?? ""}`}
      style={{ height: `${CELL_EM}em` }}
      aria-label={value}
    >
      {value.split("").map((ch, i) =>
        DIGITS.includes(ch) ? (
          <DigitColumn key={i} digit={Number(ch)} duration={duration} />
        ) : (
          <span
            key={i}
            className="inline-flex items-center justify-center"
            style={{ height: `${CELL_EM}em` }}
          >
            {ch}
          </span>
        )
      )}
    </span>
  );
});

function DigitColumn({
  digit,
  duration,
}: {
  digit: number;
  duration: number;
}) {
  return (
    <span
      className="relative inline-block overflow-hidden"
      style={{ height: `${CELL_EM}em`, width: "0.62em" }}
    >
      <span
        className="absolute left-0 top-0 flex flex-col will-change-transform"
        style={{
          transform: `translateY(-${digit * CELL_EM}em)`,
          transition: `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`,
        }}
      >
        {DIGITS.split("").map((d) => (
          <span
            key={d}
            className="flex items-center justify-center"
            style={{ height: `${CELL_EM}em` }}
          >
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}
