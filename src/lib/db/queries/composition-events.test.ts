import { describe, expect, it } from "bun:test";

import {
  buildGenerationEvidenceIdentity,
  listCompositionTrainingExamples,
} from "./composition-events";
import { normalizeConsentedUserIds } from "./composition-training-scope";

describe("composition training consent allowlist", () => {
  it("trims ids, filters empty values, and deduplicates before applying the limit", () => {
    const ids = ["", "  ", " user-0 ", "user-0"];
    for (let index = 1; index <= 500; index += 1) ids.push(` user-${index} `);

    const normalized = normalizeConsentedUserIds(ids);

    expect(normalized).toHaveLength(500);
    expect(normalized[0]).toBe("user-0");
    expect(normalized[499]).toBe("user-499");
    expect(normalized).not.toContain("");
  });

  it("short-circuits an empty normalized allowlist before querying", async () => {
    expect(await listCompositionTrainingExamples({
      consentedUserIds: ["", "   "],
    })).toEqual([]);
  });
});

describe("generation evidence identity", () => {
  it("requires batch, clip, and exact audio digest so retries cannot cross-link", () => {
    const base = {
      userId: "user-1",
      batchId: "batch-1",
      clipId: "clip-1",
      audioSha256: "A".repeat(64),
    };
    const identity = buildGenerationEvidenceIdentity(base);

    expect(identity).not.toBeNull();
    expect(identity).toContain("a".repeat(64));
    expect(buildGenerationEvidenceIdentity({ ...base, batchId: null })).toBeNull();
    expect(buildGenerationEvidenceIdentity({ ...base, audioSha256: "b".repeat(64) }))
      .not.toBe(identity);
  });
});
