"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Bug, Gauge, Languages, SlidersHorizontal } from "lucide-react";
import { useI18nStore, useTranslator } from "@/lib/i18n";
import { usePreferencesStore } from "@/lib/store/preferences-store";
import { PageBackdrop } from "@/components/murmur/page-backdrop";

type QaHealthResponse = {
  status?: string;
  capturedAt?: string;
  web?: { status?: string; runtime?: string };
  worker?: {
    configured?: boolean;
    ok?: boolean;
    status?: string;
    service?: string | null;
    url?: string | null;
  };
  qaRoutes?: string[];
};

type I18nAuditResponse = {
  status?: string;
  capturedAt?: string;
  totalKeys?: number;
  usedKeys?: number;
  missingCount?: number;
  missing?: Array<{
    key: string;
    locations: string[];
  }>;
};

type RuntimeSnapshot = {
  jsHeapMB: number | null;
  jsHeapLimitMB: number | null;
  viewport: string;
  dpr: number;
  connection: string | null;
  navigationType: string | null;
  domReadyMs: number | null;
  loadMs: number | null;
  resourceCount: number;
  slowResources: number;
  transferMB: number | null;
};

export function SettingsScreen() {
  const t = useTranslator();
  const lang = useI18nStore((state) => state.lang);
  const setLang = useI18nStore((state) => state.setLang);
  const repairBias = usePreferencesStore((state) => state.repairBias);
  const setRepairBias = usePreferencesStore((state) => state.setRepairBias);
  const developerMode = usePreferencesStore((state) => state.developerMode);
  const setDeveloperMode = usePreferencesStore((state) => state.setDeveloperMode);
  const [qaHealth, setQaHealth] = useState<QaHealthResponse | null>(null);
  const [i18nAudit, setI18nAudit] = useState<I18nAuditResponse | null>(null);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<RuntimeSnapshot | null>(null);

  useEffect(() => {
    if (!developerMode) return;
    let cancelled = false;

    async function loadDeveloperDiagnostics() {
      setRuntimeSnapshot(readRuntimeSnapshot());
      const [healthResult, i18nResult] = await Promise.allSettled([
        fetchJson<QaHealthResponse>("/api/qa/health"),
        fetchJson<I18nAuditResponse>("/api/qa/i18n"),
      ]);
      if (cancelled) return;
      setQaHealth(
        healthResult.status === "fulfilled"
          ? healthResult.value
          : { status: "unavailable" },
      );
      setI18nAudit(
        i18nResult.status === "fulfilled"
          ? i18nResult.value
          : { status: "unavailable" },
      );
    }

    void loadDeveloperDiagnostics();
    return () => {
      cancelled = true;
    };
  }, [developerMode]);

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB] text-[#1A1A1A]">
      <PageBackdrop variant="soft" />

      <div
        className="relative z-10 max-w-3xl mx-auto px-6 pb-28 md:px-12"
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
            {t("settings.title") || "Settings"}
          </h1>
          <p className="mt-3 max-w-[32rem] font-serif-italic text-[15px] leading-[1.55] text-[#6F6A63] md:text-[16px]">
            {t("settings.sub") || "Keep the product quiet, and open the wiring only when you need it."}
          </p>
        </header>

        <main className="mt-7 space-y-5">
          <SettingsCard
            icon={<Languages className="h-4 w-4" />}
            label={t("settings.language.title") || "Language"}
          >
            <div className="flex gap-2">
              <Pill active={lang === "zh"} onClick={() => setLang("zh")}>
                {t("me.language.zh") || "中文"}
              </Pill>
              <Pill active={lang === "en"} onClick={() => setLang("en")}>
                {t("me.language.en") || "English"}
              </Pill>
            </div>
          </SettingsCard>

          <SettingsCard
            icon={<SlidersHorizontal className="h-4 w-4" />}
            label={t("settings.creative.title") || "Creative bias"}
          >
            <p className="text-[13px] leading-[1.6] text-[#6F6A63] mb-6">
              {t("me.repair_bias.helper") ||
                "This only nudges Murmur when a take could go more than one sensible way."}
            </p>

            <div className="relative">
              {/* Custom slider track */}
              <div className="relative h-2 rounded-full overflow-hidden bg-[#E7DCCB]">
                {/* Filled portion */}
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-all duration-150"
                  style={{
                    width: `${((repairBias + 1) / 2) * 100}%`,
                    background: repairBias < 0
                      ? "linear-gradient(90deg, #E6D3BC 0%, #F6E6D2 100%)"
                      : "linear-gradient(90deg, #F6E6D2 0%, #FFD2BE 100%)",
                  }}
                />
              </div>

              {/* Native input (invisible but functional) */}
              <input
                aria-label={t("me.repair_bias.title") || "Creative bias"}
                type="range"
                min={-100}
                max={100}
                step={1}
                value={Math.round(repairBias * 100)}
                onChange={(event) => setRepairBias(Number(event.target.value) / 100)}
                className="absolute inset-0 w-full h-full cursor-pointer appearance-none bg-transparent"
                style={{
                  WebkitAppearance: "none",
                }}
              />

              {/* Custom thumb */}
              <div
                className="absolute top-1/2 -translate-y-1/2 pointer-events-none transition-all duration-150"
                style={{
                  left: `calc(${((repairBias + 1) / 2) * 100}% - 12px)`,
                }}
              >
                <div className="w-6 h-6 rounded-full bg-white border-2 border-[#1A1A1A] shadow-[0_2px_8px_rgba(26,26,26,0.12)]" />
              </div>
            </div>

            {/* Labels */}
            <div className="mt-5 flex items-start justify-between gap-4">
              <div className="flex-1 text-left">
                <p className="text-[13px] font-medium text-[#1A1A1A] leading-tight">
                  {t("me.repair_bias.live.left") || "偏原唱"}
                </p>
                <p className="text-[11px] text-[#8C8780] leading-snug mt-1">
                  {t("me.repair_bias.left_note") || "少修一点，尽量保留你刚刚哼出来的走向。"}
                </p>
              </div>
              <div className="flex-shrink-0 text-center px-4">
                <p className="text-[13px] font-medium text-[#1A1A1A] leading-tight">
                  {t("me.repair_bias.live.center") || "默认"}
                </p>
                <p className="text-[11px] text-[#8C8780] leading-snug mt-1">
                  {t("me.repair_bias.center_note") || "平衡原味与听感"}
                </p>
              </div>
              <div className="flex-1 text-right">
                <p className="text-[13px] font-medium text-[#1A1A1A] leading-tight">
                  {t("me.repair_bias.live.right") || "偏好听"}
                </p>
                <p className="text-[11px] text-[#8C8780] leading-snug mt-1">
                  {t("me.repair_bias.right_note") || "更好听"}
                </p>
              </div>
            </div>

            <style jsx>{`
              input[type="range"]::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 24px;
                height: 24px;
                border-radius: 50%;
                background: transparent;
                cursor: pointer;
              }
              input[type="range"]::-moz-range-thumb {
                width: 24px;
                height: 24px;
                border-radius: 50%;
                background: transparent;
                cursor: pointer;
                border: none;
              }
            `}</style>
          </SettingsCard>

          <SettingsCard
            icon={<Bug className="h-4 w-4" />}
            label={t("settings.developer.title") || "Developer mode"}
          >
            <div className="flex items-start justify-between gap-5">
              <div>
                <p className="text-[13px] leading-[1.6] text-[#6F6A63]">
                  {t("settings.developer.body") ||
                    "Expose pre-render copy tokens, QA routes, performance hints, and runtime diagnostics."}
                </p>
                <p className="mt-2 font-mono text-[11px] leading-[1.6] text-[#8C8780]">
                  {developerMode
                    ? "missing i18n -> studio.empty.eyebrow"
                    : "missing i18n -> product fallback"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeveloperMode(!developerMode)}
                className={`h-7 w-12 shrink-0 rounded-full p-1 transition-colors ${
                  developerMode ? "bg-[#1A1A1A]" : "bg-[#D8CCBA]"
                }`}
                aria-pressed={developerMode}
              >
                <span
                  className={`block h-5 w-5 rounded-full bg-white transition-transform ${
                    developerMode ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {developerMode ? (
              <div className="mt-5 space-y-4">
                <DeveloperPanel qaHealth={qaHealth} runtimeSnapshot={runtimeSnapshot} />
                <I18nPanel audit={i18nAudit} />
                <div className="flex flex-wrap gap-3">
                  <Link href="/me/debug" className="mm-btn-primary">
                    {t("settings.developer.debug") || "Open debug"}
                  </Link>
                  <Link
                    href="/api/qa/health"
                    className="inline-flex h-11 items-center rounded-full border border-[#E7DCCB] px-5 text-[13px] text-[#6F6A63] transition-colors hover:border-[#D6C7B0] hover:text-[#1A1A1A]"
                  >
                    {t("settings.developer.health") || "QA health JSON"}
                  </Link>
                  <Link
                    href="/api/qa/i18n"
                    className="inline-flex h-11 items-center rounded-full border border-[#E7DCCB] px-5 text-[13px] text-[#6F6A63] transition-colors hover:border-[#D6C7B0] hover:text-[#1A1A1A]"
                  >
                    {t("settings.developer.i18n") || "i18n JSON"}
                  </Link>
                </div>
              </div>
            ) : null}
          </SettingsCard>
        </main>
      </div>
    </div>
  );
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as T;
}

function SettingsCard({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mm-card p-6">
      <div className="mb-4 flex items-center gap-2">
        <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#1A1A1A] text-[#F5F1EB]">
          {icon}
        </span>
        <p className="eyebrow text-[#8C8780]">{label}</p>
      </div>
      {children}
    </section>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-10 flex-1 rounded-md text-sm transition-colors ${
        active
          ? "bg-[#1A1A1A] text-[#F5F1EB]"
          : "bg-[#EFE8DA] text-[#8C8780] hover:text-[#1A1A1A]"
      }`}
    >
      {children}
    </button>
  );
}

