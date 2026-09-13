"use client";

import { useEffect } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowUpRight01Icon,
  ArrowDownRight01Icon,
  ArrowDataTransferVerticalIcon,
  Loading03Icon,
  Alert02Icon,
} from "@hugeicons/core-free-icons";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatUsd } from "@/lib/format";
import type { Movement } from "@/lib/api";
import type { useWithdrawal } from "@/hooks/useWithdrawal";

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
          {" · "}
          {when(m.createdAt)}
        </span>
      </div>

      <div className="flex shrink-0 flex-col items-end">
        <span className={`tabular text-sm font-semibold ${failed ? "text-text-muted line-through" : kind.tone}`}>
          {kind.sign}
          {formatUsd(m.amount)}
        </span>
        {pending && (
          <span className="flex items-center gap-1 text-[10px] text-text-muted">
            <HugeiconsIcon
              icon={Loading03Icon}
              size={9}
              className="animate-spin"
            />
            Pending
          </span>
        )}
        {failed && <span className="text-[10px] text-down">Failed</span>}
        {m.sponsored && m.status === "confirmed" && (
          <span className="text-[10px] text-text-muted">Fee paid by us</span>
        )}
      </div>
    </div>
  );
}
