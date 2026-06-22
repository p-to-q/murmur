import { describe, expect, test } from "bun:test";
import { displayVibeLabel } from "@/lib/music/display-vibe";
import {
  buildEnglishTitleCandidates,
  buildFallbackTitleSuggestionBatch,
  buildFallbackTitleSuggestions,
  buildVersionTitleSuggestionBatch,
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

  test("Chinese name suggestions keep one English option per batch", () => {
    const first = buildFallbackTitleSuggestionBatch("zh", 0);
    const second = buildFallbackTitleSuggestionBatch("zh", 1);

    expect(first).toHaveLength(3);
    expect(first.slice(0, 2).every((title) => /^[\u4e00-\u9fff]+$/.test(title))).toBe(true);
    expect(first[2]).toMatch(/[A-Za-z]/);
    expect(second).toHaveLength(3);
    expect(second).not.toEqual(first);
    expect(second.slice(0, 2).every((title) => /^[\u4e00-\u9fff]+$/.test(title))).toBe(true);
    expect(second[2]).toMatch(/[A-Za-z]/);
  });

  test("English name suggestions stay English when refreshed", () => {
    const first = buildFallbackTitleSuggestionBatch("en", 0);
    const second = buildFallbackTitleSuggestionBatch("en", 1);

    expect(first).toHaveLength(3);
    expect(first.every((title) => /[A-Za-z]/.test(title))).toBe(true);
    expect(second).toHaveLength(3);
    expect(second).not.toEqual(first);
    expect(second.every((title) => /[A-Za-z]/.test(title))).toBe(true);
  });

  test("version name suggestion refreshes keep the selected language policy", () => {
    const version = {
      id: "version-1",
      versionSeed: "seed-1",
      title: "English Upstream Title",
      vibe: "city pop",
      tags: ["city pop", "nostalgic"],
      visualConfig: {
        visualFacets: {
          genre: "city pop",
          mood: "nostalgic",
          scene: "for a midnight drive",
        },
      },
    } as Parameters<typeof buildVersionTitleSuggestionBatch>[0];

    const zh = buildVersionTitleSuggestionBatch(version, "zh", 2);
    const en = buildVersionTitleSuggestionBatch(version, "en", 2);

    expect(zh.slice(0, 2).every((title) => /^[\u4e00-\u9fff]+$/.test(title))).toBe(true);
    expect(zh[2]).toMatch(/[A-Za-z]/);
    expect(en.every((title) => /[A-Za-z]/.test(title))).toBe(true);
  });

  test("saved magenta vibe display can localize genre labels", () => {
    expect(displayVibeLabel("mgt-demo", ["city pop"], "en")).toBe("City Pop");
    expect(displayVibeLabel("mgt-demo", ["city pop"], "zh")).toBe("灯火阑珊");
    expect(displayVibeLabel("rain", null, "zh")).toBe("雨天");
    expect(displayVibeLabel("rain", null, "en")).toBe("Rainy");
  });
});
