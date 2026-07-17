"use client";

/**
 * TopupScreen — asset-style balance view + package selection.
 *
 * Shows live notes balance, top-up summary, and purchasable SKUs.
 * Currency toggle (USD / CNY) with localStorage persistence.
 * Payment methods: Card (Waffo) and WeChat Pay (ZPay).
 */

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useSpring, useTransform, animate } from "framer-motion";
import { LogIn, RefreshCw, Search, Share2 } from "lucide-react";
import { toast } from "sonner";
import { formatSupportCode } from "@/lib/observability/support-code";
import {
  CUSTOM_TOPUP_ID,
  CUSTOM_TOPUP_MAX_USD,
  getCustomTopupQuote,
  TOPUP_SKUS,
  type Currency,
} from "@murmur/core";

import { useCurrentLang, useTranslator } from "@/lib/i18n";
import { requestWithTimeout } from "@/lib/api/timeout";
import {
  useRegionalSkus,
  getSavedCurrency,
  saveCurrencyPreference,
} from "@/lib/hooks/use-regional-skus";
import { useTopupSurface } from "@/lib/hooks/use-topup-surface";
import { useUserBalance } from "@/lib/hooks/use-user-balance";
import { useCurrentAccount } from "@/lib/hooks/use-current-account";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { copyTextToClipboard } from "@/lib/platform/clipboard";

const SLIDER_MAX_USD = Math.min(100, CUSTOM_TOPUP_MAX_USD);
const SLIDER_MAX_CNY = 500;
const TIME_RANGES = ["1H", "1D", "7D", "1M", "All"] as const;
type TopupTimeRange = (typeof TIME_RANGES)[number];

type BalanceChartPoint = {
  date: string;
  timestamp: string;
  value: number;
};

export type TopupSearchItem = {
  id: string;
  title: string;
  detail: string;
  terms: string[];
};

