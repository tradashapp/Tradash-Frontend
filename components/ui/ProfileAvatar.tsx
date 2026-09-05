"use client";

/**
 * The signed-in user's avatar: their photo, or the initials of their handle on
 * a colour derived from it.
 *
 * Initials rather than an emoji because the handle is now guaranteed — every
 * user is seeded one at signup — so the fallback identifies the person instead
 * of being a decoration they had to pick. Distinct from the leaderboard's
 * `Avatar`, which still renders other people's rows (including legacy emoji
 * avatars) and takes its size from the table it sits in.
 *
 * `className` carries BOTH the box size and the text size, because the initials
 * have to scale with the circle: `h-28 w-28 text-4xl` for the account sheet,
 * `h-8 w-8 text-xs` for the balance pill.
 */
export function ProfileAvatar({
  src,
  name,
  className = "",
}: {
  /** Photo URL (bucket or data URL). Null falls back to initials. */
  src?: string | null;
  /** Handle the initials and the colour come from. */
  name?: string | null;
  className?: string;
}) {
  const initials = initialsOf(name);

  return (
    <div
      className={`flex shrink-0 items-center h-12 w-12 justify-center overflow-hidden rounded-full bg-white/[0.06] ${className}`}
      style={src || !name ? undefined : { backgroundColor: tint(name) }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden className="font-bold leading-none text-black/70">
          {initials}
        </span>
      )}
    </div>
  );
}

/**
 * The leading letters of a handle. Two when the name splits on a separator
 * (`jane_doe` → JD), otherwise just the first — `satoshi` reads better as "S"
 * than as "SA".
 */
function initialsOf(name: string | null | undefined): string {
  const clean = name?.trim().replace(/^@/, "") ?? "";
  if (!clean) return "?";
  const parts = clean.split(/[_\-.\s]+/).filter(Boolean);
  const letters =
    parts.length > 1 ? `${parts[0]![0]}${parts[1]![0]}` : clean.slice(0, 1);
  return letters.toUpperCase();
}

/**
 * A stable pastel for a handle, hashed from the name so a user's colour is
 * identical everywhere it appears and across reloads.
 */
function tint(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) % 360;
  }
  return `hsl(${h} 55% 62%)`;
}
