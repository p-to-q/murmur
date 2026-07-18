import { describe, expect, it } from "bun:test";

import {
  musicJobFailureDisposition,
  shouldReleaseMusicJobLease,
} from "./music-job-runner";

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
