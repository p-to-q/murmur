import { describe, expect, it } from "bun:test";

import {
  isMusicJobDeadlineReached,
  MUSIC_JOB_DEADLINE_MS,
  musicJobDeadlineFrom,
  musicJobNextPollAt,
  shouldExpireProviderNotFound,
} from "./music-job-policy";

describe("durable music job policy", () => {
  it("gives every accepted job a bounded lifetime", () => {
    const createdAt = new Date("2026-07-30T00:00:00Z");
    expect(musicJobDeadlineFrom(createdAt).getTime() - createdAt.getTime())
      .toBe(MUSIC_JOB_DEADLINE_MS);
  });

  it("polls running work sooner than queued work", () => {
    const now = new Date("2026-07-30T00:00:00Z");
    expect(musicJobNextPollAt("running", now).getTime())
      .toBeLessThan(musicJobNextPollAt("queued", now).getTime());
  });

  it("treats the exact deadline as expired", () => {
    const deadline = new Date("2026-07-30T00:15:00Z");
    expect(isMusicJobDeadlineReached(deadline, deadline)).toBe(true);
  });

  it("allows provider status propagation before treating 404 as terminal", () => {
    const submittedAt = new Date("2026-07-30T10:00:00.000Z");
    const deadlineAt = new Date("2026-07-30T10:15:00.000Z");
    expect(shouldExpireProviderNotFound(
      submittedAt,
      deadlineAt,
      new Date("2026-07-30T10:00:59.999Z"),
    )).toBe(false);
    expect(shouldExpireProviderNotFound(
      submittedAt,
      deadlineAt,
      new Date("2026-07-30T10:01:00.000Z"),
    )).toBe(true);
  });
});
