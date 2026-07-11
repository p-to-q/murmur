import { describe, expect, test } from "bun:test";
import {
  clearRecordingBlob,
  loadRecordingBlob,
  saveRecordingBlob,
} from "./recording-cache";

// The bun test environment has no `indexedDB` global — the same situation a
// browser presents in Safari private mode or when storage is disabled. The
// helper must degrade to a safe no-op so HumScreen behaves exactly as it would
// with no cache at all (issue #234).
describe("recording-cache graceful degradation", () => {
  test("indexedDB is unavailable in this environment", () => {
    expect(typeof indexedDB).toBe("undefined");
  });

  test("saveRecordingBlob resolves false instead of throwing", async () => {
    const blob = new Blob(["hum"], { type: "audio/webm" });
    await expect(saveRecordingBlob(blob)).resolves.toBe(false);
  });

  test("loadRecordingBlob resolves null instead of throwing", async () => {
    await expect(loadRecordingBlob()).resolves.toBeNull();
  });

  test("clearRecordingBlob resolves without throwing", async () => {
    await expect(clearRecordingBlob()).resolves.toBeUndefined();
  });
});
