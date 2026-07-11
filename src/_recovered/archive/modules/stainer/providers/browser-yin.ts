"use client";
/**
 * browser-yin provider — wraps src/lib/music/pitch-engine (YIN) as a Stainer provider.
 * Zero-dependency, offline, ~46ms per frame on commodity hardware. Always tried first
 * for live recordings because it is instant.
 */
import type {
  MelodyNote,
  TranscriptionInput,
  TranscriptionResult,
} from "@/modules/shared/types";
import { polishMelody } from "@/modules/music/melody-polisher";

export async function transcribeBrowserYIN(
  input: TranscriptionInput
): Promise<TranscriptionResult> {
  if (!input.audioBlob) {
    throw new Error("browser-yin requires an audio blob");
  }
  if (input.audioBlob.size < 256) {
    throw new Error("browser-yin: audio blob too small");
  }

  const { analyzeAudio } = await import("@/lib/music/pitch-engine");
  const engineResult = await analyzeAudio(input.audioBlob);

  if (!engineResult.notes.length) {
    throw new Error("browser-yin: no notes detected");
  }

  const rawNotes: MelodyNote[] = engineResult.notes.map((n) => ({
    pitch: n.pitch,
    start: n.start,
    duration: n.duration,
    velocity: Math.max(0.01, Math.min(1, n.velocity)),
    confidence: Math.min(1, n.confidence),
  }));

  return {
    provider: "browser-yin",
    rawNotes,
    cleanMelody: polishMelody(rawNotes),
    warnings: [],
  };
}
