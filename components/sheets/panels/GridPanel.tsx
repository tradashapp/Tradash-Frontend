"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { GridViewIcon } from "@hugeicons/core-free-icons";
import { useFeatures } from "@/hooks/useFeatures";

// The Grid bot's home in the account sheet. Only reachable once the backend
// says this user is allowed (approved in the private beta, or public and not
// revoked). Setup, paper bots and live bots land here in the next phase; until
// then this states plainly what the bot will do and how it behaves.
export function GridPanel() {
  const { gridBot } = useFeatures();

  return (
    <div className="flex flex-col gap-4">
      <div className="glass-inset flex flex-col items-center gap-3 rounded-2xl px-4 py-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-up/15 text-up">
          <HugeiconsIcon icon={GridViewIcon} size={24} />
        </span>
        <p className="text-base font-semibold">You&apos;re in the Grid beta</p>
        <p className="max-w-xs text-sm text-text-muted">
          A grid bot buys small dips and sells small rises inside a price range you pick, all day, without the app
          open. Bots start in paper mode, with no real money.
        </p>
        {gridBot?.botsHalted && (
          <p className="text-xs text-down">Grid bots are paused right now.</p>
        )}
      </div>
      <p className="px-1 text-xs leading-relaxed text-text-muted">
        How it behaves: it earns while price moves back and forth inside the range. If price trends out of the range,
        the bot closes at a loss you see before starting. It never adds risk outside the range. Results are shown as net
        profit after fees and funding, never as a success rate.
      </p>
    </div>
  );
}
