"use client";

import { useEffect } from "react";
import { Home, RotateCcw } from "lucide-react";

import { useTranslator } from "@/lib/i18n";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { FloatingMusicNotes } from "@/components/murmur/floating-music-notes";
import { MurmurMark } from "@/components/murmur/murmur-mark";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslator();

  useEffect(() => {
    console.error("[app-error-boundary]", error);
  }, [error]);

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div className="relative z-10 flex min-h-svh items-center justify-center px-5 py-16 text-center md:px-8">
        <section className="relative flex w-full max-w-[560px] flex-col items-center">
          <div className="mb-1">
            <MurmurMark size={30} imageClassName="opacity-90" />
          </div>

          <div className="relative mt-5 flex h-32 w-32 items-center justify-center md:h-36 md:w-36">
            <div className="absolute inset-0 rounded-full border border-white/70 bg-white/40 shadow-[0_18px_70px_rgba(26,26,26,0.08)]" />
            <FloatingMusicNotes size={132} className="relative opacity-35" />
          </div>

          <p className="mt-7 text-[11px] uppercase tracking-[0.24em] text-[#9A948B]">
            {t("error.eyebrow")}
          </p>
          <h1 className="hero-serif mt-3 text-[38px] leading-[1.04] text-[#1A1A1A] md:text-[58px]">
            {t("error.title")}
          </h1>
          <p className="mt-5 max-w-[460px] text-[15px] leading-7 text-[#6F6A63] md:text-[16px]">
            {t("error.body")}
          </p>
          {error.digest && (
            <p className="mt-4 rounded-full border border-[#E5DDD0]/70 bg-white/40 px-3 py-1.5 text-[11px] tracking-[0.06em] text-[#9A948B]">
              {t("error.digest").replace("{id}", error.digest)}
            </p>
          )}

          <div className="mt-9 flex w-full max-w-[360px] flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
            <button type="button" onClick={reset} className="mm-btn-primary justify-center">
              <RotateCcw className="size-4" aria-hidden="true" />
              {t("error.retry")}
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-[#D8CFBF]/80 bg-white/45 px-5 py-3.5 text-[14px] font-medium text-[#6F6A63] transition-colors hover:border-[#BFB4A2] hover:bg-white/70 hover:text-[#1A1A1A]"
            >
              <Home className="size-4" aria-hidden="true" />
              {t("error.home")}
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
