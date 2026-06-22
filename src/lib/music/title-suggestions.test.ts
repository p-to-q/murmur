import { describe, expect, test } from "bun:test";
import { displayVibeLabel } from "@/lib/music/display-vibe";
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
    const first = buildEnglishTitleCandidates(context, 12);
    const second = buildEnglishTitleCandidates(context, 12);

    expect(first).toEqual(second);
    expect(first).toHaveLength(12);
    expect(new Set(first).size).toBe(first.length);
    for (const title of first) {
      const wordCount = title.split(/\s+/).length;
      expect(title).toMatch(/[A-Za-z]/);
      expect(title).not.toMatch(/\bFind Blue Room\b/);
      expect(title).not.toMatch(/\bOnly One Midnight Guitar\b/);
      expect(wordCount).toBeGreaterThanOrEqual(2);
      expect(wordCount).toBeLessThanOrEqual(7);
    }
  });

  test("builds deterministic Chinese titles from cipai and guofeng templates", () => {
    const context = {
      seed: "draft-title",
      genre: "ambient electronic",
      mood: "serene",
    };
    const first = buildZhTitleCandidates(context, 12);
    const second = buildZhTitleCandidates(context, 12);

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
    expect(buildFallbackTitleSuggestions("zh")[0]).toMatch(/^[\u4e00-\u9fff]+$/);
  });

  test("saved magenta vibe display can localize genre labels", () => {
    expect(displayVibeLabel("mgt-demo", ["city pop"], "en")).toBe("City Pop");
    expect(displayVibeLabel("mgt-demo", ["city pop"], "zh")).toBe("灯火阑珊");
    expect(displayVibeLabel("rain", null, "zh")).toBe("雨天");
    expect(displayVibeLabel("rain", null, "en")).toBe("Rainy");
  });
});
