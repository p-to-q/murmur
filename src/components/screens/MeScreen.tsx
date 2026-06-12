"use client";

/**
 * MeScreen — Compose v2 *reflect* moment.
 *
 * Specced in docs/page-redesign.md §8 + docs/page-contracts.md §7.
 *
 * Identity + notes + small editorial moments. Settings / Privacy / Delete
 * live as tertiary footer links; runtime debug strings move to /me/debug.
 *
 * Removed from v1:
 *   - Runtime provider chain debug strings and the StatusRow /
 *     ProviderStatusRow sections.
 *   - The three-column number stats block (replaced by a single
 *     editorial sentence).
 *
 * Added:
 *   - Notes card (balance + refill caption + Top up CTA), driven by
 *     `useUserBalance()` (docs/page-contracts.md §11).
 *   - Settings / Privacy / Delete account as tertiary footer.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { UserBadge } from "@/components/user-profile/user-badge";
import { useTranslator, useI18nStore } from "@/lib/i18n";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { useUserBalance } from "@/lib/hooks/use-user-balance";
import { usePreferencesStore } from "@/lib/store/preferences-store";

export function MeScreen() {
  const [songCount, setSongCount] = useState(0);
  const t = useTranslator();
  const lang = useI18nStore((s) => s.lang);
  const setLang = useI18nStore((s) => s.setLang);
  const { balance, isLoading } = useUserBalance();
  const { data: session } = useSession();
  const isSignedIn = !!session?.user;
  const repairBias = usePreferencesStore((state) => state.repairBias);
  const setRepairBias = usePreferencesStore((state) => state.setRepairBias);
  const developerMode = usePreferencesStore((state) => state.developerMode);

  useEffect(() => {
    let cancelled = false;
    async function loadSongCount() {
      try {
        const response = await fetch("/api/songs");
        if (!response.ok) return;
        const data = (await response.json()) as unknown;
        if (!cancelled && Array.isArray(data)) {
          setSongCount(data.length);
        }
      } catch {
        // Profile stats are decorative — keep the page usable offline.
      }
    }
    void loadSongCount();
    return () => {
      cancelled = true;
    };
  }, []);

  const refillCopy = useRefillCopy(balance?.nextRefillAt);
  const shelfCtaHref = songCount > 0 ? "/gallery" : "/";
  const shelfCtaLabel =
    songCount > 0
      ? t("me.glance.cta_songs") || "Open gallery"
      : t("me.glance.cta_empty") || "Start a hum";

  const milestone = getUserMilestone(songCount);

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <div
        className="relative z-10 px-5 md:px-12 pb-6 max-w-3xl"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 56px)" }}
      >
        <h1 className="hero-serif-italic text-[#1A1A1A] text-[44px] leading-[1.02] md:text-[72px]">
          {t("me.title")}
        </h1>
        <p className="font-serif-italic mt-3 max-w-[28rem] text-[15px] leading-[1.55] text-[#6F6A63] md:text-[16px]">
          {t("me.sub") || "A small shelf of your own."}
        </p>
      </div>

      {/* ── Body cards ─────────────────────────────────────────────── */}
      <div className="relative z-10 px-5 md:px-12 max-w-3xl space-y-5 pb-6">
        <Card className="relative z-20 overflow-visible">
          <SectionLabel>{t("me.profile.title") || "Profile"}</SectionLabel>
          <div className="space-y-4">
            <UserBadge />
            <p className="text-[13px] leading-[1.55] text-[#8C8780] md:text-[14px]">
              {t("me.profile.helper") ||
                "This is the name your songs live under in Murmur."}
            </p>
          </div>
        </Card>

        {/* Notes balance + Top up */}
        <Card>
          <SectionLabel>{t("me.notes.title") || "MURMUR NOTES"}</SectionLabel>
          <p className="font-serif text-[#1A1A1A] text-[52px] leading-none tabular-nums md:text-[56px] mb-2">
            {isLoading
              ? "—"
              : isSignedIn || balance?.unlimited
                ? "∞"
                : balance?.notes ?? 0}
          </p>
          <div className="flex items-end justify-between gap-4">
            <p className="flex-1 text-[13px] leading-[1.6] text-[#6F6A63] md:text-[14px]">
              {isSignedIn || balance?.unlimited
                ? t("me.notes.unlimited")
                : refillCopy}
            </p>
            {isSignedIn ? (
              <span className="text-[13px] text-[#8C8780]">{t("me.notes.signed_in")}</span>
            ) : (
              <Link href="/topup" className="mm-btn-primary inline-flex shrink-0">
                {t("me.notes.cta") || "Top up"}
              </Link>
            )}
          </div>
        </Card>

        {/* Milestone & Next move — achievement-driven guidance */}
        <Card>
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="flex-1 space-y-3">
              <SectionLabel>{lang === "zh" ? milestone.stageZh : milestone.stage}</SectionLabel>
              <p className="text-[13px] leading-[1.55] text-[#8C8780] md:text-[14px]">
                {lang === "zh" ? milestone.insightZh : milestone.insight}
              </p>
              <p className="font-serif-italic text-[#6F6A63] text-[16px] leading-[1.4]">
                {lang === "zh" ? milestone.actionZh : milestone.action}
              </p>
            </div>
            <Link href={shelfCtaHref} className="mm-btn-primary inline-flex shrink-0">
              {shelfCtaLabel}
            </Link>
          </div>
        </Card>

        <Card>
          <SectionLabel>{t("me.repair_bias.title") || "创作偏好"}</SectionLabel>
          <div className="space-y-7">
            <p className="max-w-[30rem] text-[13px] leading-[1.6] text-[#6F6A63] md:text-[14px]">
              {t("me.repair_bias.helper") ||
                "当 Murmur 拿不准该怎么理解你哼的那一段时，这个设置会影响它的判断。"}
            </p>

            <div className="space-y-3">
              {/* Three choice buttons */}
              <div className="grid grid-cols-3 gap-3">
                <button
                  onClick={() => setRepairBias(-1)}
                  className={`relative flex flex-col items-start gap-1.5 rounded-[16px] border px-4 py-4 text-left transition-all ${
                    repairBias <= -0.4
                      ? "border-[#1A1A1A] bg-[#FFFCF7]"
                      : "border-[#E7DCCB] bg-white/60 hover:border-[#D6C7B0]"
                  }`}
                >
                  <span className="text-[14px] font-medium text-[#1A1A1A]">
                    {lang === "zh" ? "偏原唱" : "Closer"}
                  </span>
                  {repairBias <= -0.4 && (
                    <span className="text-[11px] leading-[1.45] text-[#B7AEA1]">
                      {lang === "zh"
                        ? "保留你哼出来的走向"
                        : "Keep your hum as-is"}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setRepairBias(0)}
                  className={`relative flex flex-col items-start gap-1.5 rounded-[16px] border px-4 py-4 text-left transition-all ${
                    repairBias > -0.4 && repairBias < 0.4
                      ? "border-[#1A1A1A] bg-[#FFFCF7]"
                      : "border-[#E7DCCB] bg-white/60 hover:border-[#D6C7B0]"
                  }`}
                >
                  <span className="text-[14px] font-medium text-[#1A1A1A]">
                    {lang === "zh" ? "平衡" : "Balanced"}
                  </span>
                  {repairBias > -0.4 && repairBias < 0.4 && (
                    <span className="text-[11px] leading-[1.45] text-[#B7AEA1]">
                      {lang === "zh"
                        ? "大部分时候刚刚好"
                        : "Usually just right"}
                    </span>
                  )}
                </button>

                <button
                  onClick={() => setRepairBias(1)}
                  className={`relative flex flex-col items-end gap-1.5 rounded-[16px] border px-4 py-4 text-right transition-all ${
                    repairBias >= 0.4
                      ? "border-[#1A1A1A] bg-[#FFFCF7]"
                      : "border-[#E7DCCB] bg-white/60 hover:border-[#D6C7B0]"
                  }`}
                >
                  <span className="text-[14px] font-medium text-[#1A1A1A]">
                    {lang === "zh" ? "偏好听" : "Sweeter"}
                  </span>
                  {repairBias >= 0.4 && (
                    <span className="text-[11px] leading-[1.45] text-[#B7AEA1]">
                      {lang === "zh"
                        ? "让它更像首完整的歌"
                        : "More like a finished song"}
                    </span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </Card>

        {/* Language */}
        <Card>
          <SectionLabel>{t("me.language.title")}</SectionLabel>
          <div className="flex gap-2">
            <LangPill
              active={lang === "zh"}
              onClick={() => setLang("zh")}
              label={t("me.language.zh")}
            />
            <LangPill
              active={lang === "en"}
              onClick={() => setLang("en")}
              label={t("me.language.en")}
            />
          </div>
        </Card>
      </div>

      {/* ── Manifesto (keep — best copy in the product) ────────────── */}
      <div className="relative z-10 px-5 md:px-12 max-w-3xl pb-10">
        <div className="mm-manifesto">
          <p className="eyebrow text-[#FF8A5C] mb-5">{t("me.manifesto.eyebrow") || "A QUIET PLACE"}</p>
          <p className="font-serif text-[28px] md:text-[34px] leading-[1.15] text-[#F5F1EB]">
            No <span className="mm-strike">ads</span>, no{" "}
            <span className="mm-strike">feeds</span>, no{" "}
            <span className="mm-strike">algorithm</span>, no{" "}
            <span className="mm-strike">likes</span>.
          </p>
          <p className="mt-6 text-[#F5F1EB]/70 text-[15px] leading-[1.55] max-w-md">
            {t("me.manifesto.body") ||
              "Just a tiny private workshop for the songs you hum and forget. Every recording is yours — kept here, shared only when you choose to."}
          </p>
        </div>
      </div>

      {/* ── About ──────────────────────────────────────────────────── */}
      <div className="relative z-10 px-5 md:px-12 max-w-3xl pb-10">
        <Card>
          <SectionLabel>{t("me.about.title")}</SectionLabel>
          <p className="font-serif text-[#1A1A1A] text-[22px] leading-tight mb-2">
            {t("app.title")}
          </p>
          <p className="text-[#3A3A3A] text-[14px] leading-[1.55]">
            {t("me.about.desc")}
          </p>
          <p className="text-[#B6B0A4] text-[11px] mt-4 tracking-[0.18em] uppercase">
            {t("me.about.version")}
          </p>
        </Card>
      </div>

      {/* ── Tertiary footer ─────────────────────────────────────────── */}
      <div className="relative z-10 px-6 md:px-12 max-w-3xl pb-28">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px] tracking-[0.04em] text-[#8C8780]">
          {developerMode ? (
            <>
              <Link href="/me/debug" className="hover:text-[#1A1A1A] transition-colors">
                {t("me.debug") || "Debug"}
              </Link>
              <span className="text-[#D2C9B6]">·</span>
            </>
          ) : null}
          <Link href="/me/settings" className="hover:text-[#1A1A1A] transition-colors">
            {t("me.settings") || "Settings"}
          </Link>
          <span className="text-[#D2C9B6]">·</span>
          <Link href="/privacy" className="hover:text-[#1A1A1A] transition-colors">
            {t("me.privacy") || "Privacy"}
          </Link>
          <span className="text-[#D2C9B6]">·</span>
          <Link
            href="/me/delete"
            className="hover:text-[#D9421A] transition-colors"
          >
            {t("me.delete_account") || "Delete account"}
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────── */

/**
 * Calculate user milestone/stage based on song count
 */
function getUserMilestone(songCount: number): {
  stage: string;
  stageZh: string;
  insight: string;
  insightZh: string;
  action: string;
  actionZh: string;
} {
  if (songCount === 0) {
    return {
      stage: "STARTING POINT",
      stageZh: "起点",
      insight: "Your shelf is empty and ready.",
      insightZh: "空白的歌架正在等你。",
      action: "Start with one hum",
      actionZh: "从一句哼唱开始"
    };
  }

  if (songCount === 1) {
    return {
      stage: "FIRST SONG",
      stageZh: "第一首",
      insight: "One song down, infinite to go.",
      insightZh: "有了第一首，后面就是无限。",
      action: "Keep going",
      actionZh: "继续"
    };
  }

  if (songCount <= 3) {
    return {
      stage: "EXPLORING",
      stageZh: "探索中",
      insight: `${songCount} songs. Finding your voice.`,
      insightZh: `${songCount} 首歌。正在找到你的声音。`,
      action: "Try more vibes",
      actionZh: "试试更多氛围"
    };
  }

  if (songCount <= 10) {
    return {
      stage: "BUILDING",
      stageZh: "成长中",
      insight: `${songCount} songs. Your shelf is taking shape.`,
      insightZh: `${songCount} 首歌。歌架开始有样子了。`,
      action: "Fill the shelf",
      actionZh: "把歌架填满"
    };
  }

  if (songCount <= 20) {
    return {
      stage: "ACTIVE CREATOR",
      stageZh: "活跃创作者",
      insight: `${songCount} songs collected.`,
      insightZh: `收了 ${songCount} 首歌。`,
      action: "Keep creating",
      actionZh: "继续创作"
    };
  }

  // 21+
  return {
    stage: "PROLIFIC",
    stageZh: "高产",
    insight: `${songCount} songs and counting.`,
    insightZh: `已经 ${songCount} 首，还在继续。`,
    action: "You're on a roll",
    actionZh: "停不下来了"
  };
}

function useRefillCopy(nextRefillAtIso?: string): string {
  const t = useTranslator();
  if (!nextRefillAtIso) {
    return (
      t("me.notes.refill_default") || "5 notes refill every day at midnight."
    );
  }
  const next = new Date(nextRefillAtIso);
  const now = new Date();
  const diffMs = next.getTime() - now.getTime();
  if (diffMs <= 0) {
    return (
      t("me.notes.refill_due") || "Free notes are ready — refresh to claim."
    );
  }
  const hours = Math.floor(diffMs / 3_600_000);
  const minutes = Math.floor((diffMs % 3_600_000) / 60_000);
  if (hours > 1) {
    return (
      t("me.notes.refill_in_hours") || "5 more notes in about {hours}h."
    ).replace("{hours}", String(hours));
  }
  if (hours === 1) {
    return t("me.notes.refill_in_1h") || "5 more notes in about an hour.";
  }
  return (
    t("me.notes.refill_in_minutes") || "5 more notes in about {minutes} min."
  ).replace("{minutes}", String(Math.max(minutes, 1)));
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`mm-card p-6 ${className || ""}`}>{children}</div>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow mb-2 text-[#8C8780]">{children}</p>;
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
      onClick={onClick}
      className={`flex-1 h-10 rounded-md text-sm transition-colors ${
        active
          ? "bg-[#1A1A1A] text-[#F5F1EB]"
          : "bg-[#EFE8DA] text-[#8C8780] hover:text-[#1A1A1A]"
      }`}
    >
      {label}
    </button>
  );
}
