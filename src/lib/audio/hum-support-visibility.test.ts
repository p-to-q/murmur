import { describe, expect, it } from "bun:test";
import {
  INITIAL_FIXTURE_RESCUE_STATE,
  noteLiveFailure,
  noteLiveSuccess,
} from "@/lib/audio/fixture-rescue-policy";
import { shouldShowHumSupportCode } from "./hum-support-visibility";

describe("shouldShowHumSupportCode", () => {
  it("shows support code for hard failures immediately", () => {
    expect(
      shouldShowHumSupportCode({
        code: "worker_unconfigured",
        state: INITIAL_FIXTURE_RESCUE_STATE,
      }),
    ).toBe(true);
  });

  it("hides the first transient blip after known-good live use", () => {
    const healthy = noteLiveSuccess(INITIAL_FIXTURE_RESCUE_STATE);
    const failed = noteLiveFailure(healthy, "worker_unavailable", 1_000);

    expect(
      shouldShowHumSupportCode({
        code: "worker_unavailable",
        state: failed,
      }),
    ).toBe(false);
  });

  it("shows support code when a transient failure happens before any live success", () => {
    const failed = noteLiveFailure(
      INITIAL_FIXTURE_RESCUE_STATE,
      "network_error",
      1_000,
    );

    expect(
      shouldShowHumSupportCode({
        code: "network_error",
        state: failed,
      }),
    ).toBe(true);
  });

  it("shows support code when transient failures become persistent", () => {
    const healthy = noteLiveSuccess(INITIAL_FIXTURE_RESCUE_STATE);
    const first = noteLiveFailure(healthy, "worker_unavailable", 1_000);
    const second = noteLiveFailure(first, "worker_unavailable", 61_500);

    expect(
      shouldShowHumSupportCode({
        code: "worker_unavailable",
        state: second,
      }),
    ).toBe(true);
  });

  it("keeps product-handled capture issues human and code-free", () => {
    expect(
      shouldShowHumSupportCode({
        code: "no_voiced_frames",
        state: INITIAL_FIXTURE_RESCUE_STATE,
      }),
    ).toBe(false);
  });
});
