"use client";

import Link from "next/link";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Book02Icon,
  NewTwitterIcon,
  DiscordIcon,
  TelegramIcon,
} from "@hugeicons/core-free-icons";
import { config } from "@/lib/config";

interface SocialLink {
  label: string;
  href: string;
  icon: typeof Book02Icon;
}

const LINKS: SocialLink[] = [
  { label: "Docs", href: config.social.docs, icon: Book02Icon },
  { label: "X (formerly Twitter)", href: config.social.x, icon: NewTwitterIcon },
  { label: "Discord", href: config.social.discord, icon: DiscordIcon },
  { label: "Telegram", href: config.social.telegram, icon: TelegramIcon },
];

// Transparent, border-free bottom bar pinned to the very bottom of the hero.
// Left: glass icon pills that expand to reveal their label on hover. Right:
// legal links.
export function LandingFooter() {
  return (
    <footer className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-4 px-5 py-4 sm:px-8 sm:py-5">
      <div className="flex items-center gap-2">
        {LINKS.map((link) => (
          <SocialPill key={link.label} {...link} />
        ))}
      </div>

      <div className="flex items-center gap-4 text-xs text-text-muted sm:gap-5">
        <Link
          href="/privacy"
          className="transition-colors underline duration-200 hover:text-text"
        >
          Privacy
        </Link>
        <Link
          href="/terms"
          className="transition-colors underline duration-200 hover:text-text"
        >
          Terms
        </Link>
      </div>
    </footer>
  );
}

// A glass circle that grows into a pill on hover, sliding its label out to the
// right. The label is width-animated (not just opacity) so the pill physically
// expands — and it's `hidden` from a11y-irrelevant duplication by living in the
// same link as the icon's accessible name.
function SocialPill({ label, href, icon }: SocialLink) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      aria-label={label}
      className="group flex h-10 items-center gap-0 rounded-full bg-white/[0.06] pl-[11px] pr-[11px] text-text-muted backdrop-blur-md transition-[background-color,color,padding] duration-300 ease-snap hover:bg-white/[0.12] hover:pr-4 hover:text-text"
    >
      <HugeiconsIcon icon={icon} size={18} className="shrink-0" />
      <span
        aria-hidden
        className="grid grid-cols-[0fr] overflow-hidden transition-[grid-template-columns] duration-300 ease-snap group-hover:grid-cols-[1fr]"
      >
        <span className="min-w-0 overflow-hidden whitespace-nowrap text-sm font-medium">
          <span className="block pl-2">{label}</span>
        </span>
      </span>
    </a>
  );
}
