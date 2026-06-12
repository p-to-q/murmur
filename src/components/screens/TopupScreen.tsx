"use client";

/**
 * TopupScreen — balance view + package selection.
 *
 * Shows the authenticated user's real notes balance and top-up SKUs.
 * Chart / USD mock data removed — only live balance is shown.
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, useSpring, useTransform, animate } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  CUSTOM_TOPUP_ID,
  CUSTOM_TOPUP_MAX_USD,
  CUSTOM_TOPUP_MIN_USD,
  getCustomTopupQuote,
  TOPUP_SKUS,
  topupNotesGranted,
} from "@murmur/core";

import { useTranslator } from "@/lib/i18n";
import { useUserBalance, fetchUserBalance } from "@/lib/hooks/use-user-balance";
import { PageBackdrop } from "@/components/murmur/page-backdrop";

const SLIDER_MAX_USD = Math.min(100, CUSTOM_TOPUP_MAX_USD);

// Paper texture style for all black elements
const paperTextureStyle = {
  background: `
    linear-gradient(135deg,
      rgba(255, 255, 255, 0.08) 0%,
      rgba(255, 255, 255, 0.0) 100%
    ),
    repeating-linear-gradient(
      90deg,
      rgba(255, 255, 255, 0.04) 0px,
      transparent 0.5px,
      transparent 1px,
      rgba(255, 255, 255, 0.04) 1.5px
    ),
    repeating-linear-gradient(
      0deg,
      rgba(255, 255, 255, 0.03) 0px,
      transparent 0.5px,
      transparent 1px,
      rgba(255, 255, 255, 0.03) 1.5px
    ),
    #1A1A1A
  `,
};

function formatRefillTime(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function TopupScreen() {
  const router = useRouter();
  const t = useTranslator();
  const { balance, isLoading, refresh } = useUserBalance();

  const [selectedId, setSelectedId] = useState<string>(
    TOPUP_SKUS.find((s) => s.highlight === "popular")?.id ?? TOPUP_SKUS[0]!.id,
  );
  const [customAmount, setCustomAmount] = useState(10);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const notesSpring = useSpring(0, { stiffness: 100, damping: 20 });

  const selected = TOPUP_SKUS.find((s) => s.id === selectedId);
  const customQuote = useMemo(() => getCustomTopupQuote(customAmount), [customAmount]);
  const displayAmount = selectedId === CUSTOM_TOPUP_ID
    ? customQuote?.display ?? "$0"
    : selected?.display ?? "$0";
  const displayNotes = selectedId === CUSTOM_TOPUP_ID
    ? customQuote?.notesGranted ?? 0
    : selected ? topupNotesGranted(selected) : 0;

  const currentBalance = balance?.notes ?? 0;
  const planLabel =
    balance?.planTier === "premium" ? t("topup.plan.premium") : t("topup.plan.free");
  const nextRefillLabel = balance?.nextRefillAt
    ? t("topup.next_refill").replace(
        "{time}",
        formatRefillTime(
          balance.nextRefillAt,
          typeof document !== "undefined" && document.documentElement.lang.startsWith("zh")
            ? "zh-CN"
            : "en-US",
        ),
      )
    : null;

  const handleProceed = () => {
    if (selectedId === CUSTOM_TOPUP_ID) {
      if (!customQuote) return;
      router.push(`/topup/checkout?customAmountUsd=${encodeURIComponent(String(customQuote.amountUsd))}`);
      return;
    }
    if (!selected) return;
    router.push(`/topup/checkout?sku=${encodeURIComponent(selected.id)}`);
  };

  const animateBalance = useCallback(
    (value: number) => {
      animate(notesSpring, 0, { duration: 0.25 }).then(() => {
        animate(notesSpring, value, { duration: 0.5 });
      });
    },
    [notesSpring],
  );

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refresh();
      const result = await fetchUserBalance({ force: true });
      if (result.balance) {
        animateBalance(result.balance.notes);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleRestorePurchases = async () => {
    setIsRestoring(true);

    try {
      const response = await fetch("/api/purchases/restore", {
        method: "POST",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          (errorData as { message?: string }).message || t("topup.restore.failed"),
        );
      }

      const data = (await response.json()) as {
        restored?: unknown[];
        newPurchases?: number;
        totalNotes?: number;
      };

      if (data.restored && data.restored.length > 0) {
        if ((data.newPurchases ?? 0) > 0) {
          toast.success(
            t("topup.restore.success")
              .replace("{count}", String(data.newPurchases))
              .replace("{notes}", String(data.totalNotes ?? 0)),
          );
          await refresh();
          animateBalance(balance?.notes ?? currentBalance);
        } else {
          toast.info(
            t("topup.restore.found")
              .replace("{count}", String(data.restored.length))
              .replace("{notes}", String(data.totalNotes ?? 0)),
          );
        }
      } else {
        toast.info(t("topup.restore.none"));
      }
    } catch (error) {
      console.error("[restore-purchases] Error:", error);
      toast.error(
        error instanceof Error ? error.message : t("topup.restore.failed"),
      );
    } finally {
      setIsRestoring(false);
    }
  };

  useEffect(() => {
    notesSpring.set(currentBalance);
  }, [currentBalance, notesSpring]);

  const displayNotesBalance = useTransform(notesSpring, (v) => Math.round(v));
  const sliderSpan = SLIDER_MAX_USD - CUSTOM_TOPUP_MIN_USD;

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div className="relative z-10 flex min-h-svh flex-col">
        <div
          className="flex items-center justify-end px-5 pb-3"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 20px)" }}
        >
          <button
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
            className="flex h-9 w-9 items-center justify-center disabled:opacity-50"
            aria-label={t("topup.refresh")}
          >
            <RefreshCw className={`h-5 w-5 text-[#8C8780] ${isRefreshing ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="flex-1 px-5 pb-32">
          <div className="mx-auto max-w-lg">
            <motion.h2
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.02, duration: 0.5 }}
              className="text-[18px] font-semibold text-[#8C8780] mb-2"
            >
              {t("topup.assets")}
            </motion.h2>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.04, duration: 0.5 }}
              className="flex items-start gap-2"
            >
              <h1 className="font-serif text-[#1A1A1A] text-[68px] leading-[1.0] tabular-nums tracking-tight">
                {isLoading ? "—" : <motion.span>{displayNotesBalance}</motion.span>}
              </h1>
              <span className="mt-6 text-[18px] text-[#8C8780]">{t("topup.notes")}</span>
            </motion.div>

            {nextRefillLabel && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.08, duration: 0.5 }}
                className="mt-2.5 text-[14px] text-[#8C8780]"
              >
                {nextRefillLabel}
              </motion.p>
            )}

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.12, duration: 0.5 }}
              className="mt-8 grid grid-cols-2 gap-4"
            >
              <div className="rounded-[20px] bg-white/60 backdrop-blur-sm border border-[#E5DDD0]/40 px-5 py-5">
                <p className="text-[11px] text-[#B7AEA1] font-semibold mb-3 tracking-wider uppercase">
                  {t("topup.balance")}
                </p>
                <p className="font-serif text-[#1A1A1A] text-[28px] leading-none tabular-nums">
                  {isLoading ? "—" : currentBalance}
                  <span className="text-[14px] font-normal text-[#8C8780] ml-1">{t("topup.notes")}</span>
                </p>
              </div>

              <div className="rounded-[20px] bg-white/60 backdrop-blur-sm border border-[#E5DDD0]/40 px-5 py-5">
                <p className="text-[11px] text-[#B7AEA1] font-semibold mb-3 tracking-wider uppercase">
                  {t("topup.plan_label")}
                </p>
                <p className="font-serif text-[#1A1A1A] text-[22px] leading-none">
                  {planLabel}
                </p>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.16, duration: 0.5 }}
              className="mt-5 rounded-[22px] bg-white/50 backdrop-blur-sm border border-[#E5DDD0]/40 px-6 py-8 text-center"
            >
              <p className="font-serif-italic text-[14px] text-[#8C8780]">
                {t("topup.chart.soon")}
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="mt-8"
            >
              <div className="mb-6">
                <h3 className="text-[18px] font-semibold text-[#8C8780] mb-2">
                  {t("topup.packages")}
                </h3>
                <p className="text-[14px] text-[#B7AEA1]">
                  {t("topup.packages.sub")}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-6">
                {TOPUP_SKUS.map((sku, idx) => {
                  const isSelected = sku.id === selectedId;
                  const tierNames = [t("topup.starter"), t("topup.creator"), t("topup.patron")];
                  const songCount = Math.floor(topupNotesGranted(sku) / 5);

                  return (
                    <motion.button
                      key={sku.id}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => setSelectedId(sku.id)}
                      className={`relative rounded-[18px] border backdrop-blur-sm px-4 py-5 text-center transition-all ${
                        isSelected
                          ? "border-[#1A1A1A] bg-white/80 shadow-[0_2px_12px_rgba(0,0,0,0.08)]"
                          : "border-[#E5DDD0]/40 bg-white/50 hover:border-[#C8C0B4]"
                      }`}
                    >
                      {sku.highlight && (
                        <div
                          className="absolute -top-2 left-1/2 -translate-x-1/2 text-white px-3 py-1 rounded-full text-[9px] font-semibold uppercase tracking-wider whitespace-nowrap"
                          style={paperTextureStyle}
                        >
                          {sku.highlight === "popular"
                            ? t("topup.badge.popular")
                            : t("topup.badge.best")}
                        </div>
                      )}

                      <p className="text-[11px] text-[#B7AEA1] font-semibold uppercase tracking-wider mb-3">
                        {tierNames[idx]}
                      </p>
                      <p className="font-serif text-[#1A1A1A] text-[28px] leading-none mb-1">
                        {sku.display}
                      </p>
                      <p className="text-[12px] text-[#8C8780] mb-3">
                        {t("topup.songs").replace("{n}", String(songCount))}
                      </p>
                      <div className="flex items-baseline justify-center gap-1">
                        <span className="font-serif text-[#1A1A1A] text-[16px]">{sku.notes}</span>
                        {sku.bonusNotes && (
                          <span className="font-serif text-[#5F8A6B] text-[13px]">+{sku.bonusNotes}</span>
                        )}
                        <span className="text-[11px] text-[#B7AEA1] ml-0.5">{t("topup.notes")}</span>
                      </div>
                    </motion.button>
                  );
                })}
              </div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.5 }}
                className={`rounded-[20px] border backdrop-blur-sm px-6 py-6 transition-all ${
                  selectedId === CUSTOM_TOPUP_ID
                    ? "border-[#1A1A1A] bg-white/80 shadow-[0_2px_12px_rgba(0,0,0,0.08)]"
                    : "border-[#E5DDD0]/40 bg-white/50"
                }`}
                onClick={() => setSelectedId(CUSTOM_TOPUP_ID)}
              >
                <div className="mb-5 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-[16px] font-semibold text-[#1A1A1A] mb-1">
                      {t("topup.custom")}
                    </p>
                    <p className="text-[12px] text-[#B7AEA1]">
                      {t("topup.custom.desc")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-serif text-[#1A1A1A] text-[32px] leading-none">
                      ${customAmount}
                    </p>
                  </div>
                </div>

                <div className="relative mb-6 pt-2">
                  <div className="mb-3 flex justify-between text-[11px] font-medium text-[#B7AEA1]">
                    <span>${CUSTOM_TOPUP_MIN_USD}</span>
                    <span className="absolute left-1/2 -translate-x-1/2">${Math.round(SLIDER_MAX_USD / 2)}</span>
                    <span>${SLIDER_MAX_USD}</span>
                  </div>

                  <div className="relative">
                    <div className="relative h-1 rounded-full bg-[#E5DDD0]/60">
                      <div
                        className="absolute h-1 rounded-full bg-[#8C8780] transition-all duration-150"
                        style={{
                          width: `${((customAmount - CUSTOM_TOPUP_MIN_USD) / sliderSpan) * 100}%`,
                        }}
                      />
                    </div>

                    <input
                      type="range"
                      min={String(CUSTOM_TOPUP_MIN_USD)}
                      max={String(SLIDER_MAX_USD)}
                      value={Math.min(customAmount, SLIDER_MAX_USD)}
                      onChange={(e) => setCustomAmount(Number(e.target.value))}
                      aria-label={t("topup.slider.label")}
                      className="absolute z-10 h-8 w-full cursor-grab opacity-0 active:cursor-grabbing"
                      style={{ top: "-14px", left: 0 }}
                    />

                    <div
                      className="pointer-events-none absolute -top-3 z-20 h-7 w-7 rounded-full border-[3px] border-white shadow-[0_2px_12px_rgba(0,0,0,0.25)] transition-all duration-150"
                      style={{
                        left: `calc(${((Math.min(customAmount, SLIDER_MAX_USD) - CUSTOM_TOPUP_MIN_USD) / sliderSpan) * 100}% - 14px)`,
                        ...paperTextureStyle,
                      }}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="max-w-[200px] flex-1">
                    <input
                      type="number"
                      min={String(CUSTOM_TOPUP_MIN_USD)}
                      max={String(CUSTOM_TOPUP_MAX_USD)}
                      value={customAmount}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        setCustomAmount(
                          Math.min(
                            CUSTOM_TOPUP_MAX_USD,
                            Math.max(
                              CUSTOM_TOPUP_MIN_USD,
                              Number.isFinite(value) ? Math.floor(value) : CUSTOM_TOPUP_MIN_USD,
                            ),
                          ),
                        );
                      }}
                      onClick={(e) => e.stopPropagation()}
                      placeholder={t("topup.input.placeholder")}
                      className="w-full rounded-[14px] border border-[#E5DDD0] bg-white/60 px-4 py-3 text-[15px] text-[#1A1A1A] tabular-nums placeholder:text-[#C8C0B4] transition-colors focus:border-[#1A1A1A] focus:outline-none"
                    />
                  </div>
                  <p className="text-[13px] text-[#B7AEA1]">
                    ≈ {Math.floor(customAmount * 20)} {t("topup.notes")}
                  </p>
                </div>
              </motion.div>
            </motion.div>
          </div>
        </div>

        <div
          className="fixed left-0 right-0 bg-gradient-to-t from-[#F5F1EB] via-[#F5F1EB] to-transparent px-6 pt-6 pb-5"
          style={{
            left: "var(--side-nav-w)",
            bottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          <div className="mx-auto max-w-lg">
            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={handleProceed}
              className="h-12 w-full rounded-full text-[15px] font-semibold text-white transition-all hover:brightness-110"
              style={paperTextureStyle}
            >
              {(t("topup.cta") || "买 {notes} 颗 — {price}")
                .replace("{notes}", String(displayNotes))
                .replace("{price}", displayAmount)}
            </motion.button>

            <div className="mt-3 flex items-center justify-center gap-3 text-[11px] text-[#8C8780]">
              <button
                onClick={handleRestorePurchases}
                disabled={isRestoring}
                className="hover:text-[#1A1A1A] transition-colors disabled:opacity-50"
              >
                {isRestoring ? t("topup.restoring") : `↻ ${t("topup.restore")}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
