/**
 * Thin client for invoking a RunPod Serverless endpoint from the music proxy.
 *
 * Generation is submitted async (`POST /v2/{id}/run`) and then polled
 * (`GET /v2/{id}/status/{jobId}`) rather than using `/runsync` — a scale-to-zero
 * endpoint can take tens of seconds to cold-start a worker, which blows the
 * synchronous window. Polling lets us wait up to the caller's budget and cancel
 * the job if we run out of time. Auth is the RunPod API key as a bearer token.
 *
 * See docs/DEPLOY_MUSIC_ENGINE_GPU.md and workers/music-engine/handler.py.
 */

import type { MusicServerlessConfig } from "@/lib/platform/music-worker";

const RUNPOD_API_BASE = "https://api.runpod.ai/v2";
const DEFAULT_POLL_INTERVAL_MS = 1500;
// Per-request cap on a single /run or /status call (each returns fast — /run is
// an async submit, /status is a cheap read); the overall wait is bounded by the
// caller's budget, not this.
const PER_CALL_TIMEOUT_MS = 20_000;
// /status is an idempotent read polled ~190 times across a cold start, so a
// transient blip (per-call timeout, egress hiccup, RunPod 5xx/429) must not
// abandon a job that is still generating on a GPU. Only this many failures in
// a row count as the API being genuinely unreachable.
const MAX_CONSECUTIVE_POLL_FAILURES = 5;

// Execution policy attached to every job we submit. RunPod's default job TTL is
// 24h, so when a caller vanishes — e.g. the Vercel function is killed at its
// 300s limit before the best-effort /cancel below can fire — the job lingers in
// the endpoint queue for a full day as a phantom "queued but not running" entry.
// A short TTL lets RunPod itself drop these orphans so the queue drains to zero
// instead of accumulating backlog.
//
//   ttl              — TOTAL lifespan (queue + execution) before RunPod deletes
//                      the job. Kept above the worst-case scale-to-zero cold
//                      start (~4-5 min) AND above the caller's own wait budget
//                      (WORKER_TIMEOUT_MS, ~295s) so a legitimately slow job is
//                      never reaped while someone is still waiting for it; the
//                      10 min default clears both bars while draining orphans
//                      ~144× faster than the 24h platform default.
//   executionTimeout — cap on active processing after a worker accepts the job;
//                      a short clip finishes well under a minute.
//
// Both are overridable via env (no redeploy needed). Units: milliseconds.
const JOB_TTL_MS = clampEnvInt("RUNPOD_JOB_TTL_MS", 600_000, 360_000, 86_400_000);
const JOB_EXECUTION_TIMEOUT_MS = clampEnvInt(
  "RUNPOD_JOB_EXECUTION_TIMEOUT_MS",
  180_000,
  60_000,
  604_800_000,
);

function clampEnvInt(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(raw)));
}

export type RunpodErrorKind =
  | "unauthorized"
  | "http"
  | "failed"
  | "timeout"
  | "aborted";

/** A failed RunPod invocation, tagged so the route can map it to its error contract. */
export class RunpodError extends Error {
  constructor(
    readonly kind: RunpodErrorKind,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = "RunpodError";
  }
}

interface RunpodJob {
  id?: string;
  status?: string;
  output?: unknown;
  error?: unknown;
}

export interface RunJobOptions {
  /** Total wall-clock budget for submit + polling, in milliseconds. */
  budgetMs: number;
  pollIntervalMs?: number;
  /**
   * Caller-side abort (e.g. the browser disconnected). The wait stops, the
   * job is cancelled so it stops occupying a worker, and a RunpodError with
   * kind "aborted" is thrown.
   */
  signal?: AbortSignal;
}

function callTimeoutSignal(deadline: number): AbortSignal {
  const remaining = Math.max(1, Math.min(PER_CALL_TIMEOUT_MS, deadline - Date.now()));
  return AbortSignal.timeout(remaining);
}

