"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Wallet01Icon } from "@hugeicons/core-free-icons";
import { useAppSelector } from "@/store/hooks";
import { formatUsd } from "@/lib/format";
import { displayPnl } from "@/lib/perp";
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

  // Float with the position's MagicBlock-derived PnL. For live, strip Bulk's own
  // unrealized PnL out of equity first (it's already baked in) to avoid double-
  // counting, then add our display PnL so the number tracks the chart.
  const floatPnl = pos ? displayPnl(pos, price) : 0;
  let balance: number | null;
  if (mode === "demo") {
    balance = demoBalance + floatPnl;
  } else if (liveBalance != null) {
    const realizedBase = liveBalance.equity - (liveBalance.unrealizedPnl ?? 0);
    balance = realizedBase + floatPnl;
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
