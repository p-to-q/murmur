"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BellRing, CheckCheck, Trash2 } from "lucide-react";

import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { useCurrentLang, useTranslator } from "@/lib/i18n";
import { useNotificationActions } from "@/lib/hooks/use-notification-actions";
import {
  useNotificationStore,
  type MurmurNotification,
} from "@/lib/store/notification-store";
import { formatNotificationTime } from "./MeScreen";

export function NotificationsScreen() {
  const t = useTranslator();
  const lang = useCurrentLang();
  const router = useRouter();
  const notifications = useNotificationStore((state) => state.items);
  const markRead = useNotificationStore((state) => state.markRead);
  const markAllRead = useNotificationStore((state) => state.markAllRead);
  const clearAll = useNotificationStore((state) => state.clearAll);
  const {
    alertsOn,
    isTesting,
    sendTestNotification,
  } = useNotificationActions();
  const unreadCount = notifications.filter((item) => !item.readAt).length;

  const openNotification = (item: MurmurNotification) => {
    markRead(item.id);
    if (item.href) router.push(item.href);
  };

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB] text-[#1A1A1A]">
      <PageBackdrop variant="soft" />

      <div
        className="relative z-10 mx-auto max-w-3xl px-6 pb-28 md:px-12"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 48px)" }}
      >
        <Link
          href="/me"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/55 bg-white/70 transition-colors hover:bg-white"
          aria-label={t("common.back") || "Back"}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        <header className="mt-7">
          <h1 className="hero-serif-italic text-[44px] leading-[1.02] md:text-[72px]">
            {t("me.notifications") || "Notifications"}
          </h1>
        </header>

        <section className="mt-7 grid gap-3 sm:grid-cols-3">
          <SummaryTile
            label={t("notifications.summary.status") || "Status"}
            value={alertsOn ? t("notifications.status.on") || "On" : t("notifications.status.off") || "Off"}
            lang={lang}
          />
          <SummaryTile
            label={t("notifications.summary.unread") || "Unread"}
            value={String(unreadCount)}
            lang={lang}
          />
          <SummaryTile
            label={t("notifications.summary.total") || "Total"}
            value={String(notifications.length)}
            lang={lang}
          />
        </section>

        <main className="mt-5 rounded-[8px] border border-white/70 bg-white/65 p-4 shadow-[0_18px_45px_rgba(92,72,45,0.07)]">
          <div className="flex flex-wrap items-center gap-2 border-b border-[#E5DDD0]/70 pb-4">
            <button
              type="button"
              onClick={markAllRead}
              disabled={notifications.length === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#E5DDD0] bg-white/55 px-3 text-[12px] text-[#6F6A63] transition-colors hover:border-[#C8C0B4] hover:text-[#1A1A1A] disabled:pointer-events-none disabled:opacity-40"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {t("nav.notify.mark_all") || "Mark all read"}
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={notifications.length === 0}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#E5DDD0] bg-white/55 px-3 text-[12px] text-[#6F6A63] transition-colors hover:border-[#C8C0B4] hover:text-[#1A1A1A] disabled:pointer-events-none disabled:opacity-40"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t("nav.notify.clear") || "Clear notifications"}
            </button>
            <button
              type="button"
              onClick={() => void sendTestNotification()}
              disabled={isTesting}
              className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#E5DDD0] bg-[#F8F3EA] px-3 text-[12px] text-[#6F6A63] transition-colors hover:border-[#C8C0B4] hover:text-[#1A1A1A] disabled:cursor-wait disabled:opacity-60"
            >
              <BellRing className="h-3.5 w-3.5" />
              {t("nav.notify.test") || "Test notification"}
            </button>
          </div>

          <div className="mt-5 space-y-2">
            {notifications.length === 0 ? (
              <div className="flex min-h-[160px] whitespace-pre-line items-center justify-center rounded-[8px] border border-dashed border-[#E5DDD0] bg-[#F8F3EA]/55 px-5 text-center text-[13px] leading-[1.55] text-[#8C8780]">
                {t("nav.notify.empty") || "No notifications yet."}
              </div>
            ) : (
              notifications.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openNotification(item)}
                  className="group flex w-full items-start gap-3 rounded-[8px] px-3 py-3 text-left transition-colors hover:bg-[#F8F3EA]"
                >
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      item.readAt ? "bg-[#D8CCBA]" : "bg-[#FF5924]"
                    }`}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium leading-snug text-[#1A1A1A]">
                      {item.title}
                    </span>
                    <span className="mt-1 block text-[12px] leading-[1.5] text-[#8C8780]">
                      {item.body}
                    </span>
                  </span>
                  <span className="shrink-0 text-[10px] leading-snug text-[#B6B0A4]">
                    {formatNotificationTime(item.createdAt, lang)}
                  </span>
                </button>
              ))
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, lang }: { label: string; value: string; lang: "zh" | "en" }) {
  return (
    <div className="rounded-[8px] border border-white/65 bg-white/55 px-4 py-3 shadow-[0_14px_35px_rgba(92,72,45,0.06)]">
      <p className="text-[11px] uppercase tracking-[0.14em] text-[#B7AEA1]">{label}</p>
      <p
        className={`mt-1 text-[24px] leading-none text-[#1A1A1A] tabular-nums ${
          lang === "zh" ? "font-chinese-title" : "font-serif"
        }`}
      >
        {value}
      </p>
    </div>
  );
}
