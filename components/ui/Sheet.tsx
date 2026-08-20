"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";

/**
 * The shared bottom-sheet shell. EVERY sheet in the app renders through this so
 * the surface (background, blur, radius, grabber, close button, sizing,
 * animation) is defined
 * in exactly one place — restyling sheets means editing this file, not chasing
 * four call sites that had already drifted apart.
 *
 * Sizing: the body always occupies at least MIN_H of the viewport (short
 * content leaves blank space beneath rather than a stubby sheet) and the sheet
 * never exceeds MAX_H, which leaves a sliver of the page visible at the top so
 * it still reads as an overlay. Past that, inner scroll regions take over.
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
   * Extra pinned content below the title bar — for sheets whose top line is a
   * control (e.g. the market search field) rather than a heading. Stays above
   * the scroll region.
   */
  header?: ReactNode;
  /**
   * When true the body is one scroll region owned by the Sheet. Set false for
   * sheets whose children manage their own inner scrolling (so the scrollbar
   * lands on the inner list, not the whole body).
   */
  scrollBody?: boolean;
  children: ReactNode;
  /**
   * Hide the built-in close button — for sheets whose own header already
   * carries one (the market switcher's search row).
   */
  hideClose?: boolean;
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
  hideClose = false,
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
            style={{ maxHeight: MAX_H }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
          >
            {/* Grabber */}
            <div className="mx-auto mb-3 h-1 w-10 shrink-0 rounded-full bg-up" />

            {/* Title bar. Always rendered (even with no title) so the close
                button has a home — it sits far right on every sheet. */}
            {!hideClose || title || onBack ? (
              <div className="relative mb-3 flex h-9 shrink-0 items-center justify-center">
                {onBack && (
                  <button
                    type="button"
                    onClick={onBack}
                    aria-label="Back"
                    className="absolute left-0 flex h-9 w-9 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/10 hover:text-text active:scale-90"
                  >
                    <HugeiconsIcon icon={ArrowLeft01Icon} size={20} />
                  </button>
                )}
                {title && (
                  <span className="text-sm font-medium text-text-muted">
                    {title}
                  </span>
                )}
                {!hideClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Close"
                    className="glass-inset absolute right-0 flex h-9 w-9 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-white/10 hover:text-text active:scale-90"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={18} />
                  </button>
                )}
              </div>
            ) : null}

            {header}

            {/* Body. The min-height lives HERE rather than on the sheet root:
                a `flex-1` child of an auto-height container sizes to its content,
                so a root min-height would let inner lists grow unbounded instead
                of shrinking to scroll. Bounding the body instead means short
                content leaves blank space beneath, while tall content hits the
                root's max-height and the inner scroll region takes over. */}
            <div
              className={`flex min-h-0 flex-1 flex-col ${
                scrollBody ? "overflow-y-auto" : ""
              } ${className}`}
              style={{ minHeight: MIN_H }}
            >
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
