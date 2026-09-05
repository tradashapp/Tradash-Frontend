"use client";

/**
 * A shimmering placeholder for a value that hasn't loaded yet.
 *
 * The rule this exists to enforce: never render a stale or invented value while
 * the real one is in flight. A "$0.00" balance that is really "not loaded yet"
 * is worse than a placeholder — the user reads it as their actual money and
 * watches it silently change under them a second later.
 *
 * Sizing comes from `className` (width + height), so a skeleton occupies the
 * same box its content will, and nothing reflows when the value arrives.
 */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`block animate-pulse rounded-md bg-white/[0.08] ${className}`}
    />
  );
}

/**
 * A skeleton sized to a line of text, matched to the type scale rather than to
 * an arbitrary pixel height — so it lines up with the real value's baseline box.
 */
export function SkeletonText({
  width = "4rem",
  size = "md",
  className = "",
}: {
  width?: string;
  /** Matches the text size the real value renders at. */
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}) {
  const h = {
    xs: "h-3",
    sm: "h-3.5",
    md: "h-4",
    lg: "h-5",
    xl: "h-7",
  }[size];
  return (
    <span
      aria-hidden
      className={`block animate-pulse rounded-md bg-white/[0.08] ${h} ${className}`}
      style={{ width }}
    />
  );
}

/** A circular skeleton, for avatars. */
export function SkeletonCircle({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`block shrink-0 animate-pulse rounded-full bg-white/[0.08] ${className}`}
    />
  );
}
