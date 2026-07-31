import {
  attachMusicJobProvider,
  claimMusicJob,
  confirmMusicJobCanceled,
  expireMusicJob,
  failMusicJob,
  getMusicJobForUser,
  markMusicJobSubmissionUnknown,
  recordMusicJobResult,
  refreshMusicJobSubmissionLease,
  releaseMusicJobLease,
  succeedMusicJob,
} from "@/lib/db/queries/music-jobs";
import {
  recordPendingRefund,
  refundNotes,
  settleOperationDelivery,
} from "@/lib/db/queries/notes-ledger";
import { log } from "@/lib/observability/log";
import { getMusicServerlessConfig } from "@/lib/platform/music-worker";
import { recordMusicGenerationEvidence } from "@/lib/platform/music-generation-evidence";
import {
  cancelSubmittedJob,
  getJobStatus,
  RunpodError,
  submitJob,
} from "@/lib/platform/runpod-serverless";
import {
  isMusicDeliveryBase64WithinLimit,
  verifyMusicWorkerOutput,
} from "@/lib/platform/music-worker-output";
import { getObjectStore } from "@/lib/storage";
import { storeMusicJobOutput } from "@/lib/storage/music-job-artifacts";
import {
  isMusicJobDeadlineReached,
  musicJobNextPollAt,
  shouldExpireProviderNotFound,
} from "@/lib/music/music-job-policy";
import { createHash } from "node:crypto";
import type { MusicJobOutput } from "@/lib/db/schema/music-jobs";
import type { MusicGenerationEvidenceInput } from "@/lib/platform/music-generation-evidence";

const LEASE_MS = 45_000;

class MusicOutputRejectedError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "MusicOutputRejectedError";
  }
}

