import { beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

import { getMusicJobAudio } from "./handler";

const audioBytes = new TextEncoder().encode("durable music bytes");
let storedBytes = audioBytes;

const deps = {
  resolveRequestAuth: async () => ({
    ok: true as const,
    user: { id: "usr_audio", email: null, name: "Audio", avatarUrl: null },
    source: "session" as const,
    sessionId: "sess_audio",
  }),
  getMusicJobForUser: async () => ({
    id: "mjob_audio",
    status: "succeeded" as const,
    output: {
      storageKey: "music/jobs/usr_audio/mjob_audio.wav",
      digest: createHash("sha256").update(audioBytes).digest("hex"),
    },
  }),
  getArtifact: async () => ({
    body: storedBytes,
    contentType: "audio/wav",
    size: storedBytes.byteLength,
    scope: "private" as const,
    meta: {},
    storedAt: new Date(),
  }),
};

beforeEach(() => {
  storedBytes = audioBytes;
});

describe("GET /api/music/jobs/:jobId/audio", () => {
  it("delivers bytes that match the recorded artifact digest", async () => {
    const response = await getMusicJobAudio(request(), context(), deps);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Audio-SHA256"))
      .toBe(createHash("sha256").update(audioBytes).digest("hex"));
  });

  it("fails closed when stored bytes drift from the recorded digest", async () => {
    storedBytes = new TextEncoder().encode("corrupt bytes");

    const response = await getMusicJobAudio(request(), context(), deps);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: "audio_integrity_failed",
    });
  });
});

function request(): NextRequest {
  return new Request("https://murmur.example/api/music/jobs/mjob_audio/audio", {
    headers: { "x-request-id": "req_audio" },
  }) as unknown as NextRequest;
}

function context() {
  return { params: Promise.resolve({ jobId: "mjob_audio" }) };
}
