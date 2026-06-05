import { describe, expect, it } from "bun:test";

import {
  bumpVersionEditState,
  deriveEditDepth,
  getEditDepthLabel,
  normalizeEditCount,
  resetVersionEditState,
} from "./edit-depth";
import type { VibeVersion } from "@/modules/shared/types";

const baseVersion: VibeVersion = {
  id: "v1",
  draftId: "d1",
  originFlowId: "f1",
  sourceType: "hum",
  sourceMelodyKind: "corrected",
  editCount: 0,
  editDepth: "fresh",
  versionSeed: "seed",
  title: "Test",
  vibe: "sunset",
  tags: [],
  melody: {
    notes: [],
    key: "C",
    scale: "major",
    bpm: 80,
    duration: 0,
    contour: "flat",
  },
  strummerCode: "",
  arrangementState: {
    melody: { enabled: true, intensity: 1, originalPattern: "", currentPattern: "", instrument: "piano", versionHistory: [] },
    chords: { enabled: true, intensity: 1, originalPattern: "", currentPattern: "", instrument: "piano", versionHistory: [] },
    strings: { enabled: true, intensity: 1, originalPattern: "", currentPattern: "", instrument: "pad", versionHistory: [] },
    drums: { enabled: true, intensity: 1, originalPattern: "", currentPattern: "", instrument: "kit", versionHistory: [] },
    bass: { enabled: true, intensity: 1, originalPattern: "", currentPattern: "", instrument: "bass", versionHistory: [] },
    texture: { enabled: true, intensity: 1, originalPattern: "", currentPattern: "", instrument: "air", versionHistory: [] },
  },
  visualConfig: {
    preset: "soft_gradient",
    gradient: "linear-gradient(135deg, #f6d365, #fda085)",
    particleDensity: 0.5,
    pulseSource: "energy",
  },
};

describe("edit-depth helpers", () => {
  it("derives depth buckets from edit count", () => {
    expect(deriveEditDepth(0)).toBe("fresh");
    expect(deriveEditDepth(2)).toBe("shaped");
    expect(deriveEditDepth(5)).toBe("reworked");
  });

  it("normalizes weird edit counts", () => {
    expect(normalizeEditCount(undefined)).toBe(0);
    expect(normalizeEditCount(-4)).toBe(0);
    expect(normalizeEditCount(2.6)).toBe(3);
  });

  it("bumps and resets version edit state", () => {
    const shaped = bumpVersionEditState(baseVersion, 2);
    expect(shaped.editCount).toBe(2);
    expect(shaped.editDepth).toBe("shaped");

    const reset = resetVersionEditState({ ...shaped, editCount: 5, editDepth: "reworked" });
    expect(reset.editCount).toBe(0);
    expect(reset.editDepth).toBe("fresh");
  });

  it("returns translated labels", () => {
    const t = (key: string) => key;
    expect(getEditDepthLabel("fresh", t)).toBe("edit_depth.fresh");
    expect(getEditDepthLabel("reworked", t)).toBe("edit_depth.reworked");
  });
});
