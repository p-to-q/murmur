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

  it("keeps a ready clip ready and preserves its operation identity (#300)", () => {
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
        operationId: "op_clip_1",
        batchOperationId: "op_batch_1",
      },
    });

    const stored = prepareVersionForDraftStorage(version);

    // The ephemeral blob URL is dropped...
    expect(stored.generation?.audioUrl).toBeUndefined();
    // ...but the clip stays READY (not turned back into a fresh, re-charged
    // pending) and keeps its stable operation identity for durable recovery.
    expect(stored.generation?.status).toBe("ready");
    expect(stored.generation?.operationId).toBe("op_clip_1");
    expect(stored.generation?.batchOperationId).toBe("op_batch_1");
    // The live in-memory version is untouched.
    expect(version.generation?.audioUrl).toBe("blob:http://localhost/clip");
  });

  it("keeps a pending clip pending and preserves its operation identity (#300)", () => {
    const version = makeVersion({
      generation: {
        engine: "magenta",
        prompt: "soft evening",
        vibeLabel: { zh: "黄昏", en: "Sunset" },
        status: "pending",
        durationSec: 12,
        batchIndex: 0,
        styleMix: 0.6,
        operationId: "op_clip_2",
      },
    });

    const stored = prepareVersionForDraftStorage(version);

    expect(stored.generation?.status).toBe("pending");
    expect(stored.generation?.audioUrl).toBeUndefined();
    expect(stored.generation?.operationId).toBe("op_clip_2");
  });
});
