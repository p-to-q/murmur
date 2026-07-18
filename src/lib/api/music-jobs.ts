"use client";

import { request } from "@/lib/api/request";

const POLL_INTERVAL_MS = 2_000;

type MusicJobStatus =
  | "accepted"
  | "queued"
  | "running"
  | "result_ready"
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

export function durableMusicJobsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_MURMUR_DURABLE_MUSIC_JOBS === "1";
}

/**
 * Submit and recover one paid generation through the durable job contract.
 * The caller owns the overall deadline; each poll reads the same server job.
 */
export async function requestDurableMusicAudio(input: {
  form: FormData;
  headers: Record<string, string>;
  signal?: AbortSignal;
}): Promise<Response> {
  const created = await request("/api/music/jobs", {
    method: "POST",
    body: input.form,
    headers: input.headers,
    signal: input.signal,
  });
  if (!created.ok) return created;

  let state = await readState(created);
  if (!state.jobId) return protocolFailure("Music job response did not include a job id");
  const statusUrl = `/api/music/jobs/${state.jobId}`;

  try {
    while (!isTerminal(state.status)) {
      await abortableDelay(POLL_INTERVAL_MS, input.signal);
      const response = await request(statusUrl, {
        cache: "no-store",
        signal: input.signal,
      });
      if (!response.ok) return response;
      state = await readState(response);
    }
  } catch (error) {
    if (input.signal?.aborted) {
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

async function readState(response: Response): Promise<MusicJobResponse> {
  try {
    return (await response.json()) as MusicJobResponse;
  } catch {
    return {};
  }
}

function isTerminal(status: MusicJobStatus | undefined): boolean {
  return ["succeeded", "failed", "canceled", "expired", "submission_unknown"].includes(
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
