import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { NextRequest } from "next/server";

const { GET } = await import("./route");
const originalSecret = process.env.CRON_SECRET;

beforeEach(() => {
  process.env.CRON_SECRET = "cron_test";
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalSecret;
});

describe("GET /api/storage/cron/song-audio", () => {
  it("fails closed without CRON_SECRET", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(request("cron_test"))).status).toBe(500);
  });

  it("rejects an invalid bearer token", async () => {
    expect((await GET(request("wrong"))).status).toBe(401);
  });
});

function request(token: string, query = ""): NextRequest {
  return new Request(`https://murmur.example/api/storage/cron/song-audio${query}`, {
    headers: {
      authorization: `Bearer ${token}`,
      "x-request-id": "req_audio_cleanup",
    },
  }) as unknown as NextRequest;
}
