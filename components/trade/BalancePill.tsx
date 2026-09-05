"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useAppSelector } from "@/store/hooks";
import { formatUsd } from "@/lib/format";
import { demoPnlAt, livePnlAt } from "@/lib/perp";
import { Odometer } from "@/components/ui/Odometer";
import { ProfileAvatar } from "@/components/ui/ProfileAvatar";
import { useProfile } from "@/hooks/useProfile";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";

interface Props {
  onOpen: () => void;
}

// Top-right account chip: live-or-demo balance + the user's avatar. Opens the
// Account sheet on tap. The balance FLOATS with the open position's PnL in both
// modes (recomputed from the live MagicBlock price), so it tracks the chart.
//
// Deliberately mirrors MarketHeader across the header: same avatar/logo size,
// same text scale, so the two pills read as one row rather than two unrelated
// chips of different heights.
export function BalancePill({ onOpen }: Props) {
  const mode = useAppSelector((s) => s.tradingMode.mode);
  const { user } = usePrivy();
  const profile = useProfile();

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

  // Falls back to the Twitter/email identity only until the seeded handle
  // loads, so the initials aren't a "?" on the first frame after login.
  const name =
    profile.username ??
    user?.twitter?.username ??
    (user?.email?.address ?? user?.google?.email)?.split("@")[0] ??
    null;

  return (
    <button
      type="button"
      onClick={() => {
        playSound("tap");
        haptic("tap");
        onOpen();
      }}
      className="group flex items-center gap-3 rounded-full bg-bg-overlay/50 px-2 py-1.5 transition-colors hover:bg-bg-overlay"
    >
      <div className="pl-1.5 text-right leading-tight">
        <div className="text-lg font-semibold">
          {balance != null ? (
            <Odometer value={formatUsd(balance)} />
          ) : (
            "Connect"
          )}
        </div>
        {/* The sub-line only says something in demo, but it always occupies a
            line: without it the pill loses ~16px of height and stops matching
            the market selector across the header. */}
        <div className="text-xs text-text-muted">
          {mode === "demo" ? "Demo" : "\u00A0"}
        </div>
      </div>
      <ProfileAvatar
        src={profile.avatarUrl}
        name={name}
        className="h-8 w-8 text-xs"
      />
    </button>
  );
}
