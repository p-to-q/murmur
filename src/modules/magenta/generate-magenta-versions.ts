import type {
  CleanMelody,
  VersionGeneration,
  VersionGenerationErrorCode,
  VibeVersion,
} from "@/modules/shared/types";
import { generateVibeVersions } from "@/modules/strummer/generate-versions";
import { createVibePromptBatch } from "@/lib/music/vibe-prompts";
import { useMurmurStore } from "@/lib/store/murmur-store";
import {
  deleteClipArtifact,
  loadClipArtifact,
  persistClipArtifact,
} from "@/lib/store/generation-artifact-store";
import { log } from "@/lib/observability/log";
import { pickArtworkSelection, gradientFromPalette } from "@/presets/artworks/artwork-matcher";
import { sendBrowserNotification } from "@/lib/hooks/use-browser-notification";
import { addMurmurNotification } from "@/lib/store/notification-store";
import { useI18nStore } from "@/lib/i18n";
import { songGeneratedNotificationCopy } from "@/lib/notifications/notification-copy";
import { request } from "@/lib/api/request";
import {
  durableMusicJobsEnabled,
  requestDurableMusicAudio,
} from "@/lib/api/music-jobs";

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
const HEALTH_PROBE_TIMEOUT_MS = 13_500;
const HEALTH_RETRY_DELAYS_MS = [0, 1000] as const;
// A dead connection would otherwise leave the card pending forever: the
// server's own ceiling is maxDuration=300s, so anything past that (plus
// margin) can only be a hung socket — resolve it into the error card's
// retry affordance instead.
const GENERATE_FETCH_TIMEOUT_MS = 320_000;

export type MusicEngineStatus = {
  configured: boolean;
  available: boolean;
  reason: string | null;
  /**
   * Coarse queue-wait estimate (ms) from /api/music/health, derived from
   * RunPod queue depth + a cold-start penalty. Null when the transport does
   * not expose it (HTTP/legacy) or the queue shape was unreadable. Surfaced in
   * VibeScreen so cold-start waits read as "in queue", not a hang (issue #216).
   */
  estimatedWaitMs: number | null;
};

let healthCache: { at: number; status: MusicEngineStatus } | null = null;
let inflightStatusProbe: Promise<MusicEngineStatus> | null = null;
let activeAbort: AbortController | null = null;
let activeBatchId: string | null = null;
let liveObjectUrls: string[] = [];

export type GenerationCancellationKind = "navigation" | "background";

const BACKGROUND_CANCELLATION_REASON = "murmur:background-generation-canceled";

export function invalidateMusicEngineCache(): void {
  healthCache = null;
}

/**
 * Abort any in-flight generation requests. Navigation cancellation stays
 * silent because the screen is leaving; sustained background cancellation
 * settles pending cards into an explicit retry state for foreground recovery.
 */
export function cancelActiveGeneration(
  kind: GenerationCancellationKind = "navigation",
): void {
  if (activeAbort) {
    activeAbort.abort(
      kind === "background" ? BACKGROUND_CANCELLATION_REASON : undefined,
    );
    activeAbort = null;
  }
  activeBatchId = null;
}

/** Warm the status cache as soon as the hum screen mounts. */
export function prefetchMusicEngineStatus(): void {
  void fetchMusicEngineStatus(true);
}

/**
 * Should this flow use Magenta instead of the legacy Tone.js engine?
 *
 * Live Hum treats Magenta as required and surfaces a retryable engine state
 * when this returns false. Legacy/demo seeds can still use Tone scaffolds.
 */
export async function shouldUseMagentaEngine(): Promise<boolean> {
  const status = await fetchMusicEngineStatus();
  return status.available;
}

/** Is the worker process answering health right now? Cached; cheap to call. */
export async function checkMusicEngineAvailable(): Promise<boolean> {
  const status = await fetchMusicEngineStatus();
  return status.available;
}

/**
 * Read the current health verdict without any network activity. Returns null
 * when the cache is empty or stale; callers that need a definitive answer
 * still await fetchMusicEngineStatus.
 */
