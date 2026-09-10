"use client";

import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useMotionValue } from "framer-motion";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";

/**
 * The shared bottom-sheet shell. EVERY sheet in the app renders through this so
 * the surface (background, blur, radius, grabber, close button, sizing,
 * animation) is defined
 * in exactly one place — restyling sheets means editing this file, not chasing
 * four call sites that had already drifted apart. The surface itself is the
 * `.glass-sheet` class in globals.css (brand glow at the top edge fading into
 * near-black); the plainer `.glass` stays for pills, toasts and icon buttons.
 *
 * Sizing: the sheet occupies at least MIN_H of the viewport (short content
 * leaves blank space beneath rather than a stubby sheet) and never exceeds
 * MAX_H, which leaves a sliver of the page visible at the top so it still reads
 * as an overlay. Both bounds sit on the ROOT; the body stays `min-h-0` so it can
 * shrink and hand overflow to an inner scroll region.
 *
 * Width: full-bleed on phones, capped at MAX_W and centred beyond that — the
 * app is a mobile-shaped experience, and a sheet stretched across a desktop
 * monitor puts its close button a screen away from its content. MAX_W matches
 * the `max-w-md` the replay and trader-profile modals already use, so every
 * overlay lands on the same column.
 */

/** Tallest a sheet gets — a sliver of page stays visible above it. */
const MAX_H = "98dvh";
/** Shortest a sheet gets, however little content it holds. */
const MIN_H = "50dvh";
/** Widest a sheet gets — below this it stays full-bleed, above it it centres. */
const MAX_W = "28rem";

/**
 * Drag-to-dismiss thresholds. Either one alone closes the sheet: a slow drag
 * past DRAG_CLOSE_PX, or a quick flick regardless of distance — matching how
 * native sheets behave, where a fast short swipe still dismisses.
 */
const DRAG_CLOSE_PX = 110;
const DRAG_CLOSE_VELOCITY = 550;

interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Centred title in the header bar. Omit for a sheet that leads with its own content. */
  title?: string;
  /** Renders a back chevron on the left of the header instead of closing. */
  onBack?: () => void;
  /**
   * Content for the top-left of the title bar, opposite the close button — for
   * a sheet that carries an action of its own (the account sheet's settings
   * gear). Ignored when `onBack` is set: the back chevron owns that slot, and a
   * view deep enough to need it has its own header anyway.
   */
  headerLeft?: ReactNode;
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
  headerLeft,
  header,
  scrollBody = true,
  hideClose = false,
  children,
  className = "",
}: SheetProps) {
  // The scrollable body. A downward drag that starts while the body is scrolled
  // belongs to the scroll region, not the sheet — otherwise a long sheet could
  // never be read back up through without dismissing itself. Framer decides
  // whether a gesture may drag at `dragListener` time, so the permission is
  // held in state and flipped on pointer-down, before the drag begins.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [dragEnabled, setDragEnabled] = useState(true);

  // The sheet's vertical offset, owned explicitly instead of left to Framer's
  // internal drag state. Dragging writes to the same `y` the exit animation
  // targets, and a close landing mid-drag used to let the two fight over it: the
  // exit tween could resolve instantly or be cancelled outright, AnimatePresence
  // never got its completion callback, and the sheet stayed MOUNTED at y:100% —
  // invisible except for its lit top rim and green glow bleeding up from the
  // bottom edge, with the z-50 surface and the scrim still swallowing every
  // click on the page beneath. Holding the value here lets us clear any leftover
  // drag offset the moment a close begins, so the exit animation always starts
  // from a known resting position and runs to completion.
  const y = useMotionValue(0);

  useEffect(() => {
    // On close only: resetting on OPEN would fight the entrance animation,
    // which drives this same value from "100%" to 0.
    if (!open) {
      y.set(0);
      // Re-arm for next time — a sheet closed by drag left this false.
      setDragEnabled(true);
    }
  }, [open, y]);

  // Pointer-down anywhere in the sheet: the whole surface drags, so a downward
  // swipe from the middle of the content dismisses just as a swipe on the
  // grabber does. The one exception is a gesture that starts inside a scroll
  // region which still has somewhere to scroll back UP to — that swipe belongs
  // to the list, or a long sheet could never be read back through without
  // dismissing itself. Once such a region is scrolled to its top, the next
  // downward swipe drags the sheet, which is how native sheets behave.
  //
  // The scroller is found by walking up from the touched node rather than by
  // reading `bodyRef.scrollTop`: sheets passing `scrollBody={false}` (the
  // leaderboard, the market switcher) keep their scroll on an INNER element, so
  // the body's own scrollTop is pinned at 0 and the old check silently allowed
  // every gesture — including ones that should have scrolled the list.
  const armDrag = (e: PointerEvent) => {
    const body = bodyRef.current;
    let node = e.target as HTMLElement | null;

    while (node && body && body.contains(node)) {
      const canScroll =
        node.scrollHeight > node.clientHeight + 1 &&
        /auto|scroll/.test(getComputedStyle(node).overflowY);
      if (canScroll) {
        setDragEnabled(node.scrollTop <= 0);
        return;
      }
      node = node.parentElement;
    }

    // Nothing scrollable under the finger — header, podium, padding, the body
    // itself — so the sheet takes the gesture.
    setDragEnabled(true);
  };

  // Released: a slow drag past the distance threshold OR a quick flick closes
  // the sheet; anything less springs back to rest.
  const endDrag = (
    _e: unknown,
    info: { offset: { y: number }; velocity: { y: number } },
  ) => {
    if (
      info.offset.y > DRAG_CLOSE_PX ||
      info.velocity.y > DRAG_CLOSE_VELOCITY
    ) {
      // Hand the gesture off cleanly: drop drag permission first so Framer's
      // drag controller stops writing to `y`, then let the exit animation run
      // from wherever the finger left the sheet.
      setDragEnabled(false);
      onClose();
    }
  };

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
            className="glass-sheet fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full flex-col rounded-t-[50px] p-4 pb-8"
            style={{ y, maxHeight: MAX_H, minHeight: MIN_H, maxWidth: MAX_W }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            onPointerDown={armDrag}
            drag={dragEnabled ? "y" : false}
            // Constrained to its resting position, so only the elastic overshoot
            // moves — and only downward (top elasticity 0), because a sheet
            // yanked off the top edge has nowhere to go.
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            dragDirectionLock
            onDragEnd={endDrag}
          >
            {/* Grabber. Sits in a tall, wide hit area that never scrolls, so
                there is always a place to grab the sheet from — including when
                the body beneath it is scrolled down. */}
            <div
              className="mx-auto mb-2 flex h-6 w-24 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
              aria-hidden
            >
              <div className="h-1 w-10 rounded-full bg-up" />
            </div>

            {/* Title bar. Always rendered (even with no title) so the close
                button has a home — it sits far right on every sheet. */}
            {!hideClose || title || onBack || headerLeft ? (
              <div className="relative mb-3 flex h-9 shrink-0 items-center justify-center">
                {!onBack && headerLeft && (
                  <div className="absolute left-0 flex items-center">
                    {headerLeft}
                  </div>
                )}
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

            {/* Body. It must be free to shrink below its content height, or an
                inner `overflow-y-auto` region can never take over — so the
                min-height lives on the sheet ROOT, not here. Setting both
                `min-h-0` and an inline minHeight on this element would be a
                contradiction the inline style wins, pinning the body open and
                pushing tall lists past the sheet instead of scrolling them. */}
            <div
              ref={bodyRef}
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
