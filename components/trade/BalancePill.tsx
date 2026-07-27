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
  const demoPos = useAppSelector((s) => s.tradingMode.demo.position);
  const liveBalance = useAppSelector((s) => s.user.balance);
  const livePos = useAppSelector((s) => s.position.current);
  const pos = mode === "demo" ? demoPos : livePos;
  const price = useAppSelector((s) =>
    pos ? s.price.prices[pos.symbol] : undefined
  );

  // Balance floats smoothly with the open position's PnL.
  //  - DEMO: demo balance + MagicBlock-derived PnL.
  //  - LIVE: Bulk equity already bakes in the ANCHORED Bulk PnL, so strip that
  //    (equity − pnlAnchor) to get the realized base, then add the interpolated
  //    live PnL so it moves per-frame and re-syncs to Bulk on each WS update.
  let balance: number | null;
  if (mode === "demo") {
    balance = demoBalance + (pos ? demoPnlAt(pos, price) : 0);
  } else if (liveBalance != null) {
    const realizedBase = pos
      ? liveBalance.equity - (pos.pnlAnchor ?? pos.unrealizedPnl)
      : liveBalance.equity;
    balance = realizedBase + (pos ? livePnlAt(pos, price) : 0);
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
