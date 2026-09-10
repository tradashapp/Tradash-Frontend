"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";

/**
 * A small yes/no confirmation over the top of whatever asked for it — for
 * actions that are a nuisance to undo (logging out and losing the session,
 * wiping the demo balance) and so deserve a deliberate second tap.
 *
 * It renders at z-[70], ABOVE the sheets (z-50) and the trader-profile modal
 * (z-[60]), because it is always raised BY one of those and must sit on top of
 * its own opener rather than behind it.
 */
export function ConfirmModal({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  /** Optional second line explaining the consequence. */
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Paints the confirm button in the loss colour for irreversible actions. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Escape cancels, matching a scrim tap — the safe choice, never the action.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  const confirm = () => {
    playSound("tap");
    haptic("tap");
    onConfirm();
  };

  const cancel = () => {
    playSound("tap");
    haptic("tap");
    onCancel();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[70] bg-black/60"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={cancel}
          />
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-label={title}
            className="fixed inset-x-6 top-1/2 z-[71] mx-auto flex max-w-xs -translate-y-1/2 flex-col rounded-3xl bg-bg-elevated p-5 ring-1 ring-white/10"
            initial={{ opacity: 0, scale: 0.94, y: "-46%" }}
            animate={{ opacity: 1, scale: 1, y: "-50%" }}
            exit={{ opacity: 0, scale: 0.94, y: "-46%" }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <h2 className="text-center text-base font-semibold">{title}</h2>
            {body && (
              <p className="mt-2 text-center text-[13px] leading-snug text-text-muted">
                {body}
              </p>
            )}

            {/* Cancel sits first and carries the plainer treatment: the escape
                route should be the easy one to hit by reflex, not the action. */}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={cancel}
                className="glass-inset flex-1 rounded-2xl py-3 text-sm font-medium text-text-muted transition-colors hover:text-text active:scale-95"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={confirm}
                className={`flex-1 rounded-2xl py-3 text-sm font-bold transition-transform active:scale-95 ${
                  destructive ? "bg-down text-white" : "bg-up text-black"
                }`}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
