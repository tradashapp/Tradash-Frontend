"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Wallet01Icon } from "@hugeicons/core-free-icons";
import { useAppSelector } from "@/store/hooks";
import { formatUsd } from "@/lib/format";

interface Props {
  onOpen: () => void;
}

// Top-right account chip: live-or-demo balance + a mode badge. Opens the
// Account sheet on tap (where mode toggle + connect + settings live).
export function BalancePill({ onOpen }: Props) {
  const mode = useAppSelector((s) => s.tradingMode.mode);

  const demoBalance = useAppSelector((s) => s.tradingMode.demo.balance);
  const demoPos = useAppSelector((s) => s.tradingMode.demo.position);
  const liveEquity = useAppSelector((s) => s.user.balance?.equity);

  // Balance shown includes unrealized PnL of an open demo position (float).
  const balance =
    mode === "demo"
      ? demoBalance + (demoPos?.unrealizedPnl ?? 0)
      : liveEquity ?? null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex items-center gap-2 rounded-2xl bg-bg-overlay/60 px-3 py-1.5 backdrop-blur-sm transition-colors hover:bg-bg-overlay"
    >
      <HugeiconsIcon
        icon={Wallet01Icon}
        size={16}
        className="text-text-muted"
      />
      <div className="text-right leading-tight">
        <div className="tabular text-sm font-semibold">
          {balance != null ? formatUsd(balance) : "Connect"}
        </div>
        <div
          className={`text-[10px] font-medium tracking-wide ${
            mode === "demo" ? "text-text-muted" : "text-up"
          }`}
        >
          {mode === "demo" ? "DEMO" : "LIVE"}
        </div>
      </div>
    </button>
  );
}
