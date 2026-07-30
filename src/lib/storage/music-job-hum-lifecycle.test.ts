import { describe, expect, it } from "bun:test";

import { shouldDeleteDuplicateHum } from "./music-job-hum-lifecycle";

describe("duplicate music job hum lifecycle", () => {
  it("deletes a newly uploaded hum when a duplicate job retains another key", () => {
    expect(shouldDeleteDuplicateHum({
      storedHumKey: "tmp/usr/hum_new.webm",
      duplicate: true,
      jobHumStorageKey: "tmp/usr/hum_original.webm",
    })).toBe(true);
  });

  it("retains the hum referenced by the duplicate job", () => {
    expect(shouldDeleteDuplicateHum({
      storedHumKey: "tmp/usr/hum_original.webm",
      duplicate: true,
      jobHumStorageKey: "tmp/usr/hum_original.webm",
    })).toBe(false);
  });

  it("does not delete hum input for a newly created job", () => {
    expect(shouldDeleteDuplicateHum({
      storedHumKey: "tmp/usr/hum_new.webm",
      duplicate: false,
      jobHumStorageKey: "tmp/usr/hum_new.webm",
    })).toBe(false);
  });
});
