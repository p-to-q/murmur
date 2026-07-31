import { afterEach, describe, expect, it } from "bun:test";
import {
  RELEASE_RESOURCE_FINGERPRINT_KEYS,
  releaseResourceFingerprint,
} from "@/lib/platform/release-resource-fingerprint";
import { GET } from "./route";

const ENV_KEYS = [
  "NEXT_PUBLIC_APP_VERSION",
  "NEXT_PUBLIC_APP_BUILD",
  "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA",
  "DATABASE_URL",
  "POSTGRES_URL",
  ...RELEASE_RESOURCE_FINGERPRINT_KEYS,
] as const;

describe("GET /api/release", () => {
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("returns the complete immutable deployment identity without caching", async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = "0.7.0-rc.2";
    process.env.NEXT_PUBLIC_APP_BUILD = "440";
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA = "a".repeat(40);
    for (const key of RELEASE_RESOURCE_FINGERPRINT_KEYS) {
      process.env[key] = `release-${key}`;
    }

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      version: "0.7.0-rc.2",
      build: "440",
      sha: "a".repeat(40),
      resourceFingerprint: releaseResourceFingerprint(),
    });
  });

  it("binds the fingerprint to the actual runtime database identity", async () => {
    process.env.MURMUR_DATABASE_RESOURCE_ID = "sha256:stale-marker";
    process.env.DATABASE_URL = "postgresql://user:secret@db.example/murmur";
    for (const key of RELEASE_RESOURCE_FINGERPRINT_KEYS) {
      if (process.env[key] === undefined) process.env[key] = `release-${key}`;
    }

    const response = await GET();
    const body = await response.json() as { resourceFingerprint: string };

    expect(body.resourceFingerprint).toBe(releaseResourceFingerprint(process.env));
    delete process.env.DATABASE_URL;
    expect(body.resourceFingerprint).not.toBe(releaseResourceFingerprint(process.env));
  });
});
