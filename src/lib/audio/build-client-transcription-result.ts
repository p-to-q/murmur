import { polishMelody } from "@/modules/music/melody-polisher";
import {
  buildMelodyIntentProfile,
  buildTranscriptionMelodies,
  chooseGenerationMelodyKind,
} from "@/modules/music/humming-engine";
import type {
  MelodyNote,
  TranscriptionResult,
} from "@/modules/shared/types";

export function buildClientTranscriptionResult(
  rawNotes: MelodyNote[],
): TranscriptionResult {
  if (rawNotes.length === 0) {
    throw new Error("Client pitch detection returned no notes");
  }

  const polished = polishMelody(rawNotes);
  const melodyIntent = buildMelodyIntentProfile(rawNotes, polished, {});
  const melodies = buildTranscriptionMelodies(rawNotes, polished, {
    melodyIntent,
  });
  const selectedMelodyKind = chooseGenerationMelodyKind({
    melodies,
    melodyIntent,
  });

  return {
    provider: "client_pyin",
    rawNotes,
    melodyIntent,
    melodies,
    selectedMelodyKind,
    cleanMelody: melodies.corrected,
    warnings: ["Transcribed using browser-side pitch detection (degraded quality)"],
    diagnostics: {
      duration: rawNotes.reduce((max, n) => Math.max(max, n.start + n.duration), 0),
      snr: null,
      voicedRatio: null,
    },
  };
}
