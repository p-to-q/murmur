import { z } from "zod";
import {
  INSTRUMENT_RANGES,
  clampPitchToInstrument,
  type InstrumentId,
} from "@murmur/core/music/instrument-ranges";
import { polishMelody } from "@/modules/music/melody-polisher";
import type {
  CleanMelody,
  MelodyNote,
  TranscriptionDiagnostics,
  TranscriptionProvider,
  TranscriptionResult,
} from "@/modules/shared/types";

const WORKER_TIMEOUT_MS = 30_000;

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
    frameCount: z.number().optional(),
    denoiseMs: z.number().optional(),
    denoiseProvider: z.enum(["off", "deepfilternet"]).optional(),
    denoiseModel: z.string().nullable().optional(),
    pitchMs: z.number().optional(),
    polishMs: z.number().optional(),
  })
  .passthrough();

const workerResponseSchema = z.object({
  provider: z.string().optional(),
  source: z.string().optional(),
  rawNotes: z.array(noteSchema).optional(),
  notes: z.array(noteSchema).optional(),
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
  ) {
    super(message);
    this.name = "AudioWorkerError";
  }
}

export interface AudioWorkerRequest {
  audio: File;
  targetInstrument: InstrumentId;
  requestId: string;
}

/**
 * Call the server-side audio worker and normalize both the current pYIN
 * response and the v2 SwiftF0 response into Murmur's `TranscriptionResult`.
 */
export async function transcribeWithAudioWorker({
  audio,
  targetInstrument,
  requestId,
}: AudioWorkerRequest): Promise<TranscriptionResult> {
  const workerBase = getAudioWorkerUrl();
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

  const form = new FormData();
  form.append("audio", audio, audio.name || "hum.webm");
  form.append("targetInstrument", targetInstrument);

  const headers = new Headers({ "X-Request-Id": requestId });
  const token = process.env.AUDIO_WORKER_TOKEN?.trim();
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
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AudioWorkerError(
      "worker_http_error",
      error instanceof Error ? error.message : "Audio worker request failed",
      502,
    );
  }

  const workerMs = Math.round(performance.now() - startedAt);
  if (!response.ok) {
    const workerError = await readWorkerError(response);
    if (response.status === 422 && workerError.code === "no_voiced_frames") {
      throw new AudioWorkerError(
        "no_voiced_frames",
        workerError.message,
        422,
      );
    }

    throw new AudioWorkerError(
      "worker_http_error",
      workerError.message || `Audio worker returned HTTP ${response.status}`,
      response.status === 422 ? 422 : 502,
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
  const diagnostics = normalizeDiagnostics(workerResponse, {
    targetInstrument: options.targetInstrument,
    workerMs: options.workerMs,
    rangeClampApplied: clamped.applied,
  });

  return {
    provider,
    rawNotes,
    cleanMelody: clamped.melody,
    warnings: workerResponse.warnings ?? [],
    diagnostics,
  };
}

function getAudioWorkerUrl(): string | null {
  return (
    process.env.AUDIO_WORKER_URL?.trim() ||
    process.env.BASIC_PITCH_WORKER_URL?.trim() ||
    null
  );
}

function normalizeProvider(value: string | undefined): TranscriptionProvider {
  const lower = value?.toLowerCase() ?? "";
  if (lower.includes("swift")) return "swiftf0";
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
          typeof detail.error === "string"
            ? detail.error
            : typeof data.message === "string"
              ? data.message
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
  },
): TranscriptionDiagnostics {
  const diagnostics = workerResponse.diagnostics ?? {};
  return {
    duration:
      typeof diagnostics.duration === "number" ? diagnostics.duration : 0,
    snr: typeof diagnostics.snr === "number" ? diagnostics.snr : null,
    voicedRatio:
      typeof diagnostics.voicedRatio === "number"
        ? diagnostics.voicedRatio
        : null,
    frameCount:
      typeof diagnostics.frameCount === "number"
        ? diagnostics.frameCount
        : workerResponse.frameCount,
    denoiseMs:
      typeof diagnostics.denoiseMs === "number"
        ? diagnostics.denoiseMs
        : undefined,
    denoiseProvider:
      diagnostics.denoiseProvider === "off" ||
      diagnostics.denoiseProvider === "deepfilternet"
        ? diagnostics.denoiseProvider
        : undefined,
    denoiseModel:
      typeof diagnostics.denoiseModel === "string" ||
      diagnostics.denoiseModel === null
        ? diagnostics.denoiseModel
        : undefined,
    pitchMs:
      typeof diagnostics.pitchMs === "number"
        ? diagnostics.pitchMs
        : undefined,
    polishMs:
      typeof diagnostics.polishMs === "number"
        ? diagnostics.polishMs
        : undefined,
    workerMs: options.workerMs,
    targetInstrument: options.targetInstrument,
    rangeClampApplied: options.rangeClampApplied,
  };
}