export class MusicJobSettlementError extends Error {
  constructor(
    readonly reason: "invalid_operation" | "user_not_found" | "insufficient_notes",
    readonly currentBalance?: number,
  ) {
    super(`music_job_settlement_${reason}`);
    this.name = "MusicJobSettlementError";
  }
}

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
  if (
    !initial.providerJobId
    && ["submitting", "running", "cancel_requested"].includes(initial.status)
    && (!initial.leaseUntil || initial.leaseUntil.getTime() < Date.now())
  ) {
    const unknown = await markMusicJobSubmissionUnknown({
      userId,
      jobId,
      leaseEpoch: initial.leaseEpoch,
      leaseExpiredBefore: new Date(),
      errorMessage: "Provider submission lease expired before a job id was recorded",
    });
    if (unknown) await refundJobSpend(unknown, "submission_unknown");
    return;
  }
  const config = getMusicServerlessConfig();
  if (!config) {
    const failed = await failMusicJob({
      userId,
      jobId,
      errorCode: "worker_unconfigured",
      errorMessage: "RunPod is not configured",
    });
    if (failed) await refundJobSpend(failed, "worker_unconfigured");
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
    if (isMusicJobDeadlineReached(claimed.deadlineAt)) {
      if (providerJobId) {
        await cancelSubmittedJob(config, providerJobId).catch(() => false);
      }
      const expired = await expireMusicJob({
        userId,
        jobId,
        leaseEpoch: claimed.leaseEpoch,
        errorCode: "music_job_deadline_reached",
        errorMessage: "Music generation exceeded its execution deadline",
      });
      if (expired) await refundJobSpend(expired, "music_job_deadline_reached");
      return;
    }
    if (!providerJobId) {
      const providerInput = await buildProviderInput(claimed.input, jobId);
      const submissionLease = await refreshMusicJobSubmissionLease({
        userId,
        jobId,
        leaseEpoch: claimed.leaseEpoch,
        leaseMs: LEASE_MS,
      });
      if (!submissionLease) return;
      if (submissionLease.status === "cancel_requested") {
        const canceled = await confirmMusicJobCanceled(userId, jobId, claimed.leaseEpoch);
        if (canceled) await refundJobSpend(canceled, "user_canceled_before_submit");
        return;
      }
      if (isMusicJobDeadlineReached(submissionLease.deadlineAt)) {
        const expired = await expireMusicJob({
          userId,
          jobId,
          leaseEpoch: claimed.leaseEpoch,
          errorCode: "music_job_deadline_reached",
          errorMessage: "Music generation exceeded its execution deadline before submission",
        });
        if (expired) await refundJobSpend(expired, "music_job_deadline_reached");
        return;
      }
      let submitted: Awaited<ReturnType<typeof submitJob>>;
      try {
        submitted = await submitJob(config, providerInput);
      } catch (error) {
        if (error instanceof RunpodError && error.kind === "submission_unknown") {
          const unknown = await markMusicJobSubmissionUnknown({
            userId,
            jobId,
            leaseEpoch: claimed.leaseEpoch,
            errorMessage: error.message,
          });
          if (unknown) await refundJobSpend(unknown, "submission_unknown");
          log("music.job_submission_unknown", { jobId }, { userId, level: "error" });
          return;
        }
        throw error;
      }
      const submittedProviderJobId = submitted.providerJobId;
      providerJobId = submittedProviderJobId;
      let attached: Awaited<ReturnType<typeof attachMusicJobProvider>>;
      try {
        attached = await attachProviderAfterSubmission({
          input: claimed.input,
          jobId,
          userId,
          attach: () => attachMusicJobProvider({
            userId,
            jobId,
            leaseEpoch: claimed.leaseEpoch,
            provider: "runpod",
            providerJobId: submittedProviderJobId,
            leaseMs: LEASE_MS,
          }),
        });
      } catch (error) {
        await cancelSubmittedJob(config, providerJobId).catch(() => false);
        throw error;
      }
      if (!attached) {
        await cancelSubmittedJob(config, providerJobId).catch(() => false);
        const unknown = await markMusicJobSubmissionUnknown({
          userId,
          jobId,
          leaseEpoch: claimed.leaseEpoch,
          errorMessage: "Provider accepted the job but its id could not be persisted",
        });
        if (unknown) await refundJobSpend(unknown, "provider_attach_failed");
        log("music.job_provider_attach_failed", { jobId }, { userId, level: "error" });
        return;
      }
      log("music.job_provider_attached", {
        jobId,
        originRequestId: claimed.input.originRequestId ?? null,
        provider: "runpod",
        providerJobId,
        generationBatchId: claimed.input.generationBatchId,
      }, { userId });
      if (submitted.immediateOutput) {
        providerOutputObserved = true;
        await completeFromProviderOutput(
          userId,
          jobId,
          claimed.leaseEpoch,
          submitted.immediateOutput,
        );
        return;
      }
      if (attached.status === "cancel_requested") {
        if (await cancelSubmittedJob(config, providerJobId)) {
          const canceled = await confirmMusicJobCanceled(userId, jobId, claimed.leaseEpoch);
          if (canceled) await refundJobSpend(canceled, "user_canceled");
        } else {
          await releaseMusicJobLease({
            userId,
            jobId,
            leaseEpoch: claimed.leaseEpoch,
            nextRunAt: musicJobNextPollAt("queued"),
          });
        }
        return;
      }
      await releaseMusicJobLease({
        userId,
        jobId,
        leaseEpoch: claimed.leaseEpoch,
        nextRunAt: musicJobNextPollAt("queued"),
      });
      return;
    }

    const current = await getMusicJobForUser(userId, jobId);
    if (!current || current.status === "canceled") return;
    if (current.status === "cancel_requested") {
      if (await cancelSubmittedJob(config, providerJobId)) {
        const canceled = await confirmMusicJobCanceled(userId, jobId, claimed.leaseEpoch);
        if (canceled) await refundJobSpend(canceled, "user_canceled");
        return;
      }
      const state = await getJobStatus(config, providerJobId);
      if (state.status === "succeeded") {
        providerOutputObserved = true;
        await completeFromProviderOutput(userId, jobId, claimed.leaseEpoch, state.output);
      } else if (state.status === "canceled") {
        const canceled = await confirmMusicJobCanceled(userId, jobId, claimed.leaseEpoch);
        if (canceled) await refundJobSpend(canceled, "provider_canceled");
      } else if (state.status === "failed" || state.status === "expired") {
        await terminalizeProviderFailure(
          userId,
          jobId,
          claimed.leaseEpoch,
          state.status,
          state.message,
        );
      } else {
        await releaseMusicJobLease({
          userId,
          jobId,
          leaseEpoch: claimed.leaseEpoch,
          nextRunAt: musicJobNextPollAt(state.status),
        });
      }
      return;
    }

    const state = await getJobStatus(config, providerJobId);
    log("music.job_provider_status", {
      jobId,
      originRequestId: claimed.input.originRequestId ?? null,
      providerJobId,
      providerStatus: state.status,
      generationBatchId: claimed.input.generationBatchId,
    }, { userId });
    if (state.status === "succeeded") {
      providerOutputObserved = true;
      await completeFromProviderOutput(userId, jobId, claimed.leaseEpoch, state.output);
      return;
    }
    if (state.status === "failed" || state.status === "canceled" || state.status === "expired") {
      if (state.status === "canceled") {
        const canceled = await confirmMusicJobCanceled(userId, jobId, claimed.leaseEpoch);
        if (canceled) await refundJobSpend(canceled, "provider_canceled");
      } else {
        await terminalizeProviderFailure(
          userId,
          jobId,
          claimed.leaseEpoch,
          state.status,
          state.message,
        );
      }
      return;
    }
    if (shouldReleaseMusicJobLease(state.status)) {
      await releaseMusicJobLease({
        userId,
        jobId,
        leaseEpoch: claimed.leaseEpoch,
        nextRunAt: musicJobNextPollAt(state.status),
      });
    }
  } catch (error) {
    const current = await getMusicJobForUser(userId, jobId);
    const qualityRejected = error instanceof MusicOutputRejectedError;
    const deadlineReached = Boolean(current && isMusicJobDeadlineReached(current.deadlineAt));
    const providerMissingExpired = error instanceof RunpodError
      && error.kind === "not_found"
      && Boolean(current && shouldExpireProviderNotFound(
        current.providerSubmittedAt,
        current.deadlineAt,
      ));
    const recoverable = !deadlineReached && !providerMissingExpired
      && musicJobFailureDisposition({
        hasRecordedOutput: Boolean(current?.output),
        providerOutputObserved,
        hasProviderJobId: Boolean(providerJobId),
        errorKind: error instanceof RunpodError ? error.kind : null,
        outputRejected: qualityRejected,
      }) === "resume";
    if (!recoverable && current) {
      const errorCode = deadlineReached
        ? "music_job_deadline_reached"
        : providerMissingExpired
          ? "provider_job_not_found"
          : qualityRejected
            ? "music_quality_rejected"
            : error instanceof RunpodError ? `runpod_${error.kind}` : "runner_error";
      if ((deadlineReached || providerMissingExpired) && providerJobId) {
        await cancelSubmittedJob(config, providerJobId).catch(() => false);
      }
      const terminal = deadlineReached || providerMissingExpired
        ? await expireMusicJob({
            userId,
            jobId,
            leaseEpoch: claimed.leaseEpoch,
            errorCode,
            errorMessage: error instanceof Error ? error.message : String(error),
          })
        : await failMusicJob({
            userId,
            jobId,
            leaseEpoch: claimed.leaseEpoch,
            errorCode,
            errorMessage: error instanceof Error ? error.message : String(error),
          });
      if (terminal) await refundJobSpend(terminal, errorCode);
    } else if (recoverable) {
      await releaseMusicJobLease({
        userId,
        jobId,
        leaseEpoch: claimed.leaseEpoch,
        nextRunAt: musicJobNextPollAt("queued"),
      });
    }
    log("music.job_advance_failed", {
      jobId,
      retryable: recoverable,
      reason: error instanceof Error ? error.message : String(error),
      providerFailure: summarizeProviderFailure(error),
    }, { userId, level: recoverable ? "warn" : "error" });
  }
}

