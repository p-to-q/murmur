import { describe, expect, it } from "bun:test";

import { getRequestId, isValidRequestId } from "./request-id";

describe("request ids", () => {
  it("accepts bounded correlation-safe client ids", () => {
    expect(isValidRequestId("req_music:clip-1.2")).toBe(true);
    const request = { headers: new Headers({ "x-request-id": "req_music:clip-1.2" }) };
    expect(getRequestId(request as never)).toBe("req_music:clip-1.2");
  });

  it("replaces unsafe or high-cardinality headers", () => {
    for (const value of ["contains spaces", "semi;colon", "x".repeat(129), "../escape"]) {
      const request = { headers: new Headers({ "x-request-id": value }) };
      const resolved = getRequestId(request as never);
      expect(resolved).not.toBe(value);
      expect(isValidRequestId(resolved)).toBe(true);
    }
  });
});
