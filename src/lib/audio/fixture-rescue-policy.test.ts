import { describe, expect, it } from "bun:test";
import {
  INITIAL_FIXTURE_RESCUE_STATE,
  noteFixtureRescueUsed,
  noteLiveFailure,
  noteLiveSuccess,
  parseFixtureRescueState,
  serializeFixtureRescueState,
  shouldAutoRescueWithFixture,
} from "./fixture-rescue-policy";

describe("fixture rescue policy", () => {
  it("allows one transient rescue after prior live success", () => {
    const state = noteLiveSuccess(INITIAL_FIXTURE_RESCUE_STATE);
    expect(
      shouldAutoRescueWithFixture({
        state,
        code: "worker_unavailable",
        now: 2_000,
      }),
    ).toBe(true);
  });

  it("does not auto-rescue cold-start failures", () => {
    expect(
      shouldAutoRescueWithFixture({
        state: INITIAL_FIXTURE_RESCUE_STATE,
        code: "network_error",
        now: 2_000,
      }),
    ).toBe(false);
  });

  it("stops auto-rescue once transient failures keep repeating", () => {
    const healthy = noteLiveSuccess(INITIAL_FIXTURE_RESCUE_STATE);
    const failed = noteLiveFailure(healthy, "worker_unavailable", 1_000);
    expect(
      shouldAutoRescueWithFixture({
        state: failed,
        code: "worker_unavailable",
        now: 20_000,
      }),
    ).toBe(false);
  });

  it("does not keep masking a sustained outage with repeated rescues", () => {
    const rescued = noteFixtureRescueUsed(
      noteLiveFailure(
        noteLiveSuccess(INITIAL_FIXTURE_RESCUE_STATE),
        "worker_unavailable",
        1_000,
      ),
    );
    expect(
      shouldAutoRescueWithFixture({
        state: rescued,
        code: "worker_unavailable",
        now: 5 * 60_000,
      }),
    ).toBe(false);
  });

  it("allows a later isolated transient rescue after cooldown", () => {
    const rescued = noteFixtureRescueUsed(
      noteLiveFailure(
        noteLiveSuccess(INITIAL_FIXTURE_RESCUE_STATE),
        "worker_unavailable",
        1_000,
      ),
    );
    expect(
      shouldAutoRescueWithFixture({
        state: rescued,
        code: "worker_unavailable",
        now: 11 * 60_000,
      }),
    ).toBe(true);
  });

  it("never auto-rescues fundamental audio errors", () => {
    const state = noteLiveSuccess(INITIAL_FIXTURE_RESCUE_STATE);
    expect(
      shouldAutoRescueWithFixture({
        state,
        code: "no_voiced_frames",
      }),
    ).toBe(false);
  });

  it("round-trips serialized state", () => {
    const state = noteLiveFailure(
      noteLiveSuccess(INITIAL_FIXTURE_RESCUE_STATE),
      "billing_unavailable",
      1234,
    );
    expect(parseFixtureRescueState(serializeFixtureRescueState(state))).toEqual(
      state,
    );
  });
});
