"use client";

import { AnimatePresence, motion } from "framer-motion";
import { PositionsPanel } from "@/components/trade/PositionsPanel";
import type { ShareSubject } from "@/components/share/ShareCardModal";

interface Props {
  open: boolean;
  onClose: () => void;
  onShare: (subject: ShareSubject) => void;
}

// Mobile: a slide-up sheet that surfaces the SAME positions view used in the
// desktop right panel (aggregated PnL + expandable per-market positions). Opened
// from the "View positions" pill above the trade controls.
export function PositionsSheet({ open, onClose, onShare }: Props) {
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
            className="glass fixed inset-x-0 bottom-0 z-50 flex max-h-[80dvh] flex-col rounded-t-3xl p-4 pb-8"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            <div className="mx-auto mb-4 h-1 w-10 shrink-0 rounded-full bg-up" />
            <h2 className="mb-3 shrink-0 px-2 text-sm font-medium text-text-muted">
              Open positions
            </h2>
            {/* PositionsPanel manages its own internal scroll region. */}
            <div className="flex min-h-0 flex-1 flex-col">
              <PositionsPanel
                onShare={(subject) => {
                  onShare(subject);
                  onClose();
                }}
                onNavigate={onClose}
              />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
