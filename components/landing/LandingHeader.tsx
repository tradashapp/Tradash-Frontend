"use client";

import Image from "next/image";
import Link from "next/link";
import { playSound, unlockSound } from "@/lib/sound";

interface Props {
  onInstall: () => void;
}

// Transparent, border-free top bar: logo left, Install App + Log in right.
// Fixed so it stays put over the full-screen hero.
export function LandingHeader({ onInstall }: Props) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between px-5 py-4 sm:px-8 sm:py-5">
      <Link href="/" className="flex items-center gap-1" aria-label="Tradash">
        <Image
          src="/images/logos/tradash-white.png"
          alt="Tradash"
          width={132}
          height={28}
          className="h-6 w-auto sm:h-7"
          priority
        />
        <span>Tradash</span>
      </Link>

      <nav className="flex items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => {
            unlockSound();
            playSound("tap");
            onInstall();
          }}
          className="rounded-full bg-white/[0.07] px-4 py-2 text-sm font-medium text-text backdrop-blur-md transition-colors duration-200 hover:bg-white/[0.12] sm:px-5 sm:py-2.5"
        >
          Install App
        </button>
        <Link
          href="/trade"
          onClick={() => {
            unlockSound();
            playSound("tap");
          }}
          className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition-transform duration-200 hover:scale-[1.03] active:scale-95 sm:px-5 sm:py-2.5"
        >
          Log in
        </Link>
      </nav>
    </header>
  );
}