export function getCachedMusicEngineStatus(): MusicEngineStatus | null {
  if (!healthCache) return null;
  const ttl = healthCache.status.available
    ? HEALTH_TTL_AVAILABLE_MS
    : HEALTH_TTL_UNAVAILABLE_MS;
  return Date.now() - healthCache.at < ttl ? healthCache.status : null;
}

export async function fetchMusicEngineStatus(force = false): Promise<MusicEngineStatus> {
  if (!force) {
    const cached = getCachedMusicEngineStatus();
    if (cached) return cached;
  }

  // Concurrent callers (screen-mount prefetch, submit-time gate, remix gate)
  // share one short probe loop instead of each fanning out their own retries
  // against /api/music/health — which itself calls upstream. Keep this tight:
  // Hum submit is a user-facing transition, not a background monitor.
  if (inflightStatusProbe) return inflightStatusProbe;

  inflightStatusProbe = (async () => {
    let lastStatus: MusicEngineStatus = {
      configured: false,
      available: false,
      reason: "unreachable",
      estimatedWaitMs: null,
    };

    for (const delayMs of HEALTH_RETRY_DELAYS_MS) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      const status = await probeHealthOnce();
      if (!status) continue;
      lastStatus = status;
      if (status.available) {
        healthCache = { at: Date.now(), status };
        return status;
      }
    }

    healthCache = { at: Date.now(), status: lastStatus };
    return lastStatus;
  })();

  try {
    return await inflightStatusProbe;
  } finally {
    inflightStatusProbe = null;
  }
}

async function probeHealthOnce(): Promise<MusicEngineStatus | null> {
  try {
    const res = await request("/api/music/health", {
      signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) {
      return {
        configured: false,
        available: false,
        reason: `http_${res.status}`,
        estimatedWaitMs: null,
      };
    }
    const data = (await res.json()) as {
      available?: boolean;
      configured?: boolean;
      reason?: string | null;
      estimatedWaitMs?: number | null;
    };
    return {
      configured: data.configured === true,
      available: data.available === true,
      reason: data.reason ?? null,
      estimatedWaitMs:
        typeof data.estimatedWaitMs === "number" ? data.estimatedWaitMs : null,
    };
  } catch {
    return null;
  }
}

export interface MagentaVersionOptions {
  draftId: string;
  originFlowId: string;
  parentSongId?: string | null;
  rootSongId?: string | null;
  lineageDepth?: number;
  sourceType: VibeVersion["sourceType"];
  sourceMelodyKind: VibeVersion["sourceMelodyKind"];
  /** 0 for the first three vibes; reroll passes previous + 1. */
  batchIndex: number;
  humBlob?: Blob | null;
  /**
   * "reduced" when the source melody came from the client-side pitch fallback
   * (worker unreachable) rather than the server transcriber — the generated
   * versions carry this so VibeScreen can show a non-blocking reduced-detail
   * hint (issue #211). Absent for normal server-side captures.
   */
  captureQuality?: VibeVersion["captureQuality"];
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
    parentSongId: options.parentSongId,
    rootSongId: options.rootSongId,
    lineageDepth: options.lineageDepth,
    sourceType: options.sourceType,
    sourceMelodyKind: options.sourceMelodyKind,
  });
  const prompts = createVibePromptBatch({
    seed: options.draftId,
    batchIndex: options.batchIndex,
    count: scaffold.length,
    melody,
  });

  // Stable operation identity for the whole fan-out (#300). Each clip slot gets
  // its own operationId; the batch id is shared. Both persist in the draft and
  // become the idempotency key for spend + the recovery handle for durable
  // artifacts.
  const batchOperationId = newOperationId();

  const batchArtworkIds: string[] = [];
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
      operationId: newOperationId(),
      batchOperationId,
    };
    return {
      ...version,
      title: spec.title,
      vibe: spec.vibeId,
      tags: spec.tags,
      captureQuality: options.captureQuality,
      visualConfig: (() => {
        const artworkSeed = `${options.draftId}:${options.batchIndex}:${index}:${version.id}`;
        const artwork = pickArtworkSelection(spec.visualFacets, artworkSeed, [], batchArtworkIds);
        if (artwork) batchArtworkIds.push(artwork.id);
        const gradient = artwork?.palette?.length
          ? gradientFromPalette(artwork.palette, artworkSeed)
          : spec.gradient;
        return {
          preset: spec.visualPreset,
          gradient,
          particleDensity: spec.energy,
          pulseSource: spec.energy > 0.6 ? "drums" : "melody",
          visualFacets: spec.visualFacets,
          artwork,
        } satisfies VibeVersion["visualConfig"];
      })(),
      generation,
    };
  });

  log("magenta.batch_started", {
    batchIndex: options.batchIndex,
    prompts: versions.map((v) => v.generation!.prompt),
    vibes: versions.map((v) => v.vibe),
    humStyled: !!options.humBlob,
  });

  startBatchGeneration(versions, options.humBlob ?? null, batchOperationId);
  return versions;
}

