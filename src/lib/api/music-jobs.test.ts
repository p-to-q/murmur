import { describe, expect, it } from "bun:test";

import { shouldCancelDurableJob } from "./music-jobs";

describe("durable music job cancellation", () => {
  it("keeps the server job alive when only the request deadline expires", () => {
    expect(shouldCancelDurableJob()).toBe(false);
    expect(shouldCancelDurableJob(AbortSignal.abort("batch canceled"))).toBe(true);
  });

  it("does not cancel an active batch signal", () => {
    expect(shouldCancelDurableJob(new AbortController().signal)).toBe(false);
  });
});
