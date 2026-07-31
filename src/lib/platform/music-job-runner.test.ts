import { afterEach, describe, expect, it, mock } from "bun:test";

import {
  attachProviderAfterSubmission,
  buildDurableMusicGenerationEvidence,
  decodeMusicJobProviderAudio,
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

  it("fails and refunds a rejected provider delivery even after output was observed", () => {
    expect(musicJobFailureDisposition({
      hasRecordedOutput: false,
      providerOutputObserved: true,
      hasProviderJobId: true,
      errorKind: null,
      outputRejected: true,
    })).toBe("fail_refund");
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

describe("music job provider delivery", () => {
  it("maps a fenced durable result to the same generation evidence identity", () => {
    expect(buildDurableMusicGenerationEvidence({
      id: "mjob_evidence",
      userId: "usr_evidence",
      operationId: "clip_evidence",
      input: { generationBatchId: "batch_evidence", duration: 10, styleMix: 0.35 },
      output: {
        storageKey: "music/usr_evidence/mjob_evidence.wav",
        contentType: "audio/wav",
        sizeBytes: 1024,
        digest: "a".repeat(64),
        model: "mrt2_base",
        generationMs: 100,
        styleMix: "0.35",
      },
    })).toMatchObject({
      requestId: "mjob_evidence",
      batchId: "batch_evidence",
      clipId: "clip_evidence",
      outputSha256: "a".repeat(64),
      outputBytes: 1024,
    });
  });

  it("rejects a terminal provider success without audio", () => {
    expect(() => decodeMusicJobProviderAudio({}, 10)).toThrow("provider_audio_missing");
  });

  it("rejects oversized base64 before decoding it", () => {
    const oversized = "A".repeat(4 * 1024 * 1024);
    expect(() => decodeMusicJobProviderAudio({ audio_b64: oversized }, 2))
      .toThrow("payload_too_large");
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

  it("deletes the submitted hum when provider attachment returns false", async () => {
    const backing = createMemoryStore();
    const remove = mock(async (key: string) => backing.delete(key));
    __setObjectStoreForTesting({ ...backing, delete: remove });

    const attached = await attachProviderAfterSubmission({
      input: { humStorageKey: "tmp/usr/_/hum.wav", humDigest: "a".repeat(64) },
      jobId: "mjob_attach_false",
      userId: "usr_attach_false",
      attach: async () => false,
    });

    expect(attached).toBe(false);
    expect(remove).toHaveBeenCalledWith("tmp/usr/_/hum.wav");
  });

  it("deletes the submitted hum when provider attachment throws", async () => {
    const backing = createMemoryStore();
    const remove = mock(async (key: string) => backing.delete(key));
    __setObjectStoreForTesting({ ...backing, delete: remove });

    await expect(attachProviderAfterSubmission({
      input: { humStorageKey: "tmp/usr/_/hum.wav", humDigest: "b".repeat(64) },
      jobId: "mjob_attach_error",
      userId: "usr_attach_error",
      attach: async () => {
        throw new Error("attach failed");
      },
    })).rejects.toThrow("attach failed");
    expect(remove).toHaveBeenCalledWith("tmp/usr/_/hum.wav");
  });
});
