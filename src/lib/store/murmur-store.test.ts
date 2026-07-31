import { afterEach, describe, expect, it } from "bun:test";

import {
  CREATION_DRAFT_TTL_MS,
  isCreationDraftExpired,
  prepareVersionForDraftStorage,
  resolveRecoverableCreationRoute,
  sweepExpiredLocalCreationData,
  sweepStoredCreationDraft,
} from "./murmur-store";
import type { VibeVersion } from "@/modules/shared/types";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

afterEach(() => {
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

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
  it("bounds unsaved draft recovery to seven days", () => {
    const now = Date.parse("2026-07-30T00:00:00.000Z");

    expect(isCreationDraftExpired(now - CREATION_DRAFT_TTL_MS + 1, now)).toBe(
      false,
    );
    expect(isCreationDraftExpired(now - CREATION_DRAFT_TTL_MS, now)).toBe(true);
    expect(isCreationDraftExpired(null, now)).toBe(true);
  });

  it("removes a malformed stored draft during the next sweep", () => {
    const localStorage = new MemoryStorage();
    localStorage.setItem("murmur-creation-draft-v1", "{not-json");
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage },
    });

    expect(sweepStoredCreationDraft()).toBe(true);
    expect(localStorage.getItem("murmur-creation-draft-v1")).toBeNull();
  });

  it("removes an expired stored draft during the next sweep", () => {
    const now = Date.parse("2026-07-30T00:00:00.000Z");
    const localStorage = new MemoryStorage();
    localStorage.setItem(
      "murmur-creation-draft-v1",
      JSON.stringify({
        version: 1,
        state: {
          vibeVersions: [makeVersion()],
          currentVersion: null,
          currentDraftId: "draft_1",
          currentFlowId: "flow_1",
          activeCreationRoute: "/vibe",
          draftUpdatedAt: now - CREATION_DRAFT_TTL_MS,
        },
      }),
    );
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage },
    });

    expect(sweepStoredCreationDraft(now)).toBe(true);
    expect(localStorage.getItem("murmur-creation-draft-v1")).toBeNull();
  });

  it("preserves a valid draft inside its recovery window", () => {
    const now = Date.parse("2026-07-30T00:00:00.000Z");
    const localStorage = new MemoryStorage();
    const draft = JSON.stringify({
      version: 1,
      state: {
        vibeVersions: [makeVersion()],
        currentVersion: null,
        currentDraftId: "draft_1",
        currentFlowId: "flow_1",
        activeCreationRoute: "/vibe",
        draftUpdatedAt: now - CREATION_DRAFT_TTL_MS + 1,
      },
    });
    localStorage.setItem("murmur-creation-draft-v1", draft);
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage },
    });

    expect(sweepStoredCreationDraft(now)).toBe(true);
    expect(localStorage.getItem("murmur-creation-draft-v1")).toBe(draft);
  });

  it("attempts every local retention area during a startup sweep", async () => {
    const localStorage = new MemoryStorage();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage },
    });

    const result = await sweepExpiredLocalCreationData();

    expect(result.succeeded).toEqual(["creation-draft"]);
    expect(result.failed).toEqual(["last-recording", "generation-clips"]);
  });

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
        jobId: `mjob_${"b".repeat(32)}`,
      },
    });

    const stored = prepareVersionForDraftStorage(version);

    expect(stored.generation?.status).toBe("pending");
    expect(stored.generation?.audioUrl).toBeUndefined();
    expect(stored.generation?.operationId).toBe("op_clip_2");
    expect(stored.generation?.jobId).toBe(`mjob_${"b".repeat(32)}`);
  });
});
