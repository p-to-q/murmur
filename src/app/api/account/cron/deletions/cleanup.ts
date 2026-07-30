import {
  accountDeletionRetryAt,
  claimDueAccountDeletionJobs,
  countPendingAccountDeletionObjects,
  finalizeAccountDeletionPurge,
  listUnsettledAccountDeletionMusicJobs,
  listPendingAccountDeletionObjects,
  markAccountDeletionJobRetry,
  markAccountDeletionObjectDeleted,
  markAccountDeletionObjectRetry,
  snapshotAccountDeletionObjects,
} from "@/lib/db/queries/account-deletion";
import { log } from "@/lib/observability/log";
import { getObjectStore } from "@/lib/storage";
import { advanceMusicJob } from "@/lib/platform/music-job-runner";

const LEASE_MS = 5 * 60 * 1_000;

export interface AccountDeletionCleanupSummary {
  candidates: number;
  completed: number;
  deferred: number;
  failed: number;
  objectsDeleted: number;
}

export interface AccountDeletionCleanupDependencies {
  claimDue: typeof claimDueAccountDeletionJobs;
  snapshotObjects: typeof snapshotAccountDeletionObjects;
  listUnsettledMusicJobs: typeof listUnsettledAccountDeletionMusicJobs;
  advanceMusicJob: typeof advanceMusicJob;
  listPendingObjects: typeof listPendingAccountDeletionObjects;
  deleteObject: (storageKey: string) => Promise<void>;
  markObjectDeleted: typeof markAccountDeletionObjectDeleted;
  markObjectRetry: typeof markAccountDeletionObjectRetry;
  countPendingObjects: typeof countPendingAccountDeletionObjects;
  finalize: typeof finalizeAccountDeletionPurge;
  markJobRetry: typeof markAccountDeletionJobRetry;
  now: () => Date;
}

const DEFAULT_DEPENDENCIES: AccountDeletionCleanupDependencies = {
  claimDue: claimDueAccountDeletionJobs,
  snapshotObjects: snapshotAccountDeletionObjects,
  listUnsettledMusicJobs: listUnsettledAccountDeletionMusicJobs,
  advanceMusicJob,
  listPendingObjects: listPendingAccountDeletionObjects,
  deleteObject: (storageKey) => getObjectStore().delete(storageKey),
  markObjectDeleted: markAccountDeletionObjectDeleted,
  markObjectRetry: markAccountDeletionObjectRetry,
  countPendingObjects: countPendingAccountDeletionObjects,
  finalize: finalizeAccountDeletionPurge,
  markJobRetry: markAccountDeletionJobRetry,
  now: () => new Date(),
};

/**
 * Process deletion outbox entries. Each account is isolated so one storage or
 * DB failure cannot prevent other due accounts from being purged.
 */
export async function runAccountDeletionCleanup(
  options: { limit?: number; concurrency?: number } = {},
  dependencies: AccountDeletionCleanupDependencies = DEFAULT_DEPENDENCIES,
): Promise<AccountDeletionCleanupSummary> {
  const limit = clamp(options.limit ?? 10, 1, 50);
  const concurrency = clamp(options.concurrency ?? 2, 1, 5);
  const jobs = await dependencies.claimDue({ limit, leaseMs: LEASE_MS });
  const summary: AccountDeletionCleanupSummary = {
    candidates: jobs.length,
    completed: 0,
    deferred: 0,
    failed: 0,
    objectsDeleted: 0,
  };

  await runBounded(jobs, concurrency, async (job) => {
    const result = await processAccountDeletionJob(job, dependencies);
    summary.objectsDeleted += result.objectsDeleted;
    if (result.status === "completed") summary.completed += 1;
    else if (result.status === "deferred") summary.deferred += 1;
    else summary.failed += 1;
  });

  return summary;
}

async function processAccountDeletionJob(
  job: { userId: string; attempts: number },
  dependencies: AccountDeletionCleanupDependencies,
): Promise<{ status: "completed" | "deferred" | "failed"; objectsDeleted: number }> {
  const now = dependencies.now();
  let objectsDeleted = 0;
  try {
    const unsettledJobs = await dependencies.listUnsettledMusicJobs(job.userId);
    for (const musicJob of unsettledJobs) {
      await dependencies.advanceMusicJob(musicJob.userId, musicJob.id);
    }
    await dependencies.snapshotObjects(job.userId, now);
    const keys = await dependencies.listPendingObjects(job.userId, now);
    let storageFailed = false;

    for (const storageKey of keys) {
      try {
        await dependencies.deleteObject(storageKey);
        await dependencies.markObjectDeleted({ userId: job.userId, storageKey, now });
        objectsDeleted += 1;
      } catch (error) {
        storageFailed = true;
        const message = error instanceof Error ? error.message : String(error);
        await dependencies.markObjectRetry({
          userId: job.userId,
          storageKey,
          error: message,
          nextAttemptAt: accountDeletionRetryAt(job.attempts, now),
          now,
        });
        log("account.delete_object_failed", {
          storageKey,
          reason: message,
        }, { userId: job.userId, level: "warn" });
      }
    }

    const pendingObjects = await dependencies.countPendingObjects(job.userId);
    if (storageFailed || pendingObjects > 0) {
      await dependencies.markJobRetry({
        userId: job.userId,
        error: `account deletion has ${pendingObjects} pending object(s)`,
        nextAttemptAt: accountDeletionRetryAt(job.attempts, now),
        now,
      });
      return { status: "deferred", objectsDeleted };
    }

    const completed = await dependencies.finalize({ userId: job.userId, now });
    if (!completed) {
      await dependencies.markJobRetry({
        userId: job.userId,
        error: "account deletion references changed during finalization",
        nextAttemptAt: accountDeletionRetryAt(job.attempts, now),
        now,
      });
    }
    return { status: completed ? "completed" : "deferred", objectsDeleted };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await dependencies.markJobRetry({
      userId: job.userId,
      error: message,
      nextAttemptAt: accountDeletionRetryAt(job.attempts, now),
      now,
    }).catch(() => undefined);
    log("account.delete_cleanup_failed", { reason: message }, {
      userId: job.userId,
      level: "error",
    });
    return { status: "failed", objectsDeleted };
  }
}

async function runBounded<T>(
  items: T[],
  concurrency: number,
  action: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  await Promise.all(Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const item = items[cursor];
        cursor += 1;
        await action(item);
      }
    },
  ));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
