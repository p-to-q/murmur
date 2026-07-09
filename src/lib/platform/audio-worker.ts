import { z } from "zod";
import {
  INSTRUMENT_RANGES,
  clampPitchToInstrument,
  type InstrumentId,
} from "@murmur/core/music/instrument-ranges";
import { polishMelody } from "@/modules/music/melody-polisher";
import {
  buildMelodyIntentProfile,
  buildTranscriptionMelodies,
  chooseGenerationMelodyKind,
} from "@/modules/music/humming-engine";
import { isObject } from "@/lib/utils/is-object";
import type {
  CleanMelody,
  MelodyNote,
  TranscriptionContour,
  TranscriptionDiagnostics,
  TranscriptionProvider,
  TranscriptionResult,
} from "@/modules/shared/types";

// Per-attempt and total budgets stay under the /api/transcribe route's 60s
// maxDuration so a transient blip can be retried inside the same request
// instead of failing the user immediately. The worker pitch stack is warmed on
// the audio-engine side, so a normal transcription leaves room for a couple of
// retries within the total budget.
const WORKER_ATTEMPT_TIMEOUT_MS = 20_000;
const WORKER_TOTAL_BUDGET_MS = 40_000;
const WORKER_MAX_ATTEMPTS = 3;
const WORKER_RETRY_BACKOFF_MS = [500, 1500];
const MIN_ATTEMPT_BUDGET_MS = 3_000;

const noteSchema = z.object({
  pitch: z.number(),
  start: z.number(),
  duration: z.number(),
  velocity: z.number().optional(),
  confidence: z.number().optional(),
});

const cleanMelodySchema = z.object({
  notes: z.array(noteSchema),
  key: z.string(),
  scale: z.enum(["major", "minor", "pentatonic", "dorian", "phrygian"]),
  bpm: z.number(),
  duration: z.number(),
  contour: z.enum(["rising", "falling", "wave", "flat"]),
});

const diagnosticsSchema = z
  .object({
    duration: z.number().optional(),
    snr: z.number().nullable().optional(),
    voicedRatio: z.number().nullable().optional(),
    rmsDbfs: z.number().nullable().optional(),
    peakDbfs: z.number().nullable().optional(),
    clippingRatio: z.number().nullable().optional(),
    acceptanceScore: z.number().nullable().optional(),
    musicFeelScore: z.number().nullable().optional(),
    rushedRatio: z.number().nullable().optional(),
    ambiguousMidRatio: z.number().nullable().optional(),
    cadenceRatio: z.number().nullable().optional(),
    excessiveHoldRatio: z.number().nullable().optional(),
    interiorHoldRatio: z.number().nullable().optional(),
    onsetFragmentation: z.number().nullable().optional(),
    firstOnsetLag: z.number().nullable().optional(),
    urgentCoherence: z.number().nullable().optional(),
    frameCount: z.number().optional(),
    decodeMs: z.number().optional(),
    trimMs: z.number().optional(),
    denoiseMs: z.number().optional(),
    denoiseProvider: z.enum(["off", "deepfilternet"]).optional(),
    denoiseModel: z.string().nullable().optional(),
    providerPitchMs: z.number().optional(),
    pitchMs: z.number().optional(),
    polishMs: z.number().optional(),
    totalMs: z.number().optional(),
    rmvpeFrames: z.number().optional(),
    rmvpeVoicedFrames: z.number().optional(),
    rmvpeHopMs: z.number().optional(),
    rmvpeConfidenceThreshold: z.number().optional(),
    rmvpeDevice: z.string().optional(),
    rmvpeModel: z.string().optional(),
    rmvpeExecutionProvider: z.string().nullable().optional(),
    noteHypothesis: z.string().optional(),
    noteProposalProfile: z.string().optional(),
    noteProposalCandidates: z.string().optional(),
    proposalGlideRatio: z.number().nullable().optional(),
    proposalWobbleRatio: z.number().nullable().optional(),
    proposalUrgentRatio: z.number().nullable().optional(),
    noteDensity: z.number().nullable().optional(),
    hypothesisCandidates: z.string().optional(),
    alternateReviewMode: z.string().optional(),
    alternateReviewHypotheses: z.string().optional(),
    detailPreservingRerank: z.string().optional(),
    ensembleScore: z.number().nullable().optional(),
    ensembleCandidates: z.string().optional(),
    ensembleDecision: z.string().optional(),
    ensembleSelected: z.string().optional(),
    repairTriggered: z.boolean().optional(),
    repairTriggerReason: z.string().optional(),
    repairCandidates: z.string().optional(),
    providerRerouted: z.boolean().optional(),
  })
  .passthrough();

