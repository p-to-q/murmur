import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { NextRequest } from "next/server";

const { GET } = await import("./route");
const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  if (process.env.NODE_ENV === "production") {
    process.env.NODE_ENV = "test";
  }
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe("GET /api/qa/i18n", () => {
  it("returns the typed i18n audit snapshot", async () => {
    const response = await GET(buildRequest());
    expect(response.status).toBe(200);

    const body = await response.json() as {
      status: string;
      missingCount: number;
      missing: Array<{ key: string; locations: string[] }>;
      cached: boolean;
    };

    expect(body.status).toBe(body.missingCount > 0 ? "missing" : "ok");
    expect(Array.isArray(body.missing)).toBe(true);
    expect(typeof body.cached).toBe("boolean");
  });

  it("does not expose source path audits on public production hosts", async () => {
    process.env.NODE_ENV = "production";

    const response = await GET(buildRequest("https://murmur.example/api/qa/i18n"));

    expect(response.status).toBe(404);
  });

  it("keeps loopback production smoke checks usable", async () => {
    process.env.NODE_ENV = "production";

    const response = await GET(buildRequest("http://localhost:3000/api/qa/i18n"));

    expect(response.status).toBe(200);
  });
});

function buildRequest(url = "http://test.local/api/qa/i18n"): NextRequest {
  return new Request(url) as unknown as NextRequest;
}
