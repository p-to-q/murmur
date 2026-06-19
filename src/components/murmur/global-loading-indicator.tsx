"use client";

import { PageBackdrop } from "@/components/murmur/page-backdrop";
import { Spinner } from "@/components/ui/spinner";
import { useTranslator } from "@/lib/i18n";

export function GlobalLoadingIndicator() {
  const t = useTranslator();

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div className="relative z-10 flex min-h-svh items-center justify-center">
        <Spinner size="lg" aria-label={t("loading.aria")} />
      </div>
    </div>
  );
}
