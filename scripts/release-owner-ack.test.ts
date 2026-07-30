import { describe, expect, test } from "bun:test";

import { collectOwnerAcknowledgementIssues } from "./release-owner-ack";

const now = Date.parse("2026-07-30T10:00:00Z");

describe("release owner acknowledgement", () => {
  test("accepts an exact, recent dashboard acknowledgement", () => {
    expect(collectOwnerAcknowledgementIssues({
      disabled: "true",
      verifiedAt: "2026-07-29T10:00:00Z",
      now,
    })).toEqual([]);
  });

  test("rejects false, stale, malformed, or future acknowledgements", () => {
    expect(collectOwnerAcknowledgementIssues({ disabled: "TRUE", now })).toEqual([
      "Vercel native Production auto-deploy is not acknowledged as disabled",
      "Vercel Production cutover verification timestamp is missing or invalid",
    ]);
    expect(collectOwnerAcknowledgementIssues({
      disabled: "true",
      verifiedAt: "2026-07-20T10:00:00Z",
      now,
    })).toContain("Vercel Production cutover must be re-verified within seven days of release");
    expect(collectOwnerAcknowledgementIssues({
      disabled: "true",
      verifiedAt: "2026-07-31T10:00:00Z",
      now,
    })).toContain("Vercel Production cutover verification timestamp is in the future");
  });
});
