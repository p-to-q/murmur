import type { Lang } from "./dict";

export const DEFAULT_LANG: Lang = "en";
export const LANGUAGE_COOKIE = "murmur.lang";
export type LangSource = "stored" | "accept-language" | "default";
export type ClientLangSource = LangSource | "browser" | "client";

export interface InitialLangResolution {
  lang: Lang;
  source: LangSource;
}

export interface ClientLangResolution {
  lang: Lang;
  source: ClientLangSource;
}

export function isLang(value: unknown): value is Lang {
  return value === "zh" || value === "en";
}

export function langToHtmlLang(lang: Lang): "zh-CN" | "en" {
  return lang === "zh" ? "zh-CN" : "en";
}

export function normalizeLanguageTag(tag: string | null | undefined): Lang | null {
  if (!tag) return null;
  const normalized = tag.trim().toLowerCase().replace(/_/g, "-");
  if (!normalized) return null;

  const primary = normalized.split("-")[0];
  if (primary === "zh") return "zh";
  if (primary === "en") return "en";
  return null;
}

export function pickSupportedLang(tags: readonly (string | null | undefined)[]): Lang | null {
  for (const tag of tags) {
    const lang = normalizeLanguageTag(tag);
    if (lang) return lang;
  }
  return null;
}

export function pickLangFromAcceptLanguage(header: string | null | undefined): Lang | null {
  if (!header) return null;

  return pickSupportedLang(
    header
      .split(",")
      .map(parseAcceptLanguagePart)
      .filter((part) => part.q > 0)
      .sort((a, b) => b.q - a.q)
      .map((part) => part.tag),
  );
}

function parseAcceptLanguagePart(part: string): { tag: string; q: number } {
  const [tag = "", ...params] = part.trim().split(";");
  const qParam = params.find((param) => param.trim().toLowerCase().startsWith("q="));
  const q = qParam ? Number(qParam.trim().slice(2)) : 1;
  return {
    tag: tag.trim(),
    q: Number.isFinite(q) ? q : 0,
  };
}

export function resolveInitialLang({
  storedLang,
  acceptLanguage,
}: {
  storedLang?: string | null;
  acceptLanguage?: string | null;
}): Lang {
  return resolveInitialLangWithSource({ storedLang, acceptLanguage }).lang;
}

export function resolveInitialLangWithSource({
  storedLang,
  acceptLanguage,
}: {
  storedLang?: string | null;
  acceptLanguage?: string | null;
}): InitialLangResolution {
  if (isLang(storedLang)) {
    return { lang: storedLang, source: "stored" };
  }

  const acceptedLang = pickLangFromAcceptLanguage(acceptLanguage);
  if (acceptedLang) {
    return { lang: acceptedLang, source: "accept-language" };
  }

  return { lang: DEFAULT_LANG, source: "default" };
}

export function resolveClientLang({
  storedLang,
  hintedLang,
  hintedSource,
  browserLanguages,
}: {
  storedLang?: string | null;
  hintedLang?: string | null;
  hintedSource?: string | null;
  browserLanguages?: readonly (string | null | undefined)[];
}): ClientLangResolution {
  if (isLang(storedLang)) {
    return { lang: storedLang, source: "stored" };
  }

  if (isLang(hintedLang) && hintedSource !== "default") {
    return {
      lang: hintedLang,
      source: isClientLangSource(hintedSource) ? hintedSource : "client",
    };
  }

  const browserLang = pickSupportedLang(browserLanguages ?? []);
  if (browserLang) {
    return { lang: browserLang, source: "browser" };
  }

  if (isLang(hintedLang)) {
    return { lang: hintedLang, source: "default" };
  }

  return { lang: DEFAULT_LANG, source: "default" };
}

function isClientLangSource(value: unknown): value is ClientLangSource {
  return (
    value === "stored" ||
    value === "accept-language" ||
    value === "default" ||
    value === "browser" ||
    value === "client"
  );
}
