"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  ShieldKeyIcon,
  CodeIcon,
  CheckmarkCircle02Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { MenuSection } from "@/components/ui/MenuSection";
import { useAppSelector } from "@/store/hooks";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import type { useAgentWallet } from "@/hooks/useAgentWallet";

/**
 * Advanced — the two Bulk permissions that make live trading possible.
 *
 * This used to be a top-level "Advanced" section on the account menu, sitting
 * between Trading and App. It moved behind a row because it is not something
 * you reach for mid-session: both steps are one-time setup, and once they are
 * done the section was two permanently green rows taking up a third of the
 * menu. As its own panel it can afford to SAY what each permission does, which
 * the menu row never had room for — the rows there were a label and a status
 * word, which is exactly the wrong amount of information for a signature
 * request.
 *
 * Only reachable in live mode with a connected account (the account menu gates
 * the row), so neither step has a "not applicable" state to render.
 */

interface Props {
  agent: ReturnType<typeof useAgentWallet>;
}

export function AdvancedPanel({ agent }: Props) {
  const agentAuthorized = useAppSelector((s) => s.trading.agentAuthorized);
  const builderApproved = useAppSelector((s) => s.trading.builderApproved);

  return (
    <div className="flex flex-col">
      <p className="mb-3 px-1 text-xs leading-relaxed text-text-muted">
        Two one-time permissions let Tradash place orders for you. Both are
        granted on Bulk and can be revoked from your wallet at any time.
      </p>

      <MenuSection className="mb-3">
        <PermissionRow
          icon={ShieldKeyIcon}
          label="Agent authorization"
          description="Authorizes a session key so orders send with one tap, without a wallet prompt each time. The key can only trade — it can never withdraw."
          done={agentAuthorized}
          busy={agent.onboarding}
          doneLabel="Authorized"
          pendingLabel="Not set up"
          actionLabel="Authorize"
          onAction={agent.onboard}
        />
        <PermissionRow
          icon={CodeIcon}
          label="Builder code"
          description="Approves Tradash's builder code on your Bulk account. Every order carries it; without approval Bulk rejects them."
          done={builderApproved}
          busy={agent.onboarding}
          doneLabel="Approved"
          pendingLabel="Not approved"
          actionLabel="Approve"
          onAction={agent.approveBuilder}
        />
      </MenuSection>

      {/* The steps are independent on Bulk and fail independently, but the
          agent key is what signs the builder approval — so the order matters
          when neither is done. Only worth saying while that is actually true. */}
      {!agentAuthorized && !builderApproved && (
        <p className="px-1 text-[11px] leading-relaxed text-text-muted">
          Start with agent authorization — the builder code is approved with
          that key.
        </p>
      )}
    </div>
  );
}

/**
 * One permission: what it is, what it grants, and its current state.
 *
 * Not a NavRow. A NavRow is a link, and its chevron promises somewhere to go —
 * these rows are the destination, and the tap requests a SIGNATURE. So the
 * action is an explicit button that disappears once granted, leaving a plain
 * status row behind.
 */
function PermissionRow({
  icon,
  label,
  description,
  done,
  busy,
  doneLabel,
  pendingLabel,
  actionLabel,
  onAction,
}: {
  icon: typeof ShieldKeyIcon;
  label: string;
  description: string;
  done: boolean;
  busy: boolean;
  doneLabel: string;
  pendingLabel: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 py-3.5">
      <div className="flex items-center gap-3">
        <HugeiconsIcon
          icon={icon}
          size={18}
          className="shrink-0 text-text-muted"
        />
        <span className="flex-1 text-sm font-medium">{label}</span>
        <span
          className={`shrink-0 text-xs font-semibold ${
            done ? "text-up" : "text-text-muted"
          }`}
        >
          {done ? doneLabel : pendingLabel}
        </span>
        {done && (
          <HugeiconsIcon
            icon={CheckmarkCircle02Icon}
            size={17}
            className="shrink-0 text-up"
          />
        )}
      </div>

      <p className="pl-[30px] text-xs leading-relaxed text-text-muted">
        {description}
      </p>

      {!done && (
        <div className="pl-[30px] pt-0.5">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              playSound("tap");
              haptic("tap");
              onAction();
            }}
            className="flex items-center gap-2 rounded-full bg-up px-4 py-2 text-xs font-semibold text-black transition-transform active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy && (
              <HugeiconsIcon
                icon={Loading03Icon}
                size={14}
                className="animate-spin"
              />
            )}
            {busy ? "Waiting for signature…" : actionLabel}
          </button>
        </div>
      )}
    </div>
  );
}
