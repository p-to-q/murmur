"use client";

import { request } from "@/lib/api/request";

const POLL_INTERVAL_MS = 2_000;

type MusicJobStatus =
  | "accepted"
  | "submitting"
  | "queued"
  | "running"
  | "result_ready"
  | "cancel_requested"
  | "succeeded"
  | "failed"
  | "canceled"
  | "expired"
  | "submission_unknown";

type MusicJobResponse = {
  jobId?: string;
  status?: MusicJobStatus;
  audioUrl?: string | null;
  error?: { code?: string; message?: string } | string | null;
  message?: string;
  currentBalance?: number;
  cost?: number;
  requestId?: string;
};

const MUSIC_JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const DURABLE_JOB_CANCELLATION_REASONS = new Set([
  "murmur:background-generation-canceled",
  "murmur:generation-superseded",
]);

export function durableMusicJobsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MURMUR_DURABLE_MUSIC_JOBS === "1";
}

/**
 * Submit and recover one paid generation through the durable job contract.
 * The caller owns the overall deadline; each poll reads the same server job.
 */
export async function requestDurableMusicAudio(input: {
  form: FormData | (() => FormData);
  headers: Record<string, string>;
  operationId: string;
  jobId?: string;
  onJobAccepted?: (jobId: string) => void;
  /** Fail closed when the original conditioning input was lost before acceptance. */
  allowCreate?: boolean;
  signal?: AbortSignal;
  /** Explicit user/batch cancellation. A request deadline must not cancel the durable job. */
  cancelSignal?: AbortSignal;
}): Promise<Response> {
  if (input.allowCreate === false) {
    return Response.json({
      error: "generation_input_unavailable",
      message: "The original hum input is no longer available. Murmur did not start or charge a replacement job.",
    }, { status: 409 });
  }

  const created = await request("/api/music/jobs", {
    method: "POST",
    body: typeof input.form === "function" ? input.form() : input.form,
    headers: input.headers,
    signal: input.signal,
  });
  return consumeMusicJobResponse(created, input);
}

/** Recover an accepted operation without rebuilding or resending its input. */
export async function recoverDurableMusicAudio(input: {
  operationId: string;
  jobId?: string;
  onJobAccepted?: (jobId: string) => void;
  signal?: AbortSignal;
  cancelSignal?: AbortSignal;
  pollIntervalMs?: number;
}): Promise<Response | null> {
  let recovered: Response | null = null;
  if (input.jobId && MUSIC_JOB_ID_PATTERN.test(input.jobId)) {
    recovered = await request(`/api/music/jobs/${input.jobId}`, {
      cache: "no-store",
      signal: input.signal,
    });
    if (recovered.status !== 404) {
      return consumeMusicJobResponse(recovered, input);
    }
  }

  recovered = await request(
    `/api/music/jobs?operationId=${encodeURIComponent(input.operationId)}`,
    { cache: "no-store", signal: input.signal },
  );
  if (recovered.status === 404) return null;
  return consumeMusicJobResponse(recovered, input);
}

async function consumeMusicJobResponse(
  created: Response,
  input: {
    onJobAccepted?: (jobId: string) => void;
    signal?: AbortSignal;
    cancelSignal?: AbortSignal;
    pollIntervalMs?: number;
  },
): Promise<Response> {
  if (!created.ok) {
    await reportJobId(created, input.onJobAccepted);
    return created;
  }

  let state = await readState(created);
  if (!state.jobId || !MUSIC_JOB_ID_PATTERN.test(state.jobId)) {
    return protocolFailure("Music job response did not include a valid job id");
  }
  input.onJobAccepted?.(state.jobId);
  const statusUrl = `/api/music/jobs/${state.jobId}`;

  try {
    while (!isTerminal(state.status)) {
      await abortableDelay(input.pollIntervalMs ?? POLL_INTERVAL_MS, input.signal);
      const response = await request(statusUrl, {
        cache: "no-store",
        signal: input.signal,
      });
      if (!response.ok) return response;
      state = await readState(response);
    }
  } catch (error) {
    if (shouldCancelDurableJob(input.cancelSignal)) {
      void request(statusUrl, { method: "DELETE", keepalive: true }).catch(() => {});
    }
    throw error;
  }

  if (state.status === "succeeded") {
    return request(state.audioUrl || `${statusUrl}/audio`, {
      cache: "no-store",
      signal: input.signal,
    });
  }

  if (state.status === "result_ready") {
    return Response.json({
      error: "insufficient_notes",
      message: "Generated audio is ready and waiting for Notes settlement. Retry this operation to recover it.",
      jobStatus: "result_ready",
      recoverable: true,
      currentBalance: state.currentBalance,
      cost: state.cost,
      requestId: state.requestId,
    }, { status: 402 });
  }

  const error = typeof state.error === "object" && state.error
    ? state.error
    : { code: String(state.error || state.status || "server_error"), message: state.message };
  return Response.json({
    error: error.code || state.status || "server_error",
    message: error.message || "Music generation did not complete",
    currentBalance: state.currentBalance,
    cost: state.cost,
    requestId: state.requestId,
  }, { status: state.status === "canceled" ? 409 : 503 });
}

async function reportJobId(
  response: Response,
  onJobAccepted?: (jobId: string) => void,
): Promise<void> {
  if (!onJobAccepted) return;
  const state = await readState(response.clone());
  if (state.jobId && MUSIC_JOB_ID_PATTERN.test(state.jobId)) {
    onJobAccepted(state.jobId);
  }
}

export function shouldCancelDurableJob(cancelSignal?: AbortSignal): boolean {
  return cancelSignal?.aborted === true
    && DURABLE_JOB_CANCELLATION_REASONS.has(String(cancelSignal.reason));
}

async function readState(response: Response): Promise<MusicJobResponse> {
  try {
    return (await response.json()) as MusicJobResponse;
  } catch {
    return {};
  }
}

function isTerminal(status: MusicJobStatus | undefined): boolean {
  return [
    "result_ready",
    "succeeded",
    "failed",
    "canceled",
    "expired",
    "submission_unknown",
  ].includes(
    status ?? "",
  );
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason);
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function protocolFailure(message: string): Response {
  return Response.json({ error: "server_error", message }, { status: 502 });
}
