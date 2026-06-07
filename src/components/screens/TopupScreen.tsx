"use client";

/**
 * TopupScreen — Coinbase-inspired balance view + package selection.
 *
 * Top section: Asset-style balance display with usage chart
 * Bottom section: Three elegant package cards
 */

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion, useSpring, useTransform, animate } from "framer-motion";
import { RefreshCw, Search, Share2 } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { toast } from "sonner";

import { useTranslator } from "@/lib/i18n";
import { useUserBalance } from "@/lib/hooks/use-user-balance";
import { PageBackdrop } from "@/components/murmur/page-backdrop";

interface TopupSku {
  id: string;
  notes: number;
  bonusNotes?: number;
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
    bonusNotes: 12,
    defaultPriceCents: 599,
    defaultCurrency: "USD",
    display: "$5.99",
    highlight: "popular"
  },
  {
    id: "topup_400_notes",
    notes: 400,
    bonusNotes: 60,
    defaultPriceCents: 1499,
    defaultCurrency: "USD",
    display: "$14.99",
    highlight: "best_value"
  },
];

const TIME_RANGES = ["1D", "7D", "1M", "3M", "All"] as const;

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

// Generate mock usage data based on time range
function generateChartData(range: typeof TIME_RANGES[number]) {
  const dataPoints = range === "1D" ? 24 : range === "7D" ? 7 : range === "1M" ? 30 : range === "3M" ? 90 : 365;
  const data = [];
  const now = Date.now();

  for (let i = 0; i < dataPoints; i++) {
    const date = new Date(now - (dataPoints - i) * (range === "1D" ? 3600000 : 86400000));
    // More organic growth curve with smoother fluctuations
    const baseValue = 100;
    const trend = i * 0.8; // Gradual upward trend
    const wave = Math.sin(i * 0.3) * 8; // Smooth wave pattern
    const noise = (Math.random() - 0.5) * 4; // Reduced noise for smoother curve
    const value = baseValue + trend + wave + noise;

    // Format date as M/D
    const month = date.getMonth() + 1;
    const day = date.getDate();

    data.push({
      date: `${month}/${day}`,
      value: Math.max(50, Math.round(value * 100) / 100), // Keep values positive
    });
  }

  return data;
}

