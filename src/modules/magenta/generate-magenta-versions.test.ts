import { afterEach, describe, expect, it } from "bun:test";
import { useMurmurStore } from "@/lib/store/murmur-store";
import type { CleanMelody } from "@/modules/shared/types";
import {
  cancelActiveGeneration,
  createMagentaVersions,
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

    expect(fetches.requestCount()).toBe(3);
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
    expect(fetches.requestCount()).toBe(3);

    regenerateVersionAudio(canceled[0]!);
    expect(useMurmurStore.getState().vibeVersions[0]?.generation?.status).toBe("pending");
    expect(fetches.requestCount()).toBe(4);

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
});
