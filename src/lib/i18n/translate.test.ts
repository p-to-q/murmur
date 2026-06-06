import { describe, expect, it } from "bun:test";
import { renderTranslationToken, resolveTranslationToken } from "./translate";

describe("translation token rendering", () => {
  it("renders localized copy in product mode", () => {
    expect(renderTranslationToken("settings.title", "zh", "product")).toBe("设置");
    expect(renderTranslationToken("settings.title", "en", "product")).toBe("Settings");
  });

  it("hides missing keys in product mode so component fallbacks can render", () => {
    expect(renderTranslationToken("missing.example", "zh", "product")).toBe("");
  });

  it("renders raw keys in developer mode before localization", () => {
    expect(renderTranslationToken("settings.title", "zh", "developer")).toBe("settings.title");
    expect(renderTranslationToken("missing.example", "en", "developer")).toBe("missing.example");
  });

  it("resolves known and missing tokens as typed states", () => {
    expect(resolveTranslationToken("settings.title", "zh").kind).toBe("known");
    expect(resolveTranslationToken("missing.example", "zh").kind).toBe("missing");
  });
});
