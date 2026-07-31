import { afterEach, describe, expect, it } from "bun:test";

import { createFetchMock } from "@/test-utils/fetch";
import { requestDurableMusicAudio, shouldCancelDurableJob } from "./music-jobs";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("durable music job cancellation", () => {
  it("keeps the server job alive when only the request deadline expires", () => {
    expect(shouldCancelDurableJob()).toBe(false);
    expect(shouldCancelDurableJob(AbortSignal.abort("batch canceled"))).toBe(true);
  });

  it("does not cancel an active batch signal", () => {
    expect(shouldCancelDurableJob(new AbortController().signal)).toBe(false);
  });
});

describe("durable music job settlement recovery", () => {
  it("returns a recoverable 402 without polling when a durable result awaits settlement", async () => {
    const requests: string[] = [];
    globalThis.fetch = createFetchMock(async (input) => {
      requests.push(String(input));
      return Response.json({
        jobId: "mjob_result_ready",
        status: "result_ready",
        currentBalance: 2,
        cost: 3,
        requestId: "req_result_ready",
      }, { status: 202 });
    });

    const response = await requestDurableMusicAudio({
      form: new FormData(),
      headers: { "x-generation-clip-id": "clip_result_ready" },
    });

    expect(requests).toEqual(["/api/music/jobs"]);
    expect(response.status).toBe(402);
    expect(await response.json()).toEqual({
      error: "insufficient_notes",
      message: "Generated audio is ready and waiting for Notes settlement. Retry this operation to recover it.",
      jobStatus: "result_ready",
      recoverable: true,
      currentBalance: 2,
      cost: 3,
      requestId: "req_result_ready",
    });
  });
});
