"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Bell,
  ChevronRight,
  Settings2,
  Shield,
  Trash2,
  Wallet,
  X,
} from "lucide-react";

import { UserBadge } from "@/components/user-profile/user-badge";
import { useBrowserNotification } from "@/lib/hooks/use-browser-notification";
import { useCurrentAccount } from "@/lib/hooks/use-current-account";
import { useUserBalance } from "@/lib/hooks/use-user-balance";
import { useCurrentLang, useI18nStore, useTranslator } from "@/lib/i18n";
import { useMurmurStore } from "@/lib/store/murmur-store";
import { cn } from "@/utils/utils";

export function MobileMeDock() {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslator();
  const lang = useCurrentLang();
  const setLang = useI18nStore((s) => s.setLang);
  const { user, isRegistered, isLocalCreator } = useCurrentAccount();
  const { balance, isLoading: balanceLoading } = useUserBalance();
  const {
    permission,
    browserAlertsEnabled,
    setBrowserAlertsEnabled,
  } = useBrowserNotification();
  const { isPlaying, auditioningVersionId } = useMurmurStore();
  const [openPathname, setOpenPathname] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const open = openPathname === pathname;

  const audioActive = isPlaying || auditioningVersionId !== null;
  const alertOn = permission === "granted" && browserAlertsEnabled;
  const refillCopy = useRefillCopy(balance?.nextRefillAt);
  const accountLabel =
    displayAccountName(user) ??
    (isLocalCreator ? (t("auth.local_creator") || "Guest") : null) ??
    (isRegistered ? (t("auth.account_registered") || "Registered") : null) ??
    (t("auth.account_local") || "Guest");

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenPathname(null);
    };

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current?.contains(target) ||
        panelRef.current?.contains(target)
      ) {
        return;
      }
      setOpenPathname(null);
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  const notes = useMemo(() => {
    if (balanceLoading) return "—";
    return String(balance?.notes ?? 0);
  }, [balance?.notes, balanceLoading]);

  return (
    <div className="pointer-events-auto relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("nav.me") || "Me"}
        aria-expanded={open}
        onClick={() => setOpenPathname((value) => (value === pathname ? null : pathname))}
        className={cn(
          "group flex h-[56px] w-[56px] flex-col items-center justify-center rounded-[18px] border px-1.5 pt-1 text-center shadow-[0_2px_10px_rgba(26,26,26,0.06)] backdrop-blur-sm transition-all",
          open
            ? "border-[#FF5924]/28 bg-[#FFFEFB]/95"
            : "border-[#E5DDD0] bg-[#FFFEFB]/90 hover:border-[#FF5924]/24",
        )}
      >
        <MiniDisc active={audioActive} reduceMotion={reduceMotion} />
        <span
          className={cn(
            "mt-1 text-[11px] leading-none transition-colors",
            open ? "text-[#1A1A1A]" : "text-[#8C8780] group-hover:text-[#1A1A1A]",
          )}
        >
          {t("nav.me") || "Me"}
        </span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.18 }}
              className="fixed inset-0 z-[58] bg-[#1A1A1A]/18 backdrop-blur-[2px]"
            />
            <motion.aside
              ref={panelRef}
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{
                duration: reduceMotion ? 0 : 0.32,
                ease: [0.22, 1, 0.36, 1],
              }}
              className="fixed inset-y-0 right-0 z-[59] w-[min(88vw,352px)]"
              aria-label="Me drawer"
            >
              <div className="flex h-full flex-col border-l border-[#E5DDD0] bg-[#FFFEFB]/96 shadow-[-18px_0_42px_rgba(26,26,26,0.12)] backdrop-blur-xl">
                <div
                  className="flex items-start justify-between gap-3 px-5 pb-4 pt-[max(env(safe-area-inset-top, 0px), 16px)]"
                >
                  <div className="flex items-center gap-3">
                    <MiniDisc active={audioActive} reduceMotion={reduceMotion} size={38} />
                    <div>
                      <p className="font-serif-italic text-[20px] leading-none text-[#1A1A1A]">
                        {t("nav.me") || "Me"}
                      </p>
                      <p className="mt-1 text-[11px] leading-tight text-[#8C8780]">
                        {accountLabel}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={t("common.cancel") || "Cancel"}
                    onClick={() => setOpenPathname(null)}
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-[#E5DDD0] bg-white/80 text-[#1A1A1A] transition-colors hover:border-[#FF5924]/35 hover:text-[#FF5924]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 pb-[max(env(safe-area-inset-bottom, 0px), 18px)]">
                  <div className="space-y-4">
                    <section className="rounded-[18px] border border-[#E5DDD0] bg-[#F5F1EB]/55 p-3">
                      <UserBadge />
                    </section>

                    <section className="rounded-[18px] border border-[#E5DDD0] bg-white/75 p-3">
                      <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-[#B6B0A4]">
                        <Wallet className="h-3.5 w-3.5" />
                        <span>{t("me.mobile.notes") || "Notes"}</span>
                      </div>
                      <div className="flex items-end justify-between gap-3">
                        <div>
                          <div className="font-serif text-[30px] leading-none tabular-nums text-[#1A1A1A]">
                            {notes}
                          </div>
                          <p className="mt-2 max-w-[18ch] text-[12px] leading-[1.45] text-[#8C8780]">
                            {balance?.unlimited
                              ? (t("me.notes.unlimited") || "Unlimited notes")
                              : refillCopy}
                          </p>
                        </div>
                        <Link
                          href="/topup"
                          className="mm-btn-primary shrink-0 px-4 py-3 text-[13px]"
                          suppressHydrationWarning
                        >
                          {t("nav.topup") || "Top up"}
                        </Link>
                      </div>
                    </section>

                    <section className="rounded-[18px] border border-[#E5DDD0] bg-white/75 p-1.5">
                      <DrawerLink href="/me/settings" icon={Settings2} label={t("nav.flow.settings") || "Settings"} />
                      <DrawerLink href="/me/notifications" icon={Bell} label={t("nav.flow.notifications") || "Notifications"} />
                      <DrawerLink href="/me/payments" icon={Wallet} label={t("nav.flow.payment_records") || "Payment records"} />
                      <DrawerLink href="/me/privacy" icon={Shield} label={t("nav.flow.privacy") || "Privacy"} />
                      <DrawerLink href="/me/delete" icon={Trash2} label={t("nav.flow.delete_account") || "Delete account"} />
                    </section>

                    <section className="rounded-[18px] border border-[#E5DDD0] bg-white/75 p-3">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-[#B6B0A4]">
                          {t("nav.notify.title") || "Notifications"}
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={alertOn}
                          onClick={() => void setBrowserAlertsEnabled(!alertOn)}
                          className={cn(
                            "relative h-7 w-12 rounded-full border transition-colors",
                            alertOn
                              ? "border-[#FF5924]/35 bg-[#FFE6DA]"
                              : "border-[#E5DDD0] bg-[#F5F1EB]",
                          )}
                        >
                          <span
                            className={cn(
                              "absolute top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-[#FFFEFB] shadow-sm transition-transform",
                              alertOn ? "translate-x-[24px]" : "translate-x-[3px]",
                            )}
                          />
                        </button>
                      </div>
                      <p className="text-[12px] leading-[1.5] text-[#8C8780]">
                        {permission === "granted"
                          ? (t("nav.notify.enabled") || "On.")
                          : permission === "denied"
                            ? (t("nav.notify.denied") || "Blocked")
                            : (t("nav.notify.desc") || "Keep browser alerts ready for saves and generation updates.")}
                      </p>
                    </section>

                    <section className="rounded-[18px] border border-[#E5DDD0] bg-white/75 p-3">
                      <div className="mb-2 text-[11px] uppercase tracking-[0.18em] text-[#B6B0A4]">
                        {t("me.mobile.title") || "Me"}
                      </div>
                      <div className="flex gap-2">
                        <LangPill active={lang === "zh"} onClick={() => setLang("zh")} label="中" />
                        <LangPill active={lang === "en"} onClick={() => setLang("en")} label="EN" />
                      </div>
                    </section>

                    <div className="pb-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenPathname(null);
                          router.push("/me");
                        }}
                        className="group flex w-full items-center justify-between rounded-[16px] border border-[#E5DDD0] bg-[#1A1A1A] px-4 py-3 text-left text-[#FFFEFB] transition-colors hover:bg-[#1A1A1A]/92"
                      >
                        <span className="text-[13px] font-medium">
                          {t("me.title") || "Open Me"}
                        </span>
                        <ChevronRight className="h-4 w-4 text-[#FFFEFB]/70 transition-transform group-hover:translate-x-0.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function MiniDisc({
  active,
  reduceMotion,
  size = 32,
}: {
  active: boolean;
  reduceMotion: boolean | null;
  size?: number;
}) {
  return (
    <span
      className="relative inline-flex items-center justify-center rounded-full bg-[#1A1A1A]"
      style={{
        width: size,
        height: size,
      }}
      aria-hidden
    >
      <span
        className="absolute inset-[4px] rounded-full border border-white/10"
        aria-hidden
      />
      <motion.span
        animate={
          active && !reduceMotion
            ? { scale: [1, 1.18, 1], opacity: [1, 0.74, 1] }
            : { scale: 1, opacity: 1 }
        }
        transition={
          active && !reduceMotion
            ? { duration: 1.9, repeat: Infinity, ease: "easeInOut" }
            : { duration: 0.25 }
        }
        className="block rounded-full bg-[#FF5924]"
        style={{
          width: Math.max(5, Math.round(size * 0.2)),
          height: Math.max(5, Math.round(size * 0.2)),
        }}
      />
    </span>
  );
}

function DrawerLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center justify-between gap-3 rounded-[14px] px-3 py-2.5 transition-colors hover:bg-[#F5F1EB]"
      suppressHydrationWarning
    >
      <span className="flex items-center gap-2.5 text-[13px] font-medium text-[#1A1A1A]">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#F5F1EB] text-[#8C8780] transition-colors group-hover:text-[#FF5924]">
          <Icon className="h-3.5 w-3.5" />
        </span>
        {label}
      </span>
      <ChevronRight className="h-3.5 w-3.5 text-[#B6B0A4] transition-transform group-hover:translate-x-0.5 group-hover:text-[#FF5924]" />
    </Link>
  );
}

function LangPill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-colors",
        active
          ? "border-[#FF5924]/35 bg-[#FFE6DA] text-[#1A1A1A]"
          : "border-[#E5DDD0] bg-[#F5F1EB] text-[#8C8780] hover:text-[#1A1A1A]",
      )}
    >
      {label}
    </button>
  );
}

function useRefillCopy(nextRefillAtIso?: string | null): string {
  const now = useNow(60_000);
  const t = useTranslator();

  return useMemo(() => {
    if (now === null) {
      return t("me.notes.refill_default") || "Guest mode gets 5 free notes once.";
    }
    if (!nextRefillAtIso) {
      return t("me.notes.refill_default") || "Guest mode gets 5 free notes once.";
    }
    const nextRefillAt = new Date(nextRefillAtIso);
    if (Number.isNaN(nextRefillAt.getTime())) {
      return t("me.notes.refill_default") || "Guest mode gets 5 free notes once.";
    }
    const diffMs = nextRefillAt.getTime() - now;
    if (diffMs <= 0) {
      return t("me.notes.refill_due") || "Free notes are ready.";
    }
    const diffMinutes = Math.ceil(diffMs / 60000);
    if (diffMinutes < 60) {
      const template = t("me.notes.refill_in_minutes") || "Free notes in about {minutes} min.";
      return template.replace("{minutes}", String(diffMinutes));
    }
    const diffHours = Math.ceil(diffMinutes / 60);
    if (diffHours === 1) {
      return t("me.notes.refill_in_1h") || "Free notes in about an hour.";
    }
    const template = t("me.notes.refill_in_hours") || "Free notes in about {hours}h.";
    return template.replace("{hours}", String(diffHours));
  }, [nextRefillAtIso, now, t]);
}

function useNow(intervalMs: number): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const syncNow = () => setNow(Date.now());
    const tick = window.setTimeout(syncNow, 0);
    const interval = window.setInterval(syncNow, intervalMs);
    return () => {
      window.clearTimeout(tick);
      window.clearInterval(interval);
    };
  }, [intervalMs]);

  return now;
}

function displayAccountName(user: { name?: string | null; email?: string | null; accountKind?: string | null } | null | undefined): string | null {
  if (!user) return null;
  if (user.accountKind === "local_creator" || user.name === "Local Creator") {
    return "Guest";
  }
  return user.name ?? user.email ?? null;
}
