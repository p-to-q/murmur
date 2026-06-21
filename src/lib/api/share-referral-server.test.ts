import { describe, expect, it } from "bun:test";

import { readShareReferrerFromCookieHeader } from "./share-referral-server";

describe("share referral server helpers", () => {
  it("reads and normalizes the referral cookie", () => {
    expect(readShareReferrerFromCookieHeader("theme=dark; murmur_ref=usr_referrer"))
      .toBe("usr_referrer");
  });

  it("ignores malformed encoded referral cookies", () => {
    expect(readShareReferrerFromCookieHeader("murmur_ref=%E0%A4%A")).toBeNull();
  });
});