function newOperationId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Error-card retry normally represents a refunded failed attempt and mints a
 * new purchase identity. Post-delivery integrity/evidence failures and a
 * result waiting for Notes settlement are exceptions: they resume the same
 * operation so the durable result can be delivered without regenerating it.
 */
export function regenerateVersionAudio(version: VibeVersion): void {
  if (!version.generation) return;
  const operationId = shouldResumePaidOperation(version.generation.errorCode)
    ? version.generation.operationId ?? newOperationId()
    : newOperationId();
  clearGeneratedAudioForPending(version, {
    status: "pending",
    operationId,
    error: undefined,
    errorCode: undefined,
    currentBalance: undefined,
    cost: undefined,
  });
  const humBlob = useMurmurStore.getState().humStyleBlob;
  if (!activeAbort || activeAbort.signal.aborted) {
    activeAbort = new AbortController();
  }
  activeBatchId ??= version.generation.batchOperationId ?? newOperationId();
  void requestClip(version, humBlob, activeAbort.signal, activeBatchId, operationId);
}

/**
 * Recover a restored clip's audio without re-purchasing it (#300). A ready or
 * still-pending clip that lost its session blob URL is first rehydrated from
 * the durable artifact store — the EXACT audited clip, no network, no charge.
 * If the durable bytes are gone we resume the SAME paid operation (the server
 * dedupes the spend on operationId), which re-fetches audio without a second
 * charge. Error clips are left to the explicit retry affordance.
 */
export async function recoverVersionAudio(version: VibeVersion): Promise<void> {
  const generation = version.generation;
  if (!generation || generation.audioUrl || generation.status === "error") return;

  const operationId = generation.operationId;
  if (operationId) {
    const blob = await loadClipArtifact(operationId);
    if (blob) {
      let audioSha256: string;
      try {
        audioSha256 = await sha256Blob(blob);
      } catch {
        await deleteClipArtifact(operationId);
        resumeClipGeneration(version);
        return;
      }
      const url = URL.createObjectURL(blob);
      liveObjectUrls.push(url);
      const applied = patchGeneration(version.id, {
        status: "ready",
        audioUrl: url,
        audioSha256,
      });
      if (!applied) {
        URL.revokeObjectURL(url);
        liveObjectUrls = liveObjectUrls.filter((u) => u !== url);
      }
      return;
    }
  }

  resumeClipGeneration(version);
}

/** Resume a clip's generation on its existing (paid) operationId — no reroll. */
function resumeClipGeneration(version: VibeVersion): void {
  const generation = version.generation;
  if (!generation) return;
  clearGeneratedAudioForPending(version, {
    status: "pending",
    error: undefined,
    errorCode: undefined,
  });
  const humBlob = useMurmurStore.getState().humStyleBlob;
  if (!activeAbort || activeAbort.signal.aborted) {
    activeAbort = new AbortController();
  }
  activeBatchId ??= generation.batchOperationId ?? newOperationId();
  void requestClip(version, humBlob, activeAbort.signal, activeBatchId, generation.operationId);
}

