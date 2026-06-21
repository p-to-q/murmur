"use client";

import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { MurmurLoadingNote } from "@/components/murmur/murmur-loading-note";
import { useTranslator } from "@/lib/i18n";

export function GlobalLoadingIndicator() {
  const t = useTranslator();

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div
        className="relative z-10 flex min-h-[var(--content-h)] items-center justify-center"
        role="status"
        aria-label={t("loading.aria")}
      >
        <MurmurLoadingNote size="page" decorative={false} />
      </div>
    </div>
  );
}
