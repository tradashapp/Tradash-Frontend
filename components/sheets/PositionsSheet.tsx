"use client";

import { PositionsPanel } from "@/components/trade/PositionsPanel";
import { Sheet } from "@/components/ui/Sheet";
import type { ShareSubject } from "@/components/share/ShareCardModal";

interface Props {
  open: boolean;
  onClose: () => void;
  onShare: (subject: ShareSubject) => void;
  /** Close every open position at once. */
  onCloseAll?: () => void | Promise<void>;
}

// Mobile: a slide-up sheet that surfaces the SAME positions view used in the
// desktop right panel (aggregated PnL + expandable per-market positions). Opened
// from the "View positions" pill above the trade controls.
//
// Positions ONLY — deliberately no order settings. The dock opens
// MarketSettingsSheet for size / leverage / trailing; this pill answers the
// different question "what am I already in", and mixing the two put a wall of
// sliders in front of someone who just wanted to check a position.
export function PositionsSheet({ open, onClose, onShare, onCloseAll }: Props) {
  return (
    <Sheet open={open} onClose={onClose} title="Open positions" scrollBody={false}>
      {/* PositionsPanel manages its own internal scroll region. */}
      <PositionsPanel
        onShare={(subject) => {
          onShare(subject);
          onClose();
        }}
        onNavigate={onClose}
        onCloseAll={onCloseAll}
      />
    </Sheet>
  );
}
