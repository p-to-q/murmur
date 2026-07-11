import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/request-id";
import { resolveRequestAuth } from "@/lib/auth";
import { shouldAllowLocalPreviewFallback } from "@/lib/auth/local-preview";
import {
  deleteSongForUser,
  getSongByIdForUser,
  getSongSummaryByIdForUser,
  updateSongForUser,
} from "@/lib/db/queries/songs";
import { getDemoSong, isDemoSongId } from "@/presets/demo-songs";
import {
  deleteLocalSongForUserFallback,
  getLocalSongByIdForUserFallback,
  updateLocalSongForUserFallback,
} from "@/lib/db/queries/local-song-fallback";
import {
  isDatabaseUnavailable,
  shouldUseGuestSongFallback,
} from "@/app/api/songs/db-fallback";
import { log } from "@/lib/observability/log";
import {
  songTagsSchema,
  sourceMelodyKindSchema,
  strictArrangementStateSchema,
  strictVisualConfigSchema,
} from "../schema";

const ROUTE = "/api/songs/[id]";
const READ_RATE_LIMIT = { capacity: 60, refillWindowMs: 60_000 };
const MUTATE_RATE_LIMIT = { capacity: 20, refillWindowMs: 60_000 };

const updateSongSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  vibe: z.string().min(1).max(500).optional(),
  vibeEn: z.string().min(1).max(500).optional(),
  bpm: z.number().int().optional(),
  keySignature: z.string().min(1).max(100).optional(),
  scaleType: z.string().min(1).max(100).optional(),
  duration: z.number().int().nonnegative().optional(),
  parentSongId: z.string().min(1).max(100).nullable().optional(),
  rootSongId: z.string().min(1).max(100).nullable().optional(),
  lineageDepth: z.number().int().nonnegative().optional(),
  // Shared with the create route (#311) so the two contracts cannot drift.
  sourceMelodyKind: sourceMelodyKindSchema.optional(),
  editCount: z.number().int().nonnegative().optional(),
  editDepth: z.enum(["fresh", "shaped", "reworked"]).optional(),
  mp3DataUrl: z.string().nullable().optional(),
  mp3Url: z.string().max(2048).nullable().optional(),
  mp3StorageKey: z.string().max(1024).nullable().optional(),
  visualConfig: strictVisualConfigSchema.optional(),
  arrangementState: strictArrangementStateSchema.optional(),
  tags: songTagsSchema.optional(),
}).strict();