export function musicJobFailureDisposition(input: {
  hasRecordedOutput: boolean;
  providerOutputObserved: boolean;
  hasProviderJobId: boolean;
  errorKind: RunpodError["kind"] | null;
  outputRejected?: boolean;
}): "resume" | "fail_refund" {
  if (input.outputRejected) return "fail_refund";
  if (input.hasRecordedOutput || input.providerOutputObserved) return "resume";
  if (
    input.hasProviderJobId
    && (
      input.errorKind === "http"
      || input.errorKind === "not_found"
      || input.errorKind === "timeout"
    )
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
  leaseEpoch: number,
  output: Record<string, unknown>,
): Promise<void> {
  const job = await getMusicJobForUser(userId, jobId);
  if (!job) throw new Error("music_job_missing_during_completion");
  let bytes: Uint8Array;
  try {
    bytes = decodeMusicJobProviderAudio(output, job.input.duration);
  } catch (error) {
    log("music.quality_gate_failed", {
      jobId,
      generationBatchId: job.input.generationBatchId,
      reason: error instanceof Error ? error.message : String(error),
      outputBytes: null,
    }, { userId, level: "error" });
    throw error;
  }
  const persistedHumDigest = typeof job.input.humDigest === "string"
    ? job.input.humDigest
    : null;
  const legacyHum = !persistedHumDigest && job.input.humStorageKey
    ? await getObjectStore().get(job.input.humStorageKey)
    : null;
  if (job.input.humStorageKey && !persistedHumDigest && !legacyHum) {
    throw new MusicOutputRejectedError(
      new Error("hum_artifact_missing_during_verification"),
    );
  }
  const humWasSent = Boolean((persistedHumDigest || legacyHum) && job.input.styleMix > 0);
  let verified: ReturnType<typeof verifyMusicWorkerOutput>;
  try {
    verified = verifyMusicWorkerOutput({
      output,
      bytes,
      expected: {
        requestId: jobId,
        prompt: job.input.prompt,
        duration: job.input.duration,
        styleMix: humWasSent ? job.input.styleMix : 0,
        melody: job.input.melody,
        humSha256: humWasSent
          ? persistedHumDigest ?? createHash("sha256").update(legacyHum!.body).digest("hex")
          : null,
      },
    });
  } catch (error) {
    log("music.quality_gate_failed", {
      jobId,
      generationBatchId: job.input.generationBatchId,
      reason: error instanceof Error ? error.message : String(error),
      outputBytes: bytes.byteLength,
    }, { userId, level: "error" });
    throw new MusicOutputRejectedError(error);
  }
  log("music.quality_gate_passed", {
    jobId,
    originRequestId: job.input.originRequestId ?? null,
    generationBatchId: job.input.generationBatchId,
    gateVersion: verified.quality.version,
    qualityEvidence: verified.diagnostics.evidence,
    candidateCount: verified.diagnostics.candidateCount,
    qualityMetrics: verified.quality.metrics,
    workerWallMs: verified.diagnostics.workerWallMs,
    totalGenerationMs: verified.diagnostics.totalGenerationMs,
    estimatedCostUsd: verified.diagnostics.estimatedCostUsd,
    model: verified.diagnostics.runtime.model ?? null,
    outputBytes: bytes.byteLength,
  }, { userId });
  const artifact = await storeMusicJobOutput({ userId, jobId, bytes, contentType: "audio/wav" });
  const recorded = await recordMusicJobResult({
    userId,
    jobId,
    leaseEpoch,
    output: {
      ...artifact,
      model: typeof output.model === "string" ? output.model.slice(0, 128) : "",
      generationMs: typeof output.generation_ms === "number" ? output.generation_ms : null,
      styleMix: output.style_mix == null ? "" : String(output.style_mix),
      quality: verified.quality,
      diagnostics: verified.diagnostics,
    },
  });
  if (!recorded) throw new Error("music_job_result_record_failed");
  await settleRecordedResult(recorded);
}

/** Reject terminal provider deliveries before allocating unbounded base64 output. */
export function decodeMusicJobProviderAudio(
  output: Record<string, unknown>,
  expectedDuration: number,
): Uint8Array {
  const audioB64 = output.audio_b64;
  if (typeof audioB64 !== "string" || !audioB64) {
    throw new MusicOutputRejectedError(new Error("provider_audio_missing"));
  }
  if (!isMusicDeliveryBase64WithinLimit(audioB64, expectedDuration)) {
    throw new MusicOutputRejectedError(
      new Error("music_delivery_quality_gate_failed:payload_too_large"),
    );
  }
  return new Uint8Array(Buffer.from(audioB64, "base64"));
}

export async function deleteSubmittedHum(input: {
  humStorageKey: string | null;
  humDigest?: string | null;
}): Promise<void> {
  // Only new jobs persist a digest that supports receipt verification after
  // deletion. Legacy rows keep their source artifact until normal lifecycle.
  if (!input.humStorageKey || !input.humDigest) return;
  await getObjectStore().delete(input.humStorageKey);
}

export async function attachProviderAfterSubmission<T>(input: {
  input: { humStorageKey: string | null; humDigest?: string | null };
  jobId: string;
  userId: string;
  attach: () => Promise<T>;
}): Promise<T> {
  const cleanup = deleteSubmittedHum(input.input).catch((error) => {
    log("music.hum_cleanup_failed", {
      jobId: input.jobId,
      reason: error instanceof Error ? error.message : String(error),
    }, { userId: input.userId, level: "warn" });
  });
  try {
    return await input.attach();
  } finally {
    await cleanup;
  }
}

function summarizeProviderFailure(error: unknown): Record<string, unknown> | null {
  if (!(error instanceof RunpodError) || !error.detail || typeof error.detail !== "object") {
    return null;
  }
  const detail = error.detail as Record<string, unknown>;
  const diagnostics = detail.diagnostics && typeof detail.diagnostics === "object"
    ? detail.diagnostics as Record<string, unknown>
    : null;
  return {
    code: typeof detail.error === "string" ? detail.error : error.kind,
    gateVersion: typeof diagnostics?.gate_version === "string" ? diagnostics.gate_version : null,
    candidateCount: typeof diagnostics?.candidate_count === "number" ? diagnostics.candidate_count : null,
    totalGenerationMs: typeof diagnostics?.total_generation_ms === "number"
      ? diagnostics.total_generation_ms
      : null,
  };
}

export async function settleRecordedResult(
  job: Awaited<ReturnType<typeof getMusicJobForUser>> & {},
): Promise<void> {
  if (!job?.output) throw new Error("music_job_result_missing");
  const output = job.output;
  const evidenceRecorded = await recordMusicGenerationEvidence(
    buildDurableMusicGenerationEvidence({ ...job, output }),
  );
  if (!evidenceRecorded) throw new Error("music_generation_evidence_deferred");
  if (job.spendLedgerId) {
    const settlement = await settleOperationDelivery({
      userId: job.userId,
      spendLedgerId: job.spendLedgerId,
      metadata: { jobId: job.id, operationId: job.operationId, trigger: "music_job_succeeded" },
    });
    if (!settlement.ok) {
      throw new MusicJobSettlementError(settlement.reason, settlement.currentBalance);
    }
  }
  const succeeded = await succeedMusicJob({
    userId: job.userId,
    jobId: job.id,
    output,
  });
  if (!succeeded) {
    const current = await getMusicJobForUser(job.userId, job.id);
    if (current?.status !== "succeeded") {
      throw new Error("music_job_success_transition_deferred");
    }
  }
}

export function buildDurableMusicGenerationEvidence(job: {
  id: string;
  userId: string;
  operationId: string;
  input: { generationBatchId: string | null; duration: number; styleMix: number };
  output: MusicJobOutput;
}): MusicGenerationEvidenceInput {
  return {
    eventId: `cmp_generation_${job.id}`,
    userId: job.userId,
    requestId: job.id,
    batchId: job.input.generationBatchId,
    clipId: job.operationId,
    mode: "serverless",
    model: job.output.model,
    outputSha256: job.output.digest,
    outputBytes: job.output.sizeBytes,
    duration: job.input.duration,
    styleMix: job.input.styleMix,
    quality: job.output.quality && job.output.diagnostics
      ? { quality: job.output.quality, diagnostics: job.output.diagnostics }
      : undefined,
  };
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

export async function refundTerminalMusicJob(userId: string, jobId: string): Promise<void> {
  const job = await getMusicJobForUser(userId, jobId);
  if (
    job
    && ["failed", "canceled", "expired", "submission_unknown"].includes(job.status)
  ) {
    await refundJobSpend(job, job.errorCode ?? job.status);
  }
}

async function terminalizeProviderFailure(
  userId: string,
  jobId: string,
  leaseEpoch: number,
  status: "failed" | "expired",
  message: string,
): Promise<void> {
  const trigger = `provider_${status}`;
  const terminal = status === "expired"
    ? await expireMusicJob({
        userId,
        jobId,
        leaseEpoch,
        errorCode: trigger,
        errorMessage: message,
      })
    : await failMusicJob({
        userId,
        jobId,
        leaseEpoch,
        errorCode: trigger,
        errorMessage: message,
      });
  if (terminal) await refundJobSpend(terminal, trigger);
}
