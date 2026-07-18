import { createHash } from "node:crypto";

export const MUSIC_OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;
export const MUSIC_BATCH_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

export interface CanonicalMusicJobRequest {
  prompt: string;
  duration: number;
  styleMix: number;
  melody: string;
  humDigest: string | null;
}

export function hashMusicJobRequest(input: CanonicalMusicJobRequest): string {
  return createHash("sha256")
    .update(JSON.stringify({
      prompt: input.prompt,
      duration: input.duration,
      styleMix: input.styleMix,
      melody: canonicalMelody(input.melody),
      humDigest: input.humDigest,
    }))
    .digest("hex");
}

function canonicalMelody(melody: string): string {
  if (!melody) return "";
  try {
    return JSON.stringify(JSON.parse(melody));
  } catch {
    return melody;
  }
}
