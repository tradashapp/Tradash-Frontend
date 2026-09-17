"use client";

import { PositionsPanel } from "@/components/trade/PositionsPanel";
import { Sheet } from "@/components/ui/Sheet";
import type { ShareSubject } from "@/components/share/ShareCardModal";
import type { LivePosition } from "@/hooks/useAllPositions";

interface Props {
  open: boolean;
  onClose: () => void;
  onShare: (subject: ShareSubject) => void;
  /** Close every open position at once. */
  onCloseAll?: () => void | Promise<void>;
  /** Open the add/reduce sheet for one position. */
  onAdjust?: (item: LivePosition, mode: "add" | "reduce") => void;
  /** Close one position. */
  onClosePosition?: (item: LivePosition) => void | Promise<void>;
  /** Open the TP/SL sheet for one position. */
  onEditTpSl?: (item: LivePosition) => void;
}

// Mobile: a slide-up sheet that surfaces the SAME positions view used in the
// desktop right panel (aggregated PnL + expandable per-market positions). Opened
// from the "View positions" pill above the trade controls.
//
// Positions ONLY — deliberately no order settings. The dock opens
// MarketSettingsSheet for size / leverage / trailing; this pill answers the
// different question "what am I already in", and mixing the two put a wall of
// sliders in front of someone who just wanted to check a position.
export function PositionsSheet({
  open,
  onClose,
  onShare,
  onCloseAll,
  onAdjust,
  onClosePosition,
  onEditTpSl,
}: Props) {
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
        onAdjust={onAdjust}
        onClosePosition={onClosePosition}
        onEditTpSl={onEditTpSl}
      />
    </Sheet>
  );
}
