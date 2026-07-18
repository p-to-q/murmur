import { describe, expect, it } from "bun:test";

import { normalizeAuthUrl } from "./env";

describe("auth env", () => {
  it("normalizes common production auth origins", () => {
    expect(normalizeAuthUrl("murmur.example.com/")).toBe("https://murmur.example.com");
    expect(normalizeAuthUrl("'https://murmur.example.com/'")).toBe("https://murmur.example.com");
    expect(normalizeAuthUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeAuthUrl("http://[::1]:3000/")).toBe("http://[::1]:3000");
  });

  it("ignores malformed auth URLs so trustHost can handle request-time origins", () => {
    expect(normalizeAuthUrl("[SENSITIVE]")).toBeUndefined();
    expect(normalizeAuthUrl("mailto:hello@example.com")).toBeUndefined();
    expect(normalizeAuthUrl("   ")).toBeUndefined();
  });
});
