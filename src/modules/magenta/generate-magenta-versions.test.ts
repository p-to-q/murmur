import { afterEach, describe, expect, it } from "bun:test";
import { useMurmurStore } from "@/lib/store/murmur-store";
import type { CleanMelody, VibeVersion } from "@/modules/shared/types";
import {
  cancelActiveGeneration,
  createMagentaVersions,
  recoverVersionAudio,
  regenerateVersionAudio,
} from "./generate-magenta-versions";

const originalFetch = globalThis.fetch;

const melody: CleanMelody = {
  notes: [
    { pitch: 60, start: 0, duration: 0.5, velocity: 0.8, confidence: 0.9 },
    { pitch: 64, start: 0.5, duration: 0.5, velocity: 0.8, confidence: 0.9 },
    { pitch: 67, start: 1, duration: 0.5, velocity: 0.8, confidence: 0.9 },
  ],
  key: "C",
  scale: "major",
  bpm: 88,
  duration: 1.5,
  contour: "rising",
};

function installAbortableFetch(): { requestCount: () => number } {
  let requests = 0;
  globalThis.fetch = ((_input, init) => {
    requests += 1;
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }) as typeof fetch;
  return { requestCount: () => requests };
}

function installFailingFetch(): { requestCount: () => number } {
  let requests = 0;
  globalThis.fetch = (() => {
    requests += 1;
    return Promise.resolve(new Response("unavailable", { status: 503 }));
  }) as typeof fetch;
  return { requestCount: () => requests };
}

