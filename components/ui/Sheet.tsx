"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";

/**
 * The shared bottom-sheet shell. EVERY sheet in the app renders through this so
 * the surface (background, blur, radius, grabber, sizing, animation) is defined
 * in exactly one place — restyling sheets means editing this file, not chasing
 * four call sites that had already drifted apart.
 *
 * Sizing: sheets always occupy at least MIN_H of the viewport (short content
 * leaves blank space beneath rather than a stubby sheet) and never more than
 * MAX_H, which leaves a sliver of the page visible at the top so the sheet
 * still reads as an overlay.
 */

/** Tallest a sheet gets — a sliver of page stays visible above it. */
const MAX_H = "98dvh";
/** Shortest a sheet gets, however little content it holds. */
const MIN_H = "50dvh";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Centred title in the header bar. Omit for a sheet that leads with its own content. */
  title?: string;
  /** Renders a back chevron on the left of the header instead of closing. */
  onBack?: () => void;
  /**
   * Header content rendered in place of the title row — for sheets whose top
   * line is a control (e.g. the market search field) rather than a heading.
   * Stays pinned above the scroll region.
   */
  header?: ReactNode;
  /**
   * When true the body is one scroll region owned by the Sheet. Set false for
   * sheets whose children manage their own inner scrolling (so the scrollbar
   * lands on the inner list, not the whole body).
   */
  scrollBody?: boolean;
  children: ReactNode;
  /** Extra classes for the body wrapper. */
  className?: string;
}

export function Sheet({
  open,
  onClose,
  title,
  onBack,
  header,
  scrollBody = true,
  children,
  className = "",
}: SheetProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Scrim — tap anywhere outside the sheet to dismiss. */}
          <motion.div
            className="fixed inset-0 z-40 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="glass fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-[50px] p-4 pb-8"
            style={{ maxHeight: MAX_H, minHeight: MIN_H }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            {/* Grabber */}
            <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-up" />

            {header}

            {(title || onBack) && (
              <div className="relative mb-3 flex h-6 shrink-0 items-center justify-center">
                {onBack && (
                  <button
                    type="button"
                    onClick={onBack}
                    aria-label="Back"
                    className="absolute left-0 flex h-8 w-8 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/10 hover:text-text active:scale-90"
                  >
                    <HugeiconsIcon icon={ArrowLeft01Icon} size={20} />
                  </button>
                )}
                {title && (
                  <span className="text-sm font-medium text-text-muted">
                    {title}
                  </span>
                )}
              </div>
            )}

            {/* Body. Grows to fill the min-height so short content leaves the
                space below blank instead of shrinking the sheet. */}
            <div
              className={`flex min-h-0 flex-1 flex-col ${
                scrollBody ? "overflow-y-auto" : ""
              } ${className}`}
            >
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
