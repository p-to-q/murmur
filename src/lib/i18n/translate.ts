import { DICT, type Lang, type TKey } from "./dict";

export type TranslationToken =
  | {
      kind: "known";
      key: TKey;
      value: string;
    }
  | {
      kind: "missing";
      key: string;
      value: "";
    };

export type TranslationRenderMode = "product" | "developer";

export function resolveTranslationToken(key: string, lang: Lang): TranslationToken {
  const entry = (DICT as Record<string, { zh: string; en: string } | undefined>)[key];
  if (!entry) {
    return {
      kind: "missing",
      key,
      value: "",
    };
  }

  return {
    kind: "known",
    key: key as TKey,
    value: entry[lang] ?? entry.zh,
  };
}

export function renderTranslationToken(
  key: string,
  lang: Lang,
  mode: TranslationRenderMode,
): string {
  if (mode === "developer") return key;
  const token = resolveTranslationToken(key, lang);
  if (token.kind === "known") return token.value;
  return "";
}
