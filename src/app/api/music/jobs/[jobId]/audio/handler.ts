import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { getRequestId } from "@/lib/api/request-id";
import type { resolveRequestAuth } from "@/lib/auth";
import type { getObjectStore } from "@/lib/storage";

interface Context {
  params: Promise<{ jobId: string }>;
}

interface MusicJobAudioDeps {
  resolveRequestAuth: typeof resolveRequestAuth;
  getMusicJobForUser: (
    userId: string,
    jobId: string,
  ) => Promise<{
    status: string;
    output: { storageKey?: string | null; digest: string } | null;
  } | null>;
  getArtifact: (key: string) => ReturnType<ReturnType<typeof getObjectStore>["get"]>;
}

export async function getMusicJobAudio(
  request: NextRequest,
  context: Context,
  deps: MusicJobAudioDeps,
) {
  const requestId = getRequestId(request);
  const auth = await deps.resolveRequestAuth(request);
  if (!auth.ok) return auth.response;
  const { jobId } = await context.params;
  const job = await deps.getMusicJobForUser(auth.user.id, jobId);
  if (!job) return failure("not_found", "Music job not found", 404, requestId);
  if (job.status !== "succeeded" || !job.output?.storageKey) {
    return failure("audio_not_ready", "Music audio is not ready", 409, requestId);
  }
  const artifact = await deps.getArtifact(job.output.storageKey);
  if (!artifact) {
    return failure("audio_missing", "Music audio artifact is unavailable", 410, requestId);
  }
  const deliveredDigest = createHash("sha256").update(artifact.body).digest("hex");
  if (deliveredDigest !== job.output.digest.toLowerCase()) {
    return failure(
      "audio_integrity_failed",
      "Music audio artifact failed integrity verification",
      502,
      requestId,
    );
  }

  return new NextResponse(artifact.body as BodyInit, {
    headers: {
      "Content-Type": artifact.contentType,
      "Content-Length": String(artifact.size),
      "Cache-Control": "private, max-age=3600, immutable",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId,
      "X-Audio-SHA256": job.output.digest,
    },
  });
}

function failure(error: string, message: string, status: number, requestId: string) {
  return NextResponse.json({ error, message, requestId }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
  });
}
