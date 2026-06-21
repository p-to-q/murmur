"use client";
import { createContext, createElement, useContext, useEffect, type ReactNode } from "react";
import { create } from "zustand";
import { type Lang, type TKey } from "./dict";
import { usePreferencesStore } from "@/lib/store/preferences-store";
import { renderTranslationToken } from "./translate";
import {
  DEFAULT_LANG,
  langToHtmlLang,
  LANGUAGE_COOKIE,
  resolveClientLang,
} from "./language";

function pickInitialLang(): Lang {
  if (typeof window === "undefined") return DEFAULT_LANG;
  return resolveClientLang({
    storedLang: readStoredLang(),
    hintedLang: document.documentElement.dataset.lang,
    hintedSource: document.documentElement.dataset.langSource,
    browserLanguages: [
      ...Array.from(window.navigator.languages ?? []),
      window.navigator.language,
    ],
  }).lang;
}

function readStoredLang(): string | null {
  try {
    return window.localStorage.getItem(LANGUAGE_COOKIE);
  } catch {
    return null;
  }
}

function persistLang(lang: Lang) {
  try {
    window.localStorage.setItem(LANGUAGE_COOKIE, lang);
  } catch {}

  try {
    document.cookie = `${LANGUAGE_COOKIE}=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch {}
}

interface I18nStore {
  lang: Lang;
  setLang: (l: Lang) => void;
  hydrated: boolean;
  markHydrated: () => void;
}

export const useI18nStore = create<I18nStore>((set) => ({
  // The server writes the first-page hint onto <html>. Components start from a
  // deterministic default, then the hydrator resolves stored/browser language.
  lang: DEFAULT_LANG,
  hydrated: false,
  setLang: (l) => {
    if (typeof window !== "undefined") {
      persistLang(l);
    }
    set({ lang: l });
  },
  markHydrated: () => set({ hydrated: true }),
}));

const I18nInitialLangContext = createContext<Lang>(DEFAULT_LANG);

export function I18nProvider({
  initialLang,
  children,
}: {
  initialLang: Lang;
  children: ReactNode;
}) {
  return createElement(
    I18nInitialLangContext.Provider,
    { value: initialLang },
    children,
  );
}

export function useCurrentLang(): Lang {
  const initialLang = useContext(I18nInitialLangContext);
  const lang = useI18nStore((s) => s.lang);
  const hydrated = useI18nStore((s) => s.hydrated);
  return hydrated ? lang : initialLang;
}

/**
 * Subscribe a component to the current language and return a translator.
 * Product mode renders localized copy and hides missing keys so component
 * fallbacks can render. Developer mode deliberately exposes raw keys as the
 * pre-render token layer.
 */
export function useTranslator(): (key: TKey | string) => string {
  const lang = useCurrentLang();
  const developerMode = usePreferencesStore((s) => s.developerMode);
  return (key) => renderTranslationToken(String(key), lang, developerMode ? "developer" : "product");
}

/**
 * Mount once at the app root — resolves the *real* initial language on the
 * client after hydration so we never differ from the server render.
 */
export function I18nHydrator() {
  const setLang = useI18nStore((s) => s.setLang);
  const markHydrated = useI18nStore((s) => s.markHydrated);
  useEffect(() => {
    const initial = pickInitialLang();
    if (initial !== useI18nStore.getState().lang) {
      setLang(initial);
    } else {
      persistLang(initial);
    }
    const html = document.documentElement;
    html.dataset.lang = initial;
    html.dataset.langSource = "client";
    html.lang = langToHtmlLang(initial);
    markHydrated();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const html = document.documentElement;
    const unsubscribe = useI18nStore.subscribe((state) => {
      html.dataset.lang = state.lang;
      html.lang = langToHtmlLang(state.lang);
    });
    return unsubscribe;
  }, []);
  return null;
}

export type { Lang } from "./dict";
export {
  DEFAULT_LANG,
  LANGUAGE_COOKIE,
  langToHtmlLang,
  pickLangFromAcceptLanguage,
  resolveInitialLang,
} from "./language";
