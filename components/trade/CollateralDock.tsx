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
import type { useCollateral } from "@/hooks/useCollateral";

// Quick-add step amounts (USD), MT5-style. Manual entry (tap the number) covers
// anything in between.
const QUICK = [10, 25, 50];
const STEP = 5; // ⌄ / ⌃ increment

interface Props {
  collateral: ReturnType<typeof useCollateral>;
}

// Account-collateral dock, docked to the chart's LEFT-CENTER. Degen-simple,
// MT5-inspired: collapsed it's a slim coin tab; expanded it's just Add (green) /
// amount / Reduce (red) — big rounded-full buttons, no clutter. Manages the
// shared cross-margin pool (deposit ⇄ withdraw).
export function CollateralDock({ collateral }: Props) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number>(QUICK[1]); // $25 default

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
    <div className="pointer-events-auto absolute left-0 top-1/2 z-20 -translate-y-1/2">
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
            aria-label="Manage collateral"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-up-soft text-up">
              <HugeiconsIcon icon={Coins01Icon} size={18} />
            </span>
            <span className="tabular text-xs font-semibold leading-none">
              <Odometer value={formatUsd(collateral.available)} />
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
            {/* Add (green) — rounded-full, text only (color signals add vs reduce) */}
            <ActionButton
              tone="up"
              label="Add"
              busy={collateral.busy}
              onClick={() => collateral.deposit(amount)}
            />

            {/* Middle: MT5-style amount — ⌄ [tap-to-type] ⌃ + quick chips */}
            <AmountControl amount={amount} onChange={setAmount} />

            {/* Reduce (red) — rounded-full, text only */}
            <ActionButton
              tone="down"
              label="Reduce"
              busy={collateral.busy}
              disabled={!collateral.withdrawEnabled}
              onClick={() => collateral.withdraw(amount)}
            />

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
// arrows: this is collateral, not trade direction, so up/down would mislead
// (you can add collateral to a SHORT). Colour + word carry the meaning.
function ActionButton({
  tone,
  label,
  busy,
  disabled,
  onClick,
}: {
  tone: "up" | "down";
  label: string;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const up = tone === "up";
  return (
    <button
      type="button"
      onClick={() => {
        if (disabled || busy) return;
        playSound("tap");
        haptic("tap");
        onClick();
      }}
      disabled={disabled || busy}
      className={`flex items-center justify-center rounded-full border border-dashed py-3 text-sm font-bold transition-transform active:scale-95 disabled:opacity-45 ${
        up ? "bg-up-soft text-up border-up" : "bg-down-soft text-down border-down"
      }`}
    >
      {label}
    </button>
  );
}

// MT5-style amount picker: down/up steppers flanking a tap-to-edit number, with
// a row of quick-add chips underneath.
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
