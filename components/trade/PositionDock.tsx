"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Coins01Icon,
  ArrowUp01Icon,
  ArrowDown01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { formatUsd } from "@/lib/format";
import { Odometer } from "@/components/ui/Odometer";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import type { useTrade } from "@/hooks/useTrade";

// Quick step amounts (USD margin), MT5-style. Manual entry (tap the number)
// covers anything in between.
const QUICK = [10, 25, 50];
const STEP = 5; // ⌄ / ⌃ increment

interface Props {
  trade: ReturnType<typeof useTrade>;
}

// Position dock, docked to the chart's LEFT-CENTER. Degen-simple, MT5-inspired:
// collapsed it's a slim coin tab; expanded it's Add (green, opens more size) /
// amount / Reduce (red, partial close). The amount is USD margin at the
// position's current leverage. Only shown while a position is open.
export function PositionDock({ trade }: Props) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number>(QUICK[1]); // $25 default

  // The position's posted margin caps how much can be reduced — you can't reduce
  // more than you hold (it just closes). We clamp the reduce amount to this so
  // the button never implies otherwise; Add is uncapped.
  const marginUsed = trade.position?.marginUsed ?? 0;
  const reduceOver = amount > marginUsed && marginUsed > 0;

  // One-time "peek" nudge so the tab is noticed, then it rests flush.
  const [peeked, setPeeked] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setPeeked(true), 1400);
    return () => clearTimeout(id);
  }, []);

  const toggle = () => {
    playSound("tap");
    haptic("tap");
    setOpen((o) => !o);
  };

  return (
    <div className="pointer-events-auto absolute left-0 top-1/2 z-30 -translate-y-1/2">
      <AnimatePresence mode="wait" initial={false}>
        {!open ? (
          <motion.button
            key="mini"
            type="button"
            onClick={toggle}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: peeked ? 0 : 4 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="glass flex flex-col items-center gap-1 rounded-r-2xl !border !border-dashed !border-l-0 !border-white/40 py-3 pl-2 pr-3 shadow-lg transition-transform active:scale-95"
            aria-label="Adjust position size"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-up-soft text-up">
              <HugeiconsIcon icon={Coins01Icon} size={18} />
            </span>
            <span className="tabular text-xs font-semibold leading-none">
              <Odometer value={formatUsd(amount)} />
            </span>
          </motion.button>
        ) : (
          <motion.div
            key="panel"
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="glass flex w-44 flex-col gap-2 rounded-r-2xl !border !border-dashed !border-l-0 !border-white/40 p-2 shadow-2xl"
          >
            {/* Add (green) — opens more size in the same direction */}
            <ActionButton
              tone="up"
              label="Add"
              onClick={() => trade.increase(amount)}
            />

            {/* Middle: MT5-style amount — ⌄ [tap-to-type] ⌃ + quick chips */}
            <AmountControl amount={amount} onChange={setAmount} />

            {/* Reduce (red) — partial close, clamped to the posted margin */}
            <div className="flex flex-col">
              <ActionButton
                tone="down"
                label="Reduce"
                onClick={() => trade.decrease(Math.min(amount, marginUsed))}
              />
              {reduceOver && (
                <span className="mt-0.5 text-center text-[10px] text-text-muted">
                  Max ${marginUsed.toFixed(marginUsed < 10 ? 2 : 0)} to reduce
                </span>
              )}
            </div>

            {/* Collapse */}
            <button
              type="button"
              onClick={toggle}
              className="mx-auto mt-0.5 text-text-muted transition-colors hover:text-text"
              aria-label="Collapse"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={14} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Big rounded-full action button, text only — green "Add" / red "Reduce". No
// arrows: color + word carry the meaning (up/down would read as trade
// direction, but you can add to a SHORT too).
function ActionButton({
  tone,
  label,
  onClick,
}: {
  tone: "up" | "down";
  label: string;
  onClick: () => void;
}) {
  const up = tone === "up";
  return (
    <button
      type="button"
      onClick={() => {
        playSound("tap");
        haptic("tap");
        onClick();
      }}
      className={`flex items-center justify-center rounded-full border border-dashed py-3 text-sm font-bold transition-transform active:scale-95 ${
        up ? "bg-up-soft text-up border-up" : "bg-down-soft text-down border-down"
      }`}
    >
      {label}
    </button>
  );
}

// MT5-style amount picker: down/up steppers flanking a tap-to-edit number, with
// a row of quick-set chips underneath.
function AmountControl({
  amount,
  onChange,
}: {
  amount: number;
  onChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(amount));
  const inputRef = useRef<HTMLInputElement | null>(null);

  const commit = () => {
    const v = Number(draft);
    onChange(!Number.isNaN(v) && v > 0 ? v : amount);
    setEditing(false);
  };
  const startEdit = () => {
    setDraft(String(amount));
    setEditing(true);
    requestAnimationFrame(() => inputRef.current?.select());
  };
  const bump = (d: number) => {
    haptic("tap");
    onChange(Math.max(1, amount + d));
  };

  return (
    <div className="rounded-xl bg-white/[0.04] p-1.5">
      <div className="flex items-center justify-between">
        <StepBtn dir="down" onClick={() => bump(-STEP)} />
        {editing ? (
          <input
            ref={inputRef}
            type="number"
            inputMode="decimal"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setEditing(false);
            }}
            className="tabular w-16 bg-transparent text-center text-base font-bold text-text outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={startEdit}
            className="tabular w-16 text-center text-base font-bold text-text"
            aria-label="Edit amount"
          >
            {formatUsd(amount)}
          </button>
        )}
        <StepBtn dir="up" onClick={() => bump(STEP)} />
      </div>
      <div className="mt-1.5 flex justify-center gap-1">
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => {
              haptic("tap");
              onChange(q);
            }}
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular transition-colors ${
              amount === q
                ? "bg-up text-black"
                : "bg-white/5 text-text-muted hover:text-text"
            }`}
          >
            ${q}
          </button>
        ))}
      </div>
    </div>
  );
}

function StepBtn({ dir, onClick }: { dir: "up" | "down"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/5 text-text-muted transition-colors hover:text-text active:scale-90"
      aria-label={dir === "up" ? "Increase" : "Decrease"}
    >
      <HugeiconsIcon icon={dir === "up" ? ArrowUp01Icon : ArrowDown01Icon} size={14} />
    </button>
  );
}
