"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useAppSelector } from "@/store/hooks";
import { formatUsd } from "@/lib/format";
import { demoPnlAt, liveAccountValue, livePnlAt } from "@/lib/perp";
import { Odometer } from "@/components/ui/Odometer";
import { ProfileAvatar } from "@/components/ui/ProfileAvatar";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useProfile } from "@/hooks/useProfile";
import { useNotifications } from "@/hooks/useNotifications";
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
  const { user, ready, authenticated } = usePrivy();
  const profile = useProfile();

  const demoBalance = useAppSelector((s) => s.tradingMode.demo.balance);
  const demoPositions = useAppSelector((s) => s.tradingMode.demo.positions);
  const liveBalance = useAppSelector((s) => s.user.balance);
  const livePositions = useAppSelector((s) => s.position.bySymbol);
  const prices = useAppSelector((s) => s.price.prices);

  // Balance floats smoothly with the SUM of all open positions' PnL (one per
  // market). Demo: demoBalance + Σ MagicBlock-derived PnL. Live: Bulk equity is
  // collateral only, so each interpolated live PnL goes straight on top — see
  // liveAccountValue.
  let balance: number | null;
  if (mode === "demo") {
    let sum = 0;
    for (const p of Object.values(demoPositions)) {
      if (p) sum += demoPnlAt(p, prices[p.symbol]);
    }
    balance = demoBalance + sum;
  } else if (liveBalance != null) {
    let live = 0;
    for (const p of Object.values(livePositions)) {
      if (p) live += livePnlAt(p, prices[p.symbol]);
    }
    balance = liveAccountValue(liveBalance.equity, live);
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

  const { unread } = useNotifications();

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
      <div className="pl-1.5 text-right items-center leading-tight">
        <div className="flex justify-end text-lg font-semibold">
          {/* Three distinct states, and they must not be conflated:
                - Privy still restoring, or signed in with the balance in
                  flight  → skeleton. Showing "Connect" here tells a logged-in
                  user they're logged out; showing "$0.00" tells them they're
                  broke. Both are wrong and both resolve a beat later.
                - signed out                      → "Connect".
                - signed in with a real balance    → the number. */}
          {mode !== "demo" && (!ready || (authenticated && balance == null)) ? (
            <SkeletonText width="4.5rem" size="lg" />
          ) : balance != null ? (
            <Odometer value={formatUsd(balance)} />
          ) : (
            "Connect"
          )}
        </div>
        {/* The sub-line only says something in demo, but it always occupies a
            line: without it the pill loses ~16px of height and stops matching
            the market selector across the header. */}
        {/* <div className="text-xs text-text-muted">
          {mode === "demo" ? "Demo" : ""}
        </div> */}
      </div>
      <span className="relative">
        <ProfileAvatar
          src={profile.avatarUrl}
          name={name}
          className="h-9 w-9"
          loading={mode !== "demo" && (!ready || (authenticated && profile.loading))}
        />
        {/* Unread notifications live in the sheet this opens. */}
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-down ring-2 ring-bg" aria-label={`${unread} unread notifications`} />
        )}
      </span>
    </button>
  );
}
