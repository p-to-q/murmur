import { type NextRequest, NextResponse } from "next/server";

import { getRequestId } from "@/lib/api/request-id";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { resolveRequestAuth } from "@/lib/auth";
import { shouldAllowLocalPreviewFallback } from "@/lib/auth/local-preview";
import { getSongByIdForUser } from "@/lib/db/queries/songs";
import { getLocalSongByIdForUserFallback } from "@/lib/db/queries/local-song-fallback";
import {
  isDatabaseUnavailable,
  shouldUseGuestSongFallback,
} from "@/app/api/songs/db-fallback";
import { log } from "@/lib/observability/log";
import {
  buildSongAudioResponse,
  resolveSongAudioArtifact,
} from "@/lib/storage/song-audio-delivery";

export const runtime = "nodejs";
const ROUTE = "/api/songs/[id]/audio";
const OWNER_AUDIO_RATE_LIMIT = { capacity: 180, refillWindowMs: 60_000 };

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, context: Context) {
  return serveOwnerSongAudio(request, context);
}

export async function HEAD(request: NextRequest, context: Context) {
  return serveOwnerSongAudio(request, context);
}

async function serveOwnerSongAudio(request: NextRequest, context: Context) {
  const requestId = getRequestId(request);
  const auth = await resolveRequestAuth(request, {
    allowGuestPreview: shouldAllowLocalPreviewFallback(request),
  });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "read:user",
    userId: auth.user.id,
    requestId,
    sessionId: auth.sessionId,
    options: OWNER_AUDIO_RATE_LIMIT,
  });
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit, requestId);

  try {
    const song = await getSongByIdForUser(id, auth.user.id);
    if (!song) return failure("not_found", 404, requestId);
    return deliver(request, song, requestId);
  } catch (error) {
    if (shouldUseGuestSongFallback(request, auth.user.id) && isDatabaseUnavailable(error)) {
      const fallback = getLocalSongByIdForUserFallback(id, auth.user.id);
      if (!fallback) return failure("not_found", 404, requestId);
      return deliver(request, fallback, requestId);
    }
    log("song.audio_delivery_failed", {
      songId: id,
      reason: error instanceof Error ? error.message : String(error),
    }, {
      route: ROUTE,
      requestId,
      userId: auth.user.id,
      sessionId: auth.sessionId,
      level: "error",
    });
    return failure("audio_unavailable", 503, requestId);
  }
}

async function deliver(
  request: NextRequest,
  song: Parameters<typeof resolveSongAudioArtifact>[0] & { id?: string; title?: string },
  requestId: string,
) {
  const result = await resolveSongAudioArtifact(song);
  if (result.status === "none") return failure("audio_not_ready", 404, requestId);
  if (result.status === "missing") {
    log("song.audio_missing", { songId: song.id ?? null }, {
      route: ROUTE,
      requestId,
      level: "warn",
    });
    return failure("audio_missing", 410, requestId);
  }
  const response = buildSongAudioResponse({
    request,
    artifact: result.artifact,
    title: song.title ?? "murmur-song",
    requestId,
    cacheControl: "private, no-cache",
  });
  response.headers.set("X-Murmur-Audio-Source", result.artifact.source);
  return response;
}

function failure(error: string, status: number, requestId: string) {
  return NextResponse.json({ error, requestId }, {
    status,
    headers: { "Cache-Control": "no-store", "X-Request-Id": requestId },
  });
}
