import { type NextRequest, NextResponse } from "next/server";

import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/request-id";
import { clientIpFromHeaders } from "@/lib/http/client-ip";
import { getPublicSongByShareCode } from "@/lib/db/queries/songs";
import { getLocalSongByShareCodeFallback } from "@/lib/db/queries/local-song-fallback";
import { normalizeSongShareCode } from "@/lib/share/song-share";
import { getDemoSong, isDemoSongId } from "@/presets/demo-songs";
import {
  buildSongAudioResponse,
  resolveSongAudioArtifact,
} from "@/lib/storage/song-audio-delivery";
import { log } from "@/lib/observability/log";
import { shouldAllowLocalPreviewFallback } from "@/lib/auth/local-preview";
import { isDatabaseUnavailable } from "@/app/api/songs/db-fallback";

export const runtime = "nodejs";
const ROUTE = "/api/public/songs/[shareCode]/audio";
const PUBLIC_AUDIO_RATE_LIMIT = { capacity: 240, refillWindowMs: 60_000 };

interface Context {
  params: Promise<{ shareCode: string }>;
}

export async function GET(request: NextRequest, context: Context) {
  return servePublicSongAudio(request, context);
}

export async function HEAD(request: NextRequest, context: Context) {
  return servePublicSongAudio(request, context);
}

async function servePublicSongAudio(request: NextRequest, context: Context) {
  const requestId = getRequestId(request);
  const { shareCode: rawShareCode } = await context.params;
  if (isDemoSongId(rawShareCode)) {
    const demo = getDemoSong(rawShareCode);
    return demo
      ? NextResponse.redirect(new URL(demo.mp3Url, request.url), 307)
      : failure("not_found", 404, requestId);
  }
  const shareCode = normalizeSongShareCode(rawShareCode);
  if (!shareCode) return failure("not_found", 404, requestId);
  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "read:ip",
    userId: clientIpFromHeaders(request.headers),
    requestId,
    options: PUBLIC_AUDIO_RATE_LIMIT,
  });
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit, requestId);

  try {
    const song = await getPublicSongByShareCode(shareCode);
    if (!song) return failure("not_found", 404, requestId);
    return deliver(request, song, requestId);
  } catch (error) {
    const fallback = shouldAllowLocalPreviewFallback(request) && isDatabaseUnavailable(error)
      ? getLocalSongByShareCodeFallback(shareCode)
      : null;
    if (fallback) return deliver(request, fallback, requestId);
    log("public_song.audio_delivery_failed", {
      shareCode,
      reason: error instanceof Error ? error.message : String(error),
    }, {
      route: ROUTE,
      requestId,
      level: "error",
    });
    return failure("audio_unavailable", 503, requestId);
  }
}

async function deliver(
  request: NextRequest,
  song: Parameters<typeof resolveSongAudioArtifact>[0] & { title?: string },
  requestId: string,
) {
  const result = await resolveSongAudioArtifact(song);
  if (result.status === "none") return failure("not_found", 404, requestId);
  if (result.status === "missing") {
    log("public_song.audio_missing", {}, {
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
    cacheControl: "private, no-store",
  });
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  response.headers.set("X-Murmur-Audio-Source", result.artifact.source);
  return response;
}

function failure(error: string, status: number, requestId: string) {
  return NextResponse.json({ error, requestId }, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Request-Id": requestId,
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
