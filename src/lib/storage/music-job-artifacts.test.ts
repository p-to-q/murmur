import { afterEach, describe, expect, it } from "bun:test";

import { createMemoryStore } from "@/lib/storage/adapters/memory";
import { __setObjectStoreForTesting, type ObjectStore } from "@/lib/storage";
import { storeMusicJobHum, storeMusicJobOutput } from "./music-job-artifacts";

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

describe("storeMusicJobHum", () => {
  afterEach(() => __setObjectStoreForTesting(null));

  it("isolates temporary hums by operation while keeping a content digest", async () => {
    const store = createMemoryStore();
    __setObjectStoreForTesting(store);
    const first = await storeMusicJobHum({
      userId: "usr_owner",
      operationId: "clip_one",
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/webm",
    });
    const second = await storeMusicJobHum({
      userId: "usr_owner",
      operationId: "clip_two",
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "audio/webm",
    });
    expect(first.digest).toBe(second.digest);
    expect(first.key).not.toBe(second.key);
  });
});
