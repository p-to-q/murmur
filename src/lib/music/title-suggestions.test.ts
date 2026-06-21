import { describe, expect, test } from "bun:test";
import {
  buildEnglishTitleCandidates,
  buildFallbackTitleSuggestions,
  buildZhTitleCandidates,
} from "./title-suggestions";

describe("title suggestions", () => {
  test("builds deterministic English titles from multi-part templates", () => {
    const context = {
      seed: "draft-title",
      genre: "city pop",
      mood: "nostalgic",
      scene: "for a midnight drive",
    };
    const first = buildEnglishTitleCandidates(context, 3);
    const second = buildEnglishTitleCandidates(context, 3);

    expect(first).toEqual(second);
    expect(first).toHaveLength(3);
    for (const title of first) {
      const wordCount = title.split(/\s+/).length;
      expect(wordCount).toBeGreaterThanOrEqual(2);
      expect(wordCount).toBeLessThanOrEqual(7);
    }
  });

  test("builds deterministic Chinese titles from cipai and guofeng templates", () => {
    const first = buildZhTitleCandidates(
      {
        seed: "draft-title",
        genre: "ambient electronic",
        mood: "serene",
      },
      12,
    );
    const second = buildZhTitleCandidates(
      {
        seed: "draft-title",
        genre: "ambient electronic",
        mood: "serene",
      },
      12,
    );

    expect(first).toEqual(second);
    expect(first).toHaveLength(12);
    expect(new Set(first).size).toBe(first.length);
    expect(first.some((title) => Array.from(title).length > 4)).toBe(true);
    for (const title of first) {
      expect(title).toMatch(/^[\u4e00-\u9fff]+$/);
      expect(Array.from(title).length).toBeGreaterThanOrEqual(3);
      expect(Array.from(title).length).toBeLessThanOrEqual(10);
    }
  });

  test("fallback suggestions follow the selected language", () => {
    expect(buildFallbackTitleSuggestions("en")[0]).toMatch(/[A-Za-z]/);
    expect(Array.from(buildFallbackTitleSuggestions("zh")[0]!).length).toBeGreaterThanOrEqual(3);
  });
});
