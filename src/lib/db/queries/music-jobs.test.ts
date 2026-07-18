import { describe, expect, it } from "bun:test";

import { nextMusicJobCancellationStatus } from "./music-jobs";

describe("music job cancellation transitions", () => {
  it("preserves intent while provider submission may be in flight", () => {
    expect(nextMusicJobCancellationStatus({
      status: "running",
      providerJobId: null,
      output: null,
    })).toBe("cancel_requested");
  });

  it("cancels accepted work before provider submission", () => {
    expect(nextMusicJobCancellationStatus({
      status: "accepted",
      providerJobId: null,
      output: null,
    })).toBe("canceled");
  });

  it("never refunds cancellation after durable output exists", () => {
    expect(nextMusicJobCancellationStatus({
      status: "result_ready",
      providerJobId: "provider-1",
      output: {} as never,
    })).toBe("terminal");
  });
});
