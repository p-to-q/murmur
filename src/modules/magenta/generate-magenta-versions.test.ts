import { afterEach, describe, expect, it } from "bun:test";
import { useMurmurStore } from "@/lib/store/murmur-store";
import type { CleanMelody } from "@/modules/shared/types";
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
});
