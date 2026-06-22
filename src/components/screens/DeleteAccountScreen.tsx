"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { useTranslator } from "@/lib/i18n";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { useCurrentAccount } from "@/lib/hooks/use-current-account";

export function DeleteAccountScreen() {
  const t = useTranslator();
  const { isRegistered } = useCurrentAccount();

  const steps = ["delete.steps.1", "delete.steps.2", "delete.steps.3"] as const;

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div
        className="relative z-10 mx-auto max-w-2xl px-6 pb-28 md:px-12"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 32px)" }}
      >
        <Link
          href="/me"
          className="inline-flex items-center gap-2 text-[13px] text-[#8C8780] transition-colors hover:text-[#1A1A1A]"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("delete.back")}
        </Link>

        <h1 className="hero-serif mt-8 text-[36px] leading-[1.08] text-[#1A1A1A] md:text-[44px]">
          {t("delete.title")}
        </h1>
        <p className="font-serif-italic mt-4 text-[15px] leading-relaxed text-[#6F6A63]">
          {t("delete.intro")}
        </p>

        {!isRegistered && (
          <p className="mt-6 rounded-[16px] border border-[#E5DDD0] bg-white/60 px-4 py-3 text-[14px] text-[#6F6A63]">
            {t("delete.sign_in")}
          </p>
        )}

        <section className="mt-10">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#8C8780]">
            {t("delete.steps.title")}
          </h2>
          <ol className="mt-4 space-y-3">
            {steps.map((key, i) => (
              <li key={key} className="flex gap-3 text-[15px] leading-relaxed text-[#1A1A1A]/85">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1A1A1A] text-[11px] font-semibold text-white">
                  {i + 1}
                </span>
                {t(key)}
              </li>
            ))}
          </ol>
        </section>

        <div className="mt-10">
          <button
            type="button"
            disabled
            className="mm-btn-primary w-full max-w-sm opacity-60 cursor-not-allowed"
            aria-disabled="true"
          >
            {t("delete.cta")}
          </button>
          <p className="mt-4 max-w-sm text-[13px] leading-relaxed text-[#8C8780]">
            {t("delete.cta.pending")}
          </p>
        </div>
      </div>
    </div>
  );
}
