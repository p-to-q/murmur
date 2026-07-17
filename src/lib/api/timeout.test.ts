import { describe, expect, it } from "bun:test";
import { ApiTimeoutError, withTimeout } from "./timeout";

describe("withTimeout", () => {
  it("resolves when the work completes before the deadline", async () => {
    await expect(withTimeout(Promise.resolve("ok"), 50)).resolves.toBe("ok");
  });

  it("rejects with ApiTimeoutError when work takes too long", async () => {
    await expect(
      withTimeout(new Promise(() => {}), 1),
    ).rejects.toBeInstanceOf(ApiTimeoutError);
  });
});
