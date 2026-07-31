import { createHash } from "node:crypto";

import { getMusicJobForUser } from "@/lib/db/queries/music-jobs";
import type { MusicJob } from "@/lib/db/schema/music-jobs";
import { getObjectStore } from "@/lib/storage";
import {
  advanceMusicJob,
  MusicJobSettlementError,
  settleRecordedResult,
} from "@/lib/platform/music-job-runner";
import { createMusicJobReceipt } from "@/lib/platform/music-job-service";

const POLL_INTERVAL_MS = 1_000;
const SYNC_DEADLINE_MS = 285_000;

export interface DurableMusicSyncDeps {
  createReceipt: typeof createMusicJobReceipt;
  getJob: typeof getMusicJobForUser;
  advance: typeof advanceMusicJob;
  settle: typeof settleRecordedResult;
  getArtifact: ReturnType<typeof getObjectStore>["get"];
  now: () => number;
  delay: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const defaultDeps: DurableMusicSyncDeps = {
  createReceipt: createMusicJobReceipt,
  getJob: getMusicJobForUser,
  advance: advanceMusicJob,
  settle: settleRecordedResult,
  getArtifact: (key) => getObjectStore().get(key),
  now: Date.now,
  delay: abortableDelay,
};

export type DurableMusicGenerationResult =
  | {
      ok: true;
      audio: ArrayBuffer;
      contentType: string;
      model: string;
      generationMs: string;
      styleMix: string;
      outputSha256: string;
      duplicate: boolean;
      jobId: string;
    }
  | {
      ok: false;
      error:
        | "idempotency_conflict"
        | "operation_pending"
        | "insufficient_notes"
        | "billing_unavailable"
        | "client_closed_request"
        | "worker_http_error"
        | "worker_unconfigured"
        | "server_error";
      message: string;
      status: number;
      currentBalance?: number;
      jobId?: string;
    };

export async function generateDurableMusicSynchronously(input: {
  userId: string;
  operationId: string;
  requestId: string;
  prompt: string;
  duration: number;
  styleMix: number;
  melody: string;
  hum: File | null;
  generationBatchId: string | null;
  bill: boolean;
  signal?: AbortSignal;
}, deps: DurableMusicSyncDeps = defaultDeps): Promise<DurableMusicGenerationResult> {
  const created = await deps.createReceipt(input);
  if (!created.ok) {
    if (created.reason === "idempotency_conflict") {
      return {
        ok: false,
        error: "idempotency_conflict",
        message: "This clip id was already used with different music input",
        status: 409,
        jobId: created.job?.id,
      };
    }
    return created.reason === "insufficient_notes"
      ? {
          ok: false,
          error: "insufficient_notes",
          message: "Not enough Murmur Notes",
          status: 402,
          currentBalance: created.currentBalance,
        }
      : {
          ok: false,
          error: "billing_unavailable",
          message: "Billing account unavailable",
          status: 503,
        };
  }

  const deadline = deps.now() + SYNC_DEADLINE_MS;
  for (;;) {
    if (input.signal?.aborted) {
      return {
        ok: false,
        error: "client_closed_request",
        message: "Client closed the request; the durable generation can be resumed",
        status: 499,
        jobId: created.job.id,
      };
    }
    const job = await deps.getJob(input.userId, created.job.id);
    if (!job) {
      return { ok: false, error: "server_error", message: "Music job disappeared", status: 500 };
    }
    if (job.status === "succeeded") {
      return deliverRecordedMusicJob(job, created.duplicate, deps);
    }
    if (job.status === "result_ready") {
      try {
        await deps.settle(job);
      } catch (error) {
        if (error instanceof MusicJobSettlementError && error.reason === "insufficient_notes") {
          return {
            ok: false,
            error: "insufficient_notes",
            message: "Music is ready; add one Murmur Note to receive it",
            status: 402,
            currentBalance: error.currentBalance,
            jobId: job.id,
          };
        }
        return {
          ok: false,
          error: "billing_unavailable",
          message: "Music is ready but delivery settlement is unavailable",
          status: 503,
          jobId: job.id,
        };
      }
      continue;
    }
    if (["failed", "canceled", "expired", "submission_unknown"].includes(job.status)) {
      return terminalFailure(job);
    }
    if (deps.now() >= deadline) {
      return {
        ok: false,
        error: "operation_pending",
        message: "Music generation is still running; retry this clip to resume it",
        status: 504,
        jobId: job.id,
      };
    }

    await deps.advance(input.userId, job.id);
    const advanced = await deps.getJob(input.userId, job.id);
    if (advanced?.status === "succeeded") {
      return deliverRecordedMusicJob(advanced, created.duplicate, deps);
    }
    if (advanced && ["failed", "canceled", "expired", "submission_unknown"].includes(advanced.status)) {
      return terminalFailure(advanced);
    }
    await deps.delay(POLL_INTERVAL_MS, input.signal);
  }
}

async function deliverRecordedMusicJob(
  job: MusicJob,
  duplicate: boolean,
  deps: DurableMusicSyncDeps,
): Promise<DurableMusicGenerationResult> {
  if (!job.output?.storageKey) {
    return {
      ok: false,
      error: "server_error",
      message: "Music job completed without a recorded artifact",
      status: 502,
      jobId: job.id,
    };
  }
  const artifact = await deps.getArtifact(job.output.storageKey);
  if (!artifact) {
    return {
      ok: false,
      error: "server_error",
      message: "Recorded music artifact is unavailable",
      status: 503,
      jobId: job.id,
    };
  }
  const outputSha256 = createHash("sha256").update(artifact.body).digest("hex");
  if (outputSha256 !== job.output.digest.toLowerCase()) {
    return {
      ok: false,
      error: "server_error",
      message: "Recorded music artifact failed integrity verification",
      status: 502,
      jobId: job.id,
    };
  }
  const bytes = artifact.body;
  return {
    ok: true,
    audio: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    contentType: artifact.contentType,
    model: job.output.model,
    generationMs: job.output.generationMs == null ? "" : String(job.output.generationMs),
    styleMix: job.output.styleMix,
    outputSha256,
    duplicate,
    jobId: job.id,
  };
}

function terminalFailure(job: MusicJob): DurableMusicGenerationResult {
  const canceled = job.status === "canceled";
  return {
    ok: false,
    error: job.errorCode === "worker_unconfigured" ? "worker_unconfigured" : "worker_http_error",
    message: job.errorMessage || (canceled ? "Music generation was canceled" : "Music generation failed"),
    status: canceled ? 409 : 503,
    jobId: job.id,
  };
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}