function startBatchGeneration(
  versions: VibeVersion[],
  humBlob: Blob | null,
  batchId: string,
): void {
  activeAbort?.abort();
  const controller = new AbortController();
  activeAbort = controller;
  // One id per fan-out. The server threads it through logs and web-push
  // identity, so the three sibling clips land as a single OS notification
  // and inbox entry instead of one alert per clip.
  activeBatchId = batchId;

  // Clips from a superseded batch are unreachable from the UI — release them.
  for (const url of liveObjectUrls) URL.revokeObjectURL(url);
  liveObjectUrls = [];

  void requestBatchClipsWithConcurrency(versions, humBlob, controller.signal, batchId);
}

async function requestBatchClipsWithConcurrency(
  versions: VibeVersion[],
  humBlob: Blob | null,
  signal: AbortSignal,
  batchId: string,
): Promise<void> {
  // Two lanes overlap provider queue/cold-start latency without flooding a
  // local worker or submitting all sibling jobs at once. Each clip still owns
  // its operation id, charge, progress, and failure state.
  let nextIndex = 0;
  const runLane = async () => {
    while (nextIndex < versions.length) {
      const version = versions[nextIndex++];
      if (!version) return;
      if (signal.aborted) {
        settleQueuedClipAfterAbort(version, signal);
        continue;
      }
      await requestClip(
        version,
        humBlob,
        signal,
        batchId,
        version.generation?.operationId,
      );
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, versions.length) }, runLane));
}

function settleQueuedClipAfterAbort(version: VibeVersion, signal: AbortSignal): void {
  if (signal.reason !== BACKGROUND_CANCELLATION_REASON) return;
  const generation = version.generation;
  const applied = patchGeneration(version.id, {
    status: "error",
    error: "Generation stopped while Murmur was in the background.",
    errorCode: "background_canceled",
  });
  if (!applied) return;
  log("magenta.clip_background_canceled", {
    vibe: version.vibe,
    prompt: generation?.prompt,
    queued: true,
  }, {
    level: "warn",
  });
  notifyIfBatchComplete();
}

async function requestClip(
  version: VibeVersion,
  humBlob: Blob | null,
  signal: AbortSignal | null,
  batchId: string,
  operationId?: string,
): Promise<void> {
  const generation = version.generation!;
  const startedAt = performance.now();
  try {
    const form = new FormData();
    form.append("prompt", generation.prompt);
    form.append("duration", String(generation.durationSec));
    if (version.melody?.notes?.length) {
      form.append("melody", JSON.stringify(version.melody));
    }
    if (humBlob && generation.styleMix > 0) {
      form.append("styleMix", String(generation.styleMix));
      form.append("hum", humBlob, "hum.webm");
    }

    const headers: Record<string, string> = { "x-generation-batch-id": batchId };
    // Stable per-clip identity: the server keys spend idempotency on it, so a
    // resume/retry of the same clip never double-charges (#300).
    if (operationId) headers["x-generation-clip-id"] = operationId;

    const requestSignal = withGenerateTimeout(signal);
    const res = durableMusicJobsEnabled()
      ? await requestDurableMusicAudio({
          form,
          headers,
          signal: requestSignal,
          cancelSignal: signal ?? undefined,
        })
      : await request("/api/music/generate", {
          method: "POST",
          body: form,
          headers,
          signal: requestSignal,
        });
    if (!res.ok) {
      throw await buildMusicGenerateError(res);
    }
    const blob = await res.blob();
    const declaredAudioSha256 = validSha256(res.headers.get("x-audio-sha256"));
    let audioSha256: string;
    try {
      audioSha256 = await sha256Blob(blob);
    } catch {
      throw new MusicGenerateRequestError(
        "delivery_integrity",
        "Generated audio could not be verified. Retry will resume the same purchase.",
        502,
      );
    }
    if (declaredAudioSha256 && declaredAudioSha256 !== audioSha256) {
      throw new MusicGenerateRequestError(
        "delivery_integrity",
        "Generated audio failed integrity verification. Retry will resume the same purchase.",
        502,
      );
    }
    // Wait for IndexedDB before exposing `ready` when it works. Storage is a
    // recovery cache, not the source of truth: private mode/quota failures must
    // not discard valid, digest-checked audio already held in this session.
    // A reload resumes the same paid operation and the server dedupes it.
    if (operationId) {
      const persistence = await persistClipArtifact(operationId, blob);
      if (persistence === "failed") {
        log("magenta.clip_artifact_persistence_failed", {
          vibe: version.vibe,
          operationId,
          bytes: blob.size,
        }, {
          level: "warn",
        });
      }
    }
    const url = URL.createObjectURL(blob);
    liveObjectUrls.push(url);
    const applied = patchGeneration(version.id, {
      status: "ready",
      audioUrl: url,
      ...(audioSha256 ? { audioSha256 } : {}),
    });
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
    notifyIfBatchComplete();
  } catch (error) {
    if (signal?.aborted) {
      if (signal.reason !== BACKGROUND_CANCELLATION_REASON) return;
      const applied = patchGeneration(version.id, {
        status: "error",
        error: "Generation stopped while Murmur was in the background.",
        errorCode: "background_canceled",
      });
      if (!applied) return;
      log("magenta.clip_background_canceled", {
        vibe: version.vibe,
        prompt: generation.prompt,
      }, {
        level: "warn",
        durationMs: Math.round(performance.now() - startedAt),
      });
      notifyIfBatchComplete();
      return;
    }
    const failure = normalizeMusicGenerateError(error);
    patchGeneration(version.id, {
      status: "error",
      error: failure.message,
      errorCode: failure.code,
      currentBalance: failure.currentBalance,
      cost: failure.cost,
    });
    log("magenta.clip_failed", {
      vibe: version.vibe,
      prompt: generation.prompt,
      message: failure.message,
      code: failure.code,
    }, {
      level: "warn",
      durationMs: Math.round(performance.now() - startedAt),
    });
    notifyIfBatchComplete();
  }
}

