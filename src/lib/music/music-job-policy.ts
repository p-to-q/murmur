export const MUSIC_JOB_DEADLINE_MS = 15 * 60_000;
export const MUSIC_PROVIDER_NOT_FOUND_GRACE_MS = 60_000;

export function musicJobDeadlineFrom(createdAt: Date): Date {
  return new Date(createdAt.getTime() + MUSIC_JOB_DEADLINE_MS);
}

export function musicJobNextPollAt(
  status: "queued" | "running",
  now = new Date(),
): Date {
  return new Date(now.getTime() + (status === "running" ? 3_000 : 5_000));
}

export function isMusicJobDeadlineReached(deadlineAt: Date, now = new Date()): boolean {
  return deadlineAt.getTime() <= now.getTime();
}

export function shouldExpireProviderNotFound(
  providerSubmittedAt: Date | null,
  deadlineAt: Date,
  now = new Date(),
): boolean {
  if (isMusicJobDeadlineReached(deadlineAt, now)) return true;
  if (!providerSubmittedAt) return false;
  return providerSubmittedAt.getTime() + MUSIC_PROVIDER_NOT_FOUND_GRACE_MS <= now.getTime();
}
