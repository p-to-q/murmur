import { NextRequest, NextResponse } from "next/server";

import { getRequestId } from "@/lib/api/request-id";
import { resolveRequestAuth } from "@/lib/auth";
import {
  getMusicJobForUser,
  requestMusicJobCancellation,
} from "@/lib/db/queries/music-jobs";
import { scheduleAfterResponse } from "@/lib/platform/request-lifecycle";
import {
  advanceMusicJob,
  deleteSubmittedHum,
  refundCanceledMusicJob,
} from "@/lib/platform/music-job-runner";
import { resolveMusicJobDelivery } from "@/lib/platform/music-job-delivery";
import { COST } from "@murmur/core";

export const runtime = "nodejs";
export const maxDuration = 30;

interface Context {
  params: Promise<{ jobId: string }>;
}

export async function GET(request: NextRequest, context: Context) {
  const requestId = getRequestId(request);
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;
  const { jobId } = await context.params;
  let job = await getMusicJobForUser(auth.user.id, jobId);
  if (!job) return notFound(requestId);

  if (job.status === "result_ready") {
    const delivery = await resolveMusicJobDelivery(job);
    if (!delivery.ok) return settlementFailure(delivery, requestId);
    job = delivery.job;
  }

  if (["accepted", "submitting", "queued", "running", "cancel_requested"].includes(job.status)) {
    scheduleAfterResponse(() => advanceMusicJob(auth.user.id, job.id));
  }
  return NextResponse.json(toResponse(job), { headers: headers(requestId) });
}

export async function DELETE(request: NextRequest, context: Context) {
  const requestId = getRequestId(request);
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;
  const { jobId } = await context.params;
  const result = await requestMusicJobCancellation(auth.user.id, jobId);
  if (result.kind === "not_found") return notFound(requestId);

  if (result.kind === "canceled") {
    scheduleAfterResponse(async () => {
      await deleteSubmittedHum(result.job.input).catch(() => undefined);
      await refundCanceledMusicJob(auth.user.id, jobId);
    });
  } else if (result.kind === "cancel_requested") {
    scheduleAfterResponse(() => advanceMusicJob(auth.user.id, jobId));
  }
  return NextResponse.json(toResponse(result.job), {
    status: result.kind === "cancel_requested" ? 202 : 200,
    headers: headers(requestId),
  });
}

function toResponse(job: import("@/lib/db/schema/music-jobs").MusicJob) {
  return {
    jobId: job.id,
    operationId: job.operationId,
    status: job.status,
    // Keep the old response key during the client migration; this value is a
    // fencing epoch, not a provider or model attempt.
    attempt: job.leaseEpoch,
    leaseEpoch: job.leaseEpoch,
    audioUrl: job.status === "succeeded" ? `/api/music/jobs/${job.id}/audio` : null,
    error: job.errorCode
      ? { code: job.errorCode, message: job.errorMessage ?? "Music generation failed" }
      : null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

function headers(requestId: string): Record<string, string> {
  return { "Cache-Control": "no-store", "X-Request-Id": requestId };
}

function notFound(requestId: string) {
  return NextResponse.json({ error: "not_found", message: "Music job not found", requestId }, {
    status: 404,
    headers: headers(requestId),
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
  }, { status: insufficient ? 402 : 503, headers: headers(requestId) });
}
