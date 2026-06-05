import { describe, expect, it } from "bun:test";
import { hashSessionToken } from "./sessions";

describe("session query helpers", () => {
  it("hashes opaque session tokens without exposing the token", () => {
    const hash = hashSessionToken("tok_example");

    expect(hash).toHaveLength(64);
    expect(hash).not.toContain("tok_example");
    expect(hashSessionToken("tok_example")).toBe(hash);
    expect(hashSessionToken("tok_other")).not.toBe(hash);
  });
});
