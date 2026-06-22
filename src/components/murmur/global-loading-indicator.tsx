"use client";

import { MurmurLoadingNote } from "@/components/murmur/murmur-loading-note";
import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { useTranslator } from "@/lib/i18n";

export function GlobalLoadingIndicator() {
  const t = useTranslator();

  return (
    <div className="relative overflow-hidden bg-[#F5F1EB]" style={{ minHeight: "var(--content-h)" }}>
      <PageBackdrop variant="soft" />

      <div
        className="relative z-10 flex items-center justify-center"
        style={{ minHeight: "var(--content-h)" }}
        role="status"
        aria-label={t("loading.aria")}
      >
        <MurmurLoadingNote size="page" decorative={false} />
      </div>
    </div>
  );
}
