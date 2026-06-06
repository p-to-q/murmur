"use client";
import { useEffect } from "react";
import { create } from "zustand";
import { type Lang, type TKey } from "./dict";
import { usePreferencesStore } from "@/lib/store/preferences-store";
import { renderTranslationToken } from "./translate";

const STORAGE_KEY = "murmur.lang";

function pickInitialLang(): Lang {
  if (typeof window === "undefined") return "zh";
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === "zh" || stored === "en") return stored;
  const nav = (window.navigator.language || "").toLowerCase();
  return nav.startsWith("zh") ? "zh" : "en";
}

interface I18nStore {
  lang: Lang;
  setLang: (l: Lang) => void;
}

export const useI18nStore = create<I18nStore>((set) => ({
  // Default to "zh" during SSR so the markup is deterministic. The client
  // picks the real value in a one-shot effect to avoid hydration mismatch.
  lang: "zh",
  setLang: (l) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, l);
    }
    set({ lang: l });
  },
}));

/**
 * Subscribe a component to the current language and return a translator.
 * Product mode renders localized copy and hides missing keys so component
 * fallbacks can render. Developer mode deliberately exposes raw keys as the
 * pre-render token layer.
 */
export function useTranslator(): (key: TKey | string) => string {
  const lang = useI18nStore((s) => s.lang);
  const developerMode = usePreferencesStore((s) => s.developerMode);
  return (key) => renderTranslationToken(String(key), lang, developerMode ? "developer" : "product");
}

/**
 * Mount once at the app root — resolves the *real* initial language on the
 * client after hydration so we never differ from the server render.
 */
export function I18nHydrator() {
  const setLang = useI18nStore((s) => s.setLang);
  useEffect(() => {
    const initial = pickInitialLang();
    if (initial !== useI18nStore.getState().lang) setLang(initial);
    const html = document.documentElement;
    html.dataset.lang = initial;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const html = document.documentElement;
    const unsubscribe = useI18nStore.subscribe((state) => {
      html.dataset.lang = state.lang;
    });
    return unsubscribe;
  }, []);
  return null;
}

export type { Lang } from "./dict";
