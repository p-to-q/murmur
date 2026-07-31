import { describe, expect, it } from "bun:test";

import { verifyHttpConditioningHeaders } from "./music-http-output";
import { maxMusicDeliveryBytes } from "./music-worker-output";

describe("HTTP music Worker conditioning evidence", () => {
  it("accepts evidence for every requested signal", () => {
    const headers = new Headers({
      "x-style-mix": "0.35",
      "x-melody-conditioned": "1",
      "x-melody-segments": "2",
      "x-melody-coverage": "0.6",
    });
    expect(verifyHttpConditioningHeaders(headers, {
      humPresent: true,
      styleMix: 0.35,
      melody: "{\"notes\":[]}",
    }, true)).toBeNull();
  });

  it("rejects missing detailed melody evidence after cutover", () => {
    const headers = new Headers({ "x-melody-conditioned": "1" });
    expect(verifyHttpConditioningHeaders(headers, {
      humPresent: false,
      styleMix: 0,
      melody: "{\"notes\":[]}",
    }, true)).toBe("worker_melody_conditioning_evidence_invalid");
  });
});

describe("HTTP music Worker delivery budget", () => {
  it("scales the shared byte limit with requested duration", () => {
    expect(maxMusicDeliveryBytes(2) - maxMusicDeliveryBytes(1)).toBe(96_000 * 2 * 2);
  });
});
