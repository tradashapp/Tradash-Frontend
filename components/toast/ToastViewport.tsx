"use client";

import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CheckmarkCircle02Icon,
  AlertCircleIcon,
  InformationCircleIcon,
  Loading03Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import type { Toast, ToastType } from "./ToastProvider";

const ICON: Record<ToastType, typeof CheckmarkCircle02Icon> = {
  success: CheckmarkCircle02Icon,
  error: AlertCircleIcon,
  info: InformationCircleIcon,
  loading: Loading03Icon,
};

const ACCENT: Record<ToastType, string> = {
  success: "text-up",
  error: "text-down",
  info: "text-text",
  loading: "text-text-muted",
};

// Fixed top-center viewport. Toasts slide DOWN from above the top edge into
// place (and back up on exit) while staying anchored to the top.
export function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[100] flex flex-col items-center gap-2 px-4 pt-[calc(env(safe-area-inset-top)+12px)]">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -60, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -60, scale: 0.96 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
            className="glass pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl px-4 py-3 shadow-lg"
          >
            <HugeiconsIcon
              icon={ICON[t.type]}
              size={20}
              className={`mt-0.5 shrink-0 ${ACCENT[t.type]} ${
                t.type === "loading" ? "animate-spin" : ""
              }`}
            />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-sm font-semibold">{t.title}</div>
              {t.description && (
                <div className="mt-0.5 text-xs text-text-muted">
                  {t.description}
                </div>
              )}
            </div>

            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action?.onClick();
                  onDismiss(t.id);
                }}
                className="shrink-0 rounded-lg bg-up px-3 py-1.5 text-xs font-bold text-black transition-transform active:scale-95"
              >
                {t.action.label}
              </button>
            )}

            {t.type !== "loading" && !t.action && (
              <button
                type="button"
                onClick={() => onDismiss(t.id)}
                aria-label="Dismiss"
                className="shrink-0 text-text-muted transition-colors hover:text-text"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={16} />
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
