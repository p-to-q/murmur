import { getMusicJobForUser } from "@/lib/db/queries/music-jobs";
import type { MusicJob } from "@/lib/db/schema/music-jobs";
import {
  MusicJobSettlementError,
  settleRecordedResult,
} from "@/lib/platform/music-job-runner";

interface MusicJobDeliveryDeps {
  settle: typeof settleRecordedResult;
  getJob: typeof getMusicJobForUser;
}

const defaultDeps: MusicJobDeliveryDeps = {
  settle: settleRecordedResult,
  getJob: getMusicJobForUser,
};

export type MusicJobDeliveryResolution =
  | { ok: true; job: MusicJob }
  | {
      ok: false;
      reason: "insufficient_notes";
      job: MusicJob;
      currentBalance: number;
    }
  | {
      ok: false;
      reason: "settlement_unavailable";
      job: MusicJob;
    };

/** Resolve a recorded result synchronously so APIs never expose result_ready as open-ended polling. */
export async function resolveMusicJobDelivery(
  job: MusicJob,
  deps: MusicJobDeliveryDeps = defaultDeps,
): Promise<MusicJobDeliveryResolution> {
  if (job.status !== "result_ready") return { ok: true, job };

  try {
    await deps.settle(job);
  } catch (error) {
    if (error instanceof MusicJobSettlementError && error.reason === "insufficient_notes") {
      return {
        ok: false,
        reason: "insufficient_notes",
        job,
        currentBalance: error.currentBalance ?? 0,
      };
    }
    return { ok: false, reason: "settlement_unavailable", job };
  }

  let settled: MusicJob | null;
  try {
    settled = await deps.getJob(job.userId, job.id);
  } catch {
    return { ok: false, reason: "settlement_unavailable", job };
  }
  return settled?.status === "succeeded"
    ? { ok: true, job: settled }
    : { ok: false, reason: "settlement_unavailable", job };
}
