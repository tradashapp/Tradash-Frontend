"use client";

import { PositionsPanel } from "@/components/trade/PositionsPanel";
import { Sheet } from "@/components/ui/Sheet";
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
    <Sheet open={open} onClose={onClose} title="Open positions" scrollBody={false}>
      {/* PositionsPanel manages its own internal scroll region. */}
      <PositionsPanel
        onShare={(subject) => {
          onShare(subject);
          onClose();
        }}
        onNavigate={onClose}
      />
    </Sheet>
  );
}
