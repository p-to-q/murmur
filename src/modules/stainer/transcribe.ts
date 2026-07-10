import type {
  TranscriptionInput,
  TranscriptionResult,
} from "@/modules/shared/types";
import { log } from "@/lib/observability/log";
import {
  transcribeRecording,
  transcribeRecordingStreaming,
  type TranscribeProgressCallback,
} from "@/lib/api/transcribe";
import { transcribeFixture } from "./providers/fixture";

/**
 * Stainer is the single client transcription facade.
 *
 * Live recordings are sent to the server-authoritative `/api/transcribe`
 * route. Fixture is available only for explicit demo calls where `audioBlob`
 * is omitted; real audio never silently falls through to demo content.
 */
export async function transcribeWithStainer(
  input: TranscriptionInput & { onProgress?: TranscribeProgressCallback },
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
      result = await transcribeRecordingStreaming(input.audioBlob, {
        targetInstrument: input.targetInstrument,
        onProgress: input.onProgress,
      });
    } else if (input.audioBlob) {
      result = await transcribeRecording(input.audioBlob, {
        targetInstrument: input.targetInstrument,
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