/**
 * Combine the batch's abort signal with the hang guard. Falls back to the
 * batch signal alone on browsers without AbortSignal.any (pre-2024) — those
 * simply keep today's uncapped behavior.
 */
function withGenerateTimeout(signal: AbortSignal | null): AbortSignal | undefined {
  if (typeof AbortSignal.any !== "function" || typeof AbortSignal.timeout !== "function") {
    return signal ?? undefined;
  }
  const timeout = AbortSignal.timeout(GENERATE_FETCH_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

class MusicGenerateRequestError extends Error {
  constructor(
    readonly code: VersionGenerationErrorCode,
    message: string,
    readonly status: number,
    readonly currentBalance?: number,
    readonly cost?: number,
  ) {
    super(message);
    this.name = "MusicGenerateRequestError";
  }
}

async function buildMusicGenerateError(response: Response): Promise<MusicGenerateRequestError> {
  let payload: Record<string, unknown> = {};
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    // Non-JSON response; fall through to status mapping.
  }

  const serverError = typeof payload.error === "string" ? payload.error : null;
  const message =
    typeof payload.message === "string"
      ? payload.message
      : serverError ?? `music generate HTTP ${response.status}`;
  const currentBalance =
    typeof payload.currentBalance === "number" ? payload.currentBalance : undefined;
  const cost = typeof payload.cost === "number" ? payload.cost : undefined;
  return new MusicGenerateRequestError(
    mapMusicGenerateErrorCode(serverError, response.status),
    message,
    response.status,
    currentBalance,
    cost,
  );
}

function normalizeMusicGenerateError(error: unknown): {
  code: VersionGenerationErrorCode;
  message: string;
  currentBalance?: number;
  cost?: number;
} {
  if (error instanceof MusicGenerateRequestError) {
    return {
      code: error.code,
      message: error.message,
      currentBalance: error.currentBalance,
      cost: error.cost,
    };
  }
  return {
    code: "network_error",
    message: error instanceof Error ? error.message : String(error),
  };
}

function mapMusicGenerateErrorCode(
  serverError: string | null,
  status: number,
): VersionGenerationErrorCode {
  switch (serverError) {
    case "insufficient_notes":
      return "insufficient_notes";
    case "rate_limited":
      return "rate_limited";
    case "billing_unavailable":
      return "billing_unavailable";
    case "worker_unconfigured":
      return "worker_unconfigured";
    case "worker_http_error":
    case "worker_unauthorized":
      return "worker_unavailable";
    case "worker_overloaded":
      return "worker_overloaded";
    case "generation_evidence_unavailable":
      return "generation_evidence_unavailable";
    case "audio_integrity_failed":
      return "delivery_integrity";
    case "server_error":
      return "server_error";
    default:
      if (status === 402) return "insufficient_notes";
      if (status === 429) return "rate_limited";
      if (status === 503) return "worker_unconfigured";
      if (status >= 500) return "worker_unavailable";
      return "server_error";
  }
}

function shouldResumePaidOperation(code: VersionGenerationErrorCode | undefined): boolean {
  return code === "insufficient_notes"
    || code === "billing_unavailable"
    || code === "delivery_integrity"
    || code === "generation_evidence_unavailable";
}

function notifyIfBatchComplete(): void {
  const { currentFlowId, currentDraftId, vibeVersions } = useMurmurStore.getState();
  const withGen = vibeVersions.filter((v) => v.generation);
  if (withGen.length === 0) return;
  const allSettled = withGen.every((v) => v.generation!.status !== "pending");
  if (!allSettled) return;
  const readyCount = withGen.filter((v) => v.generation!.status === "ready").length;
  if (readyCount === 0) return;
  const sourceId = currentFlowId ?? currentDraftId ?? withGen.map((v) => v.id).join(":");
  const lang = useI18nStore.getState().lang;
  const { title, body } = songGeneratedNotificationCopy(lang, {
    readyCount,
    totalCount: withGen.length,
  });
  addMurmurNotification({
    kind: "song_generated",
    // Batch-scoped id: the service worker mirrors each clip's push under the
    // same id, so this accurate final count replaces those entries instead of
    // piling up next to them.
    id: `song_generated:${activeBatchId ?? sourceId}`,
    title,
    body,
    href: "/studio",
    sourceId,
    meta: {
      readyCount,
      totalCount: withGen.length,
    },
  });
  sendBrowserNotification("Murmur", {
    body,
    // Same tag as the per-clip pushes: the OS slot they collapsed into gets
    // replaced by this batch summary rather than joined by it.
    tag: activeBatchId ? `murmur-generation-${activeBatchId}` : "murmur-generation",
  });
}

/** Patch a version's generation in the store; false if it's no longer there. */
type VersionGenerationPatch =
  | Partial<
      Pick<
        VersionGeneration,
        "audioUrl" | "audioSha256" | "currentBalance" | "cost" | "operationId" | "batchOperationId"
      >
    > &
    ({ status: "pending" | "ready"; error?: undefined; errorCode?: undefined }
    | { status: "error"; error: string; errorCode: VersionGenerationErrorCode });

function patchGeneration(
  versionId: string,
  patch: VersionGenerationPatch,
): boolean {
  const store = useMurmurStore.getState();
  const target = store.vibeVersions.find((v) => v.id === versionId);
  const fallback = store.currentVersion?.id === versionId ? store.currentVersion : null;
  const base = target ?? fallback;
  if (!base?.generation) return false;

  const next: VibeVersion = {
    ...base,
    generation: { ...base.generation, ...patch } as VersionGeneration,
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

function clearGeneratedAudioForPending(
  version: VibeVersion,
  patch: VersionGenerationPatch & { status: "pending" },
): void {
  const store = useMurmurStore.getState();
  const previousUrls = new Set([
    store.vibeVersions.find((candidate) => candidate.id === version.id)?.generation?.audioUrl,
    store.currentVersion?.id === version.id
      ? store.currentVersion.generation?.audioUrl
      : undefined,
  ]);
  const applied = patchGeneration(version.id, {
    ...patch,
    audioUrl: undefined,
    audioSha256: undefined,
  });
  if (!applied) return;
  for (const previousUrl of previousUrls) {
    if (!previousUrl || !liveObjectUrls.includes(previousUrl)) continue;
    URL.revokeObjectURL(previousUrl);
    liveObjectUrls = liveObjectUrls.filter((url) => url !== previousUrl);
  }
}

function validSha256(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}

async function sha256Blob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
