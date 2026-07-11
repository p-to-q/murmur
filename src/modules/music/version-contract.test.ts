import { describe, expect, it } from "bun:test";

import {
  canSaveHeardVersion,
  getSaveBlockReason,
  getVersionReadinessBlockReason,
  isVersionReadyForStudio,
} from "./version-contract";
import type { VibeVersion } from "@/modules/shared/types";

function makeVersion(overrides: Partial<VibeVersion> = {}): VibeVersion {
  return {
    id: "ver_1",
    draftId: "draft_1",
    originFlowId: "flow_1",
    lineageDepth: 0,
    sourceType: "hum",
    sourceMelodyKind: "corrected",
    editCount: 0,
    editDepth: "fresh",
    versionSeed: "seed",
    title: "Soft Return",
    vibe: "sunset",
    tags: [],
    melody: {
      notes: [],
      key: "C",
      scale: "major",
      bpm: 88,
      duration: 12,
      contour: "flat",
    },
    strummerCode: "code",
    arrangementState: {
      melody: {
        enabled: true,
        intensity: 1,
        originalPattern: "",
        currentPattern: "",
        instrument: "piano",
        versionHistory: [],
      },
      chords: {
        enabled: true,
        intensity: 1,
        originalPattern: "",
        currentPattern: "",
        instrument: "felt_piano",
        versionHistory: [],
      },
      strings: {
        enabled: true,
        intensity: 1,
        originalPattern: "",
        currentPattern: "",
        instrument: "strings",
        versionHistory: [],
      },
      drums: {
        enabled: true,
        intensity: 1,
        originalPattern: "",
        currentPattern: "",
        instrument: "kit",
        versionHistory: [],
      },
      bass: {
        enabled: true,
        intensity: 1,
        originalPattern: "",
        currentPattern: "",
        instrument: "bass",
        versionHistory: [],
      },
      texture: {
        enabled: true,
        intensity: 1,
        originalPattern: "",
        currentPattern: "",
        instrument: "texture",
        versionHistory: [],
      },
    },
    visualConfig: {
      preset: "warm_particles",
      gradient: "linear-gradient(135deg, #FF8A5C, #FF5924)",
      particleDensity: 0.6,
      pulseSource: "melody",
    },
    ...overrides,
  };
}

describe("version save contract", () => {
  it("allows legacy arrangement versions to save", () => {
    const version = makeVersion();
    expect(canSaveHeardVersion(version)).toBe(true);
    expect(isVersionReadyForStudio(version)).toBe(true);
    expect(getSaveBlockReason(version)).toBeNull();
    expect(getVersionReadinessBlockReason(version)).toBeNull();
  });

  it("blocks generated versions that are still pending", () => {
    const version = makeVersion({
      generation: {
        engine: "magenta",
        prompt: "soft evening",
        vibeLabel: { zh: "黄昏", en: "Sunset" },
        status: "pending",
        durationSec: 12,
        batchIndex: 0,
        styleMix: 0.6,
      },
    });

    expect(canSaveHeardVersion(version)).toBe(false);
    expect(isVersionReadyForStudio(version)).toBe(false);
    expect(getSaveBlockReason(version)).toBe("generation_pending");
    expect(getVersionReadinessBlockReason(version)).toBe("generation_pending");
  });

  it("blocks generated versions that failed to render", () => {
    const version = makeVersion({
      generation: {
        engine: "magenta",
        prompt: "soft evening",
        vibeLabel: { zh: "黄昏", en: "Sunset" },
        status: "error",
        durationSec: 12,
        batchIndex: 0,
        styleMix: 0.6,
        error: "worker timeout",
        errorCode: "server_error",
      },
    });

    expect(canSaveHeardVersion(version)).toBe(false);
    expect(isVersionReadyForStudio(version)).toBe(false);
    expect(getSaveBlockReason(version)).toBe("generation_failed");
    expect(getVersionReadinessBlockReason(version)).toBe("generation_failed");
  });

  it("allows generated versions only when the heard clip is concrete", () => {
    const version = makeVersion({
      generation: {
        engine: "magenta",
        prompt: "soft evening",
        vibeLabel: { zh: "黄昏", en: "Sunset" },
        status: "ready",
        audioUrl: "blob:http://localhost/clip",
        durationSec: 12,
        batchIndex: 0,
        styleMix: 0.6,
      },
    });

    expect(canSaveHeardVersion(version)).toBe(true);
    expect(isVersionReadyForStudio(version)).toBe(true);
    expect(getSaveBlockReason(version)).toBeNull();
    expect(getVersionReadinessBlockReason(version)).toBeNull();
  });
});
