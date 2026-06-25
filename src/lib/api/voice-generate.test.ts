import { afterEach, describe, expect, it } from "bun:test";
import { generateVoiceSong } from "./voice-generate";

const originalFetch = globalThis.fetch;

describe("generateVoiceSong", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends the stable request id used for voice spend idempotency", async () => {
    let observedRequestId: string | null = null;
    let observedBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_input, init) => {
      observedRequestId = new Headers(init?.headers).get("x-request-id");
      observedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        mp3Url: "https://cdn.example.com/song.mp3",
        audioObjectKey: "songs/master/usr/song.mp3",
        providerModel: "minimax:music-2.6",
        durationSec: 12,
        contentType: "audio/mpeg",
      });
    }) as typeof fetch;

    await generateVoiceSong({
      lyrics: "I can sing this line",
      stylePrompt: "warm intimate pop",
      title: "Voice Song",
      draftId: "draft_1",
      requestId: "voice:version_1:attempt_1",
    });

    expect(observedRequestId).toBe("voice:version_1:attempt_1");
    expect(observedBody?.requestId).toBeUndefined();
    expect(observedBody?.draftId).toBe("draft_1");
  });
});
