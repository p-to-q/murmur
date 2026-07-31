import { beforeEach, describe, expect, it, mock } from "bun:test";
import type { NextRequest } from "next/server";

const inputs: Array<{ limit?: number; concurrency?: number }> = [];
let throws = false;
let summary = { reconciled: 0, candidates: 0, completed: 0, deferred: 0, failed: 0, objectsDeleted: 0 };

const runCleanup = mock(async (input: { limit?: number; concurrency?: number } = {}) => {
  inputs.push(input);
  if (throws) throw new Error("database unavailable");
  return summary;
});
const { createAccountDeletionCronHandler } = await import("./handler");
const GET = createAccountDeletionCronHandler(runCleanup);

beforeEach(() => {
  process.env.CRON_SECRET = "cron_test";
  inputs.length = 0;
  throws = false;
  runCleanup.mockClear();
  summary = { reconciled: 0, candidates: 0, completed: 0, deferred: 0, failed: 0, objectsDeleted: 0 };
});

function request(headers: Record<string, string> = {}, query = ""): NextRequest {
  return new Request(`http://test.local/api/account/cron/deletions${query}`, {
    headers,
  }) as unknown as NextRequest;
}

describe("GET /api/account/cron/deletions", () => {
  it("fails closed when CRON_SECRET is missing", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(request({ authorization: "Bearer cron_test" }))).status).toBe(500);
    expect(inputs).toHaveLength(0);
  });

  it("rejects an invalid bearer token", async () => {
    expect((await GET(request())).status).toBe(401);
    expect(inputs).toHaveLength(0);
  });

  it("passes bounded options to the cleanup runner", async () => {
    const response = await GET(request(
      { authorization: "Bearer cron_test" },
      "?limit=25&concurrency=3",
    ));
    expect(response.status).toBe(200);
    expect(inputs).toEqual([{ limit: 25, concurrency: 3 }]);
  });

  it("returns partial success while cleanup is deferred", async () => {
    summary = { reconciled: 0, candidates: 1, completed: 0, deferred: 1, failed: 0, objectsDeleted: 0 };
    const response = await GET(request({ authorization: "Bearer cron_test" }));
    expect(response.status).toBe(207);
  });

  it("rejects invalid options without invoking cleanup", async () => {
    expect((await GET(request(
      { authorization: "Bearer cron_test" },
      "?concurrency=6",
    ))).status).toBe(500);
    expect(inputs).toHaveLength(0);
  });

  it("does not expose internal cleanup failures", async () => {
    throws = true;
    const response = await GET(request({ authorization: "Bearer cron_test" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "account_deletion_cleanup_failed" });
  });
});
