"use client";

import { useEffect } from "react";
import { Home, RotateCcw } from "lucide-react";

import { useTranslator } from "@/lib/i18n";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { MurmurMark } from "@/components/murmur/murmur-mark";

export default function MeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslator();

  useEffect(() => {
    console.error("[me-error-boundary]", error);
  }, [error]);

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div className="relative z-10 flex min-h-svh items-center justify-center px-5 py-16 text-center md:px-8">
        <section className="relative flex w-full max-w-[560px] flex-col items-center">
          <div className="mb-7">
            <MurmurMark size={52} imageClassName="opacity-95" />
          </div>

          <h1 className="hero-serif text-[38px] leading-[1.04] text-[#1A1A1A] md:text-[58px]">
            {t("error.title") || "This page ran into a problem."}
          </h1>
          <p className="mt-5 max-w-[460px] whitespace-pre-line text-[15px] leading-7 text-[#6F6A63] md:text-[16px]">
            {t("error.body")
              || "Your saved songs are still here.\nIf you were recording or editing, reload first. If it still will not open, head home."}
          </p>
          {error.digest && (
            <p className="mt-4 rounded-full border border-[#E5DDD0]/70 bg-white/40 px-3 py-1.5 text-[11px] tracking-[0.06em] text-[#9A948B]">
              {t("error.digest").replace("{id}", error.digest)}
            </p>
          )}

          <div className="mt-9 flex w-full max-w-[360px] flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
            <button type="button" onClick={reset} className="mm-btn-primary justify-center">
              <RotateCcw className="size-4" aria-hidden="true" />
              {t("error.retry") || "Reload"}
            </button>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-[#D8CFBF]/80 bg-white/45 px-5 py-3.5 text-[14px] font-medium text-[#6F6A63] transition-colors hover:border-[#BFB4A2] hover:bg-white/70 hover:text-[#1A1A1A]"
            >
              <Home className="size-4" aria-hidden="true" />
              {t("error.home") || "Back home"}
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
