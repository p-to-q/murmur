import { createHash } from "node:crypto";
import { describe, expect, it } from "bun:test";

import type { MusicJob } from "@/lib/db/schema/music-jobs";
import {
  generateDurableMusicSynchronously,
  type DurableMusicSyncDeps,
} from "./music-sync-generation";

const bytes = new Uint8Array([1, 2, 3, 4]);
const digest = createHash("sha256").update(bytes).digest("hex");

describe("generateDurableMusicSynchronously", () => {
  it("replays a succeeded receipt without advancing the provider", async () => {
    const job = musicJob({ status: "succeeded" });
    let advances = 0;
    const result = await generateDurableMusicSynchronously(baseInput(), deps({
      createReceipt: async () => ({ ok: true, job, duplicate: true, spend: null }),
      getJob: async () => job,
      advance: async () => { advances += 1; },
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.duplicate).toBe(true);
    expect(result.outputSha256).toBe(digest);
    expect(new Uint8Array(result.audio)).toEqual(bytes);
    expect(advances).toBe(0);
  });

  it("rejects a reused operation id with different input before provider work", async () => {
    const job = musicJob({ status: "succeeded" });
    let advances = 0;
    const result = await generateDurableMusicSynchronously(baseInput(), deps({
      createReceipt: async () => ({ ok: false, reason: "idempotency_conflict", job }),
      advance: async () => { advances += 1; },
    }));

    expect(result).toMatchObject({ ok: false, error: "idempotency_conflict", status: 409 });
    expect(advances).toBe(0);
  });

  it("rejects an unverifiable legacy spend without a durable job", async () => {
    let advances = 0;
    const result = await generateDurableMusicSynchronously(baseInput(), deps({
      createReceipt: async () => ({ ok: false, reason: "idempotency_conflict", job: null }),
      advance: async () => { advances += 1; },
    }));

    expect(result).toEqual({
      ok: false,
      error: "idempotency_conflict",
      message: "This clip id was already used with different music input",
      status: 409,
      jobId: undefined,
    });
    expect(advances).toBe(0);
  });

  it("advances one accepted job and delivers its recorded artifact", async () => {
    let job = musicJob({ status: "accepted", output: null });
    let advances = 0;
    const result = await generateDurableMusicSynchronously(baseInput(), deps({
      createReceipt: async () => ({ ok: true, job, duplicate: false, spend: null }),
      getJob: async () => job,
      advance: async () => {
        advances += 1;
        job = musicJob({ status: "succeeded" });
      },
    }));

    expect(result.ok).toBe(true);
    expect(advances).toBe(1);
  });

  it("does not advance or cancel a durable job after the client disconnects", async () => {
    const controller = new AbortController();
    controller.abort();
    let advances = 0;
    const result = await generateDurableMusicSynchronously(
      { ...baseInput(), signal: controller.signal },
      deps({ advance: async () => { advances += 1; } }),
    );

    expect(result).toMatchObject({ ok: false, error: "client_closed_request", status: 499 });
    expect(advances).toBe(0);
  });

  it("returns a narrow recoverable status when the sync deadline leaves the job running", async () => {
    const job = musicJob({ status: "running", output: null });
    let clockReads = 0;
    const result = await generateDurableMusicSynchronously(baseInput(), deps({
      createReceipt: async () => ({ ok: true, job, duplicate: false, spend: null }),
      getJob: async () => job,
      now: () => clockReads++ === 0 ? 1_000 : 286_000,
    }));

    expect(result).toMatchObject({
      ok: false,
      error: "operation_pending",
      status: 504,
      jobId: "mjob_test",
    });
  });

  it("fails closed when stored bytes do not match the recorded digest", async () => {
    const job = musicJob({ status: "succeeded" });
    const result = await generateDurableMusicSynchronously(baseInput(), deps({
      createReceipt: async () => ({ ok: true, job, duplicate: false, spend: null }),
      getJob: async () => job,
      getArtifact: async () => ({
        body: new Uint8Array([9]),
        size: 1,
        contentType: "audio/wav",
        etag: "test",
        scope: "private" as const,
        storedAt: new Date("2026-07-31T00:00:00.000Z"),
        meta: {},
      }),
    }));

    expect(result).toMatchObject({ ok: false, status: 502 });
  });
});

function baseInput() {
  return {
    userId: "usr_test",
    operationId: "clip-operation-123",
    requestId: "req_test",
    prompt: "warm piano",
    duration: 10,
    styleMix: 0,
    melody: "",
    hum: null,
    generationBatchId: null,
    bill: true,
  };
}

function deps(overrides: Partial<DurableMusicSyncDeps> = {}): DurableMusicSyncDeps {
  const job = musicJob({ status: "accepted", output: null });
  return {
    createReceipt: async () => ({ ok: true, job, duplicate: false, spend: null }),
    getJob: async () => job,
    advance: async () => undefined,
    settle: async () => undefined,
    getArtifact: async () => ({
      body: bytes,
      size: bytes.byteLength,
      contentType: "audio/wav",
      etag: "test",
      scope: "private" as const,
      storedAt: new Date("2026-07-31T00:00:00.000Z"),
      meta: {},
    }),
    now: () => 1_000,
    delay: async () => undefined,
    ...overrides,
  };
}

function musicJob(overrides: Partial<MusicJob>): MusicJob {
  const now = new Date("2026-07-31T00:00:00.000Z");
  return {
    id: "mjob_test",
    userId: "usr_test",
    operationId: "clip-operation-123",
    requestHash: "a".repeat(64),
    status: "succeeded",
    input: {
      prompt: "warm piano",
      duration: 10,
      styleMix: 0,
      melody: "",
      humStorageKey: null,
      humContentType: null,
      generationBatchId: null,
    },
    output: {
      storageKey: "music/test.wav",
      contentType: "audio/wav",
      sizeBytes: bytes.byteLength,
      digest,
      model: "model-test",
      generationMs: 123,
      styleMix: "0",
    },
    provider: "runpod",
    providerJobId: "provider_test",
    spendLedgerId: "nle_test",
    leaseEpoch: 1,
    leaseUntil: null,
    providerSubmittedAt: now,
    deadlineAt: new Date(now.getTime() + 900_000),
    nextRunAt: null,
    cancelRequestedAt: null,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: now,
    ...overrides,
  };
}
