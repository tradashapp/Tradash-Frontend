"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Coins01Icon,
  MoneyAdd01Icon,
  MoneyRemove01Icon,
  Edit02Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { formatUsd } from "@/lib/format";
import { Odometer } from "@/components/ui/Odometer";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import type { useCollateral } from "@/hooks/useCollateral";

// Preset step amounts (USD) for deposit/withdraw. Manual entry covers the rest.
const PRESETS = [10, 25, 50, 100];

interface Props {
  collateral: ReturnType<typeof useCollateral>;
  /** Live mark price echoed in the deposit/withdraw rows for context. */
  price?: number;
}

// Account-collateral dock, docked to the LEFT-CENTER of the chart. Collapsed, it
// is a slim vertical tab showing free collateral + a health ring so the user
// knows their cushion lives here. Expanded, it opens a column of three
// compartments: Deposit (green, top), a balance/step editor (middle), and
// Withdraw (red, bottom) — the fast wallet ⇄ trading transfer. This mirrors the
// cross-margin reality: one shared collateral pool, not per-position margin.
export function CollateralDock({ collateral, price }: Props) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number>(PRESETS[1]); // $25 default step
  const [editing, setEditing] = useState(false);

  // One-time "peek" nudge on first mount so the tab is noticed, then it rests.
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
            className="glass flex flex-col items-center gap-1.5 rounded-r-2xl border border-l-0 border-white/10 py-3 pl-2 pr-3 text-center shadow-lg transition-transform active:scale-95"
            aria-label="Manage collateral"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-up-soft text-up">
              <HugeiconsIcon icon={Coins01Icon} size={18} />
            </span>
            <span className="tabular text-xs font-semibold leading-none">
              <Odometer value={formatUsd(collateral.available)} />
            </span>
            <HealthRing ratio={collateral.health} size={22} />
          </motion.button>
        ) : (
          <motion.div
            key="panel"
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="glass w-56 rounded-r-2xl border border-l-0 border-white/10 p-2 shadow-2xl"
          >
            {/* Collapse handle */}
            <div className="mb-1.5 flex items-center justify-between px-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Collateral
              </span>
              <button
                type="button"
                onClick={toggle}
                className="text-text-muted transition-colors hover:text-text"
                aria-label="Collapse"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={14} />
              </button>
            </div>

            {/* Top: DEPOSIT (green) */}
            <ActionRow
              tone="up"
              icon={MoneyAdd01Icon}
              label="Add collateral"
              amount={amount}
              price={price}
              busy={collateral.busy}
              onClick={() => collateral.deposit(amount)}
            />

            {/* Middle: current balance + step editor (chips slide out on edit) */}
            <div className="my-1.5 rounded-xl bg-white/[0.04] p-2">
              <div className="flex items-center justify-between">
                <div className="leading-tight">
                  <div className="text-[10px] text-text-muted">Free / In use</div>
                  <div className="tabular text-sm font-semibold">
                    {formatUsd(collateral.available)}
                    <span className="text-text-muted">
                      {" "}
                      / {formatUsd(collateral.inUse)}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing((e) => !e)}
                  className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${
                    editing ? "bg-up-soft text-up" : "bg-white/5 text-text-muted hover:text-text"
                  }`}
                  aria-label="Edit amount"
                >
                  <HugeiconsIcon icon={Edit02Icon} size={14} />
                </button>
              </div>

              <div className="mt-1.5 flex items-center justify-between">
                <span className="text-[10px] text-text-muted">Amount</span>
                <span className="tabular text-sm font-bold text-text">
                  {formatUsd(amount)}
                </span>
              </div>

              <AnimatePresence initial={false}>
                {editing && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="mt-2 flex flex-wrap gap-1">
                      {PRESETS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setAmount(p)}
                          className={`rounded-lg px-2 py-1 text-xs font-semibold tabular transition-colors ${
                            amount === p
                              ? "bg-up text-black"
                              : "bg-white/5 text-text-muted hover:text-text"
                          }`}
                        >
                          ${p}
                        </button>
                      ))}
                    </div>
                    <input
                      type="number"
                      inputMode="decimal"
                      min={1}
                      step={1}
                      value={amount}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isNaN(v) && v >= 0) setAmount(v);
                      }}
                      className="tabular mt-2 w-full rounded-lg bg-white/5 px-2 py-1.5 text-sm font-semibold text-text outline-none ring-up/40 focus:ring-2"
                      placeholder="Custom amount"
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Bottom: WITHDRAW (red) — gated until Bulk withdrawal is verified */}
            <ActionRow
              tone="down"
              icon={MoneyRemove01Icon}
              label="Withdraw"
              amount={amount}
              price={price}
              busy={collateral.busy}
              disabled={!collateral.withdrawEnabled}
              hint={
                !collateral.withdrawEnabled
                  ? "Coming soon"
                  : amount > collateral.maxWithdrawable
                    ? `Max ${formatUsd(collateral.maxWithdrawable)}`
                    : undefined
              }
              onClick={() => collateral.withdraw(amount)}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ActionRow({
  tone,
  icon,
  label,
  amount,
  price,
  busy,
  disabled,
  hint,
  onClick,
}: {
  tone: "up" | "down";
  icon: typeof MoneyAdd01Icon;
  label: string;
  amount: number;
  price?: number;
  busy?: boolean;
  disabled?: boolean;
  hint?: string;
  onClick: () => void;
}) {
  const up = tone === "up";
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => {
          if (disabled || busy) return;
          playSound("tap");
          haptic("tap");
          onClick();
        }}
        disabled={disabled || busy}
        className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-45 ${
          up ? "bg-up-soft text-up" : "bg-down-soft text-down"
        }`}
      >
        <HugeiconsIcon icon={icon} size={18} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-sm font-semibold">{label}</div>
          <div className="tabular text-[10px] opacity-80">
            {formatUsd(amount)}
            {price != null && (
              <span className="text-text-muted">
                {" "}
                · ${price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            )}
          </div>
        </div>
      </button>
      {hint && (
        <span className="mt-0.5 pl-3 text-[10px] text-text-muted">{hint}</span>
      )}
    </div>
  );
}

// A tiny circular gauge for margin health (fraction free). Green when healthy,
// amber mid, red when the pool is mostly committed.
function HealthRing({ ratio, size }: { ratio: number; size: number }) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const r = size / 2 - 2;
  const c = 2 * Math.PI * r;
  const color =
    clamped > 0.5 ? "#72E912" : clamped > 0.2 ? "#e0a814" : "#E6432D";
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={2.5}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - clamped)}
      />
    </svg>
  );
}
