import { describe, expect, it } from "bun:test";

import { listCompositionTrainingExamples } from "./composition-events";
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
