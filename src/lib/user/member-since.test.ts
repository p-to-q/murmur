import { describe, expect, it } from "bun:test";
import { ulid } from "ulid";

import { formatMemberSince, memberSinceFromUserId } from "./member-since";

describe("memberSinceFromUserId", () => {
  it("returns a date for valid ULIDs", () => {
    const id = ulid();
    const joined = memberSinceFromUserId(id);
    expect(joined).toBeInstanceOf(Date);
  });

  it("returns null for guest ids", () => {
    expect(memberSinceFromUserId("guest")).toBeNull();
  });
});

describe("formatMemberSince", () => {
  it("formats with locale", () => {
    const id = ulid();
    expect(formatMemberSince(id, "en")).toMatch(/\w{3}/);
    expect(formatMemberSince("guest", "en")).toBeNull();
  });
});
