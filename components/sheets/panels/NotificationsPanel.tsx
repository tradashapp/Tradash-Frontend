"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Notification01Icon,
  Target02Icon,
  Robot01Icon,
  Alert02Icon,
  GridViewIcon,
  MoneyReceive01Icon,
  ChartLineData02Icon,
  Settings02Icon,
  TelegramIcon,
  Mail01Icon,
  SmartPhone01Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import {
  api,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationItem,
  type NotificationSettings,
} from "@/lib/api";
import { useNotifications } from "@/hooks/useNotifications";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/webPush";
import { MenuSection } from "@/components/ui/MenuSection";
import { ToggleSwitch } from "@/components/ui/ToggleSwitch";
import { InfoTip } from "@/components/ui/InfoTip";
import { SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/components/toast/ToastProvider";
import { openSignal, signalIdOf } from "@/lib/signals/open";

const ICONS: Record<NotificationCategory, typeof Notification01Icon> = {
  signal_alert: Target02Icon,
  auto_trade: Robot01Icon,
  bot_risk: Alert02Icon,
  grid: GridViewIcon,
  funds: MoneyReceive01Icon,
  price_alert: ChartLineData02Icon,
  system: Notification01Icon,
};

function ago(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

/** The inbox. Opening it marks everything read. */
export function NotificationsPanel({ onOpenSettings, onNavigate }: { onOpenSettings: () => void; onNavigate: () => void }) {
  const router = useRouter();
  const n = useNotifications();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void n.load().finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n.privyId]);

  // Read once seen, after a beat so the unread dots are visible on arrival.
  useEffect(() => {
    if (!loaded || n.unread === 0) return;
    const t = setTimeout(() => void n.markAllRead(), 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const open = (item: NotificationItem) => {
    const url = typeof item.data.url === "string" && item.data.url.startsWith("/") ? item.data.url : null;
    if (!url) return;
    onNavigate();
    const signalId = signalIdOf(url);
    if (signalId) openSignal(signalId);
    else router.push(url);
  };

  return (
    <div className="flex flex-col">
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          onClick={onOpenSettings}
          className="glass-inset flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-text-muted transition-colors hover:text-text"
        >
          <HugeiconsIcon icon={Settings02Icon} size={14} />
          Settings
        </button>
      </div>

      {!loaded ? (
        <div className="glass-inset rounded-2xl p-4">
          <SkeletonText width="66%" />
          <SkeletonText width="50%" className="mt-3" />
        </div>
      ) : n.items.length === 0 ? (
        <div className="flex flex-col items-center py-12 text-text-muted">
          <HugeiconsIcon icon={Notification01Icon} size={28} />
          <div className="mt-2 text-sm">No notifications</div>
        </div>
      ) : (
        <div className="glass-inset flex flex-col divide-y divide-white/[0.06] overflow-hidden rounded-2xl">
          {n.items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => open(item)}
              className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.04]"
            >
              <HugeiconsIcon icon={ICONS[item.category] ?? Notification01Icon} size={18} className="mt-0.5 shrink-0 text-text-muted" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="flex-1 truncate text-sm font-medium">{item.title}</span>
                  <span className="tabular shrink-0 text-[11px] text-text-muted">{ago(item.createdAt)}</span>
                </div>
                {item.body && <div className="mt-0.5 line-clamp-2 text-xs text-text-muted">{item.body}</div>}
              </div>
              {!item.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-up" aria-label="Unread" />}
            </button>
          ))}
          {!n.end && (
            <button type="button" onClick={() => void n.loadMore()} className="px-4 py-3 text-xs text-text-muted hover:text-text">
              {n.loading ? "Loading…" : "Older"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Channels + per-category switches. "Push" = this browser and the mobile app together. */
export function NotificationSettingsPanel() {
  const { privyId } = useNotifications();
  const { toast } = useToast();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!privyId) return;
    const [s, p] = await Promise.all([api.notificationSettings(privyId), pushState()]);
    setSettings(s);
    setPush(p);
  }, [privyId]);

  useEffect(() => {
    void reload().catch(() => toast("Couldn't load notification settings", { type: "error" }));
  }, [reload, toast]);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Something went wrong", { type: "error" });
    } finally {
      setBusy(null);
    }
  };

  if (!privyId) return <div className="py-10 text-center text-sm text-text-muted">Sign in to manage notifications</div>;
  if (!settings || push === null) {
    return (
      <div className="glass-inset rounded-2xl p-4">
        <SkeletonText width="66%" />
        <SkeletonText width="50%" className="mt-3" />
      </div>
    );
  }

  const { channels } = settings;
  const togglePush = (on: boolean) =>
    run("push", async () => {
      if (on) {
        if (!channels.webpush.publicKey) throw new Error("Push isn't available yet.");
        const next = await enablePush(privyId, channels.webpush.publicKey);
        setPush(next);
        if (next === "denied") toast("Notifications are blocked", { type: "error", description: "Allow them for this site in your browser settings." });
      } else setPush(await disablePush(privyId));
      await reload();
    });

  const connectTelegram = () =>
    run("telegram", async () => {
      // Open the tab first, inside the tap, or popup blockers eat it.
      const tab = window.open("about:blank", "_blank");
      const { url } = await api.telegramLink(privyId);
      if (tab) tab.location.href = url;
      else window.location.href = url;
    });

  const setPref = (category: NotificationCategory, chs: NotificationChannel[], enabled: boolean) =>
    run(`${category}`, async () => {
      let next = settings;
      for (const ch of chs) next = await api.setNotificationPreference(privyId, category, ch, enabled);
      setSettings(next);
    });

  const pushTip: Partial<Record<PushState, string>> = {
    "ios-install": "On iPhone, add Tradash to your Home Screen first, then turn this on from the installed app.",
    denied: "Notifications are blocked for this site. Allow them in your browser settings.",
    unsupported: "This browser doesn't support push notifications.",
    "no-worker": "Push needs the installed or production app.",
  };
  const pushUsable = push === "on" || push === "off";
  const columns: Array<{ key: string; label: string; chs: NotificationChannel[]; show: boolean }> = [
    { key: "push", label: "Push", chs: ["webpush", "expo"], show: channels.webpush.available || channels.expo.devices.length > 0 },
    { key: "telegram", label: "Telegram", chs: ["telegram"], show: channels.telegram.chats.length > 0 },
    { key: "email", label: "Email", chs: ["email"], show: channels.email.available },
  ];
  const visible = columns.filter((c) => c.show);

  return (
    <div className="flex flex-col">
      <MenuSection title="Channels" className="mb-4">
        {channels.webpush.available && (
          <div className="flex items-center gap-3 px-4 py-3">
            <HugeiconsIcon icon={SmartPhone01Icon} size={18} className="shrink-0 text-text-muted" />
            <span className="flex flex-1 items-center gap-1.5 text-sm">
              This device
              {!pushUsable && pushTip[push] && <InfoTip variant="info">{pushTip[push]}</InfoTip>}
            </span>
            {pushUsable && <ToggleSwitch on={push === "on"} onChange={(on) => void togglePush(on)} />}
          </div>
        )}

        {channels.telegram.available &&
          (channels.telegram.chats.length ? (
            channels.telegram.chats.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                <HugeiconsIcon icon={TelegramIcon} size={18} className="shrink-0 text-text-muted" />
                <span className="flex-1 truncate text-sm">{c.username ? `@${c.username}` : "Telegram"}</span>
                <button
                  type="button"
                  aria-label="Disconnect Telegram"
                  onClick={() => void run("tg-rm", async () => { await api.removeNotificationChannel(privyId, c.id); await reload(); })}
                  className="text-text-muted transition-colors hover:text-down"
                >
                  <HugeiconsIcon icon={Delete02Icon} size={16} />
                </button>
              </div>
            ))
          ) : (
            <button type="button" onClick={() => void connectTelegram()} className="flex w-full items-center gap-3 px-4 py-3 text-sm hover:bg-white/[0.06]">
              <HugeiconsIcon icon={TelegramIcon} size={18} className="shrink-0 text-text-muted" />
              <span className="flex-1 text-left">Connect Telegram</span>
              {busy === "telegram" && <span className="text-xs text-text-muted">…</span>}
            </button>
          ))}

        {channels.email.available && (
          <div className="flex items-center gap-3 px-4 py-3">
            <HugeiconsIcon icon={Mail01Icon} size={18} className="shrink-0 text-text-muted" />
            <span className="flex flex-1 items-center gap-1.5 truncate text-sm">
              {channels.email.address}
              <InfoTip>Only important events: bot safety stops, failed auto trades and withdrawals.</InfoTip>
            </span>
          </div>
        )}
      </MenuSection>

      {visible.length > 0 && (
        <MenuSection title="Alerts" className="mb-4">
          <div className="flex items-center px-4 pt-3 text-[11px] text-text-muted">
            <span className="flex-1" />
            {visible.map((c) => (
              <span key={c.key} className="w-16 text-center">{c.label}</span>
            ))}
          </div>
          {settings.categories.map((cat) => (
            <div key={cat.key} className="flex items-center px-4 py-2.5">
              <span className="flex-1 text-sm">{cat.label}</span>
              {visible.map((col) => (
                <span key={col.key} className="flex w-16 justify-center">
                  {col.key === "email" && !cat.emailAllowed ? (
                    <span className="text-xs text-text-muted">—</span>
                  ) : (
                    <ToggleSwitch on={col.chs.some((ch) => cat.enabled[ch])} onChange={(on) => void setPref(cat.key, col.chs, on)} />
                  )}
                </span>
              ))}
            </div>
          ))}
        </MenuSection>
      )}

      <button
        type="button"
        onClick={() => void run("test", async () => { await api.sendTestNotification(privyId); toast("Test sent", { type: "success" }); })}
        className="glass-inset rounded-2xl px-4 py-3 text-sm text-text-muted transition-colors hover:text-text"
      >
        {busy === "test" ? "Sending…" : "Send a test"}
      </button>
    </div>
  );
}
