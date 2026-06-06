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

  const statsCopy = useStatsCopy(songCount);
  const refillCopy = useRefillCopy(balance?.nextRefillAt);
  const shelfCtaHref = songCount > 0 ? "/gallery" : "/";
  const shelfCtaLabel =
    songCount > 0
      ? t("me.glance.cta_songs") || "Open gallery"
      : t("me.glance.cta_empty") || "Start a hum";

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <div
        className="relative z-10 px-6 md:px-12 pb-6 max-w-3xl"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 56px)" }}
      >
        <p className="eyebrow text-[#FF8A5C]">
          {t("me.eyebrow") || "YOURS"}
        </p>
        <h1 className="hero-serif-italic mt-3 text-[#1A1A1A] text-[44px] leading-[1.02] md:text-[72px]">
          {t("me.title")}
        </h1>
        <p className="font-serif-italic mt-3 max-w-[28rem] text-[15px] leading-[1.55] text-[#6F6A63] md:text-[16px]">
          {t("me.sub") || "A small shelf of your own."}
        </p>
      </div>

      {/* ── Body cards ─────────────────────────────────────────────── */}
      <div className="relative z-10 px-6 md:px-12 max-w-3xl space-y-5 pb-6">
        <Card>
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
          <div className="flex items-end justify-between gap-6">
            <div>
              <p className="font-serif text-[#1A1A1A] text-[52px] leading-none tabular-nums md:text-[56px]">
                {isLoading ? "—" : balance?.notes ?? 0}
              </p>
              <p className="mt-3 max-w-[18rem] text-[13px] leading-[1.6] text-[#6F6A63] md:text-[14px]">
                {refillCopy}
              </p>
            </div>
            <Link href="/topup" className="mm-btn-primary">
              {t("me.notes.cta") || "Top up"}
            </Link>
          </div>
        </Card>

        {/* At a glance — single editorial sentence */}
        <Card>
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="max-w-[28rem]">
              <SectionLabel>{t("me.glance.title") || "AT A GLANCE"}</SectionLabel>
              <p className="mb-3 text-[13px] leading-[1.55] text-[#8C8780] md:text-[14px]">
                {t("me.glance.helper") || "A quick read before your next move."}
              </p>
              <p className="font-serif-italic text-[#1A1A1A] text-[20px] leading-[1.4] md:text-[22px]">
                {statsCopy}
              </p>
            </div>
            <Link
              href={shelfCtaHref}
              className="inline-flex h-10 items-center rounded-full border border-[#E7DCCB] px-4 text-[12px] tracking-[0.08em] text-[#6F6A63] transition-colors hover:border-[#D6C7B0] hover:text-[#1A1A1A]"
            >
              {shelfCtaLabel}
            </Link>
          </div>
        </Card>

        <Card>
          <SectionLabel>{t("me.repair_bias.title") || "CREATIVE BIAS"}</SectionLabel>
          <div className="space-y-4">
            <p className="max-w-[30rem] text-[13px] leading-[1.6] text-[#6F6A63] md:text-[14px]">
              {t("me.repair_bias.helper") ||
                "This only nudges Murmur when a take could go more than one sensible way."}
            </p>
            <div className="rounded-[18px] border border-[#E7DCCB] bg-[#FFFCF7] px-4 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[12px] tracking-[0.06em] text-[#A56A3A]">
                    {t("me.repair_bias.left") || "Closer to your hum"}
                  </p>
                  <p className="mt-1 text-[12px] leading-[1.5] text-[#8C8780]">
                    {t("me.repair_bias.left_note") ||
                      "Keep closer to the line you just hummed."}
                  </p>
                </div>
                <div className="min-w-0 text-right">
                  <p className="text-[12px] tracking-[0.06em] text-[#A56A3A]">
                    {t("me.repair_bias.right") || "More songlike"}
                  </p>
                  <p className="mt-1 text-[12px] leading-[1.5] text-[#8C8780]">
                    {t("me.repair_bias.right_note") ||
                      "Hey, this is not us saying you sang badly."}
                  </p>
                </div>
              </div>

              <div className="mt-5">
                <input
                  aria-label={t("me.repair_bias.title") || "Creative bias"}
                  type="range"
                  min={-100}
                  max={100}
                  step={1}
                  value={Math.round(repairBias * 100)}
                  onChange={(event) => {
                    setRepairBias(Number(event.target.value) / 100);
                  }}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[#E7DCCB]"
                  style={{
                    background:
                      "linear-gradient(90deg, #E6D3BC 0%, #F6E6D2 50%, #FFD2BE 100%)",
                  }}
                />
                <div className="mt-3 flex items-center justify-between text-[11px] tracking-[0.04em] text-[#8C8780]">
                  <span>{t("me.repair_bias.live.left") || "Closer"}</span>
                  <span>{t("me.repair_bias.live.center") || "Balanced"}</span>
                  <span>{t("me.repair_bias.live.right") || "Sweeter"}</span>
                </div>
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
      <div className="relative z-10 px-6 md:px-12 max-w-3xl pb-10">
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
      <div className="relative z-10 px-6 md:px-12 max-w-3xl pb-10">
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

function useStatsCopy(songCount: number): string {
  const t = useTranslator();
  if (songCount === 0) {
    return (
      t("me.stats.none") || "Nothing on your shelf yet — start with one hum."
    );
  }
  if (songCount === 1) {
    return t("me.stats.one") || "One little song so far. A whole shelf to fill.";
  }
  const template =
    t("me.stats.many") ||
    "{count} little songs so far — and infinite melodies still to hum.";
  return template.replace("{count}", String(songCount));
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

function Card({ children }: { children: React.ReactNode }) {
  return <div className="mm-card p-6">{children}</div>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="eyebrow mb-4 text-[#8C8780]">{children}</p>;
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
