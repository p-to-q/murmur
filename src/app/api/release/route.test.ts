import { afterEach, describe, expect, it } from "bun:test";
import { GET } from "./route";

const ENV_KEYS = [
  "NEXT_PUBLIC_APP_VERSION",
  "NEXT_PUBLIC_APP_BUILD",
  "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA",
] as const;

describe("GET /api/release", () => {
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("returns the complete immutable deployment identity without caching", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "0.7.0-rc.2";
    process.env.NEXT_PUBLIC_APP_BUILD = "440";
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA = "a".repeat(40);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      version: "0.7.0-rc.2",
      build: "440",
      sha: "a".repeat(40),
    });
  });
});
