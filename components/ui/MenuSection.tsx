"use client";

import type { ReactNode } from "react";

// A titled group of rows rendered as ONE joined card: the group owns the
// rounding and the glass surface, and rows sit flush inside it separated only
// by hairlines. Used by the account menu and settings so related options read
// as a single block instead of a stack of detached pills.
//
// Rows are expected to supply their own horizontal padding (px-4) and no
// rounding/background of their own — the section provides both.
export function MenuSection({
  title,
  children,
  className = "",
}: {
  /** Section heading. Omit for an untitled group. */
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      {title && (
        <h3 className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">
          {title}
        </h3>
      )}
      <div className="glass-inset overflow-hidden rounded-2xl">
        {/* Hairline between rows only — never above the first or below the last. */}
        <div className="divide-y divide-white/[0.06]">{children}</div>
      </div>
    </div>
  );
}
