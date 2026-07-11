import { afterEach, describe, expect, it, mock } from "bun:test";
import { setTestNodeEnv } from "@/test-utils/env";

let getCallCount = 0;

mock.module("@/lib/storage/adapters/local-fs", () => ({
  createLocalFsStore: () => ({
    driver: "local-fs",
    put: async () => {
      throw new Error("put should not be called");
    },
    delete: async () => {},
    url: () => "/api/storage/local/private/song.wav",
    get: async () => {
      getCallCount += 1;
      return {
        body: new Uint8Array([1, 2, 3]),
        contentType: "audio/wav",
        size: 3,
        scope: "private" as const,
        meta: {},
        storedAt: new Date(),
      };
    },
  }),
}));

const { GET } = await import("./route");

const params = Promise.resolve({ key: ["private", "song.wav"] });

afterEach(() => {
  delete process.env.MURMUR_STORAGE_DRIVER;
  if (process.env.NODE_ENV === "production") {
    setTestNodeEnv("test");
  }
  getCallCount = 0;
});

describe("GET /api/storage/local/[...key]", () => {
  it("refuses to serve local-fs objects in production even when explicitly configured", async () => {
    setTestNodeEnv("production");
    process.env.MURMUR_STORAGE_DRIVER = "local-fs";

    const response = await GET(new Request("https://murmur.example/api/storage/local/private/song.wav"), {
      params,
    });

    expect(response.status).toBe(404);
    expect(getCallCount).toBe(0);
  });

  it("serves local-fs objects outside production", async () => {
    setTestNodeEnv("test");
    process.env.MURMUR_STORAGE_DRIVER = "local-fs";

    const response = await GET(new Request("http://localhost/api/storage/local/private/song.wav"), {
      params,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Murmur-Storage-Scope")).toBe("private");
    expect(getCallCount).toBe(1);
  });
});
