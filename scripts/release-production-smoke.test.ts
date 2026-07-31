import { describe, expect, it } from "bun:test";

import {
  assertReleaseIdentity,
  assertMusicHealth,
  parseReleaseIdentity,
} from "./release-production-smoke";

describe("production release smoke response parsing", () => {
  it("requires semantic music availability, not only HTTP 200", () => {
    expect(() => assertMusicHealth({ configured: true, available: true, reason: null }))
      .not.toThrow();
    expect(() => assertMusicHealth({ configured: true, available: false, reason: "unauthorized" }))
      .toThrow("music health unavailable");
  });
  it("reports the HTTP status before attempting to parse an error body", async () => {
    const response = new Response("upstream unavailable", { status: 502 });

    await expect(parseReleaseIdentity(response)).rejects.toThrow(
      "/api/release returned 502",
    );
  });

  it("parses the bounded runtime resource fingerprint", async () => {
    const response = new Response(JSON.stringify({
      version: "0.7.0-rc.2",
      build: "440",
      sha: "a".repeat(40),
      resourceFingerprint: "b".repeat(64),
    }));

    await expect(parseReleaseIdentity(response)).resolves.toEqual({
      version: "0.7.0-rc.2",
      build: "440",
      sha: "a".repeat(40),
      resourceFingerprint: "b".repeat(64),
    });
  });

  it("rejects a runtime resource fingerprint that differs from preflight", () => {
    expect(() => assertReleaseIdentity({
      version: "0.7.0-rc.2",
      build: "440",
      sha: "a".repeat(40),
      resourceFingerprint: "b".repeat(64),
    }, {
      version: "0.7.0-rc.2",
      build: "440",
      sha: "a".repeat(40),
      resourceFingerprint: "c".repeat(64),
    })).toThrow("release identity mismatch");
  });
});
