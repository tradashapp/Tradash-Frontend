"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Wallet01Icon } from "@hugeicons/core-free-icons";
import { useAppSelector } from "@/store/hooks";
import { formatUsd } from "@/lib/format";
import { demoPnlAt, livePnlAt } from "@/lib/perp";
import { Odometer } from "@/components/ui/Odometer";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";

interface Props {
  onOpen: () => void;
}

// Top-right account chip: live-or-demo balance + a mode badge. Opens the
// Account sheet on tap. The balance FLOATS with the open position's PnL in both
// modes (recomputed from the live MagicBlock price), so it tracks the chart.
export function BalancePill({ onOpen }: Props) {
  const mode = useAppSelector((s) => s.tradingMode.mode);

  const demoBalance = useAppSelector((s) => s.tradingMode.demo.balance);
  const demoPositions = useAppSelector((s) => s.tradingMode.demo.positions);
  const liveBalance = useAppSelector((s) => s.user.balance);
  const livePositions = useAppSelector((s) => s.position.bySymbol);
  const prices = useAppSelector((s) => s.price.prices);

  // Balance floats smoothly with the SUM of all open positions' PnL (one per
  // market). Demo: demoBalance + Σ MagicBlock-derived PnL. Live: Bulk equity
  // already bakes in each position's anchored PnL, so strip those anchors to get
  // the realized base, then add each interpolated live PnL.
  let balance: number | null;
  if (mode === "demo") {
    let sum = 0;
    for (const p of Object.values(demoPositions)) {
      if (p) sum += demoPnlAt(p, prices[p.symbol]);
    }
    balance = demoBalance + sum;
  } else if (liveBalance != null) {
    let anchored = 0;
    let live = 0;
    for (const p of Object.values(livePositions)) {
      if (!p) continue;
      anchored += p.pnlAnchor ?? p.unrealizedPnl;
      live += livePnlAt(p, prices[p.symbol]);
    }
    balance = liveBalance.equity - anchored + live;
  } else {
    balance = null;
  }

  return (
    <button
      type="button"
      onClick={() => {
        playSound("tap");
        haptic("tap");
        onOpen();
      }}
      className="group flex items-center gap-2 rounded-full bg-bg-overlay/60 px-3 py-1.5 backdrop-blur-sm transition-colors hover:bg-bg-overlay"
    >
      <HugeiconsIcon
        icon={Wallet01Icon}
        size={16}
        className="text-text-muted"
      />
      <div className="text-right leading-tight">
        <div className="text-sm font-semibold">
          {balance != null ? (
            <Odometer value={formatUsd(balance)} />
          ) : (
            "Connect"
          )}
        </div>
        <div
          className={`text-[10px] font-medium tracking-wide ${
            mode === "demo" ? "text-text-muted" : "text-up"
          }`}
        >
          {mode === "demo" ? "DEMO" : ""}
        </div>
      </div>
    </button>
  );
}
