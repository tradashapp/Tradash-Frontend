"use client";

import { useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import { CenterFocusIcon } from "@hugeicons/core-free-icons";
import { chartViewport } from "@/lib/chart/viewportStore";
import { haptic } from "@/lib/haptics";
import { playSound } from "@/lib/sound";

// Appears only once the candle chart has been panned / zoomed away from live,
// and glides it back: newest candle at the right edge, price centered. The
// line chart can't be moved, so it never shows there.
export function ChartRecenterButton({ className }: { className?: string }) {
  const offCenter = useSyncExternalStore(
    chartViewport.subscribe,
    chartViewport.isOffCenter,
    () => false
  );

  return (
    <AnimatePresence>
      {offCenter && (
        <motion.button
          type="button"
          aria-label="Re-center chart"
          onClick={() => {
            playSound("tap");
            haptic("tap");
            chartViewport.recenter();
          }}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
          className={`glass-inset flex h-9 w-9 items-center justify-center rounded-full text-white/90 backdrop-blur-sm active:scale-95 ${className ?? ""}`}
        >
          <HugeiconsIcon icon={CenterFocusIcon} size={18} />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
