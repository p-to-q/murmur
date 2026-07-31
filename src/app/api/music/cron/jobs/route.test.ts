import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";

const dispatchInputs: Array<{ limit?: number; concurrency?: number }> = [];
let dispatchThrows = false;
let summary = {
  candidates: 0,
  attempted: 0,
  failed: 0,
  submissionUnknown: 0,
  refundFailed: 0,
};

mock.module("@/lib/platform/music-job-dispatcher", () => ({
  dispatchDueMusicJobs: mock(async (input: { limit?: number; concurrency?: number }) => {
    dispatchInputs.push(input);
    if (dispatchThrows) throw new Error("database unavailable");
    return summary;
  }),
}));

const { GET } = await import("./route");

beforeEach(() => {
  process.env.CRON_SECRET = "cron_test";
  dispatchInputs.length = 0;
  dispatchThrows = false;
  summary = {
    candidates: 0,
    attempted: 0,
    failed: 0,
    submissionUnknown: 0,
    refundFailed: 0,
  };
});

function buildRequest(
  headers: Record<string, string> = {},
  url = "http://test.local/api/music/cron/jobs",
): NextRequest {
  return new Request(url, { headers }) as unknown as NextRequest;
}

describe("GET /api/music/cron/jobs", () => {
  it("requires CRON_SECRET", async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(buildRequest({ authorization: "Bearer cron_test" }));
    expect(response.status).toBe(500);
    expect(dispatchInputs).toHaveLength(0);
  });

  it("rejects unauthorized requests", async () => {
    const response = await GET(buildRequest());
    expect(response.status).toBe(401);
    expect(dispatchInputs).toHaveLength(0);
  });

  it("dispatches due jobs with bounded options", async () => {
    summary = {
      candidates: 4,
      attempted: 4,
      failed: 0,
      submissionUnknown: 1,
      refundFailed: 0,
    };
    const response = await GET(buildRequest(
      { authorization: "Bearer cron_test" },
      "http://test.local/api/music/cron/jobs?limit=25&concurrency=3",
    ));
    expect(response.status).toBe(200);
    expect(dispatchInputs).toEqual([{ limit: 25, concurrency: 3 }]);
    expect(await response.json()).toEqual(summary);
  });

  it("returns partial success when one candidate fails", async () => {
    summary = {
      candidates: 2,
      attempted: 2,
      failed: 1,
      submissionUnknown: 0,
      refundFailed: 0,
    };
    const response = await GET(buildRequest({ authorization: "Bearer cron_test" }));
    expect(response.status).toBe(207);
  });

  it("rejects invalid dispatch options", async () => {
    const response = await GET(buildRequest(
      { authorization: "Bearer cron_test" },
      "http://test.local/api/music/cron/jobs?concurrency=11",
    ));
    expect(response.status).toBe(500);
    expect(dispatchInputs).toHaveLength(0);
  });

  it("does not expose internal dispatch errors", async () => {
    dispatchThrows = true;
    const response = await GET(buildRequest({ authorization: "Bearer cron_test" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "dispatch_failed" });
  });
});
