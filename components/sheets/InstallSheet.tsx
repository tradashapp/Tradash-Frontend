"use client";

import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Download04Icon,
  CheckmarkCircle02Icon,
  ShareIcon,
  Add01Icon,
  MoreVerticalIcon,
} from "@hugeicons/core-free-icons";
import { useInstallPrompt } from "@/hooks/useInstallPrompt";
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
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="bg-[#08090C] fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-[50px] p-4 pb-8"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-up" />

            <div className="mb-4 flex flex-col items-center text-center">
              <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-up">
                <HugeiconsIcon
                  icon={Download04Icon}
                  size={30}
                  className="text-black"
                />
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
                  { icon: Add01Icon, text: "Choose “Add to Home Screen”." },
                  { icon: CheckmarkCircle02Icon, text: "Tap “Add” — Tradash lands on your home screen." },
                ]}
              />
            ) : (
              <Steps
                steps={[
                  { icon: MoreVerticalIcon, text: "Open your browser menu (⋮)." },
                  { icon: Download04Icon, text: "Choose “Install app” or “Add to Home screen”." },
                  { icon: CheckmarkCircle02Icon, text: "Confirm — Tradash installs like a native app." },
                ]}
              />
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
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
