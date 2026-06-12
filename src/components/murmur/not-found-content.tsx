"use client";

import Link from "next/link";

import { useTranslator } from "@/lib/i18n";
import { PageBackdrop } from "@/components/murmur/page-backdrop";

export function NotFoundContent() {
  const t = useTranslator();

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div className="relative z-10 flex min-h-svh flex-col items-center justify-center px-6 text-center">
        <p className="text-[11px] uppercase tracking-[0.22em] text-[#8C8780]">
          {t("not_found.code")}
        </p>
        <h1 className="hero-serif mt-4 text-[36px] leading-[1.08] text-[#1A1A1A] md:text-[52px]">
          {t("not_found.title")}
        </h1>
        <p className="font-serif-italic mt-4 max-w-[420px] text-[15px] text-[#6F6A63]">
          {t("not_found.body")}
        </p>

        <div className="mt-9 flex items-center gap-5">
          <Link href="/" className="mm-btn-primary">
            {t("not_found.home")}
          </Link>
          <Link
            href="/gallery"
            className="text-[13px] tracking-[0.04em] text-[#8C8780] underline decoration-[#D2C9B6] underline-offset-4 transition-colors hover:text-[#1A1A1A]"
          >
            {t("not_found.gallery")}
          </Link>
        </div>
      </div>
    </div>
  );
}
