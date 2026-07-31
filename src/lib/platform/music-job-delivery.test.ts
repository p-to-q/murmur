import { describe, expect, it } from "bun:test";

import type { MusicJob } from "@/lib/db/schema/music-jobs";
import { MusicJobSettlementError } from "./music-job-runner";
import { resolveMusicJobDelivery } from "./music-job-delivery";

describe("music job delivery resolution", () => {
  it("settles and reloads a recorded result before exposing it", async () => {
    const ready = job("result_ready");
    const succeeded = job("succeeded");
    const result = await resolveMusicJobDelivery(ready, {
      settle: async () => undefined,
      getJob: async () => succeeded,
    });

    expect(result).toEqual({ ok: true, job: succeeded });
  });

  it("returns a typed recoverable balance failure without losing the result", async () => {
    const ready = job("result_ready");
    const result = await resolveMusicJobDelivery(ready, {
      settle: async () => {
        throw new MusicJobSettlementError("insufficient_notes", 0);
      },
      getJob: async () => ready,
    });

    expect(result).toEqual({
      ok: false,
      reason: "insufficient_notes",
      job: ready,
      currentBalance: 0,
    });
  });

  it("fails closed when settlement succeeds but the durable transition is not observable", async () => {
    const ready = job("result_ready");
    const result = await resolveMusicJobDelivery(ready, {
      settle: async () => undefined,
      getJob: async () => ready,
    });

    expect(result).toEqual({ ok: false, reason: "settlement_unavailable", job: ready });
  });

  it("keeps a post-settlement reload failure on the recoverable operation", async () => {
    const ready = job("result_ready");
    const result = await resolveMusicJobDelivery(ready, {
      settle: async () => undefined,
      getJob: async () => {
        throw new Error("database temporarily unavailable");
      },
    });

    expect(result).toEqual({ ok: false, reason: "settlement_unavailable", job: ready });
  });
});

function job(status: MusicJob["status"]): MusicJob {
  const now = new Date("2026-07-31T00:00:00.000Z");
  return {
    id: "mjob_delivery",
    userId: "usr_delivery",
    operationId: "clip_delivery",
    requestHash: "a".repeat(64),
    status,
    input: {
      prompt: "warm piano",
      duration: 10,
      styleMix: 0,
      melody: "",
      humStorageKey: null,
      humContentType: null,
      generationBatchId: null,
    },
    output: status === "result_ready" || status === "succeeded"
      ? {
          storageKey: "music/delivery.wav",
          contentType: "audio/wav",
          sizeBytes: 4,
          digest: "b".repeat(64),
          model: "model-test",
          generationMs: 10,
          styleMix: "0",
        }
      : null,
    provider: "runpod",
    providerJobId: "provider_delivery",
    spendLedgerId: "nle_delivery",
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
    finishedAt: status === "succeeded" ? now : null,
  };
}
