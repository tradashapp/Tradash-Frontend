"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import type { DemoClose } from "@/hooks/useDemoTrade";

interface Props {
  lastClose: DemoClose | null;
}

// The app's "closed with profit" alert, scoped INSIDE the phone screen. Same
// glass surface, green check and slide-down motion as the real ToastViewport —
// but it can't use the app's ToastProvider, which renders to a fixed, viewport-
// wide layer and would escape the mockup.
const VISIBLE_MS = 2400;

export function DemoToast({ lastClose }: Props) {
  const [shown, setShown] = useState<DemoClose | null>(null);

  useEffect(() => {
    if (!lastClose) return;
    setShown(lastClose);
    const t = window.setTimeout(() => setShown(null), VISIBLE_MS);
    return () => window.clearTimeout(t);
  }, [lastClose]);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center px-3 pt-9">
      <AnimatePresence initial={false}>
        {shown && (
          <motion.div
            key={shown.id}
            initial={{ opacity: 0, y: -50, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -50, scale: 0.96 }}
            transition={{ type: "spring", damping: 26, stiffness: 320 }}
            className="glass flex w-full items-start gap-2 rounded-xl px-3 py-2 shadow-lg"
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={16}
              className="mt-0.5 shrink-0 text-up"
            />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="text-[12px] font-semibold">Closed BTC</div>
              <div className="mt-0.5 text-[10px] text-text-muted">
                {shown.direction === "long" ? "Long" : "Short"} closed with
                profit of{" "}
                <span className="font-semibold text-up">
                  ${shown.pnl.toFixed(2)}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
