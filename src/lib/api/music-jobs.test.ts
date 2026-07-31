import { afterEach, describe, expect, it } from "bun:test";

import { createFetchMock } from "@/test-utils/fetch";
import {
  recoverDurableMusicAudio,
  requestDurableMusicAudio,
  shouldCancelDurableJob,
} from "./music-jobs";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("durable music job cancellation", () => {
  it("keeps the server job alive when only the request deadline expires", () => {
    expect(shouldCancelDurableJob()).toBe(false);
    expect(shouldCancelDurableJob(AbortSignal.abort("navigation"))).toBe(false);
    expect(shouldCancelDurableJob(
      AbortSignal.abort("murmur:background-generation-canceled"),
    )).toBe(true);
    expect(shouldCancelDurableJob(
      AbortSignal.abort("murmur:generation-superseded"),
    )).toBe(true);
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
        jobId: `mjob_${"a".repeat(32)}`,
        status: "result_ready",
        currentBalance: 2,
        cost: 3,
        requestId: "req_result_ready",
      }, { status: 202 });
    });

    const response = await requestDurableMusicAudio({
      form: new FormData(),
      headers: { "x-generation-clip-id": "clip_result_ready" },
      operationId: "clip_result_ready",
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

  it("polls and delivers an accepted job without rebuilding or resending input", async () => {
    const jobId = "e2e-music-job-1";
    const calls: Array<{ url: string; method: string; body: BodyInit | null | undefined }> = [];
    let jobReads = 0;
    globalThis.fetch = createFetchMock(async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body });
      if (String(input) === `/api/music/jobs/${jobId}`) {
        jobReads += 1;
        return Response.json(jobReads === 1
          ? { jobId, status: "running" }
          : { jobId, status: "succeeded", audioUrl: `/api/music/jobs/${jobId}/audio` });
      }
      return new Response("durable audio", { status: 200, headers: { "Content-Type": "audio/wav" } });
    });

    const response = await recoverDurableMusicAudio({
      operationId: "clip_existing_operation",
      jobId,
      pollIntervalMs: 0,
    });

    expect(await response?.text()).toBe("durable audio");
    expect(calls.map((call) => call.url)).toEqual([
      `/api/music/jobs/${jobId}`,
      `/api/music/jobs/${jobId}`,
      `/api/music/jobs/${jobId}/audio`,
    ]);
    expect(calls.every((call) => call.method === "GET" && call.body == null)).toBe(true);
  });

  it("fails closed without constructing FormData when styled hum input is gone", async () => {
    let formBuilds = 0;
    const calls: string[] = [];
    globalThis.fetch = createFetchMock(async (input) => {
      calls.push(String(input));
      return Response.json({ error: "not_found" }, { status: 404 });
    });

    const response = await requestDurableMusicAudio({
      form: () => {
        formBuilds += 1;
        return new FormData();
      },
      headers: {},
      operationId: "clip_missing_hum",
      allowCreate: false,
    });

    expect(response.status).toBe(409);
    expect(formBuilds).toBe(0);
    expect(calls).toEqual([]);
  });
});
