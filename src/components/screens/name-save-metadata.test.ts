import { describe, expect, it } from "bun:test";

import { buildNameSaveMetadata, buildSaveProvenance } from "./name-save-metadata";

describe("buildSaveProvenance", () => {
  it("persists the exact generated clip identity for later evidence linkage", () => {
    expect(buildSaveProvenance({
      originFlowId: "flow_1",
      draftId: "draft_1",
      sourceType: "hum",
      generation: {
        engine: "magenta",
        prompt: "warm",
        vibeLabel: { zh: "暖", en: "Warm" },
        status: "ready",
        durationSec: 10,
        batchIndex: 0,
        styleMix: 0.35,
        operationId: "clip_1",
        batchOperationId: "batch_1",
        audioSha256: "a".repeat(64),
      },
    })).toMatchObject({
      generationBatchId: "batch_1",
      generationClipId: "clip_1",
      generationAudioSha256: "a".repeat(64),
    });
  });
});

describe("buildNameSaveMetadata", () => {
  it("keeps generated English vibe metadata separate from the song title", () => {
    const metadata = buildNameSaveMetadata({
      vibe: "mgt-demo",
      tags: ["city pop", "nostalgic", "warm Rhodes piano"],
      visualConfig: {
        preset: "warm_particles",
        gradient: "linear-gradient(135deg, #FF8A5C, #FF5924)",
        particleDensity: 0.6,
        pulseSource: "melody",
        visualFacets: {
          genre: "city pop",
          mood: "nostalgic",
          instrument: "warm Rhodes piano",
          energy: 0.65,
        },
      },
      generation: {
        engine: "magenta",
        prompt: "nostalgic city pop, with warm Rhodes piano",
        vibeLabel: { zh: "灯火阑珊", en: "City Pop" },
        status: "ready",
        audioUrl: "blob:http://localhost/clip",
        durationSec: 12,
        batchIndex: 0,
        styleMix: 0.6,
      },
    });

    expect(metadata).toEqual({
      vibe: "mgt-demo",
      vibeEn: "City Pop",
    });
  });

  it("uses legacy preset English labels for structured versions", () => {
    const metadata = buildNameSaveMetadata({
      vibe: "rain",
      tags: ["soft keys", "rain air", "slow bass"],
      visualConfig: {
        preset: "rain_glass",
        gradient: "linear-gradient(135deg, #A7B8C8, #D8DDD8)",
        particleDensity: 0.5,
        pulseSource: "energy",
      },
    });

    expect(metadata).toEqual({
      vibe: "rain",
      vibeEn: "Rainy",
    });
  });

  it("falls back to the current version vibe so save payloads stay valid", () => {
    const metadata = buildNameSaveMetadata({
      vibe: "custom-ambient",
      tags: [],
      visualConfig: {
        preset: "soft_gradient",
        gradient: "linear-gradient(135deg, #A7B8C8, #D8DDD8)",
        particleDensity: 0.5,
        pulseSource: "melody",
      },
    });

    expect(metadata).toEqual({
      vibe: "custom-ambient",
      vibeEn: "custom-ambient",
    });
  });
});
