import { describe, expect, it } from "bun:test";
import { parsePersistedDraft, parseVibeVersion } from "./draft-schema";

function track() {
  return {
    enabled: true,
    intensity: 1,
    originalPattern: "60 62",
    currentPattern: "60 62",
    instrument: "piano",
    versionHistory: [],
  };
}

function arrangement() {
  return {
    melody: track(),
    chords: track(),
    strings: track(),
    drums: track(),
    bass: track(),
    texture: track(),
  };
}

function visualConfig() {
  return {
    preset: "warm_particles",
    gradient: "linear-gradient(135deg, #FF8A5C, #FF5924)",
    particleDensity: 0.6,
    pulseSource: "melody",
  };
}

function melody() {
  return {
    notes: [{ pitch: 60, start: 0, duration: 0.5, velocity: 0.8, confidence: 0.9 }],
    key: "C",
    scale: "major",
    bpm: 88,
    duration: 12,
    contour: "wave",
  };
}

function validVersion(overrides: Record<string, unknown> = {}) {
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
    tags: ["soft"],
    melody: melody(),
    strummerCode: "code",
    arrangementState: arrangement(),
    visualConfig: visualConfig(),
    ...overrides,
  };
}

function envelope(state: Record<string, unknown>) {
  return { version: 1, state };
}

describe("parseVibeVersion", () => {
  it("parses a fully valid version", () => {
    const parsed = parseVibeVersion(validVersion());
    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe("ver_1");
    expect(parsed?.melody.notes).toHaveLength(1);
    expect(parsed?.arrangementState.texture.instrument).toBe("piano");
  });

  it("drops a version with a corrupt melody", () => {
    expect(parseVibeVersion(validVersion({ melody: { notes: "nope" } }))).toBeNull();
  });

  it("drops a version missing an arrangement track", () => {
    const broken = arrangement() as Record<string, unknown>;
    delete broken.drums;
    expect(parseVibeVersion(validVersion({ arrangementState: broken }))).toBeNull();
  });

  it("drops a version with an invalid visual config", () => {
    expect(
      parseVibeVersion(validVersion({ visualConfig: { ...visualConfig(), pulseSource: "chaos" } })),
    ).toBeNull();
  });

  it("drops a generated version whose generation block is corrupt", () => {
    expect(
      parseVibeVersion(
        validVersion({ generation: { engine: "magenta", status: "unknown-status" } }),
      ),
    ).toBeNull();
  });

  it("migrates unknown enum fields to safe defaults instead of dropping", () => {
    const parsed = parseVibeVersion(
      validVersion({ sourceType: "aliens", sourceMelodyKind: "bogus", editDepth: "nope", lineageDepth: -4 }),
    );
    expect(parsed?.sourceType).toBe("hum");
    expect(parsed?.sourceMelodyKind).toBe("corrected");
    expect(parsed?.editDepth).toBe("fresh");
    expect(parsed?.lineageDepth).toBe(0);
  });

  it("restores a legacy version with no generation block (Tone-era draft)", () => {
    const parsed = parseVibeVersion(validVersion());
    expect(parsed).not.toBeNull();
    expect(parsed?.generation).toBeUndefined();
  });

  it("restores a generation without an operationId (pre-#300 draft) and keeps identity when present", () => {
    const legacyGen = parseVibeVersion(
      validVersion({
        generation: {
          engine: "magenta",
          prompt: "warm",
          vibeLabel: { zh: "暖", en: "Warm" },
          status: "ready",
          durationSec: 10,
          batchIndex: 0,
          styleMix: 0.35,
        },
      }),
    );
    expect(legacyGen?.generation?.status).toBe("ready");
    expect(legacyGen?.generation?.operationId).toBeUndefined();

    const withIdentity = parseVibeVersion(
      validVersion({
        generation: {
          engine: "magenta",
          prompt: "warm",
          vibeLabel: { zh: "暖", en: "Warm" },
          status: "ready",
          durationSec: 10,
          batchIndex: 0,
          styleMix: 0.35,
          operationId: "op_1",
          batchOperationId: "op_batch",
        },
      }),
    );
    expect(withIdentity?.generation?.operationId).toBe("op_1");
    expect(withIdentity?.generation?.batchOperationId).toBe("op_batch");
  });
});

describe("parsePersistedDraft", () => {
  it("returns null for a wrong envelope version", () => {
    expect(parsePersistedDraft({ version: 99, state: { vibeVersions: [validVersion()] } }, 1)).toBeNull();
  });

  it("keeps valid versions and drops malformed ones from the same draft", () => {
    const parsed = parsePersistedDraft(
      envelope({
        vibeVersions: [validVersion({ id: "ok" }), validVersion({ id: "bad", melody: null }), { junk: true }],
        currentDraftId: "draft_1",
        activeCreationRoute: "/vibe",
      }),
      1,
    );
    expect(parsed?.vibeVersions.map((v) => v.id)).toEqual(["ok"]);
    expect(parsed?.activeCreationRoute).toBe("/vibe");
    expect(parsed?.currentDraftId).toBe("draft_1");
  });

  it("drops an invalid currentVersion but keeps a valid list", () => {
    const parsed = parsePersistedDraft(
      envelope({ vibeVersions: [validVersion()], currentVersion: { nope: 1 } }),
      1,
    );
    expect(parsed?.vibeVersions).toHaveLength(1);
    expect(parsed?.currentVersion).toBeNull();
  });

  it("returns null when every version is invalid", () => {
    const parsed = parsePersistedDraft(
      envelope({ vibeVersions: [{ id: "x" }, { melody: null }] }),
      1,
    );
    expect(parsed).toBeNull();
  });

  it("ignores an out-of-range activeCreationRoute", () => {
    const parsed = parsePersistedDraft(
      envelope({ vibeVersions: [validVersion()], activeCreationRoute: "/hacker" }),
      1,
    );
    expect(parsed?.activeCreationRoute).toBeNull();
  });
});
