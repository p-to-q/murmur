import { describe, expect, it } from "bun:test";
import { ApiTimeoutError, fetchWithTimeout, withTimeout } from "./timeout";

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

describe("fetchWithTimeout", () => {
  it("preserves a caller cancellation instead of reporting a timeout", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_input, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
          once: true,
        });
      })) as typeof fetch;

    try {
      const controller = new AbortController();
      const request = fetchWithTimeout("https://example.test", {
        signal: controller.signal,
      }, 1_000);
      const cancellation = new DOMException("Navigation changed", "AbortError");
      controller.abort(cancellation);
      await expect(request).rejects.toBe(cancellation);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("maps only its own deadline to ApiTimeoutError", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_input, init) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), {
          once: true,
        });
      })) as typeof fetch;

    try {
      await expect(
        fetchWithTimeout("https://example.test", {}, 1),
      ).rejects.toBeInstanceOf(ApiTimeoutError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