type SongUpdatePayload = z.infer<typeof updateSongSchema>;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const requestId = getRequestId(req);

  if (isDemoSongId(id)) {
    const demo = getDemoSong(id);
    if (!demo) return errorResponse("not_found", 404, requestId);
    const { mp3Url, ...rest } = demo;
    return NextResponse.json(
      { ...rest, mp3DataUrl: null, mp3Url },
      { headers: { "X-Request-Id": requestId } },
    );
  }

  const auth = await resolveRequestAuth(req, {
    allowGuestPreview: shouldAllowLocalPreviewFallback(req),
  });
  if (!auth.ok) {
    auth.response.headers.set("X-Request-Id", requestId);
    return auth.response;
  }
  const userId = auth.user.id;

  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "read:user",
    userId,
    requestId,
    sessionId: auth.sessionId,
    options: READ_RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  try {
    // ?view=summary serves metadata-only consumers (e.g. the lineage trail)
    // without the multi-MB mp3DataUrl / arrangementState payload. The default
    // full view is unchanged.
    const song =
      requestedView(req) === "summary"
        ? await getSongSummaryByIdForUser(id, userId)
        : await getSongByIdForUser(id, userId);
    if (!song) {
      return errorResponse("not_found", 404, requestId);
    }
    return NextResponse.json(song, {
      headers: { "X-Request-Id": requestId },
    });
  } catch (err) {
    if (shouldUseGuestSongFallback(req, userId) && isDatabaseUnavailable(err)) {
      const fallbackSong = getLocalSongByIdForUserFallback(id, userId);
      if (!fallbackSong) {
        return errorResponse("not_found", 404, requestId);
      }
      return NextResponse.json(fallbackSong, {
        headers: {
          "X-Murmur-Fallback": "local-guest-song",
          "X-Request-Id": requestId,
        },
      });
    }
    log("song.get_failed", {
      error: err instanceof Error ? err.message : String(err),
      songId: id,
    }, {
      route: ROUTE,
      userId,
      sessionId: auth.sessionId,
      level: "error",
    });
    return errorResponse("server_error", 500, requestId);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(req);
  const auth = await resolveRequestAuth(req, {
    allowGuestPreview: shouldAllowLocalPreviewFallback(req),
  });
  if (!auth.ok) {
    auth.response.headers.set("X-Request-Id", requestId);
    return auth.response;
  }
  const userId = auth.user.id;
  const { id } = await params;

  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "update:user",
    userId,
    requestId,
    sessionId: auth.sessionId,
    options: MUTATE_RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  let body: SongUpdatePayload;
  try {
    body = updateSongSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "validation_error",
          message: "Invalid song update payload",
          requestId,
          issues: err.issues.map((issue) => ({
            path: issue.path.join("."),
            code: issue.code,
            message: issue.message,
          })),
        },
        { status: 400, headers: { "X-Request-Id": requestId } },
      );
    }

    log("song.payload_invalid", {
      error: err instanceof Error ? err.message : String(err),
      songId: id,
    }, {
      route: ROUTE,
      userId,
      sessionId: auth.sessionId,
      level: "warn",
    });
    return errorResponse("validation_error", 400, requestId, {
      message: "Invalid payload",
    });
  }

  try {
    const updated = await updateSongForUser(id, userId, body);
    if (!updated) {
      return errorResponse("not_found", 404, requestId);
    }
    return NextResponse.json(updated, {
      headers: { "X-Request-Id": requestId },
    });
  } catch (err) {
    if (shouldUseGuestSongFallback(req, userId) && isDatabaseUnavailable(err)) {
      const updated = updateLocalSongForUserFallback(id, userId, body);
      if (!updated) {
        return errorResponse("not_found", 404, requestId);
      }
      return NextResponse.json(updated, {
        headers: {
          "X-Murmur-Fallback": "local-guest-song",
          "X-Request-Id": requestId,
        },
      });
    }

    log("song.update_failed", {
      error: err instanceof Error ? err.message : String(err),
      songId: id,
    }, {
      route: ROUTE,
      userId,
      sessionId: auth.sessionId,
      level: "error",
    });
    return errorResponse("server_error", 500, requestId);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = getRequestId(req);
  const auth = await resolveRequestAuth(req, {
    allowGuestPreview: shouldAllowLocalPreviewFallback(req),
  });
  if (!auth.ok) {
    auth.response.headers.set("X-Request-Id", requestId);
    return auth.response;
  }
  const userId = auth.user.id;
  const { id } = await params;

  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "delete:user",
    userId,
    requestId,
    sessionId: auth.sessionId,
    options: MUTATE_RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  try {
    const deleted = await deleteSongForUser(id, userId);
    if (!deleted) {
      return errorResponse("not_found", 404, requestId);
    }
    return NextResponse.json(
      { success: true },
      { headers: { "X-Request-Id": requestId } },
    );
  } catch (err) {
    if (shouldUseGuestSongFallback(req, userId) && isDatabaseUnavailable(err)) {
      const deleted = deleteLocalSongForUserFallback(id, userId);
      if (!deleted) {
        return errorResponse("not_found", 404, requestId);
      }
      return NextResponse.json(
        { success: true },
        {
          headers: {
            "X-Murmur-Fallback": "local-guest-song",
            "X-Request-Id": requestId,
          },
        },
      );
    }
    log("song.delete_failed", {
      error: err instanceof Error ? err.message : String(err),
      songId: id,
    }, {
      route: ROUTE,
      userId,
      sessionId: auth.sessionId,
      level: "error",
    });
    return errorResponse("server_error", 500, requestId);
  }
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
    { status, headers: { "X-Request-Id": requestId } },
  );
}

function requestedView(req: NextRequest): string | null {
  const nextUrl = (req as { nextUrl?: { searchParams?: URLSearchParams } }).nextUrl;
  if (nextUrl?.searchParams) return nextUrl.searchParams.get("view");

  try {
    return new URL(req.url).searchParams.get("view");
  } catch {
    return null;
  }
}

