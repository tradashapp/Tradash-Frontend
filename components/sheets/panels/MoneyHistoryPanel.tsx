"use client";

import { useEffect } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUpRight01Icon,
  ArrowDownRight01Icon,
  ArrowDataTransferVerticalIcon,
  Loading03Icon,
  Alert02Icon,
  LinkSquare02Icon,
} from "@hugeicons/core-free-icons";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatUsd } from "@/lib/format";
import type { Movement } from "@/lib/api";
import type { useWithdrawal } from "@/hooks/useWithdrawal";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";

/**
 * Money history: deposits, wallet↔trading transfers, and external withdrawals.
 *
 * Deliberately separate from the trade HistoryPanel. A trade is a position; a
 * movement is custody of funds. Keeping them apart means neither list has to
 * explain the other's rows, and a withdrawal never lands in trade stats.
 */

/** How each kind is labelled and drawn. */
const KIND = {
  deposit: {
    label: "Deposit",
    detail: "External → Wallet",
    icon: ArrowDownRight01Icon,
    tone: "text-up",
    sign: "+",
  },
  transfer_in: {
    label: "To Trading",
    detail: "Wallet → Trading",
    icon: ArrowDataTransferVerticalIcon,
    tone: "text-text",
    sign: "",
  },
  transfer_out: {
    label: "To Wallet",
    detail: "Trading → Wallet",
    icon: ArrowDataTransferVerticalIcon,
    tone: "text-text",
    sign: "",
  },
  withdrawal: {
    label: "Withdrawal",
    detail: "Wallet → External",
    icon: ArrowUpRight01Icon,
    tone: "text-down",
    sign: "−",
  },
} as const;

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function when(iso: string): string {
  const d = new Date(iso);
  const now = Date.now();
  const mins = Math.floor((now - d.getTime()) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Solscan link for a movement's transaction.
 *
 * `network` is written by the backend as "mainnet" or "devnet"; Solscan
 * defaults to mainnet and needs the cluster spelled out for anything else.
 * Null when there's no signature yet — a pending withdrawal has no tx to link.
 */
function explorerUrl(m: Movement): string | null {
  if (!m.signature) return null;
  const cluster = m.network === "mainnet" ? "" : `?cluster=${m.network}`;
  return `https://solscan.io/tx/${m.signature}${cluster}`;
}

export function MoneyHistoryPanel({
  withdrawal,
}: {
  withdrawal: ReturnType<typeof useWithdrawal>;
}) {
  const { movements, refreshMovements } = withdrawal;

  // `movements` is null until the first fetch resolves — that's the loading
  // state, distinct from an empty list.
  useEffect(() => {
    if (movements === null) void refreshMovements();
  }, [movements, refreshMovements]);

  if (movements === null) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (movements.length === 0) {
    return (
      <div className="glass-inset flex flex-col items-center gap-1 rounded-2xl px-4 py-10 text-center">
        <span className="text-sm font-medium text-text">No transfers yet</span>
        <span className="text-xs text-text-muted">
          Deposits, transfers and withdrawals will show up here.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {movements.map((m) => (
        <MovementRow key={m.id} movement={m} />
      ))}
    </div>
  );
}

function MovementRow({ movement: m }: { movement: Movement }) {
  const kind = KIND[m.kind];
  const failed = m.status === "failed";
  const pending = m.status === "pending";
  const url = explorerUrl(m);

  return (
    <div className="glass-inset flex items-center gap-3 rounded-2xl px-4 py-3">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 ${
          failed ? "text-down" : kind.tone
        }`}
      >
        <HugeiconsIcon icon={failed ? Alert02Icon : kind.icon} size={15} />
      </span>

      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold text-text">
          {kind.label}
        </span>
        <span className="truncate text-[11px] text-text-muted">
          {m.recipient ? `To ${short(m.recipient)}` : kind.detail}
        </span>
      </div>

      <div className="flex shrink-0 flex-col items-end">
        <span className={`tabular text-sm font-semibold ${failed ? "text-text-muted line-through" : kind.tone}`}>
          {kind.sign}
          {formatUsd(m.amount)}
        </span>
        {/* Date sits under the amount. Status, when there is one, rides in
          front of it so a pending row still says when it was started. */}
        <span className="flex items-center gap-1 text-[10px] text-text-muted">
          {pending && (
            <>
              <HugeiconsIcon
                icon={Loading03Icon}
                size={9}
                className="animate-spin"
              />
              Pending ·
            </>
          )}
          {failed && <span className="text-down">Failed ·</span>}
          {when(m.createdAt)}
        </span>
      </div>

      {/* Explorer link, right-aligned. A movement with no signature (a pending
        withdrawal, a local transfer) has nothing to open — the slot is held
        empty so amounts stay on one vertical line down the list. */}
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            playSound("tap");
            haptic("tap");
          }}
          className="shrink-0 rounded-full p-1.5 text-text-muted transition-colors hover:bg-white/10 hover:text-text"
          aria-label={`View ${kind.label.toLowerCase()} on Solscan`}
        >
          <HugeiconsIcon icon={LinkSquare02Icon} size={15} />
        </a>
      ) : (
        <span className="h-[27px] w-[27px] shrink-0" aria-hidden />
      )}
    </div>
  );
}
