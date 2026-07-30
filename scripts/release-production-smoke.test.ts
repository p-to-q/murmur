import { describe, expect, it } from "bun:test";

import { parseReleaseIdentity } from "./release-production-smoke";

describe("production release smoke response parsing", () => {
  it("reports the HTTP status before attempting to parse an error body", async () => {
    const response = new Response("upstream unavailable", { status: 502 });

    await expect(parseReleaseIdentity(response)).rejects.toThrow(
      "/api/release returned 502",
    );
  });
});
