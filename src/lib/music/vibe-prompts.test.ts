import { describe, expect, test } from "bun:test";
import { createVibePromptBatch } from "./vibe-prompts";

describe("createVibePromptBatch", () => {
  test("returns the requested count with non-empty prompts and labels", () => {
    const batch = createVibePromptBatch({ seed: "draft-a", batchIndex: 0 });
    expect(batch).toHaveLength(3);
    for (const spec of batch) {
      expect(spec.prompt.length).toBeGreaterThan(10);
      expect(spec.label.zh.length).toBeGreaterThan(0);
      expect(spec.label.en.length).toBeGreaterThan(0);
      expect(spec.gradient).toContain("linear-gradient");
      expect(spec.energy).toBeGreaterThanOrEqual(0.25);
      expect(spec.energy).toBeLessThanOrEqual(0.9);
      expect(spec.visualPreset.length).toBeGreaterThan(0);
    }
  });

  test("is deterministic for the same seed and batch", () => {
    const a = createVibePromptBatch({ seed: "draft-a", batchIndex: 2 });
    const b = createVibePromptBatch({ seed: "draft-a", batchIndex: 2 });
    expect(a).toEqual(b);
  });

  test("different seeds give different batches", () => {
    const a = createVibePromptBatch({ seed: "draft-a", batchIndex: 0 });
    const b = createVibePromptBatch({ seed: "draft-b", batchIndex: 0 });
    expect(a.map((s) => s.prompt)).not.toEqual(b.map((s) => s.prompt));
  });

  test("consecutive batches never repeat a vibe (the 换一批 contract)", () => {
    const first = createVibePromptBatch({ seed: "draft-a", batchIndex: 0 });
    const second = createVibePromptBatch({ seed: "draft-a", batchIndex: 1 });
    const firstLabels = new Set(first.map((s) => s.label.en));
    for (const spec of second) {
      expect(firstLabels.has(spec.label.en)).toBe(false);
    }
  });

  test("no duplicate vibes inside one batch", () => {
    for (let i = 0; i < 8; i++) {
      const batch = createVibePromptBatch({ seed: "draft-x", batchIndex: i });
      const labels = batch.map((s) => s.label.en);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  test("melody hints flow into the prompt", () => {
    const slow = createVibePromptBatch({
      seed: "draft-a",
      batchIndex: 0,
      melody: { bpm: 60, scale: "minor" },
    });
    for (const spec of slow) {
      expect(spec.prompt).toContain("slow tempo");
      expect(spec.prompt).toContain("in a minor key");
    }
  });
});
