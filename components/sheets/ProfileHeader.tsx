"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePrivy } from "@privy-io/react-auth";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PencilEdit02Icon,
  ImageAdd02Icon,
  Tick02Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateSettings } from "@/store/slices/settingsSlice";
import { AVATAR_EMOJIS, fileToAvatarDataUrl, isPhotoAvatar } from "@/lib/avatars";
import { useToast } from "@/components/toast/ToastProvider";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import { useProfile } from "@/hooks/useProfile";
import { USERNAME_PATTERN } from "@/lib/username";

// Top of the account sheet: the avatar (with a glass pencil that opens the
// emoji / device-photo picker) above the user's handle — or a login button that
// opens the Privy modal when they aren't signed in yet.
export function ProfileHeader({ onLogin }: { onLogin: () => void }) {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { user, authenticated } = usePrivy();
  const avatar = useAppSelector((s) => s.settings.avatar);
  const profile = useProfile();
  const [picking, setPicking] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // The stored handle is the identity other people see; fall back to whatever
  // the login method suggests until one has been claimed.
  const handle = profile.username ? `@${profile.username}` : usernameFor(user);

  const setAvatar = (next: string) => {
    dispatch(updateSettings({ avatar: next }));
    playSound("tap");
    haptic("tap");
    setPicking(false);
  };

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    let dataUrl: string;
    try {
      dataUrl = await fileToAvatarDataUrl(file);
    } catch {
      toast("Couldn't use that image", { type: "error" });
      return;
    }
    // Show it locally at once, then publish it so it renders for everyone else
    // on the leaderboard. A failed upload leaves the local avatar in place —
    // it's still valid for this browser — but says so.
    setAvatar(dataUrl);
    if (authenticated && !(await profile.uploadAvatar(dataUrl))) {
      toast("Photo saved on this device only", { type: "info" });
    }
  };

  return (
    <div className="mb-4 flex flex-col items-center">
      {/* Avatar + pencil */}
      <div className="relative mb-1">
        <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-up text-6xl border-8 border-white/[0.6]">
          {profile.avatarUrl || isPhotoAvatar(avatar) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatarUrl ?? avatar}
              alt="Profile"
              className="h-full w-full object-cover"
            />
          ) : (
            <span aria-hidden className="text-black">D</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            playSound("tap");
            haptic("tap");
            setPicking((p) => !p);
          }}
          aria-label="Change avatar"
          className="glass absolute -bottom-0.5 -right-0.5 flex h-8 w-8 items-center justify-center rounded-full text-text transition-transform active:scale-90"
        >
          <HugeiconsIcon icon={PencilEdit02Icon} size={15} />
        </button>
      </div>

      {/* Handle (logged in) — plain centred text — or the login pill. */}
      {authenticated ? (
        <button
          type="button"
          onClick={() => {
            playSound("tap");
            haptic("tap");
            setEditingName((e) => !e);
          }}
          className="mt-2 flex items-center gap-1.5 text-sm font-medium text-text transition-opacity active:opacity-60"
          aria-label="Change username"
        >
          {handle}
          <HugeiconsIcon
            icon={PencilEdit02Icon}
            size={12}
            className="text-text-muted"
          />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => {
            playSound("tap");
            haptic("tap");
            onLogin();
          }}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-full bg-up px-7 py-3.5 text-base font-bold text-black transition-transform active:scale-95"
        >
          Log in
        </button>
      )}

      {/* Username claim. Opened by tapping the handle. */}
      <AnimatePresence initial={false}>
        {editingName && authenticated && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="w-full overflow-hidden"
          >
            <UsernameForm
              current={profile.username}
              saving={profile.saving}
              onSubmit={async (name) => {
                const result = await profile.claimUsername(name);
                if (result === "ok") {
                  toast("Username updated", { type: "success" });
                  setEditingName(false);
                } else if (result === "taken") {
                  toast("That username is taken", { type: "error" });
                } else if (result === "invalid") {
                  toast("3-20 letters, numbers or underscores", {
                    type: "error",
                  });
                } else {
                  toast("Couldn't save that username", { type: "error" });
                }
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Avatar picker — emoji grid + "from device". */}
      <AnimatePresence initial={false}>
        {picking && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="w-full overflow-hidden"
          >
            <div className="glass-inset mt-3 rounded-2xl p-3">
              <div className="grid grid-cols-8 gap-1.5">
                {AVATAR_EMOJIS.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => setAvatar(e)}
                    aria-label={`Use ${e} as avatar`}
                    className={`flex aspect-square items-center justify-center rounded-full text-lg transition-transform active:scale-90 ${
                      avatar === e ? "bg-up-soft ring-1 ring-up" : "bg-white/[0.04]"
                    }`}
                  >
                    <span aria-hidden>{e}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl bg-white/[0.05] py-2.5 text-xs font-medium text-text-muted transition-colors hover:text-text"
              >
                <HugeiconsIcon icon={ImageAdd02Icon} size={16} />
                Choose from device
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  void onPickFile(e.target.files?.[0]);
                  // Reset so picking the SAME file again still fires onChange.
                  e.target.value = "";
                }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Claim form for the public handle. Validated inline against the same rule the
 * backend enforces, so an obviously-bad name never costs a round trip — but the
 * server is still the authority on whether it's free.
 */
function UsernameForm({
  current,
  saving,
  onSubmit,
}: {
  current: string | null;
  saving: boolean;
  onSubmit: (name: string) => void | Promise<void>;
}) {
  const [value, setValue] = useState(current ?? "");
  const cleaned = value.trim().replace(/^@/, "");
  const valid = USERNAME_PATTERN.test(cleaned);
  const unchanged = cleaned === current;

  return (
    <div className="glass-inset mt-3 flex items-center gap-2 rounded-2xl p-2">
      <span className="pl-2 text-sm text-text-muted">@</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && valid && !unchanged && !saving) {
            void onSubmit(cleaned);
          }
        }}
        placeholder="username"
        maxLength={20}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-text-muted"
        aria-label="Username"
      />
      <button
        type="button"
        disabled={!valid || unchanged || saving}
        onClick={() => void onSubmit(cleaned)}
        aria-label="Save username"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-up text-black transition-transform active:scale-90 disabled:opacity-30"
      >
        <HugeiconsIcon
          icon={saving ? Loading03Icon : Tick02Icon}
          size={16}
          className={saving ? "animate-spin" : ""}
        />
      </button>
    </div>
  );
}

/**
 * A display handle for the signed-in user. Privy has no single username field,
 * so we take the best identity the login method gave us — Twitter/Discord
 * handle, email local-part, phone, else a shortened wallet address.
 */
function usernameFor(user: ReturnType<typeof usePrivy>["user"]): string {
  if (!user) return "@trader";
  const twitter = user.twitter?.username;
  if (twitter) return `@${twitter}`;
  const discord = user.discord?.username;
  if (discord) return `@${discord.split("#")[0]}`;
  const github = user.github?.username;
  if (github) return `@${github}`;
  const email = user.email?.address ?? user.google?.email;
  if (email) return `@${email.split("@")[0]}`;
  if (user.phone?.number) return user.phone.number;
  const addr = user.wallet?.address;
  if (addr) return `@${addr.slice(0, 4)}…${addr.slice(-4)}`;
  return "@trader";
}
