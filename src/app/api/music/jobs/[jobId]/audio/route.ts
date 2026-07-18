import { NextRequest, NextResponse } from "next/server";

import { getRequestId } from "@/lib/api/request-id";
import { resolveRequestAuth } from "@/lib/auth";
import { getMusicJobForUser } from "@/lib/db/queries/music-jobs";
import { getObjectStore } from "@/lib/storage";

export const runtime = "nodejs";

interface Context {
  params: Promise<{ jobId: string }>;
}

export async function GET(request: NextRequest, context: Context) {
  const requestId = getRequestId(request);
  const auth = await resolveRequestAuth(request);
  if (!auth.ok) return auth.response;
  const { jobId } = await context.params;
  const job = await getMusicJobForUser(auth.user.id, jobId);
  if (!job) return failure("not_found", "Music job not found", 404, requestId);
  if (job.status !== "succeeded" || !job.output?.storageKey) {
    return failure("audio_not_ready", "Music audio is not ready", 409, requestId);
  }
  const artifact = await getObjectStore().get(job.output.storageKey);
  if (!artifact) return failure("audio_missing", "Music audio artifact is unavailable", 410, requestId);

  return new NextResponse(artifact.body as BodyInit, {
    headers: {
      "Content-Type": artifact.contentType,
      "Content-Length": String(artifact.size),
      "Cache-Control": "private, max-age=3600, immutable",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId,
    },
  });
}

function failure(error: string, message: string, status: number, requestId: string) {
  return NextResponse.json({ error, message, requestId }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
  });
}