const contourSchema = z.object({
  timestamps: z.array(z.number()),
  pitchHz: z.array(z.number().nullable()),
  confidence: z.array(z.number()),
  voiced: z.array(z.boolean()),
  hopSeconds: z.number().positive(),
});

const workerResponseSchema = z.object({
  provider: z.string().optional(),
  source: z.string().optional(),
  rawNotes: z.array(noteSchema).optional(),
  notes: z.array(noteSchema).optional(),
  contour: contourSchema.optional(),
  cleanMelody: cleanMelodySchema.optional(),
  warnings: z.array(z.string()).optional(),
  diagnostics: diagnosticsSchema.optional(),
  frameCount: z.number().optional(),
});

export type TranscribeErrorCode =
  | "worker_unconfigured"
  | "worker_http_error"
  | "worker_invalid_response"
  | "no_voiced_frames"
  | "validation_error";

export class AudioWorkerError extends Error {
  constructor(
    public readonly code: TranscribeErrorCode,
    message: string,
    public readonly status = 500,
    /** Transient failure (connection/timeout/5xx) safe to retry within budget. */
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "AudioWorkerError";
  }
}

export interface AudioWorkerRequest {
  audio: File;
  targetInstrument: InstrumentId;
  requestId: string;
  /** Loopback-only test routes can inject a worker URL without changing process env. */
  workerBaseUrl?: string;
  /** Product routes omit this and let the worker's configured auto route decide. */
  pitchProvider?: string;
}

/**
 * Call the server-side audio worker and normalize the current RMVPE/SwiftF0/pYIN
 * response shape into Murmur's `TranscriptionResult`.
 */
export async function transcribeWithAudioWorker({
  audio,
  targetInstrument,
  requestId,
  workerBaseUrl,
  pitchProvider,
}: AudioWorkerRequest): Promise<TranscriptionResult> {
  const workerBase = workerBaseUrl?.trim() || getAudioWorkerUrl();
  if (!workerBase) {
    throw new AudioWorkerError(
      "worker_unconfigured",
      "AUDIO_WORKER_URL is not configured",
      503,
    );
  }

  const workerUrl = workerBase.endsWith("/transcribe")
    ? workerBase
    : `${workerBase.replace(/\/+$/, "")}/transcribe`;
  const token = process.env.AUDIO_WORKER_TOKEN?.trim() || undefined;
  // Read the upload once so every retry can send a fresh body — a File/Blob can
  // otherwise be left consumed by a failed attempt's fetch.
  const audioBytes = await audio.arrayBuffer();
  const audioName = audio.name || "hum.webm";
  const audioType = audio.type || "audio/webm";

  const deadline = Date.now() + WORKER_TOTAL_BUDGET_MS;
  let lastError: AudioWorkerError | null = null;

  for (let attempt = 0; attempt < WORKER_MAX_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < MIN_ATTEMPT_BUDGET_MS) break;

    if (attempt > 0) {
      const backoff = Math.min(
        WORKER_RETRY_BACKOFF_MS[attempt - 1] ?? 1_500,
        remaining - MIN_ATTEMPT_BUDGET_MS,
      );
      if (backoff > 0) await sleep(backoff);
    }

    const attemptTimeout = Math.min(WORKER_ATTEMPT_TIMEOUT_MS, deadline - Date.now());
    if (attemptTimeout < MIN_ATTEMPT_BUDGET_MS) break;

    try {
      return await runTranscribeAttempt({
        workerUrl,
        audioBytes,
        audioName,
        audioType,
        targetInstrument,
        requestId,
        token,
        pitchProvider,
        timeoutMs: attemptTimeout,
      });
    } catch (error) {
      if (error instanceof AudioWorkerError && error.retryable) {
        lastError = error;
        continue;
      }
      throw error;
    }
  }

  throw (
    lastError ??
    new AudioWorkerError(
      "worker_http_error",
      "Audio worker did not respond within the retry budget",
      502,
      false,
    )
  );
}

