"use client";

import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Tick02Icon } from "@hugeicons/core-free-icons";
import { api } from "@/lib/api";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import { seedOfAvatar } from "@/lib/avatars";

/**
 * The grid of generated faces a user can pick instead of uploading a photo.
 *
 * The list comes from the backend rather than a constant here, because the same
 * route validates the seed on write — a face rendered from a local list the
 * server didn't know about would fail only once the user tapped it.
 *
 * Selection sends the SEED, not the URL: the server maps it to an image, so the
 * client can't write an arbitrary URL into a field every other user's browser
 * loads as an <img src>.
 */
export function AvatarPicker({
  currentUrl,
  saving,
  onSelect,
}: {
  /** The avatar in force, so the matching face can be ticked. */
  currentUrl: string | null;
  saving: boolean;
  onSelect: (seed: string) => void | Promise<void>;
}) {
  const [choices, setChoices] = useState<{ seed: string; url: string }[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .fetchAvatarChoices()
      .then((r) => live && setChoices(r.avatars))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  // Which face is currently in force. Null when the user has an uploaded photo
  // — nothing in the grid is theirs, so nothing is ticked.
  const activeSeed = seedOfAvatar(currentUrl);

  if (failed) return null;

  return (
    <div>
      <div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">
        Pick an avatar
      </div>
      <div className="grid grid-cols-6 gap-2">
        {choices.length === 0
          ? // Placeholders at the real tile size, so the panel doesn't jump
            // taller when the list lands.
            Array.from({ length: 12 }).map((_, i) => (
              <span
                key={i}
                aria-hidden
                className="aspect-square animate-pulse rounded-full bg-white/[0.06]"
              />
            ))
          : choices.map(({ seed, url }) => {
              const active = seed === activeSeed;
              return (
                <button
                  key={seed}
                  type="button"
                  disabled={saving}
                  aria-label={`Avatar ${seed}`}
                  aria-pressed={active}
                  onClick={() => {
                    playSound("tap");
                    haptic("tap");
                    void onSelect(seed);
                  }}
                  className={`relative aspect-square overflow-hidden rounded-full bg-white/[0.06] transition-transform active:scale-90 disabled:opacity-50 ${
                    active ? "ring-2 ring-up" : ""
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                  {active && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/45">
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        size={14}
                        className="text-up"
                      />
                    </span>
                  )}
                </button>
              );
            })}
      </div>
    </div>
  );
}
