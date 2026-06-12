"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { useTranslator } from "@/lib/i18n";
import { PageBackdrop } from "@/components/murmur/page-backdrop";

type AuthErrorCode = "Configuration" | "AccessDenied" | "Verification" | "Default";

function resolveMessageKey(error: string): string {
  switch (error as AuthErrorCode) {
    case "Configuration":
      return "auth.error.configuration";
    case "AccessDenied":
      return "auth.error.access_denied";
    default:
      return "auth.error.default";
  }
}

export function AuthErrorScreen({
  error,
  isLocal,
}: {
  error: string;
  isLocal: boolean;
}) {
  const t = useTranslator();
  const messageKey =
    error === "Configuration" && !isLocal
      ? "auth.error.configuration_prod"
      : resolveMessageKey(error);

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB]">
      <PageBackdrop variant="soft" />

      <div
        className="relative z-10 mx-auto flex min-h-svh max-w-lg flex-col justify-center px-6 pb-28 md:px-12"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 32px)" }}
      >
        <h1 className="hero-serif text-[36px] leading-[1.08] text-[#1A1A1A] md:text-[44px]">
          {t("auth.error.title")}
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-[#6F6A63]">
          {t(messageKey)}
        </p>

        <Link
          href="/"
          className="mt-10 inline-flex items-center gap-2 text-[13px] text-[#8C8780] transition-colors hover:text-[#1A1A1A]"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("auth.error.back")}
        </Link>
      </div>
    </div>
  );
}
