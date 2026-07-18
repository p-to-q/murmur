import { afterEach, describe, expect, it } from "bun:test";

import { createMemoryStore } from "@/lib/storage/adapters/memory";
import { __setObjectStoreForTesting, type ObjectStore } from "@/lib/storage";
import { storeMusicJobOutput } from "./music-job-artifacts";

describe("storeMusicJobOutput", () => {
  afterEach(() => __setObjectStoreForTesting(null));

  it("stores successful paid output as permanent private content-addressed audio", async () => {
    const backing = createMemoryStore();
    let putOptions: Parameters<ObjectStore["put"]>[2] | null = null;
    const store: ObjectStore = {
      ...backing,
      put: async (key, body, options) => {
        putOptions = options;
        return backing.put(key, body, options);
      },
    };
    __setObjectStoreForTesting(store);

    const first = await storeMusicJobOutput({
      userId: "usr_owner",
      jobId: "mjob_one",
      bytes: new Uint8Array([82, 73, 70, 70]),
      contentType: "audio/wav",
    });
    const second = await storeMusicJobOutput({
      userId: "usr_owner",
      jobId: "mjob_two",
      bytes: new Uint8Array([82, 73, 70, 70]),
      contentType: "audio/wav",
    });

    expect(first.storageKey).toStartWith("music/jobs/usr_owner/_/");
    expect(second.storageKey).toBe(first.storageKey);
    expect(putOptions).toMatchObject({ scope: "private", contentType: "audio/wav" });
    expect(putOptions).not.toHaveProperty("ttlSeconds");
    expect(await store.get(first.storageKey)).not.toBeNull();
  });
});
