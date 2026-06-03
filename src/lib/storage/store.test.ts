import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createLocalFsStore } from "@/lib/storage/adapters/local-fs";
import { createMemoryStore } from "@/lib/storage/adapters/memory";
import {
  __resetObjectStoreForTesting,
  getObjectStore,
  StorageError,
  type ObjectStore,
} from "@/lib/storage";

interface AdapterCase {
  name: string;
  build: () => Promise<{ store: ObjectStore; cleanup: () => Promise<void> }>;
}

const adapters: AdapterCase[] = [
  {
    name: "memory",
    build: async () => ({
      store: createMemoryStore(),
      cleanup: async () => {},
    }),
  },
  {
    name: "local-fs",
    build: async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "murmur-storage-"));
      const store = createLocalFsStore({ root, urlPrefix: "/test/storage" });
      return {
        store,
        cleanup: async () => {
          await fs.rm(root, { recursive: true, force: true });
        },
      };
    },
  },
];

const sample = new Uint8Array([0x4d, 0x55, 0x52, 0x4d, 0x55, 0x52]); // "MURMUR"

for (const adapter of adapters) {
  describe(`ObjectStore contract — ${adapter.name}`, () => {
    let store: ObjectStore;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      const built = await adapter.build();
      store = built.store;
      cleanup = built.cleanup;
    });

    afterEach(async () => {
      await cleanup();
    });

    it("round-trips bytes, content-type, scope, and meta", async () => {
      const putResult = await store.put("tmp/_shared/_/sample.bin", sample, {
        contentType: "application/octet-stream",
        scope: "public",
        meta: { source: "contract-test" },
      });
      expect(putResult.key).toBe("tmp/_shared/_/sample.bin");
      expect(putResult.size).toBe(sample.byteLength);
      expect(putResult.scope).toBe("public");
      expect(putResult.url.endsWith("tmp/_shared/_/sample.bin")).toBe(true);

      const got = await store.get("tmp/_shared/_/sample.bin");
      expect(got).not.toBeNull();
      expect(got?.contentType).toBe("application/octet-stream");
      expect(got?.scope).toBe("public");
      expect(got?.meta).toEqual({ source: "contract-test" });
      expect(Array.from(got!.body)).toEqual(Array.from(sample));
    });

    it("defaults scope to private when unspecified", async () => {
      await store.put("tmp/_shared/_/private.bin", sample, {
        contentType: "application/octet-stream",
      });
      const got = await store.get("tmp/_shared/_/private.bin");
      expect(got?.scope).toBe("private");
    });

    it("returns null for missing keys", async () => {
      const got = await store.get("tmp/_shared/_/never-existed.bin");
      expect(got).toBeNull();
    });

    it("overwrites existing objects", async () => {
      const first = new Uint8Array([1, 2, 3]);
      const second = new Uint8Array([9, 9, 9, 9]);
      await store.put("tmp/_shared/_/over.bin", first, {
        contentType: "application/octet-stream",
      });
      await store.put("tmp/_shared/_/over.bin", second, {
        contentType: "application/octet-stream",
      });
      const got = await store.get("tmp/_shared/_/over.bin");
      expect(Array.from(got!.body)).toEqual(Array.from(second));
    });

    it("delete is idempotent and removes the body", async () => {
      await store.put("tmp/_shared/_/gone.bin", sample, {
        contentType: "application/octet-stream",
      });
      await store.delete("tmp/_shared/_/gone.bin");
      await store.delete("tmp/_shared/_/gone.bin"); // second delete must not throw
      const got = await store.get("tmp/_shared/_/gone.bin");
      expect(got).toBeNull();
    });

    it("honors ttlSeconds expiry on read", async () => {
      const past = new Uint8Array([7]);
      await store.put("tmp/_shared/_/expiring.bin", past, {
        contentType: "application/octet-stream",
        ttlSeconds: -1, // already expired
      });
      const got = await store.get("tmp/_shared/_/expiring.bin");
      expect(got).toBeNull();
    });

    it("isolates body copies — caller mutations don't leak into storage", async () => {
      const mutable = new Uint8Array([0xaa, 0xbb]);
      await store.put("tmp/_shared/_/copy.bin", mutable, {
        contentType: "application/octet-stream",
      });
      mutable[0] = 0xff;
      const got = await store.get("tmp/_shared/_/copy.bin");
      expect(got?.body[0]).toBe(0xaa);
    });

    it("rejects unsafe keys", async () => {
      await expect(
        store.put("../escape.bin", sample, { contentType: "application/octet-stream" }),
      ).rejects.toBeInstanceOf(StorageError);
      await expect(store.get("/abs.bin")).rejects.toBeInstanceOf(StorageError);
    });
  });
}

describe("getObjectStore factory", () => {
  const ENV_KEY = "MURMUR_STORAGE_DRIVER";
  let originalEnv: string | undefined;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env[ENV_KEY];
    originalNodeEnv = process.env.NODE_ENV;
    __resetObjectStoreForTesting();
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv;
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    __resetObjectStoreForTesting();
  });

  it("returns the memory store when MURMUR_STORAGE_DRIVER=memory", () => {
    process.env[ENV_KEY] = "memory";
    const store = getObjectStore();
    expect(store.driver).toBe("memory");
  });

  it("defaults to memory in test environments", () => {
    delete process.env[ENV_KEY];
    process.env.NODE_ENV = "test";
    const store = getObjectStore();
    expect(store.driver).toBe("memory");
  });

  it("refuses unknown drivers loudly", () => {
    process.env[ENV_KEY] = "rusty-bucket";
    expect(() => getObjectStore()).toThrow(StorageError);
  });

  it("refuses s3-compatible until the adapter ships", () => {
    process.env[ENV_KEY] = "s3-compatible";
    expect(() => getObjectStore()).toThrow(StorageError);
  });

  it("refuses an unset driver in production", () => {
    delete process.env[ENV_KEY];
    process.env.NODE_ENV = "production";
    expect(() => getObjectStore()).toThrow(StorageError);
  });
});
