import { describe, expect, it } from "bun:test";
import {
  normalizeLanguageTag,
  pickLangFromAcceptLanguage,
  resolveClientLang,
  resolveInitialLang,
  resolveInitialLangWithSource,
} from "./language";

describe("language negotiation", () => {
  it("normalizes supported browser language tags", () => {
    expect(normalizeLanguageTag("zh-CN")).toBe("zh");
    expect(normalizeLanguageTag("zh_Hant_TW")).toBe("zh");
    expect(normalizeLanguageTag("en-US")).toBe("en");
  });

  it("ignores unsupported languages", () => {
    expect(normalizeLanguageTag("ja-JP")).toBeNull();
    expect(normalizeLanguageTag("fr")).toBeNull();
  });

  it("picks the first supported language from Accept-Language", () => {
    expect(pickLangFromAcceptLanguage("fr-FR,zh-CN;q=0.9,en;q=0.8")).toBe("zh");
    expect(pickLangFromAcceptLanguage("ja-JP,en-US;q=0.9")).toBe("en");
  });

  it("honors Accept-Language quality weights", () => {
    expect(pickLangFromAcceptLanguage("en-US;q=0.6,zh-CN;q=0.9")).toBe("zh");
    expect(pickLangFromAcceptLanguage("zh-CN;q=0,en-US;q=0.8")).toBe("en");
  });

  it("keeps explicit stored language above browser hints", () => {
    expect(
      resolveInitialLang({
        storedLang: "zh",
        acceptLanguage: "en-US,en;q=0.9",
      }),
    ).toBe("zh");
  });

  it("falls back to English when no supported hint exists", () => {
    expect(
      resolveInitialLang({
        storedLang: null,
        acceptLanguage: "ja-JP,fr-FR;q=0.9",
      }),
    ).toBe("en");
  });

  it("reports the source of the server-side language decision", () => {
    expect(resolveInitialLangWithSource({
      storedLang: "zh",
      acceptLanguage: "en-US",
    })).toEqual({ lang: "zh", source: "stored" });
    expect(resolveInitialLangWithSource({
      storedLang: null,
      acceptLanguage: "zh-CN,zh;q=0.9",
    })).toEqual({ lang: "zh", source: "accept-language" });
    expect(resolveInitialLangWithSource({
      storedLang: "fr",
      acceptLanguage: "ja-JP",
    })).toEqual({ lang: "en", source: "default" });
  });

  it("keeps client localStorage above server and browser hints", () => {
    expect(resolveClientLang({
      storedLang: "zh",
      hintedLang: "en",
      hintedSource: "accept-language",
      browserLanguages: ["en-US"],
    })).toEqual({ lang: "zh", source: "stored" });
  });

  it("keeps non-default server hints above browser hints on first hydration", () => {
    expect(resolveClientLang({
      storedLang: null,
      hintedLang: "zh",
      hintedSource: "accept-language",
      browserLanguages: ["en-US"],
    })).toEqual({ lang: "zh", source: "accept-language" });
  });

  it("uses browser language before a default server fallback", () => {
    expect(resolveClientLang({
      storedLang: null,
      hintedLang: "en",
      hintedSource: "default",
      browserLanguages: ["zh-CN", "en-US"],
    })).toEqual({ lang: "zh", source: "browser" });
  });

  it("keeps the default server fallback when browser languages are unsupported", () => {
    expect(resolveClientLang({
      storedLang: null,
      hintedLang: "en",
      hintedSource: "default",
      browserLanguages: ["ja-JP", "fr-FR"],
    })).toEqual({ lang: "en", source: "default" });
  });
});
