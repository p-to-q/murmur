"use client";

/**
 * TopupScreen — Compose v2 *renew* moment.
 *
 * Specced in docs/page-redesign.md §9 + docs/page-contracts.md §8.
 *
 * Three SKUs as mm-cards, balance shown big, dynamic CTA at bottom.
 * Provider chip auto-fills based on region (intl → Stripe / cn → WeChat).
 *
 * SKU data is inlined for v2 launch; once `@murmur/core` is path-aliased
 * in apps/web, swap to `import { TOPUP_SKUS } from "@murmur/core/payments/cost-table"`.
 * The shape matches that source of truth exactly.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Star, Sparkles } from "lucide-react";

import { useTranslator } from "@/lib/i18n";
import { useUserBalance } from "@/lib/hooks/use-user-balance";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { MurmurWave } from "@/components/murmur/murmur-wave";

interface TopupSku {
  id: string;
  notes: number;
  defaultPriceCents: number;
  defaultCurrency: "USD" | "CNY";
  display: string;
  highlight?: "popular" | "best_value";
}

// Mirrors packages/murmur-core/src/payments/cost-table.ts TOPUP_SKUS.
const TOPUP_SKUS: TopupSku[] = [
  { id: "topup_30_notes",  notes: 30,  defaultPriceCents: 199,  defaultCurrency: "USD", display: "$1.99" },
  { id: "topup_120_notes", notes: 120, defaultPriceCents: 599,  defaultCurrency: "USD", display: "$5.99",  highlight: "popular" },
  { id: "topup_400_notes", notes: 400, defaultPriceCents: 1499, defaultCurrency: "USD", display: "$14.99", highlight: "best_value" },
];

export function TopupScreen() {
  const router = useRouter();
  const t = useTranslator();
  const { balance, isLoading } = useUserBalance();

  // Pre-select the "popular" SKU per the page-redesign §9 default.
  const [selectedId, setSelectedId] = useState<string>(
    TOPUP_SKUS.find((s) => s.highlight === "popular")?.id ?? TOPUP_SKUS[0]!.id,
  );

  const selected = TOPUP_SKUS.find((s) => s.id === selectedId) ?? TOPUP_SKUS[0]!;

  const handleProceed = () => {
    router.push(`/topup/checkout?sku=${encodeURIComponent(selected.id)}`);
  };

  // Provider — placeholder until /api/billing/skus lands. v2 default to
  // Stripe for intl; the chip is purely informational.
  const provider = t("topup.provider.stripe") || "pay via Stripe";

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div className="relative z-10 flex min-h-svh flex-col">
        {/* ── Header ───────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between px-5 pb-5 md:px-8"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 28px)" }}
        >
          <button
            onClick={() => router.back()}
            aria-label={t("common.back") || "Back"}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/55 bg-white/70 hover:bg-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4 text-[#1A1A1A]" />
          </button>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#8C8780]">
            {t("topup.header") || "MURMUR NOTES"}
          </p>
          <div className="h-9 w-9" />
        </div>

        {/* ── Body ─────────────────────────────────────────────── */}
        <div className="flex-1 px-5 md:px-10 lg:px-16 pb-44 md:pb-48">
          <div className="mx-auto max-w-2xl">
            {/* Eyebrow + headline */}
            <motion.p
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55 }}
              className="eyebrow text-[#FF8A5C]"
            >
              {t("topup.eyebrow") || "MURMUR NOTES"}
            </motion.p>
            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="hero-serif mt-3 text-[#1A1A1A] text-[36px] leading-[1.04] md:text-[56px]"
            >
              {t("topup.headline") || "More notes, more little songs."}
            </motion.h1>

            {/* Balance card — big number + animated wave underneath */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.14, duration: 0.6 }}
              className="relative mt-8 overflow-hidden rounded-[26px] border border-[#E5DDD0] bg-[#FFFEFB]/85 backdrop-blur-sm px-6 py-7 md:px-8 md:py-8"
              style={{ minHeight: 156 }}
            >
              <MurmurWave
                color="#FF8A5C"
                intensity={0.35}
                isPlaying={false}
                waveY={0.65}
                className="absolute inset-x-0 bottom-0 h-2/3 w-full pointer-events-none"
              />
              <div className="relative z-10">
                <p className="text-[10px] uppercase tracking-[0.28em] text-[#B7AEA1]">
                  {t("topup.balance") || "you have"}
                </p>
                <p className="mt-1 font-serif text-[#1A1A1A] text-[64px] leading-none tabular-nums md:text-[80px]">
                  {isLoading ? "—" : balance?.notes ?? 0}
                </p>
                <p className="mt-2 font-serif-italic text-[13px] text-[#6F6A63] md:text-[14px]">
                  {t("topup.balance.sub") || "notes. 5 refill every day at midnight."}
                </p>
              </div>
            </motion.div>

            {/* Eyebrow for SKU picker */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.22, duration: 0.5 }}
              className="eyebrow mt-12 text-[#FF8A5C]"
            >
              {t("topup.pick.eyebrow") || "PICK A TOP UP"}
            </motion.p>

            {/* SKU bento — 3 cards in a row on desktop, stack on mobile */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28, duration: 0.55 }}
              className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4"
            >
              {TOPUP_SKUS.map((sku) => (
                <SkuCard
                  key={sku.id}
                  sku={sku}
                  selected={sku.id === selectedId}
                  onSelect={() => setSelectedId(sku.id)}
                  t={t}
                />
              ))}
            </motion.div>

            {/* Provider chip */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.45, duration: 0.5 }}
              className="mt-6 text-[12px] text-[#8C8780]"
            >
              {provider}
            </motion.p>
          </div>
        </div>

        {/* ── Bottom CTA ───────────────────────────────────────── */}
        <div
          className="fixed left-0 right-0 bg-gradient-to-t from-[#F5F1EB] via-[#F5F1EB] to-transparent px-5 pt-7 pb-5 md:px-8"
          style={{
            left: "var(--side-nav-w)",
            bottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          <div className="mx-auto max-w-2xl">
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleProceed}
              className="h-14 w-full rounded-[22px] bg-[#FF5924] text-base font-medium text-white transition-colors hover:bg-[#D9421A]"
            >
              {(t("topup.cta") || "Buy {notes} notes — {price}")
                .replace("{notes}", String(selected.notes))
                .replace("{price}", selected.display)}
            </motion.button>

            {/* Tertiary footer */}
            <div className="mt-3 flex items-center justify-center gap-4 text-[11px] tracking-[0.04em] text-[#8C8780]">
              <button className="hover:text-[#1A1A1A] transition-colors">
                ↻ {t("topup.restore") || "Restore purchases"}
              </button>
              <span className="text-[#D2C9B6]">·</span>
              <a href="/terms" className="hover:text-[#1A1A1A] transition-colors">
                {t("topup.terms") || "Terms"}
              </a>
              <span className="text-[#D2C9B6]">·</span>
              <a href="/privacy" className="hover:text-[#1A1A1A] transition-colors">
                {t("topup.privacy") || "Privacy"}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────── */

function SkuCard({
  sku,
  selected,
  onSelect,
  t,
}: {
  sku: TopupSku;
  selected: boolean;
  onSelect: () => void;
  t: (k: string) => string;
}) {
  const badge = sku.highlight;
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onSelect}
      className={`relative isolate overflow-hidden rounded-[22px] border bg-[#FFFEFB] px-5 py-6 text-left transition-all ${
        selected
          ? "border-[#FF5924] shadow-[0_8px_24px_rgba(255,89,36,0.16)]"
          : "border-[#E5DDD0] hover:border-[#FF8A5C]"
      }`}
    >
      {badge && (
        <span className="absolute right-4 top-4 inline-flex items-center gap-1 rounded-full bg-[#FFE6DA] px-2 py-0.5 text-[10px] tracking-[0.1em] uppercase text-[#D9421A]">
          {badge === "popular" ? (
            <Star className="h-3 w-3" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          {badge === "popular"
            ? t("topup.badge.popular") || "popular"
            : t("topup.badge.best") || "best value"}
        </span>
      )}

      <p className="text-[10px] uppercase tracking-[0.22em] text-[#B7AEA1]">
        {t("topup.notes_label") || "notes"}
      </p>
      <p className="mt-1 font-serif text-[#1A1A1A] text-[40px] leading-none tabular-nums md:text-[48px]">
        {sku.notes}
      </p>
      <p className="mt-4 font-serif-italic text-[#6F6A63] text-[20px]">
        {sku.display}
      </p>

      {selected && (
        <motion.span
          layoutId="sku-underline"
          className="absolute inset-x-5 bottom-3 h-[1.5px] bg-[#FF5924]"
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        />
      )}
    </motion.button>
  );
}
