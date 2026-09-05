"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  Notification03Icon,
  PreferenceHorizontalIcon,
  SlidersHorizontalIcon,
  ShieldKeyIcon,
  Wallet01Icon,
} from "@hugeicons/core-free-icons";
import { MenuSection } from "@/components/ui/MenuSection";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";

/**
 * The settings hub, opened by the gear in the account sheet's top-left.
 *
 * Every destination is listed but disabled: the rows exist so the shape of the
 * settings area is visible and stable, and each one is enabled as its screen
 * lands. `onOpen` is what makes a row live — a row without one renders greyed
 * with a "Soon" tag instead of a chevron.
 */
interface SettingsEntry {
  icon: typeof SlidersHorizontalIcon;
  label: string;
  description: string;
  onOpen?: () => void;
}

const ENTRIES: SettingsEntry[] = [
  {
    icon: SlidersHorizontalIcon,
    label: "Trade Settings",
    description: "Order defaults, leverage, trailing stops",
  },
  {
    icon: Wallet01Icon,
    label: "Wallet Management",
    description: "Deposits, withdrawals, connected wallets",
  },
  {
    icon: ShieldKeyIcon,
    label: "Security",
    description: "Session keys, approvals, recovery",
  },
  {
    icon: Notification03Icon,
    label: "Notification Settings",
    description: "Fills, liquidation warnings, price alerts",
  },
  {
    icon: PreferenceHorizontalIcon,
    label: "Preferences",
    description: "Theme, sound, haptics",
  },
];

export function SettingsMenuPanel() {
  return (
    <div className="flex flex-col">
      <MenuSection className="mb-4">
        {ENTRIES.map((entry) => (
          <SettingsRow key={entry.label} {...entry} />
        ))}
      </MenuSection>
    </div>
  );
}

function SettingsRow({ icon, label, description, onOpen }: SettingsEntry) {
  return (
    <button
      type="button"
      disabled={!onOpen}
      onClick={() => {
        if (!onOpen) return;
        playSound("tap");
        haptic("tap");
        onOpen();
      }}
      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
    >
      <HugeiconsIcon icon={icon} size={18} className="shrink-0 text-text-muted" />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-sm font-medium">{label}</div>
        <div className="truncate text-xs text-text-muted">{description}</div>
      </div>
      {onOpen ? (
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          size={16}
          className="shrink-0 text-text-muted"
        />
      ) : (
        <span className="shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
          Soon
        </span>
      )}
    </button>
  );
}
