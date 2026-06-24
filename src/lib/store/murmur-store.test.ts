import { describe, expect, it } from "bun:test";

import {
  prepareVersionForDraftStorage,
  resolveRecoverableCreationRoute,
} from "./murmur-store";
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
    versionSeed: "seed_1",
    title: "Soft Return",
    vibe: "sunset",
    tags: ["soft", "warm"],
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

describe("creation draft store helpers", () => {
  it("routes Create back to the recoverable flow step", () => {
    const version = makeVersion();

    expect(
      resolveRecoverableCreationRoute({
        activeCreationRoute: null,
        currentVersion: null,
        vibeVersions: [version],
      }),
    ).toBe("/vibe");

    expect(
      resolveRecoverableCreationRoute({
        activeCreationRoute: null,
        currentVersion: version,
        vibeVersions: [version],
      }),
    ).toBe("/studio");

    expect(
      resolveRecoverableCreationRoute({
        activeCreationRoute: "/studio/name",
        currentVersion: version,
        vibeVersions: [version],
      }),
    ).toBe("/studio/name");
  });

  it("does not restore a Studio route without a picked version", () => {
    expect(
      resolveRecoverableCreationRoute({
        activeCreationRoute: "/studio",
        currentVersion: null,
        vibeVersions: [makeVersion()],
      }),
    ).toBe("/vibe");
  });

  it("strips session audio URLs before localStorage persistence", () => {
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

    const stored = prepareVersionForDraftStorage(version);

    expect(stored.generation?.audioUrl).toBeUndefined();
    expect(stored.generation?.status).toBe("pending");
    expect(version.generation?.audioUrl).toBe("blob:http://localhost/clip");
  });
});
