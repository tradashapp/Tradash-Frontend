"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePrivy } from "@privy-io/react-auth";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PencilEdit02Icon,
  Camera01Icon,
  Tick02Icon,
  Loading03Icon,
  NewTwitterIcon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { updateSettings } from "@/store/slices/settingsSlice";
import { fileToAvatarDataUrl, isPhotoAvatar } from "@/lib/avatars";
import { useToast } from "@/components/toast/ToastProvider";
import { playSound } from "@/lib/sound";
import { haptic } from "@/lib/haptics";
import { useProfile } from "@/hooks/useProfile";
import { USERNAME_PATTERN } from "@/lib/username";
import { twitterHandle } from "@/lib/twitter";
import { ProfileAvatar } from "@/components/ui/ProfileAvatar";

/**
 * Top of the account sheet: the avatar above the user's handle — or a login
 * button when they aren't signed in yet.
 *
 * The avatar itself is not a control: editing lives behind the pencil beside
 * the handle, which opens ONE panel owning both the name and the photo. Two
 * separate edit affordances (a pencil on the avatar, another on the name) meant
 * two panels that could both be open, each editing half an identity.
 */
export function ProfileHeader({ onLogin }: { onLogin: () => void }) {
  const { user, authenticated } = usePrivy();
  const profile = useProfile();
  const [editing, setEditing] = useState(false);

  // The stored handle is the identity other people see; fall back to whatever
  // the login method suggests until the backend's seeded one has loaded.
  const name = profile.username ?? fallbackName(user);
  const handle = `@${name}`;

  return (
    <div className="mb-4 flex flex-col items-center">
      <ProfileAvatar
        src={profile.avatarUrl}
        name={name}
        className="h-28 w-28 text-4xl"
      />

      {/* Handle + the pencil that opens the edit panel, or the login pill. */}
      {authenticated ? (
        <button
          type="button"
          onClick={() => {
            playSound("tap");
            haptic("tap");
            setEditing((e) => !e);
          }}
          className="mt-2 flex items-center gap-1.5 text-sm font-medium text-text transition-opacity active:opacity-60"
          aria-expanded={editing}
          aria-label="Edit profile"
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

      <AnimatePresence initial={false}>
        {editing && authenticated && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="w-full overflow-hidden"
          >
            <EditProfilePanel profile={profile} onDone={() => setEditing(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Everything that makes up the public identity, in one panel: the handle, the
 * photo, and the social accounts linked to it.
 */
function EditProfilePanel({
  profile,
  onDone,
}: {
  profile: ReturnType<typeof useProfile>;
  onDone: () => void;
}) {
  const dispatch = useAppDispatch();
  const { toast } = useToast();
  const { user, linkTwitter } = usePrivy();
  const avatar = useAppSelector((s) => s.settings.avatar);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const xHandle = twitterHandle(user);

  const onPickFile = async (file: File | undefined) => {
    if (!file) return;
    let dataUrl: string;
    try {
      dataUrl = await fileToAvatarDataUrl(file);
    } catch {
      toast("Couldn't use that image", { type: "error" });
      return;
    }
    playSound("tap");
    haptic("tap");
    // Show it locally at once, then publish it so it renders for everyone else
    // on the leaderboard. A failed upload leaves the local photo in place — it's
    // still valid for this browser — but says so.
    dispatch(updateSettings({ avatar: dataUrl }));
    if (!(await profile.uploadAvatar(dataUrl))) {
      toast("Photo saved on this device only", { type: "info" });
    }
  };

  const photo = profile.avatarUrl ?? (isPhotoAvatar(avatar) ? avatar : null);

  return (
    <div className="glass-inset mt-3 flex flex-col gap-3 rounded-2xl p-3">
      {/* Photo — a preview beside the one action that changes it. */}
      <div className="flex items-center gap-3">
        <ProfileAvatar
          src={photo}
          name={profile.username}
          className="h-12 w-12 text-base"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={profile.savingAvatar}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white/[0.05] py-2.5 text-xs font-medium text-text-muted transition-colors hover:text-text disabled:opacity-50"
        >
          <HugeiconsIcon
            icon={profile.savingAvatar ? Loading03Icon : Camera01Icon}
            size={16}
            className={profile.savingAvatar ? "animate-spin" : ""}
          />
          {photo ? "Change photo" : "Upload photo"}
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

      <UsernameForm
        current={profile.username}
        saving={profile.savingUsername}
        onSubmit={async (name) => {
          const result = await profile.claimUsername(name);
          if (result === "ok") {
            toast("Username updated", { type: "success" });
            onDone();
          } else if (result === "taken") {
            toast("That username is taken", { type: "error" });
          } else if (result === "invalid") {
            toast("3-20 letters, numbers or underscores", { type: "error" });
          } else {
            toast("Couldn't save that username", { type: "error" });
          }
        }}
      />

      {/* Socials. Linking X also brings its profile photo across for users who
          have none yet — adopted centrally in useAgentWallet, so it happens on
          a plain X login too, not only when this panel is open. */}
      <div>
        <div className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">
          Connect socials
        </div>
        <button
          type="button"
          disabled={!!xHandle}
          onClick={() => {
            playSound("tap");
            haptic("tap");
            linkTwitter();
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/[0.12] py-2.5 text-xs font-semibold text-text transition-colors hover:bg-white/[0.05] disabled:cursor-default disabled:text-text-muted disabled:hover:bg-transparent"
        >
          <HugeiconsIcon icon={NewTwitterIcon} size={15} />
          {xHandle ? `@${xHandle}` : "Connect X"}
          {xHandle && (
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              size={15}
              className="text-up"
            />
          )}
        </button>
      </div>
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

  // The handle is seeded server-side at signup, so it can land AFTER this form
  // mounted with an empty box. Adopt it while the field is still untouched —
  // otherwise the user sees a blank input under a header showing their name.
  useEffect(() => {
    if (current) setValue((v) => (v === "" ? current : v));
  }, [current]);

  return (
    <div className="flex items-center gap-2 rounded-2xl bg-white/[0.04] p-2">
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
 * A display name for the signed-in user, used only until the stored handle
 * loads (every user is seeded one at signup). Privy has no single username
 * field, so we take the best identity the login method gave us.
 */
function fallbackName(user: ReturnType<typeof usePrivy>["user"]): string {
  if (!user) return "trader";
  const twitter = user.twitter?.username;
  if (twitter) return twitter;
  const discord = user.discord?.username;
  if (discord) return discord.split("#")[0];
  const github = user.github?.username;
  if (github) return github;
  const email = user.email?.address ?? user.google?.email;
  if (email) return email.split("@")[0];
  const addr = user.wallet?.address;
  if (addr) return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
  return "trader";
}
