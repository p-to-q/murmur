import { beforeEach, describe, expect, it, mock } from "bun:test";
import { NextRequest } from "next/server";
import type { MusicJob } from "@/lib/db/schema/music-jobs";

let nextJob: MusicJob | null = null;
let storedJob: MusicJob | null = null;
let useStoredLookup = false;
const lookupInputs: Array<{ userId: string; operationId: string }> = [];

mock.module("@/lib/auth", () => ({
  resolveRequestAuth: async () => ({
    ok: true as const,
    user: { id: "usr_route", email: null, name: "Route", avatarUrl: null },
    source: "session" as const,
    sessionId: "sess_route",
  }),
}));

mock.module("@/lib/db/queries/music-jobs", () => ({
  getMusicJobByOperationForUser: async (userId: string, operationId: string) => {
    lookupInputs.push({ userId, operationId });
    return useStoredLookup
      ? storedJob?.userId === userId && storedJob.operationId === operationId
        ? storedJob
        : null
      : nextJob;
  },
}));

mock.module("@/lib/platform/music-job-service", () => ({
  createMusicJobReceipt: async () => { throw new Error("POST not expected"); },
}));

mock.module("@/lib/platform/music-job-runner", () => ({
  advanceMusicJob: async () => undefined,
}));

mock.module("@/lib/platform/music-job-delivery", () => ({
  resolveMusicJobDelivery: async (job: MusicJob) => ({ ok: true as const, job }),
}));

mock.module("@/lib/platform/request-lifecycle", () => ({
  scheduleAfterResponse: () => undefined,
}));

const { GET } = await import("./route");

beforeEach(() => {
  lookupInputs.length = 0;
  nextJob = musicJob();
  storedJob = null;
  useStoredLookup = false;
});

describe("GET /api/music/jobs?operationId", () => {
  it("returns the authenticated owner's existing receipt without request input", async () => {
    const request = new NextRequest(
      "https://murmur.example/api/music/jobs?operationId=clip_route_existing",
      { headers: { "x-request-id": "req_route" } },
    );

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(lookupInputs).toEqual([
      { userId: "usr_route", operationId: "clip_route_existing" },
    ]);
    await expect(response.json()).resolves.toMatchObject({
      jobId: `mjob_${"f".repeat(32)}`,
      operationId: "clip_route_existing",
      status: "running",
      duplicate: true,
    });
  });

  it("returns 404 rather than creating a replacement receipt", async () => {
    nextJob = null;
    const response = await GET(new NextRequest(
      "https://murmur.example/api/music/jobs?operationId=clip_route_missing",
    ));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "not_found" });
  });

  it("does not resolve another owner's job with the same operation id", async () => {
    useStoredLookup = true;
    storedJob = { ...musicJob(), userId: "usr_other" };
    const response = await GET(new NextRequest(
      "https://murmur.example/api/music/jobs?operationId=clip_route_existing",
    ));

    expect(response.status).toBe(404);
    expect(lookupInputs).toEqual([
      { userId: "usr_route", operationId: "clip_route_existing" },
    ]);
  });
});

function musicJob(): MusicJob {
  const now = new Date("2026-07-31T00:00:00.000Z");
  return {
    id: `mjob_${"f".repeat(32)}`,
    userId: "usr_route",
    operationId: "clip_route_existing",
    requestHash: "a".repeat(64),
    status: "running",
    input: {
      originRequestId: "req_origin",
      prompt: "warm piano",
      duration: 10,
      styleMix: 0.35,
      melody: "{}",
      humStorageKey: "music/job-hum",
      humDigest: "b".repeat(64),
      humContentType: "audio/webm",
      generationBatchId: "batch_route",
    },
    output: null,
    provider: "runpod",
    providerJobId: "provider_route",
    spendLedgerId: "nle_route",
    leaseEpoch: 1,
    leaseUntil: null,
    providerSubmittedAt: now,
    deadlineAt: new Date(now.getTime() + 900_000),
    nextRunAt: now,
    cancelRequestedAt: null,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: null,
  };
}
