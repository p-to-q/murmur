import { afterEach, describe, expect, it, mock } from "bun:test";

import {
  deleteSubmittedHum,
  musicJobFailureDisposition,
  shouldReleaseMusicJobLease,
} from "./music-job-runner";
import { __setObjectStoreForTesting, type ObjectStore } from "@/lib/storage";
import { createMemoryStore } from "@/lib/storage/adapters/memory";

describe("music job terminal safety", () => {
  it("never refunds after provider output was observed", () => {
    expect(musicJobFailureDisposition({
      hasRecordedOutput: false,
      providerOutputObserved: true,
      hasProviderJobId: true,
      errorKind: null,
    })).toBe("resume");
  });

  it("replays settlement when a durable result already exists", () => {
    expect(musicJobFailureDisposition({
      hasRecordedOutput: true,
      providerOutputObserved: false,
      hasProviderJobId: true,
      errorKind: null,
    })).toBe("resume");
  });

  it("keeps polling the same provider job after a transient status failure", () => {
    expect(musicJobFailureDisposition({
      hasRecordedOutput: false,
      providerOutputObserved: false,
      hasProviderJobId: true,
      errorKind: "http",
    })).toBe("resume");
  });

  it("fails and refunds an unrecoverable error before any result", () => {
    expect(musicJobFailureDisposition({
      hasRecordedOutput: false,
      providerOutputObserved: false,
      hasProviderJobId: false,
      errorKind: null,
    })).toBe("fail_refund");
  });
});

describe("music job polling lease", () => {
  it("releases the lease after every non-terminal provider status read", () => {
    expect(shouldReleaseMusicJobLease("queued")).toBe(true);
    expect(shouldReleaseMusicJobLease("running")).toBe(true);
  });

  it("keeps terminal transitions responsible for clearing their own lease", () => {
    expect(shouldReleaseMusicJobLease("succeeded")).toBe(false);
    expect(shouldReleaseMusicJobLease("failed")).toBe(false);
    expect(shouldReleaseMusicJobLease("canceled")).toBe(false);
    expect(shouldReleaseMusicJobLease("expired")).toBe(false);
  });
});

describe("music job hum retention", () => {
  afterEach(() => __setObjectStoreForTesting(null));

  it("eagerly deletes a submitted hum once its digest is durable", async () => {
    const backing = createMemoryStore();
    const remove = mock(async (key: string) => backing.delete(key));
    const store: ObjectStore = { ...backing, delete: remove };
    __setObjectStoreForTesting(store);
    await deleteSubmittedHum({ humStorageKey: "tmp/usr/_/hum.wav", humDigest: "a".repeat(64) });
    expect(remove).toHaveBeenCalledWith("tmp/usr/_/hum.wav");
  });

  it("does not delete legacy hums that lack a persisted verification digest", async () => {
    const backing = createMemoryStore();
    const remove = mock(async (key: string) => backing.delete(key));
    __setObjectStoreForTesting({ ...backing, delete: remove });
    await deleteSubmittedHum({ humStorageKey: "tmp/usr/_/hum.wav", humDigest: null });
    expect(remove).not.toHaveBeenCalled();
  });
});