function DeveloperPanel({
  qaHealth,
  runtimeSnapshot,
}: {
  qaHealth: QaHealthResponse | null;
  runtimeSnapshot: RuntimeSnapshot | null;
}) {
  return (
    <div className="rounded-md border border-[#E7DCCB] bg-[#FFFCF7] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Gauge className="h-4 w-4 text-[#FF5924]" />
        <p className="text-[11px] uppercase tracking-[0.16em] text-[#8C8780]">
          Runtime diagnostics
        </p>
      </div>
      <div className="grid gap-2 text-[12px] md:grid-cols-2">
        <Metric label="Web" value={qaHealth?.web?.status ?? qaHealth?.status ?? "loading"} />
        <Metric label="Runtime" value={qaHealth?.web?.runtime ?? "loading"} />
        <Metric label="Worker" value={qaHealth?.worker?.status ?? "loading"} />
        <Metric
          label="QA routes"
          value={qaHealth?.qaRoutes ? String(qaHealth.qaRoutes.length) : "loading"}
        />
        <Metric label="DOM ready" value={formatMs(runtimeSnapshot?.domReadyMs)} />
        <Metric label="Load" value={formatMs(runtimeSnapshot?.loadMs)} />
        <Metric label="Viewport" value={runtimeSnapshot?.viewport ?? "loading"} />
        <Metric label="DPR" value={runtimeSnapshot ? String(runtimeSnapshot.dpr) : "loading"} />
        <Metric
          label="JS heap"
          value={
            runtimeSnapshot?.jsHeapMB === null || !runtimeSnapshot
              ? "n/a"
              : `${runtimeSnapshot.jsHeapMB} MB`
          }
        />
        <Metric
          label="Resources"
          value={
            runtimeSnapshot
              ? `${runtimeSnapshot.resourceCount} / ${runtimeSnapshot.slowResources} slow`
              : "loading"
          }
        />
        <Metric label="Transfer" value={formatMB(runtimeSnapshot?.transferMB)} />
        <Metric label="Network" value={runtimeSnapshot?.connection ?? "n/a"} />
      </div>
    </div>
  );
}

function I18nPanel({ audit }: { audit: I18nAuditResponse | null }) {
  const missing = audit?.missing ?? [];
  const topMissing = missing.slice(0, 8);
  const status = audit?.status ?? "loading";

  return (
    <div className="rounded-md border border-[#E7DCCB] bg-[#FFFCF7] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Languages className="h-4 w-4 text-[#FF5924]" />
          <p className="text-[11px] uppercase tracking-[0.16em] text-[#8C8780]">
            i18n tokens
          </p>
        </div>
        <span className="font-mono text-[11px] text-[#8C8780]">{status}</span>
      </div>

      <div className="grid gap-2 text-[12px] md:grid-cols-3">
        <Metric label="Dictionary" value={audit?.totalKeys ? String(audit.totalKeys) : "loading"} />
        <Metric label="Used" value={audit?.usedKeys ? String(audit.usedKeys) : "loading"} />
        <Metric
          label="Missing"
          value={audit?.missingCount === undefined ? "loading" : String(audit.missingCount)}
        />
      </div>

      {topMissing.length > 0 ? (
        <div className="mt-4 space-y-2">
          {topMissing.map((item) => (
            <div key={item.key} className="rounded bg-white/70 px-3 py-2">
              <p className="truncate font-mono text-[12px] text-[#1A1A1A]">{item.key}</p>
              <p className="mt-1 truncate font-mono text-[10px] text-[#8C8780]">
                {item.locations[0] ?? "unknown"}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded bg-white/70 px-3 py-2">
      <span className="shrink-0 text-[#8C8780]">{label}</span>
      <span className="truncate font-mono text-[#1A1A1A]">{value}</span>
    </div>
  );
}

function readRuntimeSnapshot(): RuntimeSnapshot {
  const performanceMemory = (
    performance as Performance & {
      memory?: {
        usedJSHeapSize?: number;
        jsHeapSizeLimit?: number;
      };
    }
  ).memory;
  const connection = (
    navigator as Navigator & {
      connection?: {
        effectiveType?: string;
      };
    }
  ).connection;
  const navigation = performance.getEntriesByType("navigation")[0] as
    | PerformanceNavigationTiming
    | undefined;
  const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
  const transferBytes = resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0);

  return {
    jsHeapMB: performanceMemory?.usedJSHeapSize
      ? Math.round(performanceMemory.usedJSHeapSize / 1024 / 1024)
      : null,
    jsHeapLimitMB: performanceMemory?.jsHeapSizeLimit
      ? Math.round(performanceMemory.jsHeapSizeLimit / 1024 / 1024)
      : null,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    dpr: window.devicePixelRatio || 1,
    connection: connection?.effectiveType ?? null,
    navigationType: navigation?.type ?? null,
    domReadyMs: navigation ? Math.round(navigation.domContentLoadedEventEnd) : null,
    loadMs: navigation?.loadEventEnd ? Math.round(navigation.loadEventEnd) : null,
    resourceCount: resources.length,
    slowResources: resources.filter((entry) => entry.duration > 750).length,
    transferMB: transferBytes > 0 ? Math.round((transferBytes / 1024 / 1024) * 10) / 10 : null,
  };
}

function formatMs(value: number | null | undefined): string {
  if (value === undefined) return "loading";
  if (value === null) return "n/a";
  return `${value} ms`;
}

function formatMB(value: number | null | undefined): string {
  if (value === undefined) return "loading";
  if (value === null) return "n/a";
  return `${value} MB`;
}
