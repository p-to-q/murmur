"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { useTranslator } from "@/lib/i18n";
import { PageBackdrop } from "@/components/murmur/page-backdrop";

export function PrivacyScreen() {
  const t = useTranslator();

  const sections = [
    { title: "privacy.collect.title", body: "privacy.collect.body" },
    { title: "privacy.use.title", body: "privacy.use.body" },
    { title: "privacy.share.title", body: "privacy.share.body" },
    { title: "privacy.contact.title", body: "privacy.contact.body" },
  ] as const;

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
          {t("privacy.back")}
        </Link>

        <h1 className="hero-serif mt-8 text-[36px] leading-[1.08] text-[#1A1A1A] md:text-[44px]">
          {t("privacy.title")}
        </h1>
        <p className="font-serif-italic mt-4 text-[15px] leading-relaxed text-[#6F6A63]">
          {t("privacy.intro")}
        </p>

        <div className="mt-10 space-y-8">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-[#8C8780]">
                {t(section.title)}
              </h2>
              <p className="mt-3 text-[15px] leading-relaxed text-[#1A1A1A]/85">
                {t(section.body)}
              </p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
