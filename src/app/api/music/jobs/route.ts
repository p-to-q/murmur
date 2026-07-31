import { NextRequest, NextResponse } from "next/server";

import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/request-id";
import { resolveRequestAuth } from "@/lib/auth";
import { shouldBypassBillingInDevelopment } from "@/lib/billing/dev-balance";
import { shouldSkipNotesBilling } from "@/lib/billing/session-billing";
import type { MusicJob } from "@/lib/db/schema/music-jobs";
import { clientIpFromHeaders } from "@/lib/http/client-ip";
import { safeHostnameFromUrl } from "@/lib/http/safe-hostname";
import {
  MUSIC_BATCH_ID_PATTERN,
  MUSIC_OPERATION_ID_PATTERN,
} from "@/lib/music/music-job-contract";
import { createMusicJobReceipt } from "@/lib/platform/music-job-service";
import { scheduleAfterResponse } from "@/lib/platform/request-lifecycle";
import { advanceMusicJob } from "@/lib/platform/music-job-runner";
import { resolveMusicJobDelivery } from "@/lib/platform/music-job-delivery";
import { getMusicEngineMode } from "@/lib/platform/music-worker";
import { COST } from "@murmur/core";

export const runtime = "nodejs";
export const maxDuration = 30;

const ROUTE = "/api/music/jobs";
const RATE_LIMIT = { capacity: 12, refillWindowMs: 60_000 };
const MAX_PROMPT_CHARS = 300;
const MAX_MELODY_CHARS = 256_000;
const MAX_HUM_BYTES = 4 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;

  const rateLimitId = auth.source === "guest"
    ? `${auth.user.id}:${clientIpFromHeaders(request.headers)}`
    : auth.user.id;
  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "user:create",
    userId: rateLimitId,
    requestId,
    sessionId: auth.sessionId,
    options: RATE_LIMIT,
  });
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit, requestId);

  if (getMusicEngineMode() !== "serverless") {
    return error("worker_unconfigured", "Durable music jobs require the serverless music worker", 503, requestId);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return error("validation_error", "Expected multipart form data", 400, requestId);
  }

  const operationId = readOperationId(request, form);
  if (!operationId) {
    return error("operation_id_required", "A valid operationId is required", 400, requestId);
  }
  const prompt = stringField(form, "prompt").trim();
  if (!prompt) return error("prompt_required", "prompt is required", 400, requestId);
  if (prompt.length > MAX_PROMPT_CHARS) {
    return error("validation_error", "prompt is too long", 400, requestId);
  }
  const melody = stringField(form, "melody").trim();
  if (melody.length > MAX_MELODY_CHARS) {
    return error("validation_error", "melody is too large", 413, requestId);
  }
  const duration = clampNumber(form.get("duration"), 10, 2, 20);
  const styleMix = clampNumber(form.get("styleMix"), 0, 0, 0.8);
  const batchRaw = request.headers.get("x-generation-batch-id")?.trim() || stringField(form, "generationBatchId");
  const generationBatchId = MUSIC_BATCH_ID_PATTERN.test(batchRaw) ? batchRaw : null;
  const humValue = form.get("hum");
  const hum = humValue instanceof File && humValue.size > 0 ? humValue : null;
  if (hum && hum.size > MAX_HUM_BYTES) {
    return error("validation_error", "hum recording is too large", 413, requestId);
  }

  try {
    const host = request.nextUrl?.hostname || safeHostnameFromUrl(request.url);
    const bill = !shouldSkipNotesBilling(auth)
      && !(auth.user.accountKind !== "local_creator" && shouldBypassBillingInDevelopment({ host }));
    const created = await createMusicJobReceipt({
      userId: auth.user.id,
      operationId,
      requestId,
      prompt,
      duration,
      styleMix,
      melody,
      hum,
      generationBatchId,
      bill,
    });

    if (!created.ok) {
      if (created.reason === "idempotency_conflict") {
        return NextResponse.json({
          error: "idempotency_conflict",
          message: "This operationId was already used with different music input",
          jobId: created.job?.id,
          requestId,
        }, { status: 409, headers: responseHeaders(requestId) });
      }
      const status = created.reason === "insufficient_notes" ? 402 : 503;
      return NextResponse.json({
        error: created.reason === "insufficient_notes" ? "insufficient_notes" : "billing_unavailable",
        message: created.reason === "insufficient_notes" ? "Not enough Murmur Notes" : "Billing account unavailable",
        currentBalance: created.currentBalance,
        cost: COST.music_generate,
        requestId,
      }, { status, headers: responseHeaders(requestId) });
    }

    let job = created.job;
    if (job.status === "result_ready") {
      const delivery = await resolveMusicJobDelivery(job);
      if (!delivery.ok) return settlementFailure(delivery, requestId);
      job = delivery.job;
    }
    if (!isTerminal(job.status)) {
      scheduleAfterResponse(() => advanceMusicJob(auth.user.id, job.id));
    }
    return NextResponse.json(jobResponse(job, created.duplicate), {
      status: created.duplicate && isTerminal(job.status) ? 200 : 202,
      headers: { ...responseHeaders(requestId), Location: `${ROUTE}/${job.id}` },
    });
  } catch (cause) {
    return error(
      "server_error",
      cause instanceof Error ? cause.message : "Could not create music job",
      500,
      requestId,
    );
  }
}

function readOperationId(request: NextRequest, form: FormData): string | null {
  const raw = request.headers.get("idempotency-key")?.trim()
    || request.headers.get("x-generation-clip-id")?.trim()
    || stringField(form, "operationId").trim();
  return MUSIC_OPERATION_ID_PATTERN.test(raw) ? raw : null;
}

function stringField(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

function clampNumber(value: FormDataEntryValue | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value ?? fallback);
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback));
}

function isTerminal(status: string): boolean {
  return ["succeeded", "failed", "canceled", "expired", "submission_unknown"].includes(status);
}

function jobResponse(job: MusicJob, duplicate: boolean) {
  return {
    jobId: job.id,
    operationId: job.operationId,
    status: job.status,
    duplicate,
    statusUrl: `${ROUTE}/${job.id}`,
    audioUrl: job.status === "succeeded" ? `${ROUTE}/${job.id}/audio` : null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

function responseHeaders(requestId: string): Record<string, string> {
  return { "Cache-Control": "no-store", "X-Request-Id": requestId };
}

function error(code: string, message: string, status: number, requestId: string) {
  return NextResponse.json({ error: code, message, requestId }, {
    status,
    headers: responseHeaders(requestId),
  });
}

function settlementFailure(
  result: Extract<Awaited<ReturnType<typeof resolveMusicJobDelivery>>, { ok: false }>,
  requestId: string,
) {
  const insufficient = result.reason === "insufficient_notes";
  return NextResponse.json({
    error: insufficient ? "insufficient_notes" : "billing_unavailable",
    message: insufficient
      ? "Generated audio is ready and waiting for Notes settlement. Retry this operation to recover it."
      : "Generated audio is ready, but delivery settlement is temporarily unavailable.",
    jobId: result.job.id,
    jobStatus: "result_ready",
    recoverable: true,
    ...(insufficient ? { currentBalance: result.currentBalance, cost: COST.music_generate } : {}),
    requestId,
  }, { status: insufficient ? 402 : 503, headers: responseHeaders(requestId) });
}