async function runTranscribeAttempt({
  workerUrl,
  audioBytes,
  audioName,
  audioType,
  targetInstrument,
  requestId,
  token,
  pitchProvider,
  timeoutMs,
}: {
  workerUrl: string;
  audioBytes: ArrayBuffer;
  audioName: string;
  audioType: string;
  targetInstrument: InstrumentId;
  requestId: string;
  token?: string;
  pitchProvider?: string;
  timeoutMs: number;
}): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append("audio", new Blob([audioBytes], { type: audioType }), audioName);
  form.append("targetInstrument", targetInstrument);
  if (pitchProvider) {
    form.append("pitchProvider", pitchProvider);
  }

  const headers = new Headers({ "X-Request-Id": requestId });
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const startedAt = performance.now();
  let response: Response;
  try {
    response = await fetch(workerUrl, {
      method: "POST",
      body: form,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // Connection refused / DNS / TLS / per-attempt timeout — all transient.
    throw new AudioWorkerError(
      "worker_http_error",
      error instanceof Error ? error.message : "Audio worker request failed",
      502,
      true,
    );
  }

  const workerMs = Math.round(performance.now() - startedAt);
  if (!response.ok) {
    const workerError = await readWorkerError(response);
    if (response.status === 422 && workerError.code === "no_voiced_frames") {
      throw new AudioWorkerError("no_voiced_frames", workerError.message, 422);
    }

    // 5xx (a restarting or overloaded worker) is worth another try; other 4xx
    // are caller/content errors that a retry would not fix.
    throw new AudioWorkerError(
      "worker_http_error",
      workerError.message || `Audio worker returned HTTP ${response.status}`,
      response.status === 422 ? 422 : 502,
      response.status >= 500,
    );
  }

  let parsed: z.infer<typeof workerResponseSchema>;
  try {
    parsed = workerResponseSchema.parse(await response.json());
  } catch (error) {
    throw new AudioWorkerError(
      "worker_invalid_response",
      error instanceof Error ? error.message : "Invalid audio worker response",
      502,
    );
  }

  return normalizeWorkerResponse(parsed, {
    targetInstrument,
    workerMs,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isInstrumentId(value: string): value is InstrumentId {
  return value in INSTRUMENT_RANGES;
}

export function isMelodyCarrier(value: InstrumentId): boolean {
  return INSTRUMENT_RANGES[value].canCarryMelody;
}

export function normalizeWorkerResponse(
  workerResponse: z.infer<typeof workerResponseSchema>,
  options: { targetInstrument: InstrumentId; workerMs: number },
): TranscriptionResult {
  const rawNotes = normalizeNotes(
    workerResponse.rawNotes ??
      workerResponse.notes ??
      workerResponse.cleanMelody?.notes ??
      [],
  );

  if (rawNotes.length === 0) {
    throw new AudioWorkerError(
      "no_voiced_frames",
      "The audio worker did not detect a usable melody",
      422,
    );
  }

  const provider = normalizeProvider(
    workerResponse.provider ?? workerResponse.source,
  );
  const polished = workerResponse.cleanMelody
    ? normalizeCleanMelody(workerResponse.cleanMelody)
    : polishMelody(rawNotes);
  const clamped = clampMelody(polished, options.targetInstrument);
  const melodyIntent = buildMelodyIntentProfile(rawNotes, clamped.melody, {
    diagnostics: workerResponse.diagnostics,
    contour: workerResponse.contour,
  });
  const melodies = buildTranscriptionMelodies(rawNotes, clamped.melody, {
    diagnostics: workerResponse.diagnostics,
    contour: workerResponse.contour,
    melodyIntent,
  });
  const selectedMelodyKind = chooseGenerationMelodyKind({
    melodies,
    melodyIntent,
    diagnostics: workerResponse.diagnostics,
    contour: workerResponse.contour,
  });
  const diagnostics = normalizeDiagnostics(workerResponse, {
    targetInstrument: options.targetInstrument,
    workerMs: options.workerMs,
    rangeClampApplied: clamped.applied,
    selectedMelodyKind,
  });
  const contour = normalizeContour(workerResponse.contour);

  return {
    provider,
    rawNotes,
    contour,
    melodyIntent,
    melodies,
    selectedMelodyKind,
    cleanMelody: melodies.corrected,
    warnings: workerResponse.warnings ?? [],
    diagnostics,
  };
}

function getAudioWorkerUrl(): string | null {
  return process.env.AUDIO_WORKER_URL?.trim() || null;
}

function normalizeProvider(value: string | undefined): TranscriptionProvider {
  const lower = value?.toLowerCase() ?? "";
  if (lower.includes("rmvpe")) return "rmvpe";
  if (lower.includes("swift")) return "swiftf0";
  if (lower.includes("parselmouth") || lower.includes("praat")) return "parselmouth";
  if (lower.includes("pyin")) return "pyin";
  if (lower === "yin" || lower.includes("librosa_yin")) return "yin";
  return "pyin";
}

async function readWorkerError(
  response: Response,
): Promise<{ code: string | null; message: string }> {
  try {
    const data = (await response.json()) as {
      detail?: unknown;
      error?: string;
      message?: string;
    };
    const detail = data.detail;
    if (isObject(detail)) {
      return {
        code: typeof detail.error === "string" ? detail.error : null,
        message:
          typeof detail.message === "string"
            ? detail.message
            : typeof data.message === "string"
              ? data.message
              : typeof detail.error === "string"
                ? detail.error
              : `Audio worker returned HTTP ${response.status}`,
      };
    }
    return {
      code: typeof data.error === "string" ? data.error : null,
      message:
        typeof data.message === "string"
          ? data.message
          : typeof detail === "string"
            ? detail
            : `Audio worker returned HTTP ${response.status}`,
    };
  } catch {
    return {
      code: null,
      message: `Audio worker returned HTTP ${response.status}`,
    };
  }
}

function normalizeNotes(
  notes: Array<z.infer<typeof noteSchema>>,
): MelodyNote[] {
  return notes.map((note) => ({
    pitch: Math.round(note.pitch),
    start: Math.max(0, note.start),
    duration: Math.max(0, note.duration),
    velocity:
      note.velocity === undefined
        ? 0.7
        : note.velocity > 1
          ? Math.min(1, Math.max(0.05, note.velocity / 127))
          : Math.min(1, Math.max(0.05, note.velocity)),
    confidence: Math.min(1, Math.max(0, note.confidence ?? 0.8)),
  }));
}

function normalizeCleanMelody(
  cleanMelody: z.infer<typeof cleanMelodySchema>,
): CleanMelody {
  return {
    ...cleanMelody,
    notes: normalizeNotes(cleanMelody.notes),
  };
}

function normalizeContour(
  contour: z.infer<typeof contourSchema> | undefined,
): TranscriptionContour | undefined {
  if (!contour) return undefined;

  const frameCount = Math.min(
    contour.timestamps.length,
    contour.pitchHz.length,
    contour.confidence.length,
    contour.voiced.length,
  );

  return {
    timestamps: contour.timestamps
      .slice(0, frameCount)
      .map((value) => Math.max(0, value)),
    pitchHz: contour.pitchHz
      .slice(0, frameCount)
      .map((value) =>
        typeof value === "number" && Number.isFinite(value) && value > 0
          ? value
          : null,
      ),
    confidence: contour.confidence
      .slice(0, frameCount)
      .map((value) => Math.min(1, Math.max(0, value))),
    voiced: contour.voiced.slice(0, frameCount),
    hopSeconds: contour.hopSeconds,
  };
}

function clampMelody(
  melody: CleanMelody,
  targetInstrument: InstrumentId,
): { melody: CleanMelody; applied: boolean } {
  const clampedNotes = clampPitchToInstrument(melody.notes, targetInstrument);
  const applied = clampedNotes.some(
    (note, index) => note.pitch !== melody.notes[index]?.pitch,
  );

  if (!applied) {
    return { melody, applied: false };
  }

  return {
    melody: {
      ...melody,
      notes: clampedNotes,
    },
    applied: true,
  };
}

function normalizeDiagnostics(
  workerResponse: z.infer<typeof workerResponseSchema>,
  options: {
    targetInstrument: InstrumentId;
    workerMs: number;
    rangeClampApplied: boolean;
    selectedMelodyKind: "intent" | "corrected" | "musical";
  },
): TranscriptionDiagnostics {
  const diagnostics = workerResponse.diagnostics ?? {};
  return {
    duration:
      typeof diagnostics.duration === "number" ? diagnostics.duration : 0,
    snr: numberOrNull(diagnostics.snr),
    voicedRatio:
      numberOrNull(diagnostics.voicedRatio),
    rmsDbfs: numberOrNull(diagnostics.rmsDbfs),
    peakDbfs: numberOrNull(diagnostics.peakDbfs),
    clippingRatio: numberOrNull(diagnostics.clippingRatio),
    acceptanceScore: numberOrNull(diagnostics.acceptanceScore),
    musicFeelScore: numberOrNull(diagnostics.musicFeelScore),
    rushedRatio: numberOrNull(diagnostics.rushedRatio),
    ambiguousMidRatio: numberOrNull(diagnostics.ambiguousMidRatio),
    cadenceRatio: numberOrNull(diagnostics.cadenceRatio),
    excessiveHoldRatio: numberOrNull(diagnostics.excessiveHoldRatio),
    interiorHoldRatio: numberOrNull(diagnostics.interiorHoldRatio),
    onsetFragmentation: numberOrNull(diagnostics.onsetFragmentation),
    firstOnsetLag: numberOrNull(diagnostics.firstOnsetLag),
    urgentCoherence: numberOrNull(diagnostics.urgentCoherence),
    frameCount:
      typeof diagnostics.frameCount === "number"
        ? diagnostics.frameCount
        : workerResponse.frameCount ?? workerResponse.contour?.timestamps.length,
    decodeMs: numberOrUndefined(diagnostics.decodeMs),
    trimMs: numberOrUndefined(diagnostics.trimMs),
    denoiseMs: numberOrUndefined(diagnostics.denoiseMs),
    denoiseProvider:
      diagnostics.denoiseProvider === "off" ||
      diagnostics.denoiseProvider === "deepfilternet"
        ? diagnostics.denoiseProvider
        : undefined,
    denoiseModel: stringOrNull(diagnostics.denoiseModel),
    providerPitchMs: numberOrUndefined(diagnostics.providerPitchMs),
    pitchMs: numberOrUndefined(diagnostics.pitchMs),
    polishMs: numberOrUndefined(diagnostics.polishMs),
    totalMs: numberOrUndefined(diagnostics.totalMs),
    rmvpeFrames: numberOrUndefined(diagnostics.rmvpeFrames),
    rmvpeVoicedFrames: numberOrUndefined(diagnostics.rmvpeVoicedFrames),
    rmvpeHopMs: numberOrUndefined(diagnostics.rmvpeHopMs),
    rmvpeConfidenceThreshold: numberOrUndefined(
      diagnostics.rmvpeConfidenceThreshold,
    ),
    rmvpeDevice: stringOrUndefined(diagnostics.rmvpeDevice),
    rmvpeModel: stringOrUndefined(diagnostics.rmvpeModel),
    rmvpeExecutionProvider: stringOrNull(diagnostics.rmvpeExecutionProvider),
    workerMs: options.workerMs,
    targetInstrument: options.targetInstrument,
    rangeClampApplied: options.rangeClampApplied,
    selectedMelodyKind: options.selectedMelodyKind,
    noteHypothesis: stringOrUndefined(diagnostics.noteHypothesis),
    noteProposalProfile: stringOrUndefined(diagnostics.noteProposalProfile),
    noteProposalCandidates: stringOrUndefined(diagnostics.noteProposalCandidates),
    proposalGlideRatio: numberOrNull(diagnostics.proposalGlideRatio),
    proposalWobbleRatio: numberOrNull(diagnostics.proposalWobbleRatio),
    proposalUrgentRatio: numberOrNull(diagnostics.proposalUrgentRatio),
    noteDensity: numberOrNull(diagnostics.noteDensity),
    hypothesisCandidates: stringOrUndefined(diagnostics.hypothesisCandidates),
    alternateReviewMode: stringOrUndefined(diagnostics.alternateReviewMode),
    alternateReviewHypotheses: stringOrUndefined(
      diagnostics.alternateReviewHypotheses,
    ),
    detailPreservingRerank: stringOrUndefined(diagnostics.detailPreservingRerank),
    ensembleScore: numberOrNull(diagnostics.ensembleScore),
    ensembleCandidates: stringOrUndefined(diagnostics.ensembleCandidates),
    ensembleDecision: stringOrUndefined(diagnostics.ensembleDecision),
    ensembleSelected: stringOrUndefined(diagnostics.ensembleSelected),
    repairTriggered:
      typeof diagnostics.repairTriggered === "boolean"
        ? diagnostics.repairTriggered
        : undefined,
    repairTriggerReason: stringOrUndefined(diagnostics.repairTriggerReason),
    repairCandidates: stringOrUndefined(diagnostics.repairCandidates),
    providerRerouted:
      typeof diagnostics.providerRerouted === "boolean"
        ? diagnostics.providerRerouted
        : undefined,
  };
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberOrNull(value: unknown): number | null {
  return numberOrUndefined(value) ?? null;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stringOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  return stringOrUndefined(value);
}
