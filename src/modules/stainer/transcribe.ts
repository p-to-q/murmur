import type {
  TranscriptionInput,
  TranscriptionResult,
} from "@/modules/shared/types";
import { log } from "@/lib/observability/log";
import {
  transcribeRecording,
  transcribeRecordingStreaming,
  TranscribeRequestError,
  type TranscribeProgressCallback,
} from "@/lib/api/transcribe";
import { transcribeFixture } from "./providers/fixture";
import {
  detectPitchClient,
  isClientPitchAvailable,
} from "@/lib/audio/client-pitch-fallback";
import { buildClientTranscriptionResult } from "@/lib/audio/build-client-transcription-result";

type StainerDependencies = {
  transcribeRecording: typeof transcribeRecording;
  transcribeRecordingStreaming: typeof transcribeRecordingStreaming;
  isClientPitchAvailable: typeof isClientPitchAvailable;
  detectPitchClient: typeof detectPitchClient;
  decodeAudioBlob: typeof decodeAudioBlob;
};

const defaultDependencies: StainerDependencies = {
  transcribeRecording,
  transcribeRecordingStreaming,
  isClientPitchAvailable,
  detectPitchClient,
  decodeAudioBlob,
};

function isNetworkError(error: unknown): boolean {
  if (
    error instanceof TranscribeRequestError &&
    (error.code === "network_error" ||
      error.code === "worker_unavailable" ||
      error.code === "worker_unconfigured")
  ) {
    return true;
  }
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) return true;
  if (error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")) return true;
  if (error instanceof Error && /ECONNREFUSED|ETIMEDOUT|503|502/i.test(error.message)) return true;
  return false;
}

async function decodeAudioBlob(blob: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioContext = new AudioContext();
  try {
    return await audioContext.decodeAudioData(arrayBuffer);
  } finally {
    await audioContext.close();
  }
}

/**
 * Stainer is the single client transcription facade.
 *
 * Live recordings are sent to the server-authoritative `/api/transcribe`
 * route. When the server is unreachable and client-side pitch detection
 * (Essentia.js pYIN) is available, Stainer falls back to browser-side
 * transcription automatically.
 *
 * Fixture is available only for explicit demo calls where `audioBlob`
 * is omitted; real audio never silently falls through to demo content.
 */
export async function transcribeWithStainer(
  input: TranscriptionInput & {
    onProgress?: TranscribeProgressCallback;
    operationId?: string;
  },
  dependencies: StainerDependencies = defaultDependencies,
): Promise<TranscriptionResult> {
  const startedAt = performance.now();

  log("transcribe.requested", {
    hasAudioBlob: !!input.audioBlob,
    providerHint: input.providerHint ?? null,
    targetInstrument: input.targetInstrument ?? null,
    streaming: !!input.onProgress,
  });

  try {
    let result: TranscriptionResult;
    if (input.audioBlob && input.onProgress) {
      result = await dependencies.transcribeRecordingStreaming(input.audioBlob, {
        targetInstrument: input.targetInstrument,
        onProgress: input.onProgress,
        operationId: input.operationId,
      });
    } else if (input.audioBlob) {
      result = await dependencies.transcribeRecording(input.audioBlob, {
        targetInstrument: input.targetInstrument,
        operationId: input.operationId,
      });
    } else {
      result = await transcribeFixture(input);
    }

    log("transcribe.completed", {
      provider: result.provider,
      rawNoteCount: result.rawNotes.length,
      cleanNoteCount: result.cleanMelody.notes.length,
      selectedMelodyKind: result.selectedMelodyKind,
      warningCount: result.warnings.length,
      snr: result.diagnostics?.snr ?? null,
      voicedRatio: result.diagnostics?.voicedRatio ?? null,
    }, {
      durationMs: Math.round(performance.now() - startedAt),
    });

    return result;
  } catch (error) {
    if (input.audioBlob && isNetworkError(error)) {
      const fallbackResult = await tryClientPitchFallback(
        input.audioBlob,
        startedAt,
        dependencies,
      );
      if (fallbackResult) return fallbackResult;
    }

    log("transcribe.failed", {
      error_code: "client_transcribe_failed",
      hasAudioBlob: !!input.audioBlob,
      message: error instanceof Error ? error.message : String(error),
    }, {
      durationMs: Math.round(performance.now() - startedAt),
      level: "warn",
    });
    throw error;
  }
}

async function tryClientPitchFallback(
  audioBlob: Blob,
  startedAt: number,
  dependencies: StainerDependencies,
): Promise<TranscriptionResult | null> {
  const available = await dependencies.isClientPitchAvailable();
  if (!available) {
    log("transcribe.client_fallback_unavailable", {});
    return null;
  }

  try {
    log("transcribe.client_fallback_starting", {});
    const audioBuffer = await dependencies.decodeAudioBlob(audioBlob);
    const pitchResult = await dependencies.detectPitchClient(audioBuffer);
    const result = buildClientTranscriptionResult(pitchResult.rawNotes);

    log("transcribe.completed", {
      provider: result.provider,
      rawNoteCount: result.rawNotes.length,
      cleanNoteCount: result.cleanMelody.notes.length,
      selectedMelodyKind: result.selectedMelodyKind,
      warningCount: result.warnings.length,
      snr: null,
      voicedRatio: null,
      clientFallback: true,
    }, {
      durationMs: Math.round(performance.now() - startedAt),
    });

    return result;
  } catch (fallbackError) {
    log("transcribe.client_fallback_failed", {
      message: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
    }, { level: "warn" });
    return null;
  }
}
