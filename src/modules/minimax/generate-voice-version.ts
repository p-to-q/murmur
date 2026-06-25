import type { CleanMelody, VibeVersion, VersionGeneration } from "@/modules/shared/types";
import { generateVoiceSong } from "@/lib/api/voice-generate";
import { createVibePromptBatch } from "@/lib/music/vibe-prompts";
import { log } from "@/lib/observability/log";
import { useMurmurStore } from "@/lib/store/murmur-store";
import { gradientFromPalette, pickArtworkSelection } from "@/presets/artworks/artwork-matcher";
import { generateVibeVersions } from "@/modules/strummer/generate-versions";

export interface MiniMaxVoiceVersionOptions {
  lyrics: string;
  draftId: string;
  originFlowId: string;
  language: "zh" | "en" | "unknown";
}

export function createMiniMaxVoiceVersion(
  options: MiniMaxVoiceVersionOptions,
): VibeVersion {
  const melody = placeholderVoiceMelody();
  const [scaffold] = generateVibeVersions(melody, {
    draftId: options.draftId,
    originFlowId: options.originFlowId,
    sourceType: "voice",
    sourceMelodyKind: "corrected",
  });
  const [spec] = createVibePromptBatch({
    seed: options.draftId,
    batchIndex: 0,
    count: 1,
    melody,
  });

  const versionId = scaffold?.id ?? crypto.randomUUID();
  const stylePrompt = spec?.prompt ?? "intimate indie pop, warm vocal, gentle drums";
  const generation: VersionGeneration = {
    engine: "minimax",
    prompt: stylePrompt,
    vibeLabel: spec?.label ?? { zh: "带词小歌", en: "Voice song" },
    status: "pending",
    durationSec: 0,
    batchIndex: 0,
    styleMix: 0,
    lyrics: options.lyrics,
    providerModel: "minimax:music-2.6",
    requestId: voiceGenerationRequestId(versionId),
    loop: false,
  };

  const artworkSeed = `${options.draftId}:voice:${versionId}`;
  const artwork = spec
    ? pickArtworkSelection(spec.visualFacets, artworkSeed, [], [])
    : null;
  const gradient = artwork?.palette?.length
    ? gradientFromPalette(artwork.palette, artworkSeed)
    : (spec?.gradient ?? "linear-gradient(148deg, #18313F 0%, #4A9B8E 48%, #D8E6D6 100%)");

  const version: VibeVersion = {
    ...scaffold!,
    id: versionId,
    title: spec?.title ?? "Voice Take",
    vibe: spec?.vibeId ?? "voice_song",
    tags: [...(spec?.tags ?? []), "voice"],
    visualConfig: {
      preset: spec?.visualPreset ?? "voice_song",
      gradient,
      particleDensity: spec?.energy ?? 0.5,
      pulseSource: "energy",
      visualFacets: spec?.visualFacets,
      artwork: artwork ?? undefined,
    },
    generation,
  };

  void requestVoiceGeneration(version);
  return version;
}

export function regenerateMiniMaxVoiceAudio(version: VibeVersion): void {
  if (version.generation?.engine !== "minimax") return;
  const requestId = voiceGenerationRequestId(version.id);
  const nextVersion: VibeVersion = {
    ...version,
    generation: {
      ...version.generation,
      status: "pending",
      error: undefined,
      requestId,
    },
  };
  patchGeneration(version.id, {
    status: "pending",
    error: undefined,
    requestId,
  });
  void requestVoiceGeneration(nextVersion);
}

async function requestVoiceGeneration(version: VibeVersion): Promise<void> {
  const generation = version.generation;
  if (!generation?.lyrics) return;
  const startedAt = performance.now();
  try {
    const result = await generateVoiceSong({
      lyrics: generation.lyrics,
      stylePrompt: generation.prompt,
      title: version.title,
      draftId: version.draftId,
      requestId: generation.requestId ?? voiceGenerationRequestId(version.id),
    });
    patchGeneration(version.id, {
      status: "ready",
      audioUrl: result.mp3Url,
      audioObjectKey: result.audioObjectKey,
      providerModel: result.providerModel,
      durationSec: result.durationSec ?? generation.durationSec,
      loop: false,
    });
    log("minimax.voice_ready", {
      versionId: version.id,
      providerModel: result.providerModel,
      durationSec: result.durationSec,
    }, {
      durationMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    patchGeneration(version.id, {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    log("minimax.voice_failed", {
      versionId: version.id,
      message: error instanceof Error ? error.message : String(error),
    }, {
      level: "warn",
      durationMs: Math.round(performance.now() - startedAt),
    });
  }
}

function voiceGenerationRequestId(versionId: string): string {
  return `voice:${versionId}:${crypto.randomUUID()}`;
}

function patchGeneration(
  versionId: string,
  patch: Partial<VersionGeneration>,
): void {
  const store = useMurmurStore.getState();
  const target = store.vibeVersions.find((v) => v.id === versionId);
  const fallback = store.currentVersion?.id === versionId ? store.currentVersion : null;
  const base = target ?? fallback;
  if (!base?.generation) return;

  const next: VibeVersion = {
    ...base,
    generation: { ...base.generation, ...patch },
  };
  if (target) {
    store.setVibeVersions(
      store.vibeVersions.map((v) => (v.id === versionId ? next : v)),
    );
  }
  if (store.currentVersion?.id === versionId) {
    store.setCurrentVersion(next);
  }
}

function placeholderVoiceMelody(): CleanMelody {
  return {
    notes: [
      {
        pitch: 60,
        start: 0,
        duration: 4,
        velocity: 0.72,
        confidence: 0.5,
      },
    ],
    key: "C",
    scale: "major",
    bpm: 84,
    duration: 4,
    contour: "flat",
  };
}