function installSuccessfulFetch(): void {
  globalThis.fetch = (() => Promise.resolve(new Response(
    new Blob(["generated audio"], { type: "audio/wav" }),
    { status: 200 },
  ))) as typeof fetch;
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function startPendingBatch() {
  const versions = createMagentaVersions(melody, {
    draftId: "draft_background_cancel",
    originFlowId: "flow_background_cancel",
    sourceType: "hum",
    sourceMelodyKind: "corrected",
    batchIndex: 0,
  });
  useMurmurStore.getState().setVibeVersions(versions);
  return versions;
}

afterEach(() => {
  cancelActiveGeneration();
  useMurmurStore.getState().resetFlow();
  globalThis.fetch = originalFetch;
});

describe("Magenta generation cancellation recovery", () => {
  it("settles pending cards as retryable errors after sustained background cancellation", async () => {
    const fetches = installAbortableFetch();
    startPendingBatch();

    expect(fetches.requestCount()).toBe(2);
    cancelActiveGeneration("background");
    await flushAsyncWork();

    const canceled = useMurmurStore.getState().vibeVersions;
    expect(canceled.map((version) => version.generation?.status)).toEqual([
      "error",
      "error",
      "error",
    ]);
    expect(canceled.map((version) => version.generation?.errorCode)).toEqual([
      "background_canceled",
      "background_canceled",
      "background_canceled",
    ]);
    expect(fetches.requestCount()).toBe(2);

    regenerateVersionAudio(canceled[0]!);
    expect(useMurmurStore.getState().vibeVersions[0]?.generation?.status).toBe("pending");
    expect(fetches.requestCount()).toBe(3);

    cancelActiveGeneration("background");
    await flushAsyncWork();
    expect(useMurmurStore.getState().vibeVersions[0]?.generation?.errorCode)
      .toBe("background_canceled");
  });

  it("keeps navigation cancellation silent for versions leaving the screen", async () => {
    installAbortableFetch();
    startPendingBatch();

    cancelActiveGeneration();
    await flushAsyncWork();

    expect(useMurmurStore.getState().vibeVersions.map((version) => version.generation?.status))
      .toEqual(["pending", "pending", "pending"]);
  });

  it("clears stale generated audio when retrying with a new operation", async () => {
    installSuccessfulFetch();
    const versions = startPendingBatch();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      if (useMurmurStore.getState().vibeVersions[0]?.generation?.status === "ready") break;
      await flushAsyncWork();
    }
    const readyVersion = useMurmurStore.getState().vibeVersions[0]!;
    const previousUrl = readyVersion.generation?.audioUrl;
    const staleVersion = {
      ...versions[0]!,
      generation: {
        ...readyVersion.generation!,
        status: "error" as const,
        error: "previous attempt failed",
        errorCode: "network_error" as const,
      },
    };
    useMurmurStore.getState().setVibeVersions([
      staleVersion,
      ...useMurmurStore.getState().vibeVersions.slice(1),
    ]);
    const revoked: string[] = [];
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.revokeObjectURL = (url) => revoked.push(url);
    installAbortableFetch();

    try {
      regenerateVersionAudio(staleVersion);
    } finally {
      URL.revokeObjectURL = originalRevokeObjectURL;
    }

    expect(previousUrl).toStartWith("blob:");
    expect(useMurmurStore.getState().vibeVersions[0]?.generation?.status).toBe("pending");
    expect(useMurmurStore.getState().vibeVersions[0]?.generation?.audioUrl).toBeUndefined();
    expect(useMurmurStore.getState().vibeVersions[0]?.generation?.audioSha256).toBeUndefined();
    expect(revoked).toEqual([previousUrl!]);
  });

  it("clears a restored stale identity before a same-operation resume fails", async () => {
    installAbortableFetch();
    const versions = createMagentaVersions(melody, {
      draftId: "draft_resume",
      originFlowId: "flow_resume",
      sourceType: "hum",
      sourceMelodyKind: "corrected",
      batchIndex: 0,
    });
    cancelActiveGeneration();
    await flushAsyncWork();
    const fetches = installFailingFetch();
    const staleVersion = {
      ...versions[0]!,
      generation: {
        ...versions[0]!.generation!,
        status: "ready" as const,
        audioSha256: "b".repeat(64),
        error: undefined,
        errorCode: undefined,
      },
    };
    useMurmurStore.getState().setVibeVersions([staleVersion]);

    await recoverVersionAudio(staleVersion);
    await flushAsyncWork();

    const generation = useMurmurStore.getState().vibeVersions[0]?.generation;
    expect(fetches.requestCount()).toBe(1);
    expect(generation?.status).toBe("error");
    expect(generation?.audioUrl).toBeUndefined();
    expect(generation?.audioSha256).toBeUndefined();
  });

  it("reuses the paid operation after a delivery integrity failure", () => {
    installAbortableFetch();
    const [version] = startPendingBatch();
    cancelActiveGeneration();
    const failed = {
      ...version!,
      generation: {
        ...version!.generation!,
        status: "error" as const,
        error: "digest mismatch",
        errorCode: "delivery_integrity" as const,
      },
    };
    useMurmurStore.getState().setVibeVersions([failed]);

    regenerateVersionAudio(failed);

    expect(useMurmurStore.getState().vibeVersions[0]?.generation?.operationId)
      .toBe(version!.generation!.operationId);
  });

  it("reuses the operation when a durable result is waiting for Notes settlement", () => {
    installAbortableFetch();
    const [version] = startPendingBatch();
    cancelActiveGeneration();
    const failed = {
      ...version!,
      generation: {
        ...version!.generation!,
        status: "error" as const,
        error: "Generated audio is waiting for Notes settlement",
        errorCode: "insufficient_notes" as const,
        currentBalance: 0,
        cost: 1,
      },
    };
    useMurmurStore.getState().setVibeVersions([failed]);

    regenerateVersionAudio(failed);

    expect(useMurmurStore.getState().vibeVersions[0]?.generation?.operationId)
      .toBe(version!.generation!.operationId);
  });

  it("keeps the accepted job after polling disconnects and retries it without resending hum", async () => {
    const previousFlag = process.env.NEXT_PUBLIC_MURMUR_DURABLE_MUSIC_JOBS;
    delete process.env.NEXT_PUBLIC_MURMUR_DURABLE_MUSIC_JOBS;
    const jobId = `mjob_${"c".repeat(32)}`;
    const calls: Array<{ url: string; method: string; hasBody: boolean }> = [];
    let phase: "disconnect" | "deliver" = "disconnect";
    let reads = 0;
    globalThis.fetch = ((input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET", hasBody: init?.body != null });
      if (url === `/api/music/jobs?operationId=clip_restore_123`) {
        return Promise.resolve(Response.json({
          jobId,
          status: "succeeded",
          audioUrl: `/api/music/jobs/${jobId}/audio`,
        }));
      }
      if (url === `/api/music/jobs/${jobId}`) {
        reads += 1;
        if (phase === "disconnect") return Promise.reject(new TypeError("network disconnected"));
        return Promise.resolve(Response.json({
          jobId,
          status: "succeeded",
          audioUrl: `/api/music/jobs/${jobId}/audio`,
        }));
      }
      if (url === `/api/music/jobs/${jobId}/audio`) {
        if (phase === "disconnect") return Promise.reject(new TypeError("network disconnected"));
        return Promise.resolve(new Response(new Blob(["audio"], { type: "audio/wav" })));
      }
      return Promise.reject(new Error(`unexpected request ${url}`));
    }) as typeof fetch;

    const [base] = createMagentaVersions(melody, {
      draftId: "draft_restore",
      originFlowId: "flow_restore",
      sourceType: "hum",
      sourceMelodyKind: "corrected",
      batchIndex: 0,
      humBlob: new Blob(["original hum"], { type: "audio/webm" }),
    });
    cancelActiveGeneration();
    await flushAsyncWork();
    calls.length = 0;
    const restored: VibeVersion = {
      ...base!,
      generation: {
        ...base!.generation!,
        status: "pending" as const,
        operationId: "clip_restore_123",
        jobId: undefined,
        error: undefined,
        errorCode: undefined,
      },
    };
    useMurmurStore.getState().setVibeVersions([restored]);
    useMurmurStore.getState().setHumStyleBlob(null);

    try {
      await recoverVersionAudio(restored);
      await flushAsyncWork();
      const disconnected = useMurmurStore.getState().vibeVersions[0]!.generation!;
      expect(disconnected).toMatchObject({
        status: "error",
        errorCode: "operation_pending",
        operationId: "clip_restore_123",
        jobId,
      });

      phase = "deliver";
      reads = 0;
      regenerateVersionAudio(useMurmurStore.getState().vibeVersions[0]!);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        if (useMurmurStore.getState().vibeVersions[0]?.generation?.status === "ready") break;
        await flushAsyncWork();
      }
      const ready = useMurmurStore.getState().vibeVersions[0]!.generation!;
      expect(ready.operationId).toBe("clip_restore_123");
      expect(ready.jobId).toBe(jobId);
      expect(ready.status).toBe("ready");
      expect(reads).toBeGreaterThan(0);
      expect(calls.some((call) => call.url === "/api/music/generate")).toBe(false);
      expect(calls.every((call) => call.method === "GET" && !call.hasBody)).toBe(true);
    } finally {
      if (previousFlag === undefined) delete process.env.NEXT_PUBLIC_MURMUR_DURABLE_MUSIC_JOBS;
      else process.env.NEXT_PUBLIC_MURMUR_DURABLE_MUSIC_JOBS = previousFlag;
    }
  });

  it("keeps operation and job identity when explicitly retrying operation_pending", () => {
    installAbortableFetch();
    const [version] = startPendingBatch();
    cancelActiveGeneration();
    const jobId = `mjob_${"e".repeat(32)}`;
    const pending = {
      ...version!,
      generation: {
        ...version!.generation!,
        status: "error" as const,
        error: "Generation is still running",
        errorCode: "operation_pending" as const,
        jobId,
      },
    };
    useMurmurStore.getState().setVibeVersions([pending]);

    regenerateVersionAudio(pending);

    const retried = useMurmurStore.getState().vibeVersions[0]!.generation!;
    expect(retried.operationId).toBe(version!.generation!.operationId);
    expect(retried.jobId).toBe(jobId);
  });
});
