import { request } from "./request";

export interface VoiceGenerateResult {
  mp3Url: string;
  audioObjectKey: string;
  providerModel: string;
  durationSec: number | null;
  contentType: string;
}

export async function generateVoiceSong(input: {
  lyrics: string;
  stylePrompt: string;
  title?: string;
  draftId?: string;
  requestId?: string;
}): Promise<VoiceGenerateResult> {
  const { requestId, ...payload } = input;
  const response = await request("/api/music/voice-generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(requestId ? { "x-request-id": requestId } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok) {
    let payload: Record<string, unknown> = {};
    try {
      payload = (await response.json()) as Record<string, unknown>;
    } catch {
      // no JSON body
    }
    throw new Error(
      typeof payload.message === "string"
        ? payload.message
        : `Voice generation failed with HTTP ${response.status}`,
    );
  }

  return (await response.json()) as VoiceGenerateResult;
}