async function runpodFetch(
  config: MusicServerlessConfig,
  path: string,
  init: RequestInit,
): Promise<Response> {
  return fetch(`${RUNPOD_API_BASE}/${config.endpointId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Inspect a job payload. Returns the output object when COMPLETED, throws on a
 * terminal failure, and returns null while the job is still queued/running.
 */
function readTerminal(job: RunpodJob): Record<string, unknown> | null {
  const status = (job.status ?? "").toUpperCase();
  if (status === "COMPLETED") {
    const output = job.output;
    if (output && typeof output === "object") {
      const obj = output as Record<string, unknown>;
      // The handler reports generation failures in-band as {error, message}.
      if (typeof obj.error === "string") {
        throw new RunpodError("failed", String(obj.message ?? obj.error), obj);
      }
      return obj;
    }
    throw new RunpodError("failed", "RunPod job completed with no output", job);
  }
  if (status === "FAILED" || status === "CANCELLED" || status === "TIMED_OUT") {
    throw new RunpodError(
      "failed",
      `RunPod job ${status.toLowerCase()}`,
      job.output ?? job.error ?? job,
    );
  }
  return null; // IN_QUEUE / IN_PROGRESS / unknown → keep polling
}

function assertAuthorized(res: Response, body: unknown): void {
  if (res.status === 401 || res.status === 403) {
    throw new RunpodError("unauthorized", "RunPod rejected the API key", body);
  }
}

async function cancelJob(config: MusicServerlessConfig, jobId: string): Promise<void> {
  try {
    await runpodFetch(config, `/cancel/${jobId}`, {
      method: "POST",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // best-effort — the job's own execution timeout will reap it otherwise
  }
}

/**
 * Submit `input` to the endpoint and wait for the job's output, polling until
 * COMPLETED or the budget runs out. Throws `RunpodError` on failure/timeout.
 *
 * Transient /status failures (thrown fetch, 429, 5xx) are retried in place —
 * the poll is an idempotent read and the job keeps generating regardless —
 * and every terminal exit that leaves the job possibly alive awaits a
 * best-effort cancel so it stops occupying one of the few workers.
 */
export async function runJob(
  config: MusicServerlessConfig,
  input: Record<string, unknown>,
  options: RunJobOptions,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + options.budgetMs;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const signal = options.signal;

  if (signal?.aborted) {
    throw new RunpodError("aborted", "Caller aborted before the job was submitted");
  }

  const submitRes = await runpodFetch(config, "/run", {
    method: "POST",
    body: JSON.stringify({
      input,
      policy: { executionTimeout: JOB_EXECUTION_TIMEOUT_MS, ttl: JOB_TTL_MS },
    }),
    signal: callTimeoutSignal(deadline),
  });
  const submitBody = await safeJson(submitRes);
  assertAuthorized(submitRes, submitBody);
  if (!submitRes.ok) {
    throw new RunpodError("http", `RunPod /run returned HTTP ${submitRes.status}`, submitBody);
  }

  const job = (submitBody ?? {}) as RunpodJob;
  // Fast jobs can already be terminal in the /run response.
  const immediate = readTerminal(job);
  if (immediate) return immediate;

  const jobId = job.id;
  if (!jobId) {
    throw new RunpodError("http", "RunPod /run returned no job id", submitBody);
  }

  let consecutivePollFailures = 0;
  while (Date.now() < deadline) {
    await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
    if (signal?.aborted) {
      await cancelJob(config, jobId);
      throw new RunpodError("aborted", "Caller aborted while waiting for the job");
    }
    if (Date.now() >= deadline) break;

    let statusRes: Response;
    try {
      statusRes = await runpodFetch(config, `/status/${jobId}`, {
        method: "GET",
        signal: callTimeoutSignal(deadline),
      });
    } catch (error) {
      consecutivePollFailures += 1;
      if (consecutivePollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        await cancelJob(config, jobId);
        throw new RunpodError(
          "http",
          `RunPod /status unreachable ${consecutivePollFailures}x in a row`,
          error instanceof Error ? error.message : error,
        );
      }
      continue;
    }

    const statusBody = await safeJson(statusRes);
    if (statusRes.status === 401 || statusRes.status === 403) {
      await cancelJob(config, jobId);
      throw new RunpodError("unauthorized", "RunPod rejected the API key", statusBody);
    }
    if (!statusRes.ok) {
      // 429/5xx are the platform having a moment, not the job failing.
      if (statusRes.status === 429 || statusRes.status >= 500) {
        consecutivePollFailures += 1;
        if (consecutivePollFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
          await cancelJob(config, jobId);
          throw new RunpodError(
            "http",
            `RunPod /status returned HTTP ${statusRes.status} ${consecutivePollFailures}x in a row`,
            statusBody,
          );
        }
        continue;
      }
      await cancelJob(config, jobId);
      throw new RunpodError(
        "http",
        `RunPod /status returned HTTP ${statusRes.status}`,
        statusBody,
      );
    }

    consecutivePollFailures = 0;
    const result = readTerminal((statusBody ?? {}) as RunpodJob);
    if (result) return result;
  }

  // Awaited on purpose: a fire-and-forget cancel is usually killed when the
  // serverless function freezes right after the response, leaving the job to
  // squat a worker until its executionTimeout. cancelJob caps itself at 5s.
  await cancelJob(config, jobId);
  throw new RunpodError("timeout", "RunPod job did not complete within the budget");
}

export interface EndpointHealth {
  ok: boolean;
  status: number;
  body: unknown;
}

/** GET the endpoint's worker/job metrics (`/v2/{id}/health`). */
export async function endpointHealth(
  config: MusicServerlessConfig,
  signal?: AbortSignal,
): Promise<EndpointHealth> {
  const res = await runpodFetch(config, "/health", { method: "GET", signal });
  const body = await safeJson(res);
  return { ok: res.ok, status: res.status, body };
}
