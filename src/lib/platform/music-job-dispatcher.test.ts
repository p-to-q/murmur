import { describe, expect, it, mock } from "bun:test";

import { dispatchDueMusicJobs } from "./music-job-dispatcher";

describe("durable music job dispatcher", () => {
  it("refunds expired unknown submissions and advances every due candidate", async () => {
    const refunded: string[] = [];
    const advanced: string[] = [];
    const summary = await dispatchDueMusicJobs(
      { limit: 10, concurrency: 2 },
      {
        terminalizeExpiredSubmissions: mock(async () => [
          { id: "unknown-1", userId: "user-1" },
        ]) as never,
        listRunnable: mock(async () => [
          { id: "job-1", userId: "user-1" },
          { id: "job-2", userId: "user-2" },
        ]),
        refundTerminal: mock(async (_userId, jobId) => {
          refunded.push(jobId);
        }),
        advance: mock(async (_userId, jobId) => {
          advanced.push(jobId);
        }),
      },
    );

    expect(refunded).toEqual(["unknown-1"]);
    expect(advanced.sort()).toEqual(["job-1", "job-2"]);
    expect(summary).toEqual({
      candidates: 2,
      attempted: 2,
      failed: 0,
      submissionUnknown: 1,
      refundFailed: 0,
    });
  });

  it("continues after one candidate fails", async () => {
    const advanced: string[] = [];
    const summary = await dispatchDueMusicJobs(
      { concurrency: 1 },
      {
        terminalizeExpiredSubmissions: mock(async () => []) as never,
        listRunnable: mock(async () => [
          { id: "job-fail", userId: "user-1" },
          { id: "job-ok", userId: "user-1" },
        ]),
        refundTerminal: mock(async () => {}),
        advance: mock(async (_userId, jobId) => {
          advanced.push(jobId);
          if (jobId === "job-fail") throw new Error("transient");
        }),
      },
    );

    expect(advanced).toEqual(["job-fail", "job-ok"]);
    expect(summary.failed).toBe(1);
    expect(summary.attempted).toBe(2);
  });

  it("continues dispatching when immediate refund falls back unsuccessfully", async () => {
    const advanced: string[] = [];
    const summary = await dispatchDueMusicJobs(
      { concurrency: 1 },
      {
        terminalizeExpiredSubmissions: mock(async () => [
          { id: "unknown-1", userId: "user-1" },
        ]) as never,
        listRunnable: mock(async () => [{ id: "job-ok", userId: "user-2" }]),
        refundTerminal: mock(async () => {
          throw new Error("ledger unavailable");
        }),
        advance: mock(async (_userId, jobId) => {
          advanced.push(jobId);
        }),
      },
    );

    expect(advanced).toEqual(["job-ok"]);
    expect(summary.refundFailed).toBe(1);
  });
});
