import type { CleanMelody, VibeVersion, VersionGeneration } from "@/modules/shared/types";
import { generateVibeVersions } from "@/modules/strummer/generate-versions";
import { createVibePromptBatch } from "@/lib/music/vibe-prompts";
import { useMurmurStore } from "@/lib/store/murmur-store";
import { log } from "@/lib/observability/log";

/**
 * Magenta RealTime version flow.
 *
 * Builds three VibeVersions whose audio comes from the local Magenta worker
 * (via /api/music/generate) driven by randomized prompts, instead of the
 * Tone.js arrangement synth. The legacy generator still scaffolds each
 * version (arrangementState, strummerCode, melody) so the rest of the app —
 * studio, save payloads, gallery rows — keeps its data shape; only what you
 * *hear* changes.
 *
 * Versions return immediately with `generation.status === "pending"`; clips
 * stream in one by one and patch the store as they land. "换一批" calls this
 * again with `batchIndex + 1` for the next three prompts.
 */

export const MAGENTA_CLIP_SECONDS = 10;
export const DEFAULT_HUM_STYLE_MIX = 0.35;

// Negative results expire fast: one cold-start hiccup must not pin users
// to the legacy engine for a whole minute.
const HEALTH_TTL_AVAILABLE_MS = 60_000;
const HEALTH_TTL_UNAVAILABLE_MS = 10_000;

let healthCache: { at: number; available: boolean } | null = null;
let activeAbort: AbortController | null = null;
let liveObjectUrls: string[] = [];

/** Is the Magenta worker reachable? Cached; cheap to call. */
export async function checkMusicEngineAvailable(): Promise<boolean> {
  if (healthCache) {
    const ttl = healthCache.available
      ? HEALTH_TTL_AVAILABLE_MS
      : HEALTH_TTL_UNAVAILABLE_MS;
    if (Date.now() - healthCache.at < ttl) return healthCache.available;
  }
  let available = false;
  try {
    // Generous budget: in production this fetch traverses a cold Vercel
    // function plus the Cloudflare tunnel to the worker. Callers overlap
    // it with transcription, so the wait is usually free.
    const res = await fetch("/api/music/health", {
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { available?: boolean };
      available = data.available === true;
    }
  } catch {
    available = false;
  }
  healthCache = { at: Date.now(), available };
  return available;
}

export interface MagentaVersionOptions {
  draftId: string;
  originFlowId: string;
  sourceType: VibeVersion["sourceType"];
  sourceMelodyKind: VibeVersion["sourceMelodyKind"];
  /** 0 for the first three vibes; reroll passes previous + 1. */
  batchIndex: number;
  humBlob?: Blob | null;
}

/**
 * Create three pending Magenta versions and kick off their clip generation.
 * Returns synchronously; audio lands via store patches.
 */
export function createMagentaVersions(
  melody: CleanMelody,
  options: MagentaVersionOptions,
): VibeVersion[] {
  const scaffold = generateVibeVersions(melody, {
    draftId: options.draftId,
    originFlowId: options.originFlowId,
    sourceType: options.sourceType,
    sourceMelodyKind: options.sourceMelodyKind,
  });
  const prompts = createVibePromptBatch({
    seed: options.draftId,
    batchIndex: options.batchIndex,
    count: scaffold.length,
    melody,
  });

  const versions = scaffold.map((version, index) => {
    const spec = prompts[index]!;
    const generation: VersionGeneration = {
      engine: "magenta",
      prompt: spec.prompt,
      vibeLabel: spec.label,
      status: "pending",
      durationSec: MAGENTA_CLIP_SECONDS,
      batchIndex: options.batchIndex,
      styleMix: options.humBlob ? DEFAULT_HUM_STYLE_MIX : 0,
    };
    return {
      ...version,
      title: spec.title,
      vibe: spec.vibeId,
      tags: spec.tags,
      visualConfig: {
        preset: spec.visualPreset,
        gradient: spec.gradient,
        particleDensity: spec.energy,
        pulseSource: spec.energy > 0.6 ? "drums" : "melody",
      } satisfies VibeVersion["visualConfig"],
      generation,
    };
  });

  log("magenta.batch_started", {
    batchIndex: options.batchIndex,
    prompts: versions.map((v) => v.generation!.prompt),
    vibes: versions.map((v) => v.vibe),
    humStyled: !!options.humBlob,
  });

  startBatchGeneration(versions, options.humBlob ?? null);
  return versions;
}

/** Re-request audio for a single version (error-card retry). */
export function regenerateVersionAudio(version: VibeVersion): void {
  if (!version.generation) return;
  patchGeneration(version.id, { status: "pending", error: undefined });
  const humBlob = useMurmurStore.getState().humStyleBlob;
  void requestClip(version, humBlob, activeAbort?.signal ?? null);
}

function startBatchGeneration(versions: VibeVersion[], humBlob: Blob | null): void {
  activeAbort?.abort();
  const controller = new AbortController();
  activeAbort = controller;

  // Clips from a superseded batch are unreachable from the UI — release them.
  for (const url of liveObjectUrls) URL.revokeObjectURL(url);
  liveObjectUrls = [];

  for (const version of versions) {
    void requestClip(version, humBlob, controller.signal);
  }
}

async function requestClip(
  version: VibeVersion,
  humBlob: Blob | null,
  signal: AbortSignal | null,
): Promise<void> {
  const generation = version.generation!;
  const startedAt = performance.now();
  try {
    const form = new FormData();
    form.append("prompt", generation.prompt);
    form.append("duration", String(generation.durationSec));
    if (humBlob && generation.styleMix > 0) {
      form.append("styleMix", String(generation.styleMix));
      form.append("hum", humBlob, "hum.webm");
    }

    const res = await fetch("/api/music/generate", {
      method: "POST",
      body: form,
      signal: signal ?? undefined,
    });
    if (!res.ok) {
      throw new Error(`music generate HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    liveObjectUrls.push(url);
    const applied = patchGeneration(version.id, { status: "ready", audioUrl: url });
    if (!applied) {
      // Batch was replaced while this clip was in flight.
      URL.revokeObjectURL(url);
      liveObjectUrls = liveObjectUrls.filter((u) => u !== url);
      return;
    }
    log("magenta.clip_ready", {
      vibe: version.vibe,
      prompt: generation.prompt,
      bytes: blob.size,
    }, {
      durationMs: Math.round(performance.now() - startedAt),
    });
  } catch (error) {
    if (signal?.aborted) return;
    patchGeneration(version.id, {
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    log("magenta.clip_failed", {
      vibe: version.vibe,
      prompt: generation.prompt,
      message: error instanceof Error ? error.message : String(error),
    }, {
      level: "warn",
      durationMs: Math.round(performance.now() - startedAt),
    });
  }
}

/** Patch a version's generation in the store; false if it's no longer there. */
function patchGeneration(
  versionId: string,
  patch: Partial<VersionGeneration>,
): boolean {
  const store = useMurmurStore.getState();
  const target = store.vibeVersions.find((v) => v.id === versionId);
  const fallback = store.currentVersion?.id === versionId ? store.currentVersion : null;
  const base = target ?? fallback;
  if (!base?.generation) return false;

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
  return true;
}
