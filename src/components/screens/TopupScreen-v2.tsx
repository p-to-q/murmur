"use client";

/**
 * TopupScreen v2 — Redesigned with better conversion optimization.
 *
 * Key improvements:
 * 1. Middle tier (popular) visually emphasized with larger card
 * 2. Unit price shown to highlight value
 * 3. Bonus notes for higher tiers (psychological nudge)
 * 4. Clearer visual hierarchy and selection state
 * 5. Animated transitions between selections
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowLeft, Star, Sparkles, Check } from "lucide-react";

import { useTranslator } from "@/lib/i18n";
import { useUserBalance } from "@/lib/hooks/use-user-balance";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { MurmurWave } from "@/components/murmur/murmur-wave";

interface TopupSku {
  id: string;
  notes: number;
  bonusNotes?: number; // Extra notes as incentive
  defaultPriceCents: number;
  defaultCurrency: "USD" | "CNY";
  display: string;
  highlight?: "popular" | "best_value";
}

const TOPUP_SKUS: TopupSku[] = [
  {
    id: "topup_30_notes",
    notes: 30,
    defaultPriceCents: 199,
    defaultCurrency: "USD",
    display: "$1.99"
  },
  {
    id: "topup_120_notes",
    notes: 120,
    bonusNotes: 10,
    defaultPriceCents: 599,
    defaultCurrency: "USD",
    display: "$5.99",
    highlight: "popular"
  },
  {
    id: "topup_400_notes",
    notes: 400,
    bonusNotes: 50,
    defaultPriceCents: 1499,
    defaultCurrency: "USD",
    display: "$14.99",
    highlight: "best_value"
  },
];

export function TopupScreenV2() {
  const router = useRouter();
  const t = useTranslator();
  const { balance, isLoading } = useUserBalance();

  const [selectedId, setSelectedId] = useState<string>(
    TOPUP_SKUS.find((s) => s.highlight === "popular")?.id ?? TOPUP_SKUS[0]!.id,
  );

  const selected = TOPUP_SKUS.find((s) => s.id === selectedId) ?? TOPUP_SKUS[0]!;

  const handleProceed = () => {
    router.push(`/topup/checkout?sku=${encodeURIComponent(selected.id)}`);
  };

  const provider = t("topup.provider.stripe") || "用 Stripe 支付";

  // Calculate unit price for each SKU
  const getUnitPrice = (sku: TopupSku) => {
    const totalNotes = sku.notes + (sku.bonusNotes || 0);
    return (sku.defaultPriceCents / totalNotes / 100).toFixed(3);
  };

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div className="relative z-10 flex min-h-svh flex-col">
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 pb-5 md:px-8"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 28px)" }}
        >
          <button
            onClick={() => router.back()}
            aria-label={t("common.back") || "返回"}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/55 bg-white/70 hover:bg-white transition-colors"
          >
            <ArrowLeft className="h-4 w-4 text-[#1A1A1A]" />
          </button>
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#8C8780]">
            {t("topup.header") || "灵感币"}
          </p>
          <div className="h-9 w-9" />
        </div>

        {/* Body */}
        <div className="flex-1 px-5 md:px-10 lg:px-16 pb-44 md:pb-48">
          <div className="mx-auto max-w-3xl">
            {/* Headline */}
            <motion.h1
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="hero-serif text-[#1A1A1A] text-[36px] leading-[1.04] md:text-[52px]"
            >
              {t("topup.headline") || "多一点灵感币，多几首小歌。"}
            </motion.h1>

            {/* Balance card */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.14, duration: 0.6 }}
              className="relative mt-8 overflow-hidden rounded-[26px] border border-[#E5DDD0] bg-[#FFFEFB]/85 backdrop-blur-sm px-6 py-7 md:px-8 md:py-8"
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
                  {t("topup.balance") || "你的余额"}
                </p>
                <div className="mt-1 flex items-baseline gap-3">
                  <p className="font-serif text-[#1A1A1A] text-[64px] leading-none tabular-nums md:text-[80px]">
                    {isLoading ? "—" : balance?.notes ?? 0}
                  </p>
                  <p className="font-serif-italic text-[15px] text-[#6F6A63] md:text-[16px] pb-2">
                    {t("topup.balance.unit") || "颗灵感币"}
                  </p>
                </div>
                <p className="mt-2 font-serif-italic text-[13px] text-[#6F6A63] md:text-[14px]">
                  {t("topup.balance.sub") || "每天 0 点补 5 颗"}
                </p>
              </div>
            </motion.div>

            {/* Eyebrow */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.22, duration: 0.5 }}
              className="eyebrow mt-12 text-[#FF8A5C]"
            >
              {t("topup.pick.eyebrow") || "选一档"}
            </motion.p>

            {/* SKU cards - asymmetric grid with middle card larger */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.28, duration: 0.55 }}
              className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1.35fr_1fr] md:gap-4 md:items-start"
            >
              {TOPUP_SKUS.map((sku, idx) => {
                const isMiddle = idx === 1;
                return (
                  <SkuCardV2
                    key={sku.id}
                    sku={sku}
                    selected={sku.id === selectedId}
                    onSelect={() => setSelectedId(sku.id)}
                    emphasized={isMiddle}
                    unitPrice={getUnitPrice(sku)}
                    t={t}
                  />
                );
              })}
            </motion.div>

            {/* Provider */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.45, duration: 0.5 }}
              className="mt-6 text-center text-[12px] text-[#8C8780]"
            >
              {provider}
            </motion.p>
          </div>
        </div>

        {/* Bottom CTA */}
        <div
          className="fixed left-0 right-0 bg-gradient-to-t from-[#F5F1EB] via-[#F5F1EB] to-transparent px-5 pt-7 pb-5 md:px-8"
          style={{
            left: "var(--side-nav-w)",
            bottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          <div className="mx-auto max-w-3xl">
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={handleProceed}
              className="h-14 w-full rounded-[22px] bg-[#FF5924] text-base font-medium text-white transition-colors hover:bg-[#D9421A]"
            >
              {(t("topup.cta") || "买 {notes} 颗 — {price}")
                .replace("{notes}", String(selected.notes + (selected.bonusNotes || 0)))
                .replace("{price}", selected.display)}
            </motion.button>

            {/* Footer */}
            <div className="mt-3 flex items-center justify-center gap-4 text-[11px] tracking-[0.04em] text-[#8C8780]">
              <button className="hover:text-[#1A1A1A] transition-colors">
                ↻ {t("topup.restore") || "恢复已购买"}
              </button>
              <span className="text-[#D2C9B6]">·</span>
              <a href="/terms" className="hover:text-[#1A1A1A] transition-colors">
                {t("topup.terms") || "条款"}
              </a>
              <span className="text-[#D2C9B6]">·</span>
              <a href="/privacy" className="hover:text-[#1A1A1A] transition-colors">
                {t("topup.privacy") || "隐私"}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SkuCardV2({
  sku,
  selected,
  onSelect,
  emphasized,
  unitPrice,
  t,
}: {
  sku: TopupSku;
  selected: boolean;
  onSelect: () => void;
  emphasized: boolean;
  unitPrice: string;
  t: (k: string) => string;
}) {
  const badge = sku.highlight;

  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      whileHover={{ y: emphasized ? -4 : -2 }}
      onClick={onSelect}
      className={`relative isolate overflow-hidden rounded-[22px] border bg-[#FFFEFB] text-left transition-all ${
        emphasized ? "md:py-8 py-6 px-5 md:px-6" : "px-5 py-6"
      } ${
        selected
          ? "border-[#FF5924] shadow-[0_8px_24px_rgba(255,89,36,0.16)] scale-[1.02]"
          : "border-[#E5DDD0] hover:border-[#FF8A5C]"
      }`}
    >
      {/* Badge */}
      {badge && (
        <span className={`absolute ${emphasized ? "right-5 top-5" : "right-4 top-4"} inline-flex items-center gap-1 rounded-full bg-[#FFE6DA] px-2 py-0.5 text-[10px] tracking-[0.1em] uppercase text-[#D9421A]`}>
          {badge === "popular" ? (
            <Star className="h-3 w-3 fill-current" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          {badge === "popular"
            ? t("topup.badge.popular") || "热门"
            : t("topup.badge.best") || "最划算"}
        </span>
      )}

      {/* Check icon when selected */}
      {selected && (
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="absolute left-4 top-4 flex h-5 w-5 items-center justify-center rounded-full bg-[#FF5924]"
        >
          <Check className="h-3 w-3 text-white" strokeWidth={3} />
        </motion.div>
      )}

      {/* Notes label */}
      <p className={`text-[10px] uppercase tracking-[0.22em] text-[#B7AEA1] ${emphasized ? "md:text-[11px]" : ""}`}>
        {t("topup.notes_label") || "灵感币"}
      </p>

      {/* Notes count */}
      <div className="mt-1 flex items-baseline gap-2">
        <p className={`font-serif text-[#1A1A1A] leading-none tabular-nums ${
          emphasized ? "text-[44px] md:text-[56px]" : "text-[40px] md:text-[44px]"
        }`}>
          {sku.notes}
        </p>
        {sku.bonusNotes && (
          <span className="font-serif-italic text-[#FF5924] text-[18px] md:text-[20px]">
            +{sku.bonusNotes}
          </span>
        )}
      </div>

      {/* Price */}
      <p className={`mt-4 font-serif-italic text-[#1A1A1A] ${emphasized ? "text-[24px] md:text-[26px]" : "text-[20px] md:text-[22px]"}`}>
        {sku.display}
      </p>

      {/* Unit price */}
      <p className="mt-1 text-[11px] text-[#B7AEA1]">
        ${unitPrice} / {t("topup.per_note") || "颗"}
      </p>

      {/* Selection underline */}
      {selected && (
        <motion.span
          layoutId="sku-underline-v2"
          className="absolute inset-x-4 bottom-3 h-[2px] rounded-full bg-[#FF5924]"
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        />
      )}
    </motion.button>
  );
}
