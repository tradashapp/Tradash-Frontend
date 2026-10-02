import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";

interface Props {
  title: string;
  updated: string;
  children: ReactNode;
}

// Shared shell for the Privacy / Terms pages the landing footer links to.
// Deliberately plain: dark background, readable measure, and a way back.
export function LegalPage({ title, updated, children }: Props) {
  return (
    <main className="h-dvh w-full overflow-y-auto bg-bg">
      <div className="mx-auto w-full max-w-2xl px-6 py-14">
        <Link href="/" className="inline-flex items-center gap-2">
          <Image
            src="/images/logos/tradash-white.png"
            alt="Tradash"
            width={132}
            height={28}
            className="h-6 w-auto"
          />
        </Link>

        <h1 className="mt-10 text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-text-muted">Last updated {updated}</p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-text-muted [&_h2]:pt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-text [&_strong]:text-text [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_a]:text-text [&_a]:underline [&_a]:underline-offset-2">
          {children}
        </div>

        <Link
          href="/"
          className="mt-12 inline-block text-sm text-text-muted transition-colors hover:text-text"
        >
          ← Back to home
        </Link>
      </div>
    </main>
  );
}
