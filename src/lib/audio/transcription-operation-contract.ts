import { createHash } from "node:crypto";

export function hashTranscriptionOperationRequest(input: {
  audioSha256: string;
  targetInstrument: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({
      audioSha256: input.audioSha256.toLowerCase(),
      targetInstrument: input.targetInstrument,
    }))
    .digest("hex");
}
