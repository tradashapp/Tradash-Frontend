"use client";

import { isPhotoAvatar } from "@/lib/avatars";

/**
 * A trader's avatar, rounded-full.
 *
 * Handles all three shapes an avatar can take here: a stored photo URL from the
 * `avatars` bucket, a local emoji (the account sheet still keeps one in
 * settings), or — for the many users who never set one — a deterministic
 * fallback derived from the handle, so the same person always gets the same
 * colour rather than a different one on each render.
 */
export function Avatar({
  src,
  name,
  className = "h-10 w-10",
}: {
  /** Photo URL or emoji. Null/undefined falls back to initials. */
  src?: string | null;
  /** Handle, used for the initial and its colour. */
  name?: string | null;
  className?: string;
}) {
  const isImage = !!src && (src.startsWith("http") || isPhotoAvatar(src));
  const initial = (name?.trim()[0] ?? "?").toUpperCase();

  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/[0.06] ${className}`}
      style={isImage || !name ? undefined : { backgroundColor: tint(name) }}
    >
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src!}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : src ? (
        // An emoji avatar. Sized off the box so it scales with the podium.
        <span aria-hidden className="text-[55%] leading-none">
          {src}
        </span>
      ) : (
        <span
          aria-hidden
          className="text-[40%] font-bold leading-none text-black/70"
        >
          {initial}
        </span>
      )}
    </div>
  );
}

/**
 * A stable pastel for a handle. Hashing the name (rather than using the row
 * index) keeps a trader's colour identical between the podium, the table and
 * the profile popup.
 */
function tint(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) % 360;
  }
  return `hsl(${h} 55% 62%)`;
}
