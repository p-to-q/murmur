import {
  listRunnableMusicJobs,
  terminalizeExpiredSubmittingJobs,
} from "@/lib/db/queries/music-jobs";
import { log } from "@/lib/observability/log";
import {
  advanceMusicJob,
  refundTerminalMusicJob,
} from "@/lib/platform/music-job-runner";

interface DispatchDependencies {
  listRunnable: typeof listRunnableMusicJobs;
  terminalizeExpiredSubmissions: typeof terminalizeExpiredSubmittingJobs;
  advance: typeof advanceMusicJob;
  refundTerminal: typeof refundTerminalMusicJob;
}

export interface MusicJobDispatchSummary {
  candidates: number;
  attempted: number;
  failed: number;
  submissionUnknown: number;
  refundFailed: number;
}

const DEFAULT_DEPENDENCIES: DispatchDependencies = {
  listRunnable: listRunnableMusicJobs,
  terminalizeExpiredSubmissions: terminalizeExpiredSubmittingJobs,
  advance: advanceMusicJob,
  refundTerminal: refundTerminalMusicJob,
};

/**
 * Advances due jobs independently of browser polling. Claims still happen in
 * the query layer, so overlapping cron invocations are fenced by the DB lease.
 */
export async function dispatchDueMusicJobs(
  options: { limit?: number; concurrency?: number } = {},
  dependencies: DispatchDependencies = DEFAULT_DEPENDENCIES,
): Promise<MusicJobDispatchSummary> {
  const limit = clamp(options.limit ?? 20, 1, 100);
  const concurrency = clamp(options.concurrency ?? 4, 1, 10);
  const expiredSubmissions = await dependencies.terminalizeExpiredSubmissions({ limit });
  let refundFailed = 0;

  await runBounded(expiredSubmissions, concurrency, async (job) => {
    try {
      await dependencies.refundTerminal(job.userId, job.id);
    } catch (error) {
      refundFailed += 1;
      log("music.dispatch_refund_failed", {
        jobId: job.id,
        reason: error instanceof Error ? error.message : String(error),
      }, { userId: job.userId, level: "error" });
    }
  });

  const jobs = await dependencies.listRunnable({ limit });
  let attempted = 0;
  let failed = 0;
  await runBounded(jobs, concurrency, async (job) => {
    attempted += 1;
    try {
      await dependencies.advance(job.userId, job.id);
    } catch (error) {
      failed += 1;
      log("music.dispatch_job_failed", {
        jobId: job.id,
        reason: error instanceof Error ? error.message : String(error),
      }, { userId: job.userId, level: "error" });
    }
  });

  return {
    candidates: jobs.length,
    attempted,
    failed,
    submissionUnknown: expiredSubmissions.length,
    refundFailed,
  };
}

async function runBounded<T>(
  items: T[],
  concurrency: number,
  action: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const item = items[cursor];
        cursor += 1;
        await action(item);
      }
    },
  );
  await Promise.all(workers);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
