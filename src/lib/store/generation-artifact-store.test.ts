import { describe, expect, it } from "bun:test";

import {
  isClipArtifactExpired,
  sweepExpiredClipArtifacts,
} from "./generation-artifact-store";

describe("generation artifact retention", () => {
  it("expires generated clip bytes after 24 hours", () => {
    const now = Date.parse("2026-07-30T00:00:00.000Z");
    const day = 24 * 60 * 60 * 1_000;

    expect(isClipArtifactExpired(now - day + 1, now)).toBe(false);
    expect(isClipArtifactExpired(now - day, now)).toBe(true);
    expect(isClipArtifactExpired(0, now)).toBe(true);
    expect(isClipArtifactExpired(Number.NaN, now)).toBe(true);
  });

  it("keeps startup cleanup best-effort when IndexedDB is unavailable", async () => {
    expect(typeof indexedDB).toBe("undefined");
    await expect(sweepExpiredClipArtifacts()).resolves.toBe(false);
  });
});
