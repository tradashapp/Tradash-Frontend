"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { NewTwitterIcon } from "@hugeicons/core-free-icons";

interface Props {
  /** Handle WITHOUT the leading "@". Nothing renders when absent. */
  handle: string | null | undefined;
  /** Icon size in px. Sits beside a username, so it stays visually secondary. */
  size?: number;
}

/**
 * A small X icon linking out to a trader's profile, shown beside their username.
 *
 * Renders nothing when no X account is linked, so callers can drop it in
 * unconditionally rather than branching at every call site.
 *
 * `stopPropagation` matters: this sits inside rows and modals that are
 * themselves clickable (a leaderboard row opens a profile, the account handle
 * opens the edit panel), and without it opening X would also fire that action
 * behind the newly-opened tab.
 */
export function XLink({ handle, size = 13 }: Props) {
  if (!handle) return null;
  return (
    <a
      href={`https://x.com/${encodeURIComponent(handle)}`}
      target="_blank"
      // noreferrer alongside noopener: the opened tab gets no window.opener
      // handle back into the app.
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      aria-label={`@${handle} on X`}
      title={`@${handle} on X`}
      className="inline-flex shrink-0 items-center text-text-muted transition-colors hover:text-text active:opacity-60"
    >
      <HugeiconsIcon icon={NewTwitterIcon} size={size} />
    </a>
  );
}