export function TopupScreen() {
  const router = useRouter();
  const t = useTranslator();
  const { balance, isLoading } = useUserBalance();

  const [selectedId, setSelectedId] = useState<string>(
    TOPUP_SKUS.find((s) => s.highlight === "popular")?.id ?? TOPUP_SKUS[0]!.id,
  );
  const [timeRange, setTimeRange] = useState<typeof TIME_RANGES[number]>("7D");
  const [customAmount, setCustomAmount] = useState(10); // Default $10
  const [isRestoring, setIsRestoring] = useState(false);

  // Animated values for number rolling
  const totalNotesSpring = useSpring(0, { stiffness: 100, damping: 20 });
  const balanceUSDSpring = useSpring(0, { stiffness: 100, damping: 20 });
  const notesInUseSpring = useSpring(0, { stiffness: 100, damping: 20 });

  const selected = TOPUP_SKUS.find((s) => s.id === selectedId);
  const displayAmount = selectedId === "custom"
    ? `$${customAmount}`
    : selected?.display ?? "$0";
  const displayNotes = selectedId === "custom"
    ? Math.floor(customAmount * 20) // Roughly 20 notes per dollar
    : (selected?.notes ?? 0) + (selected?.bonusNotes ?? 0);

  const handleProceed = () => {
    if (!selected) return;
    router.push(`/topup/checkout?sku=${encodeURIComponent(selected.id)}`);
  };

  const handleRefresh = () => {
    // Animate to 0 first, then to target values
    animate(totalNotesSpring, 0, { duration: 0.3 }).then(() => {
      animate(totalNotesSpring, totalNotes, { duration: 0.5 });
    });
    animate(balanceUSDSpring, 0, { duration: 0.3 }).then(() => {
      animate(balanceUSDSpring, balanceUSD, { duration: 0.5 });
    });
    animate(notesInUseSpring, 0, { duration: 0.3 }).then(() => {
      animate(notesInUseSpring, notesInUse, { duration: 0.5 });
    });
  };

  const handleRestorePurchases = async () => {
    setIsRestoring(true);

    try {
      const response = await fetch("/api/purchases/restore", {
        method: "POST",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to restore purchases");
      }

      const data = await response.json();

      // Show appropriate feedback based on results
      if (data.restored && data.restored.length > 0) {
        if (data.newPurchases > 0) {
          toast.success(`已恢复 ${data.newPurchases} 笔新购买，共 ${data.totalNotes} 颗音磅`);
          // Refresh balance after successful restore
          setTimeout(() => {
            window.location.reload();
          }, 2000);
        } else {
          toast.info(`找到 ${data.restored.length} 笔购买记录，共 ${data.totalNotes} 颗音磅`);
        }
      } else {
        toast.info("没有找到可恢复的购买记录");
      }
    } catch (error) {
      console.error("[restore-purchases] Error:", error);
      toast.error(error instanceof Error ? error.message : "恢复购买失败，请稍后重试");
    } finally {
      setIsRestoring(false);
    }
  };

  // Calculate real-time balance and changes
  const currentBalance = balance?.notes ?? 0;
  const totalAvailable = currentBalance;

  // Balance in USD - mock value, should come from actual payment system
  const balanceUSD = 8.23;

  // In use - notes used in recent days, not USD
  const notesInUse = 45;
  const totalNotes = totalAvailable + notesInUse;

  // Initialize spring values on mount
  useEffect(() => {
    totalNotesSpring.set(totalNotes);
    balanceUSDSpring.set(balanceUSD);
    notesInUseSpring.set(notesInUse);
  }, [totalNotes, balanceUSD, notesInUse, totalNotesSpring, balanceUSDSpring, notesInUseSpring]);

  // Generate chart data based on selected time range
  const chartData = useMemo(() => generateChartData(timeRange), [timeRange]);

  // Calculate real 24h change from chart data
  const firstValue = chartData[0]?.value ?? 0;
  const lastValue = chartData[chartData.length - 1]?.value ?? 0;
  const change24hValue = lastValue - firstValue;
  const change24hPercent = firstValue !== 0 ? ((change24hValue / firstValue) * 100) : 0;

  const changeText = `${change24hValue >= 0 ? '+' : ''}${Math.abs(change24hValue).toFixed(0)} (${change24hPercent >= 0 ? '+' : ''}${change24hPercent.toFixed(2)}%)`;
  const changeColor = change24hValue >= 0 ? "#5F8A6B" : "#C87355";

  // Animated display values
  const displayTotalNotes = useTransform(totalNotesSpring, (v) => Math.round(v));
  const displayBalanceUSD = useTransform(balanceUSDSpring, (v) => v.toFixed(2));
  const displayNotesInUse = useTransform(notesInUseSpring, (v) => Math.round(v));

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div className="relative z-10 flex min-h-svh flex-col">
        {/* ── Header ───────────────────────── */}
        <div
          className="flex items-center justify-end px-5 pb-3"
          style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 20px)" }}
        >
          {/* Right: Action icons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              className="flex h-9 w-9 items-center justify-center"
              aria-label={t("topup.refresh")}
            >
              <RefreshCw className="h-5 w-5 text-[#8C8780]" />
            </button>
            <button className="flex h-9 w-9 items-center justify-center">
              <Search className="h-5 w-5 text-[#8C8780]" />
            </button>
            <button className="flex h-9 w-9 items-center justify-center">
              <Share2 className="h-5 w-5 text-[#8C8780]" />
            </button>
          </div>
        </div>

        {/* ── Body: Balance + chart ───────────── */}
        <div className="flex-1 px-5 pb-32">
          <div className="mx-auto max-w-lg">
            {/* Assets title - aligned with balance */}
            <motion.h2
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.02, duration: 0.5 }}
              className="text-[18px] font-semibold text-[#8C8780] mb-2"
            >
              {t("topup.assets")}
            </motion.h2>
            {/* Big balance number with refresh icon */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.04, duration: 0.5 }}
              className="flex items-start gap-2"
            >
              <h1 className="font-serif text-[#1A1A1A] text-[68px] leading-[1.0] tabular-nums tracking-tight">
                <motion.span>{displayTotalNotes}</motion.span>
              </h1>
              <button
                onClick={handleRefresh}
                className="mt-1 flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/5 transition-colors"
                aria-label={t("topup.refresh")}
              >
                <RefreshCw className="h-4 w-4 text-[#8C8780]" />
              </button>
            </motion.div>

            {/* 24H change */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.08, duration: 0.5 }}
              className="mt-2.5 text-[14px] font-medium flex items-center gap-1.5"
              style={{ color: changeColor }}
            >
              <span>{change24hValue >= 0 ? '↑' : '↓'}</span>
              <span className="tabular-nums">{changeText}</span>
              <span className="text-[#B7AEA1]">· {t("topup.24h")}</span>
            </motion.p>

            {/* Balance & In Use cards */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.12, duration: 0.5 }}
              className="mt-8 grid grid-cols-2 gap-4"
            >
              {/* Balance */}
              <div className="rounded-[20px] bg-white/60 backdrop-blur-sm border border-[#E5DDD0]/40 px-5 py-5">
                <p className="text-[11px] text-[#B7AEA1] font-semibold mb-3 tracking-wider uppercase">{t("topup.balance")}</p>
                <p className="font-serif text-[#1A1A1A] text-[28px] leading-none tabular-nums">
                  $<motion.span>{displayBalanceUSD}</motion.span>
                </p>
              </div>

              {/* In Use */}
              <div className="rounded-[20px] bg-white/60 backdrop-blur-sm border border-[#E5DDD0]/40 px-5 py-5">
                <p className="text-[11px] text-[#B7AEA1] font-semibold mb-3 tracking-wider uppercase">{t("topup.in_use")}</p>
                <p className="font-serif text-[#1A1A1A] text-[28px] leading-none tabular-nums">
                  <motion.span>{displayNotesInUse}</motion.span>
                  <span className="text-[14px] font-normal text-[#1A1A1A] ml-1">{t("topup.notes")}</span>
                </p>
              </div>
            </motion.div>

            {/* Chart card - gray background with grid lines like reference */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.16, duration: 0.5 }}
              className="mt-5 rounded-[22px] bg-white/50 backdrop-blur-sm border border-[#E5DDD0]/40 px-6 py-6"
            >
              {/* Time period selector - sliding pill design */}
              <div className="relative inline-flex items-center mb-5 bg-white rounded-full p-1 mx-auto">
                {TIME_RANGES.map((range, idx) => {
                  const isSelected = timeRange === range;
                  return (
                    <button
                      key={range}
                      id={`time-range-${idx}`}
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
                {/* Sliding indicator with paper texture */}
                <motion.div
                  className="absolute rounded-full z-0 pointer-events-none"
                  animate={{
                    left: (() => {
                      if (typeof document === 'undefined') return 0;
                      const idx = TIME_RANGES.indexOf(timeRange);
                      const button = document.getElementById(`time-range-${idx}`);
                      if (button) {
                        const parent = button.parentElement;
                        if (parent) {
                          const parentRect = parent.getBoundingClientRect();
                          const buttonRect = button.getBoundingClientRect();
                          return buttonRect.left - parentRect.left;
                        }
                      }
                      return 0;
                    })(),
                    width: (() => {
                      if (typeof document === 'undefined') return 0;
                      const idx = TIME_RANGES.indexOf(timeRange);
                      const button = document.getElementById(`time-range-${idx}`);
                      return button ? button.offsetWidth : 0;
                    })(),
                  }}
                  initial={false}
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                  style={{
                    top: "4px",
                    bottom: "4px",
                    ...paperTextureStyle,
                  }}
                />
              </div>

              {/* Interactive chart with grid lines */}
              <div className="h-48 -ml-1 -mr-1 [&_*]:outline-none [&_*]:focus:outline-none">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
                    {/* 5 horizontal grid lines */}
                    <CartesianGrid
                      horizontal={true}
                      vertical={false}
                      stroke="#E5DDD0"
                      strokeWidth={1}
                      strokeDasharray="0"
                    />
                    <XAxis
                      dataKey="date"
                      stroke="#D2C9B6"
                      style={{ fontSize: "10px", fontFamily: "system-ui", fill: "#B7AEA1", fontWeight: 500 }}
                      tickLine={false}
                      axisLine={false}
                      interval={Math.floor(chartData.length / 6)}
                      tickMargin={10}
                    />
                    <YAxis
                      stroke="#E5DDD0"
                      style={{ fontSize: "11px", fontFamily: "system-ui", fill: "#8C8780" }}
                      tickLine={false}
                      axisLine={false}
                      domain={["auto", "auto"]}
                      tickMargin={8}
                      hide={true}
                      tickCount={5}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "rgba(255, 255, 255, 0.98)",
                        border: "1px solid #E5DDD0",
                        borderRadius: "10px",
                        fontSize: "12px",
                        padding: "8px 12px",
                        boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                      }}
                      labelStyle={{ color: "#8C8780", fontSize: "11px", marginBottom: "3px" }}
                      itemStyle={{ color: "#1A1A1A", fontWeight: 600, fontFamily: "var(--font-serif)" }}
                      formatter={(value: number | string | undefined) => {
                        if (typeof value === 'number') {
                          return [`${value.toFixed(0)} notes`, ""];
                        }
                        return ["", ""];
                      }}
                      cursor={{ stroke: "#B7AEA1", strokeWidth: 1.5 }}
                    />
                    <Line
                      type="monotoneX"
                      dataKey="value"
                      stroke="#B7AEA1"
                      strokeWidth={2.5}
                      dot={false}
                      activeDot={{ r: 5, fill: "#8C8780", strokeWidth: 0 }}
                      animationDuration={800}
                      animationEasing="ease-in-out"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            {/* Support / Pricing section */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="mt-8"
            >
              {/* Header */}
              <div className="mb-6">
                <h3 className="text-[18px] font-semibold text-[#8C8780] mb-2">
                  {t("topup.packages")}
                </h3>
                <p className="text-[14px] text-[#B7AEA1]">
                  {t("topup.packages.sub")}
                </p>
              </div>

              {/* Three preset tiers */}
              <div className="grid grid-cols-3 gap-3 mb-6">
                {TOPUP_SKUS.map((sku, idx) => {
                  const isSelected = sku.id === selectedId;
                  const tierNames = [t("topup.starter"), t("topup.creator"), t("topup.patron")];
                  const songCount = Math.floor((sku.notes + (sku.bonusNotes || 0)) / 5);

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
                      style={
                        isSelected
                          ? {
                              background: `
                                linear-gradient(135deg,
                                  rgba(26, 26, 26, 0.02) 0%,
                                  rgba(26, 26, 26, 0.0) 100%
                                ),
                                repeating-linear-gradient(
                                  90deg,
                                  rgba(0, 0, 0, 0.01) 0px,
                                  transparent 1px,
                                  transparent 2px,
                                  rgba(0, 0, 0, 0.01) 3px
                                ),
                                rgba(255, 255, 255, 0.8)
                              `,
                            }
                          : undefined
                      }
                    >
                      {/* Badge */}
                      {sku.highlight && (
                        <div
                          className="absolute -top-2 left-1/2 -translate-x-1/2 text-white px-3 py-1 rounded-full text-[9px] font-semibold uppercase tracking-wider whitespace-nowrap"
                          style={paperTextureStyle}
                        >
                          Most loved
                        </div>
                      )}

                      {/* Tier name */}
                      <p className="text-[11px] text-[#B7AEA1] font-semibold uppercase tracking-wider mb-3">
                        {tierNames[idx]}
                      </p>

                      {/* Price */}
                      <p className="font-serif text-[#1A1A1A] text-[28px] leading-none mb-1">
                        {sku.display}
                      </p>

                      {/* Song count */}
                      <p className="text-[12px] text-[#8C8780] mb-3">
                        {t("topup.songs").replace("{n}", String(songCount))}
                      </p>

                      {/* Notes + bonus */}
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

              {/* Custom amount section with slider */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.5 }}
                className={`rounded-[20px] border backdrop-blur-sm px-6 py-6 transition-all ${
                  selectedId === "custom"
                    ? "border-[#1A1A1A] bg-white/80 shadow-[0_2px_12px_rgba(0,0,0,0.08)]"
                    : "border-[#E5DDD0]/40 bg-white/50"
                }`}
                onClick={() => setSelectedId("custom")}
              >
                <div className="flex items-center justify-between mb-5">
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

                {/* Slider */}
                <div className="relative mb-6 pt-2">
                  {/* Labels */}
                  <div className="flex justify-between mb-3 text-[11px] text-[#B7AEA1] font-medium">
                    <span>$1</span>
                    <span className="absolute left-1/2 -translate-x-1/2">$50</span>
                    <span>$100</span>
                  </div>

                  {/* Slider track and thumb container */}
                  <div className="relative">
                    {/* Simple tick marks */}
                    <div className="absolute -top-2 left-0 right-0 flex justify-between pointer-events-none">
                      {[0, 25, 50, 75, 100].map((n) => (
                        <div
                          key={`tick-${n}`}
                          className="w-[1.5px] h-3 bg-[#D2C9B6] rounded-full"
                          style={{ marginLeft: n === 0 ? '0.75px' : undefined }}
                        />
                      ))}
                    </div>

                    {/* Slider track */}
                    <div className="relative h-1 bg-[#E5DDD0]/60 rounded-full">
                      {/* Progress fill */}
                      <div
                        className="absolute h-1 bg-[#8C8780] rounded-full transition-all duration-150"
                        style={{ width: `${((customAmount - 1) / 99) * 100}%` }}
                      />
                    </div>

                    {/* Slider input */}
                    <input
                      type="range"
                      min="1"
                      max="100"
                      value={customAmount}
                      onChange={(e) => setCustomAmount(Number(e.target.value))}
                      className="absolute w-full h-8 opacity-0 cursor-grab active:cursor-grabbing z-10"
                      style={{ top: '-14px', left: 0 }}
                    />

                    {/* Slider thumb */}
                    <div
                      className="absolute w-7 h-7 rounded-full -top-3 transition-all duration-150 pointer-events-none shadow-[0_2px_12px_rgba(0,0,0,0.25)] border-[3px] border-white z-20"
                      style={{
                        left: `calc(${((customAmount - 1) / 99) * 100}% - 14px)`,
                        ...paperTextureStyle,
                      }}
                    />
                  </div>
                </div>

                {/* Input field */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 max-w-[200px]">
                    <input
                      type="number"
                      min="1"
                      max="999"
                      value={customAmount}
                      onChange={(e) => setCustomAmount(Math.min(999, Math.max(1, Number(e.target.value) || 1)))}
                      onClick={(e) => e.stopPropagation()}
                      placeholder={t("topup.input.placeholder")}
                      className="w-full px-4 py-3 rounded-[14px] border border-[#E5DDD0] bg-white/60 text-[15px] text-[#1A1A1A] placeholder:text-[#C8C0B4] focus:outline-none focus:border-[#1A1A1A] transition-colors tabular-nums"
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

        {/* ── Bottom CTA ───────────────────────────────────────── */}
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
                {isRestoring ? "恢复中..." : `↻ ${t("topup.restore") || "恢复已购买"}`}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
