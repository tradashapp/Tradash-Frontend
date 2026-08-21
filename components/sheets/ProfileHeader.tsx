"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePrivy } from "@privy-io/react-auth";
import { HugeiconsIcon } from "@hugeicons/react";
import { PencilEdit02Icon, ImageAdd02Icon } from "@hugeicons/core-free-icons";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateSettings } from "@/store/slices/settingsSlice";
import { AVATAR_EMOJIS, fileToAvatarDataUrl, isPhotoAvatar } from "@/lib/avatars";
import { useToast } from "@/components/toast/ToastProvider";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";

// Top of the account sheet: the avatar (with a glass pencil that opens the
// emoji / device-photo picker) above the user's handle — or a login button that
// opens the Privy modal when they aren't signed in yet.
export function ProfileHeader({ onLogin }: { onLogin: () => void }) {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { user, authenticated } = usePrivy();
  const avatar = useAppSelector((s) => s.settings.avatar);
  const [picking, setPicking] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handle = usernameFor(user);

  const setAvatar = (next: string) => {
    dispatch(updateSettings({ avatar: next }));
    playSound("tap");
    haptic("tap");
    setPicking(false);
  };

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      setAvatar(await fileToAvatarDataUrl(file));
    } catch {
      toast("Couldn't use that image", { type: "error" });
    }
  };

  return (
    <div className="mb-4 flex flex-col items-center py-3">
      {/* Avatar + pencil */}
      <div className="relative mb-1">
        <div className="flex h-28 w-28 items-center justify-center overflow-hidden rounded-full bg-white/[0.06] text-6xl">
          {isPhotoAvatar(avatar) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={avatar}
              alt="Profile"
              className="h-full w-full object-cover"
            />
          ) : (
            <span aria-hidden>{avatar}</span>
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
        <span className="mt-2 text-sm font-medium text-text">{handle}</span>
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