export function topupSearchMatches(item: TopupSearchItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [item.title, item.detail, ...item.terms]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

export function buildTopupSharePayload(origin: string, lang: "zh" | "en") {
  const cleanOrigin = origin.replace(/\/$/, "");
  const url = `${cleanOrigin}/topup`;
  return {
    url,
    title: "Murmur",
    text: lang === "zh"
      ? "来 Murmur 补给音磅，把哼唱变成可以保存和分享的歌。"
      : "Top up Murmur notes and turn a hum into a song you can save and share.",
  };
}

export function buildTopupCheckoutHref(input: {
  selectedId: string;
  selectedSkuId?: string;
  customAmount: number;
  customAmountUsd?: number;
  currency: Currency;
  payMethod: "card" | "wxpay";
  requiresSignIn: boolean;
}): string | null {
  const methodParam = input.payMethod === "wxpay" ? "&payMethod=wxpay" : "";
  const gateParam = input.requiresSignIn ? "&gate=sign_in" : "";

  if (input.selectedId === CUSTOM_TOPUP_ID) {
    if (input.currency === "CNY") {
      return `/topup/checkout?customAmountCny=${encodeURIComponent(String(input.customAmount))}&currency=CNY${methodParam}${gateParam}`;
    }
    if (input.customAmountUsd == null) return null;
    return `/topup/checkout?customAmountUsd=${encodeURIComponent(String(input.customAmountUsd))}${methodParam}${gateParam}`;
  }

  if (!input.selectedSkuId) return null;
  const currencyParam = input.currency === "CNY" ? "&currency=CNY" : "";
  return `/topup/checkout?sku=${encodeURIComponent(input.selectedSkuId)}${currencyParam}${methodParam}${gateParam}`;
}

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

function formatChartLabel(date: Date, range: TopupTimeRange) {
  if (range === "1H") {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  }
  if (range === "1D") {
    const hours = String(date.getHours()).padStart(2, "0");
    return `${hours}:00`;
  }

  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}/${day}`;
}

function buildBalanceChartData(range: TopupTimeRange, currentBalance: number): BalanceChartPoint[] {
  const dataPoints =
    range === "1H" ? 12 :
    range === "1D" ? 24 :
    range === "7D" ? 7 :
    range === "1M" ? 30 : 365;
  const now = Date.now();
  const stepMs =
    range === "1H" ? 5 * 60_000 :
    range === "1D" ? 3_600_000 :
    86_400_000;

  // Keep old or partial topup-surface payloads truthful instead of fabricating movement.
  return Array.from({ length: dataPoints }, (_, index) => {
    const date = new Date(now - (dataPoints - 1 - index) * stepMs);
    return {
      date: formatChartLabel(date, range),
      timestamp: date.toISOString(),
      value: currentBalance,
    };
  });
}

function formatHistoryChartData(
  range: TopupTimeRange,
  points: Array<{ timestamp: string; balance: number }>,
): BalanceChartPoint[] {
  return points.flatMap((point): BalanceChartPoint[] => {
    const date = new Date(point.timestamp);
    if (!Number.isFinite(date.getTime()) || !Number.isFinite(point.balance)) return [];
    return [{
      date: formatChartLabel(date, range),
      timestamp: point.timestamp,
      value: point.balance,
    }];
  });
}

function BalanceLineChart({ data, timeRange }: { data: BalanceChartPoint[]; timeRange: TopupTimeRange }) {
  const width = 320;
  const height = 192;
  const padding = { top: 10, right: 10, bottom: 25, left: 0 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const values = data.map((point) => point.value);
  const minValue = Math.min(...values, 0);
  const maxValue = Math.max(...values, 1);
  const spread = maxValue - minValue;
  const points = data.map((point, index) => {
    const x = padding.left + (index / Math.max(data.length - 1, 1)) * chartWidth;
    const y = spread === 0
      ? padding.top + chartHeight / 2
      : padding.top + (1 - (point.value - minValue) / spread) * chartHeight;
    return { x, y, point };
  });
  const linePath = points
    .map(({ x, y }, index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
  const interval = timeRange === "1H" ? 2 : timeRange === "1D" ? 5 : Math.floor(data.length / 6);
  const ticks = points.filter((_, index) => {
    if (index === 0 || index === points.length - 1) return true;
    return interval > 0 && index % interval === 0;
  });

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-full w-full"
      role="img"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      {[0, 1, 2, 3, 4].map((index) => {
        const y = padding.top + (index / 4) * chartHeight;
        return (
          <line
            key={index}
            x1={padding.left}
            x2={width - padding.right}
            y1={y}
            y2={y}
            stroke="#E5DDD0"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
      <path
        d={linePath}
        fill="none"
        stroke="#B7AEA1"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {ticks.map(({ x, point }, index) => (
        <text
          key={`${point.timestamp}-${index}`}
          x={x}
          y={height - 5}
          fill="#B7AEA1"
          fontSize="10"
          fontWeight="500"
          textAnchor={index === 0 ? "start" : index === ticks.length - 1 ? "end" : "middle"}
          style={{ fontFamily: "system-ui" }}
        >
          {point.date}
        </text>
      ))}
    </svg>
  );
}

export function TopupScreen() {
  const router = useRouter();
  const t = useTranslator();
  const lang = useCurrentLang();
  const {
    isRegistered,
    isLoading: accountLoading,
  } = useCurrentAccount();
  const { balance, isLoading, error: balanceError, refresh } = useUserBalance();
  const { data: topupSurface, refresh: refreshTopupSurface } = useTopupSurface();

  // ── Currency state ────────────────────────────────────────────────
  const [manualCurrency, setManualCurrency] = useState<Currency | undefined>(
    () => getSavedCurrency() ?? undefined,
  );
  const { skus: regionalSkus, currency, customConfig } = useRegionalSkus(manualCurrency);
  const [payMethodPreference, setPayMethodPreference] = useState<"card" | "wxpay">(() =>
    (getSavedCurrency() ?? "USD") === "CNY" ? "wxpay" : "card",
  );

  // Sync detected currency on first load when no saved preference
  const initializedRef = useRef(false);
  const rangeGroupRef = useRef<HTMLDivElement | null>(null);
  const rangeButtonRefs = useRef<Record<TopupTimeRange, HTMLButtonElement | null>>({
    "1H": null,
    "1D": null,
    "7D": null,
    "1M": null,
    "All": null,
  });
  useEffect(() => {
    if (!initializedRef.current && currency && !getSavedCurrency()) {
      initializedRef.current = true;
      setManualCurrency(currency);
    }
  }, [currency]);

  const effectiveCurrency: Currency = manualCurrency ?? currency;
  const isCny = effectiveCurrency === "CNY";
  const payMethod = isCny ? payMethodPreference : "card";

  // ── Payment method state ──────────────────────────────────────────
  const handleCurrencyToggle = (c: Currency) => {
    setManualCurrency(c);
    saveCurrencyPreference(c);
    if (c !== "CNY" && payMethodPreference === "wxpay") setPayMethodPreference("card");
  };

  const handlePayMethodChange = (m: "card" | "wxpay") => {
    setPayMethodPreference(m);
    if (m === "wxpay" && effectiveCurrency !== "CNY") {
      setManualCurrency("CNY");
      saveCurrencyPreference("CNY");
    }
  };

  // ── SKU / pricing ─────────────────────────────────────────────────
  const effectiveSkus = regionalSkus.length > 0 ? regionalSkus : TOPUP_SKUS;
  const currencySymbol = isCny ? "¥" : "$";
  const sliderMin = customConfig.minAmount;
  const sliderMax = isCny ? Math.min(SLIDER_MAX_CNY, customConfig.maxAmount) : SLIDER_MAX_USD;
  const notesPerUnit = customConfig.notesPerUnit;
  const defaultCustomAmount = Math.min(
    customConfig.maxAmount,
    Math.max(sliderMin, isCny ? 50 : 10),
  );

  const [selectedId, setSelectedId] = useState<string>(
    TOPUP_SKUS.find((s) => s.highlight === "popular")?.id ?? TOPUP_SKUS[0]!.id,
  );
  const [timeRange, setTimeRange] = useState<TopupTimeRange>("7D");
  const [rangeIndicator, setRangeIndicator] = useState({ left: 0, width: 0 });
  const [customAmountByCurrency, setCustomAmountByCurrency] = useState<Record<string, number>>({});
  const [isRestoring, setIsRestoring] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const customAmount = Math.min(
    customConfig.maxAmount,
    Math.max(sliderMin, customAmountByCurrency[effectiveCurrency] ?? defaultCustomAmount),
  );
  const sliderAmount = Math.min(customAmount, sliderMax);
  const setCustomAmount = useCallback(
    (amount: number) => {
      setCustomAmountByCurrency((current) => ({
        ...current,
        [effectiveCurrency]: amount,
      }));
    },
    [effectiveCurrency],
  );

  const notesSpring = useSpring(0, { stiffness: 100, damping: 20 });
  const balanceUSDSpring = useSpring(0, { stiffness: 100, damping: 20 });
  const notesInUseSpring = useSpring(0, { stiffness: 100, damping: 20 });

  const customQuote = useMemo(() => getCustomTopupQuote(customAmount), [customAmount]);
  const customDisplay = isCny
    ? `¥${customAmount.toFixed(2)}`
    : customQuote?.display ?? "$0";
  const customNotes = isCny
    ? customAmount * notesPerUnit
    : customQuote?.notesGranted ?? 0;

  const currentBalance = balance?.notes ?? 0;
  const nextRefillLabel = balance?.nextRefillAt
    ? t("topup.next_refill").replace(
        "{time}",
        formatRefillTime(balance.nextRefillAt, lang === "zh" ? "zh-CN" : "en-US"),
      )
    : null;
  const balanceUSD = (topupSurface?.lifetimeTopupCents ?? 0) / 100;
  const notesInUse = topupSurface?.notesInUse ?? 0;
  const activeHistory = topupSurface?.balanceHistory.find((history) => history.range === timeRange);
  const dailyHistory = topupSurface?.balanceHistory.find((history) => history.range === "1D");
  const chartData = useMemo(() => {
    const historyData = activeHistory ? formatHistoryChartData(timeRange, activeHistory.points) : [];
    return historyData.length >= 2 ? historyData : buildBalanceChartData(timeRange, currentBalance);
  }, [activeHistory, currentBalance, timeRange]);
  const dailyChartData = useMemo(() => {
    const historyData = dailyHistory ? formatHistoryChartData("1D", dailyHistory.points) : [];
    return historyData.length >= 2 ? historyData : buildBalanceChartData("1D", currentBalance);
  }, [currentBalance, dailyHistory]);
  const firstDailyValue = dailyChartData[0]?.value ?? 0;
  const lastDailyValue = dailyChartData.at(-1)?.value ?? 0;
  const change24hValue = dailyHistory?.changeValue ?? lastDailyValue - firstDailyValue;
  const change24hPercent = dailyHistory?.changePercent
    ?? (firstDailyValue !== 0 ? (change24hValue / firstDailyValue) * 100 : 0);
  const changeText = `${change24hValue > 0 ? "+" : ""}${change24hValue.toFixed(0)} (${change24hPercent > 0 ? "+" : ""}${change24hPercent.toFixed(2)}%)`;
  const changeColor =
    change24hValue > 0 ? "#5F8A6B" :
    change24hValue < 0 ? "#C87355" :
    "#8C8780";
  const tierNames = useMemo(
    () => [t("topup.starter"), t("topup.creator"), t("topup.patron")],
    [t],
  );
  const skuSearchItems = useMemo(
    () => effectiveSkus.map((sku, idx): TopupSearchItem => {
      const totalNotes = sku.notes + (sku.bonusNotes ?? 0);
      const songCount = Math.floor(totalNotes / 5);
      return {
        id: sku.id,
        title: tierNames[idx] ?? sku.id,
        detail: `${sku.display} ${totalNotes} ${t("topup.notes")} ${t("topup.songs").replace("{n}", String(songCount))}`,
        terms: [
          sku.id,
          sku.display,
          String(sku.notes),
          String(totalNotes),
          sku.highlight ?? "",
          effectiveCurrency,
        ],
      };
    }),
    [effectiveCurrency, effectiveSkus, t, tierNames],
  );
  const customSearchItem = useMemo<TopupSearchItem>(() => ({
    id: CUSTOM_TOPUP_ID,
    title: t("topup.custom"),
    detail: `${t("topup.custom.desc")} ${customDisplay} ${Math.floor(customAmount * notesPerUnit)} ${t("topup.notes")}`,
    terms: [
      CUSTOM_TOPUP_ID,
      "custom",
      customDisplay,
      String(customAmount),
      String(Math.floor(customAmount * notesPerUnit)),
      effectiveCurrency,
    ],
  }), [customAmount, customDisplay, effectiveCurrency, notesPerUnit, t]);
  const filteredSkuIds = useMemo(
    () => new Set(skuSearchItems.filter((item) => topupSearchMatches(item, searchQuery)).map((item) => item.id)),
    [searchQuery, skuSearchItems],
  );
  const showCustomTopup = topupSearchMatches(customSearchItem, searchQuery);
  const hasSearchQuery = searchQuery.trim().length > 0;
  const hasSearchResults = !hasSearchQuery || filteredSkuIds.size > 0 || showCustomTopup;
  const activeSelectedId = useMemo<string>(() => {
    if (!hasSearchQuery || !hasSearchResults) return selectedId;
    if (selectedId === CUSTOM_TOPUP_ID) {
      return showCustomTopup
        ? selectedId
        : effectiveSkus.find((sku) => filteredSkuIds.has(sku.id))?.id ?? selectedId;
    }
    if (filteredSkuIds.has(selectedId)) return selectedId;
    return effectiveSkus.find((sku) => filteredSkuIds.has(sku.id))?.id
      ?? (showCustomTopup ? CUSTOM_TOPUP_ID : selectedId);
  }, [effectiveSkus, filteredSkuIds, hasSearchQuery, hasSearchResults, selectedId, showCustomTopup]);
  const selected = effectiveSkus.find((s) => s.id === activeSelectedId);
  const displayAmount = activeSelectedId === CUSTOM_TOPUP_ID
    ? customDisplay
    : selected?.display ?? "$0";
  const displayNotes = activeSelectedId === CUSTOM_TOPUP_ID
    ? customNotes
    : selected
      ? selected.notes + (selected.bonusNotes ?? 0)
      : 0;
  const requiresSignIn = !accountLoading && !isRegistered;
  const topupCtaCopy = requiresSignIn
    ? t("topup.cta.sign_in") || "Sign in to buy {notes} notes — {price}"
    : (t("topup.cta") || "Buy {notes} notes — {price}");

  // ── Actions ───────────────────────────────────────────────────────
  const handleProceed = () => {
    if (!hasSearchResults || accountLoading) return;
    const href = buildTopupCheckoutHref({
      selectedId: activeSelectedId,
      selectedSkuId: selected?.id,
      customAmount,
      customAmountUsd: customQuote?.faceAmount,
      currency: effectiveCurrency,
      payMethod,
      requiresSignIn,
    });
    if (href) router.push(href);
  };

  const animateBalance = useCallback(
    (notesValue: number, usdValue: number, notesInUseValue: number) => {
      animate(notesSpring, 0, { duration: 0.25 }).then(() => {
        animate(notesSpring, notesValue, { duration: 0.5 });
      });
      animate(balanceUSDSpring, 0, { duration: 0.25 }).then(() => {
        animate(balanceUSDSpring, usdValue, { duration: 0.5 });
      });
      animate(notesInUseSpring, 0, { duration: 0.25 }).then(() => {
        animate(notesInUseSpring, notesInUseValue, { duration: 0.5 });
      });
    },
    [balanceUSDSpring, notesInUseSpring, notesSpring],
  );

  const handleRefresh = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      const [result, surface] = await Promise.all([
        refresh(),
        refreshTopupSurface(),
      ]);
      if (result?.balance) {
        animateBalance(
          result.balance.notes,
          (surface?.lifetimeTopupCents ?? topupSurface?.lifetimeTopupCents ?? 0) / 100,
          surface?.notesInUse ?? topupSurface?.notesInUse ?? 0,
        );
      } else if (result && !result.ok) {
        toast.error(t("topup.refresh_failed") || "Couldn't refresh balance — try again.");
      }
    } catch {
      toast.error(t("topup.refresh_failed") || "Couldn't refresh balance — try again.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleShareTopup = async () => {
    if (typeof window === "undefined") return;
    const payload = buildTopupSharePayload(window.location.origin, lang);
    try {
      if (navigator.share) {
        await navigator.share(payload);
        toast.success(t("topup.share.done") || "Top up link shared");
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }

    const copied = await copyTextToClipboard(`${payload.text}\n${payload.url}`);
    if (copied) {
      toast.success(t("topup.share.copied") || "Top up link copied");
    } else {
      toast.error(t("topup.share.failed") || "Couldn't share this link");
    }
  };

  const handleRestorePurchases = async () => {
    setIsRestoring(true);

    try {
      const response = await requestWithTimeout("/api/purchases/restore", {
        method: "POST",
      }, 12_000);

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
          const [result, surface] = await Promise.all([
            refresh(),
            refreshTopupSurface(),
          ]);
          animateBalance(
            result?.balance?.notes ?? currentBalance,
            (surface?.lifetimeTopupCents ?? topupSurface?.lifetimeTopupCents ?? 0) / 100,
            surface?.notesInUse ?? topupSurface?.notesInUse ?? 0,
          );
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
        { description: formatSupportCode({ area: "BILLING", error: "restore_failed", requestId: null }) },
      );
    } finally {
      setIsRestoring(false);
    }
  };

  useEffect(() => {
    notesSpring.set(currentBalance);
    balanceUSDSpring.set(balanceUSD);
    notesInUseSpring.set(notesInUse);
  }, [balanceUSD, balanceUSDSpring, currentBalance, notesInUse, notesInUseSpring, notesSpring]);

  const displayNotesBalance = useTransform(notesSpring, (v) => Math.round(v));
  const displayBalanceUSD = useTransform(balanceUSDSpring, (v) => v.toFixed(2));
  const displayNotesInUse = useTransform(notesInUseSpring, (v) => Math.round(v));
  const sliderSpan = sliderMax - sliderMin;

  useEffect(() => {
    const button = rangeButtonRefs.current[timeRange];
    const parent = rangeGroupRef.current;
    if (!button || !parent) return;
    const parentRect = parent.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    setRangeIndicator({
      left: buttonRect.left - parentRect.left,
      width: buttonRect.width,
    });
  }, [timeRange]);

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div className="relative z-10 flex min-h-svh flex-col">
        <div
          className="flex items-center justify-end px-5 pb-3"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 20px)" }}
        >
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleRefresh()}
              disabled={isRefreshing}
              className="flex h-9 w-9 items-center justify-center disabled:opacity-50"
              aria-label={t("topup.refresh")}
            >
              <RefreshCw className={`h-5 w-5 text-[#8C8780] ${isRefreshing ? "animate-spin" : ""}`} />
            </button>
            <button
              type="button"
              onClick={() => setIsSearchOpen((open) => !open)}
              className={`flex h-9 w-9 items-center justify-center transition-colors ${
                isSearchOpen ? "text-[#1A1A1A]" : "text-[#8C8780] hover:text-[#1A1A1A]"
              }`}
              aria-expanded={isSearchOpen}
              aria-label={t("topup.search")}
            >
              <Search className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => void handleShareTopup()}
              className="flex h-9 w-9 items-center justify-center text-[#8C8780] transition-colors hover:text-[#1A1A1A]"
              aria-label={t("topup.share")}
            >
              <Share2 className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 px-5 pb-52 md:pb-32">
          <div className="mx-auto max-w-lg">
            <AnimatePresence initial={false}>
              {isSearchOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -8, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: "auto" }}
                  exit={{ opacity: 0, y: -8, height: 0 }}
                  transition={{ duration: 0.18 }}
                  className="mb-5 overflow-hidden"
                >
                  <input
                    autoFocus
                    type="search"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={t("topup.search.placeholder") || "Search notes, prices, history"}
                    className="h-11 w-full rounded-full border border-[#E5DDD0]/70 bg-white/70 px-5 text-[14px] text-[#1A1A1A] outline-none placeholder:text-[#B7AEA1] focus:border-[#1A1A1A]/50"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Assets ─────────────────────────────────────────── */}
            <section>
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
                  {isLoading
                    ? "—"
                    : balanceError && !balance
                      ? <span className="text-[32px] text-[#B7AEA1]">{t("topup.balance_unavailable") || "Balance unavailable"}</span>
                      : <motion.span>{displayNotesBalance}</motion.span>}
                </h1>
                <button
                  onClick={() => void handleRefresh()}
                  disabled={isRefreshing}
                  className="mt-1 flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/5 transition-colors disabled:opacity-50"
                  aria-label={t("topup.refresh")}
                >
                  <RefreshCw className={`h-4 w-4 text-[#8C8780] ${isRefreshing ? "animate-spin" : ""}`} />
                </button>
              </motion.div>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.08, duration: 0.5 }}
                className="mt-2.5 flex items-center gap-1.5 text-[14px] font-medium"
                style={{ color: changeColor }}
              >
                <span>{change24hValue > 0 ? "↑" : change24hValue < 0 ? "↓" : "–"}</span>
                <span className="tabular-nums">{changeText}</span>
                <span className="text-[#B7AEA1]">· {t("topup.24h")}</span>
              </motion.p>

              {nextRefillLabel && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.1, duration: 0.5 }}
                  className="mt-2 text-[14px] text-[#8C8780]"
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
                    $<motion.span>{displayBalanceUSD}</motion.span>
                  </p>
                </div>

                <div className="rounded-[20px] bg-white/60 backdrop-blur-sm border border-[#E5DDD0]/40 px-5 py-5">
                  <p className="text-[11px] text-[#B7AEA1] font-semibold mb-3 tracking-wider uppercase">
                    {t("topup.in_use")}
                  </p>
                  <p className="font-serif text-[#1A1A1A] text-[28px] leading-none tabular-nums">
                    <motion.span>{displayNotesInUse}</motion.span>
                    <span className="text-[14px] font-normal text-[#1A1A1A] ml-1">{t("topup.notes")}</span>
                  </p>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.16, duration: 0.5 }}
                className="mt-5 rounded-[22px] bg-white/50 backdrop-blur-sm border border-[#E5DDD0]/40 px-6 py-6"
              >
                <div ref={rangeGroupRef} className="relative inline-flex items-center mb-5 bg-white rounded-full p-1 mx-auto">
                  {TIME_RANGES.map((range, idx) => {
                    const isSelected = timeRange === range;
                    return (
                      <button
                        key={range}
                        id={`time-range-${idx}`}
                        ref={(node) => {
                          rangeButtonRefs.current[range] = node;
                        }}
                        type="button"
                        onClick={() => setTimeRange(range)}
                        className={`relative z-10 text-[14px] font-semibold transition-colors px-5 py-2 rounded-full ${
                          isSelected
                            ? "text-white"
                            : "text-[#B7AEA1] hover:text-[#8C8780]"
                        }`}
                      >
                        {range}
                      </button>
                    );
                  })}
                  <motion.div
                    className="absolute rounded-full z-0 pointer-events-none"
                    animate={rangeIndicator}
                    initial={false}
                    transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    style={{
                      top: "4px",
                      bottom: "4px",
                      ...paperTextureStyle,
                    }}
                  />
                </div>

                <div
                  className="h-48 -ml-1 -mr-1 [&_*]:outline-none [&_*]:focus:outline-none"
                  aria-label={t("topup.balance_chart")}
                >
                  <BalanceLineChart data={chartData} timeRange={timeRange} />
                </div>
              </motion.div>
            </section>

            {/* ── Packages ───────────────────────────────────────── */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="mt-8"
            >
              <div className="mb-6 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[18px] font-semibold text-[#8C8780] mb-2">
                    {t("topup.packages")}
                  </h3>
                  <p className="text-[14px] text-[#B7AEA1]">
                    {t("topup.packages.sub")}
                  </p>
                </div>
                <CurrencyToggle value={effectiveCurrency} onChange={handleCurrencyToggle} />
              </div>

              <div className="grid grid-cols-3 gap-3 mb-6">
                {effectiveSkus.filter((sku) => filteredSkuIds.has(sku.id)).map((sku, idx) => {
                  const isSelected = sku.id === activeSelectedId;
                  const originalIndex = effectiveSkus.findIndex((entry) => entry.id === sku.id);
                  const skuNotes = sku.notes + (sku.bonusNotes ?? 0);
                  const songCount = Math.floor(skuNotes / 5);

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
                        {tierNames[originalIndex] ?? tierNames[idx] ?? sku.id}
                      </p>
                      <p className="font-serif text-[#1A1A1A] text-[28px] leading-none mb-1">
                        {sku.display}
                      </p>
                      <p className="text-[12px] text-[#8C8780] mb-3">
                        {t("topup.songs").replace("{n}", String(songCount))}
                      </p>
                      <div className="flex items-baseline justify-center gap-1">
                        <span className="font-serif text-[#1A1A1A] text-[16px]">{sku.notes}</span>
                        {sku.bonusNotes ? (
                          <span className="font-serif text-[#5F8A6B] text-[13px]">+{sku.bonusNotes}</span>
                        ) : null}
                        <span className="text-[11px] text-[#B7AEA1] ml-0.5">{t("topup.notes")}</span>
                      </div>
                    </motion.button>
                  );
                })}
              </div>

              {/* Custom amount */}
              {showCustomTopup && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3, duration: 0.5 }}
                  className={`rounded-[20px] border backdrop-blur-sm px-6 py-6 transition-all ${
                    activeSelectedId === CUSTOM_TOPUP_ID
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
                        {currencySymbol}{customAmount}
                      </p>
                    </div>
                  </div>

                <div className="relative mb-6 pt-2">
                  <div className="mb-3 flex justify-between text-[11px] font-medium text-[#B7AEA1]">
                    <span>{currencySymbol}{sliderMin}</span>
                    <span className="absolute left-1/2 -translate-x-1/2">{currencySymbol}{Math.round(sliderMax / 2)}</span>
                    <span>{currencySymbol}{sliderMax}</span>
                  </div>

                  <div className="relative">
                    <div className="relative h-1 rounded-full bg-[#E5DDD0]/60">
                      <div
                        className="absolute h-1 rounded-full bg-[#8C8780] transition-all duration-150"
                        style={{
                          width: `${((sliderAmount - sliderMin) / sliderSpan) * 100}%`,
                        }}
                      />
                    </div>

                    <input
                      type="range"
                      min={String(sliderMin)}
                      max={String(sliderMax)}
                      value={sliderAmount}
                      onChange={(e) => setCustomAmount(Number(e.target.value))}
                      aria-label={t("topup.slider.label")}
                      className="absolute z-10 h-8 w-full cursor-grab opacity-0 active:cursor-grabbing"
                      style={{ top: "-14px", left: 0 }}
                    />

                    <div
                      className="pointer-events-none absolute -top-3 z-20 h-7 w-7 rounded-full border-[3px] border-white shadow-[0_2px_12px_rgba(0,0,0,0.25)] transition-all duration-150"
                      style={{
                        left: `calc(${((sliderAmount - sliderMin) / sliderSpan) * 100}% - 14px)`,
                        ...paperTextureStyle,
                      }}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                  <div className="max-w-[200px] flex-1">
                    <input
                      type="number"
                      min={String(sliderMin)}
                      max={String(customConfig.maxAmount)}
                      value={customAmount}
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        setCustomAmount(
                          Math.min(
                            customConfig.maxAmount,
                            Math.max(
                              sliderMin,
                              Number.isFinite(value) ? Math.floor(value) : sliderMin,
                            ),
                          ),
                        );
                      }}
                      onClick={(e) => e.stopPropagation()}
                      placeholder={t("topup.input.placeholder")}
                      className="w-full rounded-[14px] border border-[#E5DDD0] bg-white/60 px-4 py-3 text-[15px] text-[#1A1A1A] tabular-nums placeholder:text-[#C8C0B4] transition-colors focus:border-[#1A1A1A] focus:outline-none"
                    />
                  </div>
                  <p className="text-[13px] leading-none text-[#B7AEA1] sm:whitespace-nowrap">
                    ≈ {Math.floor(customAmount * notesPerUnit)} {t("topup.notes")}
                  </p>
                </div>
                </motion.div>
              )}

              {!hasSearchResults && (
                <p className="rounded-[18px] border border-[#E5DDD0]/50 bg-white/45 px-4 py-5 text-center text-[13px] text-[#8C8780]">
                  {t("topup.search.empty") || "No matching top-up items."}
                </p>
              )}

              {/* ── Desktop: payment + CTA + restore ─────────────── */}
              <div className="mt-6 hidden md:block">
                <PayMethodPicker value={payMethod} onChange={handlePayMethodChange} t={t} className="mb-3" />

                <motion.button
                  whileTap={{ scale: 0.98 }}
                  onClick={handleProceed}
                  disabled={!hasSearchResults || accountLoading}
                  className="h-12 w-full rounded-full text-[15px] font-semibold text-white transition-all hover:brightness-110 disabled:opacity-45"
                  style={paperTextureStyle}
                >
                  {topupCtaCopy
                    .replace("{notes}", String(displayNotes))
                    .replace("{price}", displayAmount)}
                </motion.button>

                {requiresSignIn && (
                  <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] leading-[1.45] text-[#8C8780]">
                    <LogIn className="h-3.5 w-3.5" />
                    {t("topup.sign_in_hint") || "Purchases attach to a registered account so your notes can sync."}
                  </p>
                )}

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
            </motion.div>
          </div>
        </div>

        {/* ── Mobile: fixed bottom bar ────────────────────────────── */}
        <div
          className="fixed inset-x-0 bottom-0 z-40 px-6 pt-3 md:hidden"
          style={{
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)",
            backgroundColor: "#F5F1EB",
          }}
        >
          <div
            className="pointer-events-none absolute inset-x-0 -top-8 h-8"
            style={{
              background: "linear-gradient(to top, #F5F1EB, rgba(245,241,235,0))",
            }}
            aria-hidden
          />
          <div className="mx-auto max-w-lg">
            <PayMethodPicker value={payMethod} onChange={handlePayMethodChange} t={t} className="mb-2" />

            <motion.button
              whileTap={{ scale: 0.98 }}
              onClick={handleProceed}
              disabled={!hasSearchResults || accountLoading}
              className="h-12 w-full rounded-full text-[15px] font-semibold text-white transition-all hover:brightness-110 disabled:opacity-45"
              style={paperTextureStyle}
            >
              {topupCtaCopy
                .replace("{notes}", String(displayNotes))
                .replace("{price}", displayAmount)}
            </motion.button>

            {requiresSignIn && (
              <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] leading-[1.4] text-[#8C8780]">
                <LogIn className="h-3.5 w-3.5" />
                {t("topup.sign_in_hint") || "Purchases attach to a registered account so your notes can sync."}
              </p>
            )}

            <div className="mt-2 flex items-center justify-center text-[11px] text-[#8C8780]">
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

/* ── Sub-components ──────────────────────────────────────────────────── */

function CurrencyToggle({
  value,
  onChange,
}: {
  value: Currency;
  onChange: (c: Currency) => void;
}) {
  return (
    <div className="flex shrink-0 rounded-full bg-[#E5DDD0]/50 p-[3px]">
      {(["USD", "CNY"] as const).map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`rounded-full px-3 py-1 text-[12px] font-medium transition-all ${
            value === c
              ? "bg-white text-[#1A1A1A] shadow-sm"
              : "text-[#8C8780] hover:text-[#1A1A1A]"
          }`}
        >
          {c === "USD" ? "$ USD" : "¥ CNY"}
        </button>
      ))}
    </div>
  );
}

function CreditCardIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}

function WechatPayIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="#07C160" xmlns="http://www.w3.org/2000/svg">
      <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z" />
    </svg>
  );
}

function PayMethodPicker({
  value,
  onChange,
  t,
  className,
}: {
  value: "card" | "wxpay";
  onChange: (v: "card" | "wxpay") => void;
  t: (k: string) => string;
  className?: string;
}) {
  return (
    <div className={`flex items-center justify-center gap-1.5 ${className ?? ""}`}>
      <button
        onClick={() => onChange("card")}
        className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] transition-all ${
          value === "card"
            ? "bg-[#1A1A1A]/8 text-[#1A1A1A] font-medium"
            : "text-[#B7AEA1] hover:text-[#8C8780]"
        }`}
      >
        <CreditCardIcon size={14} />
        {t("topup.payment.card")}
      </button>
      <span className="text-[#D2C9B6] text-[10px]">|</span>
      <button
        onClick={() => onChange("wxpay")}
        className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] transition-all ${
          value === "wxpay"
            ? "bg-[#07C160]/10 text-[#07C160] font-medium"
            : "text-[#B7AEA1] hover:text-[#8C8780]"
        }`}
      >
        <WechatPayIcon size={14} />
        {t("topup.payment.wechat")}
      </button>
    </div>
  );
}
