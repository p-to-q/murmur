import { NextRequest, NextResponse } from "next/server";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { clientIpFromHeaders } from "@/lib/http/client-ip";
import { log } from "@/lib/observability/log";
import { hasSongShareAudio, normalizeSongShareCode } from "@/lib/share/song-share";
import { getDemoSong, isDemoSongId } from "@/presets/demo-songs";

const ROUTE = "/api/public/songs/[shareCode]";
const PUBLIC_SONG_RATE_LIMIT = { capacity: 120, refillWindowMs: 60_000 };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ shareCode: string }> },
) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const { shareCode: rawShareCode } = await params;
  const shareCode = normalizeSongShareCode(rawShareCode);
  if (!shareCode && !isDemoSongId(rawShareCode)) {
    return errorResponse("validation_error", 400, requestId, {
      message: "Invalid share code",
    });
  }

  if (isDemoSongId(rawShareCode)) {
    const demo = getDemoSong(rawShareCode);
    if (!demo) {
      return errorResponse("not_found", 404, requestId);
    }
    return publicSongResponse(toPublicSong(demo), requestId);
  }

  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "read:ip",
    userId: clientIpFromHeaders(req.headers),
    requestId,
    options: PUBLIC_SONG_RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  try {
    const { getPublicSongByShareCode } = await import("@/lib/db/queries/songs");
    const song = await getPublicSongByShareCode(shareCode!);
    if (!song || !hasSongShareAudio(song)) {
      return errorResponse("not_found", 404, requestId);
    }
    return publicSongResponse(toPublicSong(song), requestId);
  } catch (err) {
    const { getLocalSongByShareCodeFallback } = await import("@/lib/db/queries/local-song-fallback");
    const fallbackSong = getLocalSongByShareCodeFallback(shareCode!);
    if (fallbackSong && !hasSongShareAudio(fallbackSong)) {
      return errorResponse("not_found", 404, requestId);
    }
    if (fallbackSong) {
      return publicSongResponse(toPublicSong(fallbackSong), requestId, {
        "X-Murmur-Fallback": "local-guest-song",
      });
    }

    log("public_song.get_failed", {
      error: err instanceof Error ? err.message : String(err),
      shareCode,
    }, {
      route: ROUTE,
      requestId,
      level: "error",
    });
    return errorResponse("server_error", 500, requestId);
  }
}

type PublicSongPayload = ReturnType<typeof toPublicSong>;

function publicSongResponse(
  song: PublicSongPayload,
  requestId: string,
  extraHeaders: Record<string, string> = {},
) {
  const headers: Record<string, string> = {
    "X-Request-Id": requestId,
    // s-maxage stays short so unsharing a song propagates within ~5 minutes;
    // stale-while-revalidate only papers over the refresh itself.
    "Cache-Control":
      song.visibility === "public"
        ? "public, max-age=60, s-maxage=300, stale-while-revalidate=600"
        : "private, no-store",
    ...extraHeaders,
  };
  if (song.visibility !== "public") {
    headers["X-Robots-Tag"] = "noindex, nofollow";
  }
  return NextResponse.json(song, { headers });
}

function errorResponse(
  error: "validation_error" | "not_found" | "server_error",
  status: number,
  requestId: string,
  input: { message?: string } = {},
) {
  return NextResponse.json(
    {
      error,
      ...(input.message ? { message: input.message } : {}),
      requestId,
    },
    {
      status,
      headers: {
        "X-Request-Id": requestId,
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}

function toPublicSong(song: {
  id: string;
  title: string;
  vibe: string;
  vibeEn: string;
  bpm: number;
  keySignature: string;
  scaleType: string;
  duration: number;
  sourceMelodyKind: string;
  editCount: number;
  editDepth: string;
  visibility: string;
  shareCode: string | null;
  mp3DataUrl?: string | null;
  mp3Url?: string | null;
  visualConfig: unknown;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: song.id,
    title: song.title,
    vibe: song.vibe,
    vibeEn: song.vibeEn,
    bpm: song.bpm,
    keySignature: song.keySignature,
    duration: song.duration,
    visibility: song.visibility,
    shareCode: song.shareCode,
    mp3DataUrl: song.mp3DataUrl ?? null,
    mp3Url: song.mp3Url ?? null,
    visualConfig: song.visualConfig,
    tags: song.tags,
    createdAt: song.createdAt,
    updatedAt: song.updatedAt,
  };
}
