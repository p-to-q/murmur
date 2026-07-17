import { afterEach, describe, expect, it } from "bun:test";
import { loadPublicSongOnce } from "./PublicSongScreen";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("loadPublicSongOnce", () => {
  it("classifies only missing responses as not found", async () => {
    globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch;
    expect(await loadPublicSongOnce("gone")).toEqual({ status: "not_found" });
  });

  it("rejects temporary failures instead of classifying the share as missing", async () => {
    globalThis.fetch = (async () => new Response(null, { status: 503 })) as typeof fetch;
    await expect(loadPublicSongOnce("still-here")).rejects.toThrow(
      "Public song request failed with status 503",
    );
  });
});
