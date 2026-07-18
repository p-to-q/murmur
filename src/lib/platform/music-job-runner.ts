import {
  attachMusicJobProvider,
  claimMusicJob,
  confirmMusicJobCanceled,
  failMusicJob,
  getMusicJobForUser,
  markMusicJobSubmissionUnknown,
  recordMusicJobResult,
  releaseMusicJobLease,
  renewMusicJobLease,
  succeedMusicJob,
} from "@/lib/db/queries/music-jobs";
import {
  recordPendingRefund,
  refundNotes,
  settleOperationDelivery,
} from "@/lib/db/queries/notes-ledger";
import { log } from "@/lib/observability/log";
import { getMusicServerlessConfig } from "@/lib/platform/music-worker";
import {
  cancelSubmittedJob,
  getJobStatus,
  RunpodError,
  submitJob,
} from "@/lib/platform/runpod-serverless";
import { getObjectStore } from "@/lib/storage";
import { storeMusicJobOutput } from "@/lib/storage/music-job-artifacts";

const LEASE_MS = 45_000;

/**
 * Advance one durable job. It may be called after creation or from any later
 * GET resume. The DB lease prevents two requests from polling/submitting the
 * same job concurrently; provider id and terminal output remain durable even
 * when the request that started work disappears.
 */
export async function advanceMusicJob(userId: string, jobId: string): Promise<void> {
  const initial = await getMusicJobForUser(userId, jobId);
  if (!initial) return;
  if (initial.output && initial.status === "result_ready") {
    try {
      await settleRecordedResult(initial);
    } catch (error) {
      log("music.job_settlement_deferred", {
        jobId,
        reason: error instanceof Error ? error.message : String(error),
      }, { userId, level: "warn" });
    }
    return;
  }
  const config = getMusicServerlessConfig();
  if (!config) {
    await refundJobSpend(initial, "worker_unconfigured");
    await failMusicJob({ userId, jobId, errorCode: "worker_unconfigured", errorMessage: "RunPod is not configured" });
    return;
  }

  const claimed = await claimMusicJob({ userId, jobId, leaseMs: LEASE_MS });
  if (!claimed) return;

  let providerJobId = claimed.providerJobId;
  let providerOutputObserved = false;
  try {
    if (claimed.output) {
      await settleRecordedResult(claimed);
      return;
    }
    if (!providerJobId) {
      const providerInput = await buildProviderInput(claimed.input, jobId);
      let submitted: Awaited<ReturnType<typeof submitJob>>;
      try {
        submitted = await submitJob(config, providerInput);
      } catch (error) {
        if (error instanceof RunpodError && error.kind === "submission_unknown") {
          const unknown = await markMusicJobSubmissionUnknown({
            userId,
            jobId,
            errorMessage: error.message,
          });
          if (unknown) await refundJobSpend(unknown, "submission_unknown");
          log("music.job_submission_unknown", { jobId }, { userId, level: "error" });
          return;
        }
        throw error;
      }
      providerJobId = submitted.providerJobId;
      const attached = await attachMusicJobProvider({
        userId,
        jobId,
        attempt: claimed.attempt,
        provider: "runpod",
        providerJobId,
        leaseMs: LEASE_MS,
      });
      if (!attached) {
        await cancelSubmittedJob(config, providerJobId).catch(() => false);
        throw new Error("music_job_provider_attach_failed");
      }
      if (submitted.immediateOutput) {
        providerOutputObserved = true;
        await completeFromProviderOutput(
          userId,
          jobId,
          claimed.attempt,
          submitted.immediateOutput,
        );
        return;
      }
      if (attached.status === "cancel_requested") {
        if (await cancelSubmittedJob(config, providerJobId)) {
          const canceled = await confirmMusicJobCanceled(userId, jobId, claimed.attempt);
          if (canceled) await refundJobSpend(canceled, "user_canceled");
        }
        return;
      }
      return;
    }

    const current = await getMusicJobForUser(userId, jobId);
    if (!current || current.status === "canceled") return;
    if (current.status === "cancel_requested") {
      if (await cancelSubmittedJob(config, providerJobId)) {
        const canceled = await confirmMusicJobCanceled(userId, jobId, claimed.attempt);
        if (canceled) await refundJobSpend(canceled, "user_canceled");
        return;
      }
      const state = await getJobStatus(config, providerJobId);
      if (state.status === "succeeded") {
        providerOutputObserved = true;
        await completeFromProviderOutput(userId, jobId, claimed.attempt, state.output);
      } else if (state.status === "canceled") {
        const canceled = await confirmMusicJobCanceled(userId, jobId, claimed.attempt);
        if (canceled) await refundJobSpend(canceled, "provider_canceled");
      } else if (state.status === "failed" || state.status === "expired") {
        const failed = await failMusicJob({
          userId,
          jobId,
          attempt: claimed.attempt,
          errorCode: `provider_${state.status}`,
          errorMessage: state.message,
        });
        if (failed) await refundJobSpend(failed, `provider_${state.status}`);
      }
      return;
    }

    const state = await getJobStatus(config, providerJobId);
    if (state.status === "succeeded") {
      providerOutputObserved = true;
      await completeFromProviderOutput(userId, jobId, claimed.attempt, state.output);
      return;
    }
    if (state.status === "failed" || state.status === "canceled" || state.status === "expired") {
      if (state.status === "canceled") {
        const canceled = await confirmMusicJobCanceled(userId, jobId, claimed.attempt);
        if (canceled) await refundJobSpend(canceled, "provider_canceled");
      } else {
        const failed = await failMusicJob({
          userId,
          jobId,
          attempt: claimed.attempt,
          errorCode: `provider_${state.status}`,
          errorMessage: state.message,
        });
        if (failed) await refundJobSpend(failed, `provider_${state.status}`);
      }
      return;
    }
    await renewMusicJobLease({ userId, jobId, attempt: claimed.attempt, leaseMs: LEASE_MS });
    if (shouldReleaseMusicJobLease(state.status)) {
      // The lease only excludes concurrent advances. A pending provider job
      // must remain immediately resumable by the next client poll.
      await releaseMusicJobLease({ userId, jobId, attempt: claimed.attempt });
    }
  } catch (error) {
    const current = await getMusicJobForUser(userId, jobId);
    const recoverable = musicJobFailureDisposition({
      hasRecordedOutput: Boolean(current?.output),
      providerOutputObserved,
      hasProviderJobId: Boolean(providerJobId),
      errorKind: error instanceof RunpodError ? error.kind : null,
    }) === "resume";
    if (!recoverable && current) {
      const errorCode = error instanceof RunpodError ? `runpod_${error.kind}` : "runner_error";
      const failed = await failMusicJob({
        userId,
        jobId,
        attempt: claimed.attempt,
        errorCode,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      if (failed) await refundJobSpend(failed, errorCode);
    }
    log("music.job_advance_failed", {
      jobId,
      retryable: recoverable,
      reason: error instanceof Error ? error.message : String(error),
    }, { userId, level: recoverable ? "warn" : "error" });
  }
}

export function musicJobFailureDisposition(input: {
  hasRecordedOutput: boolean;
  providerOutputObserved: boolean;
  hasProviderJobId: boolean;
  errorKind: RunpodError["kind"] | null;
}): "resume" | "fail_refund" {
  if (input.hasRecordedOutput || input.providerOutputObserved) return "resume";
  if (
    input.hasProviderJobId
    && (input.errorKind === "http" || input.errorKind === "timeout")
  ) {
    return "resume";
  }
  return "fail_refund";
}

export function shouldReleaseMusicJobLease(
  providerStatus: "queued" | "running" | "succeeded" | "failed" | "canceled" | "expired",
): boolean {
  return providerStatus === "queued" || providerStatus === "running";
}

async function buildProviderInput(input: {
  prompt: string;
  duration: number;
  styleMix: number;
  melody: string;
  humStorageKey: string | null;
}, jobId: string): Promise<Record<string, unknown>> {
  const providerInput: Record<string, unknown> = {
    prompt: input.prompt,
    duration: input.duration,
    request_id: jobId,
  };
  if (input.melody) providerInput.melody = input.melody;
  if (input.humStorageKey && input.styleMix > 0) {
    const hum = await getObjectStore().get(input.humStorageKey);
    if (!hum) throw new Error("hum_artifact_missing");
    providerInput.style_mix = input.styleMix;
    providerInput.hum_b64 = Buffer.from(hum.body).toString("base64");
  }
  return providerInput;
}

async function completeFromProviderOutput(
  userId: string,
  jobId: string,
  attempt: number,
  output: Record<string, unknown>,
): Promise<void> {
  const audioB64 = output.audio_b64;
  if (typeof audioB64 !== "string" || !audioB64) throw new Error("provider_audio_missing");
  const bytes = new Uint8Array(Buffer.from(audioB64, "base64"));
  const artifact = await storeMusicJobOutput({ userId, jobId, bytes, contentType: "audio/wav" });
  const job = await getMusicJobForUser(userId, jobId);
  if (!job) throw new Error("music_job_missing_during_completion");
  const recorded = await recordMusicJobResult({
    userId,
    jobId,
    attempt,
    output: {
      ...artifact,
      model: typeof output.model === "string" ? output.model : "",
      generationMs: typeof output.generation_ms === "number" ? output.generation_ms : null,
      styleMix: output.style_mix == null ? "" : String(output.style_mix),
    },
  });
  if (!recorded) throw new Error("music_job_result_record_failed");
  await settleRecordedResult(recorded);
}

async function settleRecordedResult(
  job: Awaited<ReturnType<typeof getMusicJobForUser>> & {},
): Promise<void> {
  if (!job?.output) throw new Error("music_job_result_missing");
  if (job.spendLedgerId) {
    const settlement = await settleOperationDelivery({
      userId: job.userId,
      spendLedgerId: job.spendLedgerId,
      metadata: { jobId: job.id, operationId: job.operationId, trigger: "music_job_succeeded" },
    });
    if (!settlement.ok) throw new Error(`music_job_settlement_${settlement.reason}`);
  }
  await succeedMusicJob({
    userId: job.userId,
    jobId: job.id,
    output: job.output,
  });
}

async function refundJobSpend(
  job: { id: string; userId: string; spendLedgerId: string | null },
  trigger: string,
): Promise<void> {
  if (!job.spendLedgerId) return;
  try {
    const refund = await refundNotes({
      originalLedgerId: job.spendLedgerId,
      metadata: { jobId: job.id, trigger },
    });
    if (refund.ok) return;
    throw new Error(refund.reason);
  } catch (error) {
    await recordPendingRefund({
      userId: job.userId,
      originalLedgerId: job.spendLedgerId,
      amount: 1,
      spendReason: "spend:music_generate",
      source: "music_job_terminal_failure",
      metadata: {
        jobId: job.id,
        trigger,
        refundError: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

export async function refundCanceledMusicJob(userId: string, jobId: string): Promise<void> {
  const job = await getMusicJobForUser(userId, jobId);
  if (job?.status === "canceled") await refundJobSpend(job, "user_canceled");
}
