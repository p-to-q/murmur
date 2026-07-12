"use client";

import { useCurrentLang, useI18nStore } from "@/lib/i18n";
import { MurmurMark } from "./murmur-mark";

export function MobileTopBar() {
  const lang = useCurrentLang();
  const setLang = useI18nStore((s) => s.setLang);

  return (
    <header
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-between md:hidden pointer-events-none"
      aria-label="App header"
      style={{
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 14px)",
        paddingLeft: 20,
        paddingRight: 20,
      }}
    >
      <MurmurMark size={22} className="pointer-events-auto" />

      <div className="pointer-events-auto flex items-baseline gap-1.5">
        <button
          type="button"
          onClick={() => setLang("zh")}
          aria-pressed={lang === "zh"}
          aria-label="Switch language to Chinese"
          className={`text-[13px] transition-colors ${
            lang === "zh"
              ? "text-[#1A1A1A]"
              : "text-[#B6B0A4] hover:text-[#1A1A1A]"
          }`}
        >
          中
        </button>
        <span className="text-[16px] leading-none text-[#B6B0A4]" aria-hidden="true">/</span>
        <button
          type="button"
          onClick={() => setLang("en")}
          aria-pressed={lang === "en"}
          aria-label="Switch language to English"
          className={`text-[13px] transition-colors ${
            lang === "en"
              ? "text-[#1A1A1A]"
              : "text-[#B6B0A4] hover:text-[#1A1A1A]"
          }`}
        >
          EN
        </button>
      </div>
    </header>
  );
}
