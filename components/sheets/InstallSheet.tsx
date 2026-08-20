"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import {
  Download04Icon,
  CheckmarkCircle02Icon,
  ShareIcon,
  Add01Icon,
  MoreVerticalIcon,
} from "@hugeicons/core-free-icons";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
import { Sheet } from "@/components/ui/Sheet";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";

interface Props {
  open: boolean;
  onClose: () => void;
}

// "Install app" sheet. Uses the native install prompt where available
// (Chrome/Edge/Android); otherwise shows the manual per-browser steps (iOS
// Safari has no prompt API).
export function InstallSheet({ open, onClose }: Props) {
  const { platform, installed, canPrompt, promptInstall } = useInstallPrompt();

  const doInstall = async () => {
    playSound("tap");
    haptic("tap");
    const ok = await promptInstall();
    if (ok) onClose();
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <div className="mb-4 flex flex-col items-center text-center">
        <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-up">
          <HugeiconsIcon icon={Download04Icon} size={30} className="text-black" />
        </div>
        <h2 className="text-xl font-bold">Install Tradash</h2>
        <p className="mt-1 text-sm text-text-muted">
          Add it to your home screen for a full-screen, app-like experience.
        </p>
      </div>

      {installed ? (
        <div className="glass-inset flex items-center justify-center gap-2 rounded-2xl py-4 text-sm font-medium text-up">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} size={18} />
          Already installed
        </div>
      ) : canPrompt ? (
        <button
          type="button"
          onClick={doInstall}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-up py-4 text-lg font-semibold text-black transition-transform active:scale-95"
        >
          <HugeiconsIcon icon={Download04Icon} size={20} />
          Install app
        </button>
      ) : platform === "ios" ? (
        <Steps
          steps={[
            { icon: ShareIcon, text: "Tap the Share button in Safari's toolbar." },
            { icon: Add01Icon, text: "Choose \u201CAdd to Home Screen\u201D." },
            { icon: CheckmarkCircle02Icon, text: "Tap \u201CAdd\u201D \u2014 Tradash lands on your home screen." },
          ]}
        />
      ) : (
        <Steps
          steps={[
            { icon: MoreVerticalIcon, text: "Open your browser menu (\u22EE)." },
            { icon: Download04Icon, text: "Choose \u201CInstall app\u201D or \u201CAdd to Home screen\u201D." },
            { icon: CheckmarkCircle02Icon, text: "Confirm \u2014 Tradash installs like a native app." },
          ]}
        />
      )}
    </Sheet>
  );
}

function Steps({
  steps,
}: {
  steps: { icon: typeof Download04Icon; text: string }[];
}) {
  return (
    <div className="flex flex-col gap-2">
      {steps.map((s, i) => (
        <div
          key={i}
          className="glass-inset flex items-center gap-3 rounded-2xl px-4 py-3"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-up-soft text-up">
            <HugeiconsIcon icon={s.icon} size={16} />
          </div>
          <span className="text-sm">
            <span className="mr-1 font-semibold text-text-muted">{i + 1}.</span>
            {s.text}
          </span>
        </div>
      ))}
    </div>
  );
}
