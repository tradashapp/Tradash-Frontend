"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import { HelpCircleIcon, InformationCircleIcon } from "@hugeicons/core-free-icons";

// A small "?" (or "!") that explains a term without putting the explanation in
// the main copy. Hover opens it on desktop, a tap toggles it on touch, and a
// tap anywhere else, a scroll or Escape closes it.
//
// Portalled to <body> at a fixed position: inside a sheet it would otherwise
// be clipped by the sheet's rounded, overflow-bounded surface.

const WIDTH = 240;
const GAP = 8;
const EDGE = 12;

export function InfoTip({
  children,
  label = "More info",
  variant = "help",
  size = 14,
}: {
  children: ReactNode;
  /** Accessible name for the trigger. */
  label?: string;
  /** help = "?", info = "!" for something worth knowing. */
  variant?: "help" | "info";
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  // A tap fires pointerenter then click; without this the click would
  // immediately close what the enter just opened.
  const openedByHover = useRef(false);

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const h = bubble.current?.offsetHeight ?? 80;
    const left = Math.min(
      Math.max(EDGE, r.left + r.width / 2 - WIDTH / 2),
      window.innerWidth - WIDTH - EDGE
    );
    const above = r.bottom + GAP + h > window.innerHeight - EDGE;
    setPos({ left, top: above ? r.top - GAP - h : r.bottom + GAP });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (trigger.current?.contains(t) || bubble.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onScroll = () => setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onPointerEnter={(e) => {
          if (e.pointerType !== "mouse") return;
          openedByHover.current = true;
          setOpen(true);
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse" && openedByHover.current) setOpen(false);
        }}
        onClick={(e) => {
          // Never let the tap reach a row this sits inside.
          e.stopPropagation();
          if (openedByHover.current) {
            openedByHover.current = false;
            setOpen(true);
            return;
          }
          setOpen((o) => !o);
        }}
        className="inline-flex shrink-0 items-center justify-center rounded-full align-middle text-text-muted transition-colors hover:text-text"
      >
        <HugeiconsIcon icon={variant === "info" ? InformationCircleIcon : HelpCircleIcon} size={size} />
      </button>
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={bubble}
            role="tooltip"
            style={{
              position: "fixed",
              width: WIDTH,
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
            }}
            className="z-[80] rounded-2xl bg-bg-elevated px-3.5 py-2.5 text-xs leading-relaxed text-text-muted shadow-xl ring-1 ring-white/10"
          >
            {children}
          </div>,
          document.body
        )}
    </>
  );
}
