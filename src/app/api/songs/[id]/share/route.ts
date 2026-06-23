import { NextRequest, NextResponse } from "next/server";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { resolveRequestAuth } from "@/lib/auth";
import {
  getSongByIdForUser,
  publishSongShareForUser,
  revokeSongShareForUser,
} from "@/lib/db/queries/songs";
import {
  getLocalSongByIdForUserFallback,
  publishLocalSongShareForUserFallback,
  revokeLocalSongShareForUserFallback,
} from "@/lib/db/queries/local-song-fallback";
import { shouldBypassBillingInDevelopment } from "@/lib/billing/dev-balance";
import { log } from "@/lib/observability/log";
import { getSiteUrl } from "@/lib/site-url";
import {
  buildSongShareUrl,
  createSongShareCode,
  hasSongShareAudio,
  isSongShareVisibility,
  normalizeSongShareVisibility,
} from "@/lib/share/song-share";
import { isDemoSongId } from "@/presets/demo-songs";

const ROUTE = "/api/songs/[id]/share";
const SHARE_CREATE_RATE_LIMIT = { capacity: 20, refillWindowMs: 60_000 };
const SHARE_REVOKE_RATE_LIMIT = { capacity: 20, refillWindowMs: 60_000 };
const SHARE_CODE_ATTEMPTS = 5;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveRequestAuth(req);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const userId = auth.user.id;
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const body = await readJsonObject(req);
  if ("visibility" in body && !isSongShareVisibility(body.visibility)) {
    return errorResponse("validation_error", 400, requestId, {
      message: "visibility must be unlisted or public",
    });
  }
  const visibility = normalizeSongShareVisibility(body.visibility);

  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "publish:user",
    userId,
    requestId,
    sessionId: auth.sessionId,
    options: SHARE_CREATE_RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  if (isDemoSongId(id)) {
    return shareResponse(
      {
        shareCode: id,
        visibility: "unlisted",
        url: buildSongShareUrl(getSiteUrl(), id),
      },
      requestId,
    );
  }

  try {
    const existing = await getSongByIdForUser(id, userId);
    if (!existing) {
      return errorResponse("not_found", 404, requestId);
    }
    if (!hasSongShareAudio(existing)) {
      await revokeExistingShareIfNeeded(id, userId, existing);
      return errorResponse("audio_required", 400, requestId);
    }

    const song =
      existing.shareCode && existing.visibility === visibility
        ? existing
        : await publishSongShareWithRetry(id, userId, {
            existingShareCode: existing.shareCode,
            visibility,
          });

    if (!song?.shareCode) {
      return errorResponse("not_found", 404, requestId);
    }

    return shareResponse({
      shareCode: song.shareCode,
      visibility: song.visibility,
      url: buildSongShareUrl(getSiteUrl(), song.shareCode),
    }, requestId);
  } catch (err) {
    if (shouldUseLocalSongFallback(req, userId) && isDatabaseUnavailable(err)) {
      const existing = getLocalSongByIdForUserFallback(id, userId);
      if (!existing) {
        return errorResponse("not_found", 404, requestId);
      }
      if (!hasSongShareAudio(existing)) {
        revokeLocalShareIfNeeded(id, userId, existing);
        return errorResponse("audio_required", 400, requestId);
      }
      const shareCode = existing.shareCode || createSongShareCode();
      const song = publishLocalSongShareForUserFallback(id, userId, {
        shareCode,
        visibility,
      });
      if (!song?.shareCode) {
        return errorResponse("not_found", 404, requestId);
      }
      return shareResponse(
        {
          shareCode: song.shareCode,
          visibility: song.visibility,
          url: buildSongShareUrl(getSiteUrl(), song.shareCode),
        },
        requestId,
        { "X-Murmur-Fallback": "local-guest-song" },
      );
    }

    log("song.share_failed", {
      error: err instanceof Error ? err.message : String(err),
      songId: id,
    }, {
      route: ROUTE,
      requestId,
      userId,
      sessionId: auth.sessionId,
      level: "error",
    });
    if (isUniqueShareCodeConflict(err)) {
      return errorResponse("conflict", 409, requestId, {
        message: "Could not allocate a share code. Please retry.",
      });
    }
    return errorResponse("server_error", 500, requestId);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveRequestAuth(req);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  const userId = auth.user.id;
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();

  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "revoke:user",
    userId,
    requestId,
    sessionId: auth.sessionId,
    options: SHARE_REVOKE_RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  if (isDemoSongId(id)) {
    return errorResponse("not_found", 404, requestId);
  }

  try {
    const song = await revokeSongShareForUser(id, userId);
    if (!song) {
      return errorResponse("not_found", 404, requestId);
    }

    return NextResponse.json(
      {
        id: song.id,
        shareCode: song.shareCode,
        visibility: song.visibility,
      },
      { headers: { "X-Request-Id": requestId } },
    );
  } catch (err) {
    if (shouldUseLocalSongFallback(req, userId) && isDatabaseUnavailable(err)) {
      const song = revokeLocalSongShareForUserFallback(id, userId);
      if (!song) {
        return errorResponse("not_found", 404, requestId);
      }
      return NextResponse.json(
        {
          id: song.id,
          shareCode: song.shareCode,
          visibility: song.visibility,
        },
        {
          headers: {
            "X-Request-Id": requestId,
            "X-Murmur-Fallback": "local-guest-song",
          },
        },
      );
    }

    log("song.share_failed", {
      error: err instanceof Error ? err.message : String(err),
      songId: id,
      action: "revoke",
    }, {
      route: ROUTE,
      requestId,
      userId,
      sessionId: auth.sessionId,
      level: "error",
    });
    return errorResponse("server_error", 500, requestId);
  }
}

function shareResponse(
  body: {
    shareCode: string;
    visibility: string;
    url: string;
  },
  requestId: string,
  extraHeaders: Record<string, string> = {},
) {
  return NextResponse.json(body, {
    headers: {
      "X-Request-Id": requestId,
      ...extraHeaders,
    },
  });
}

async function publishSongShareWithRetry(
  songId: string,
  userId: string,
  input: {
    existingShareCode: string | null;
    visibility: "unlisted" | "public";
  },
) {
  if (input.existingShareCode) {
    return publishSongShareForUser(songId, userId, {
      shareCode: input.existingShareCode,
      visibility: input.visibility,
    });
  }

  let lastConflict: unknown = null;
  for (let attempt = 0; attempt < SHARE_CODE_ATTEMPTS; attempt += 1) {
    try {
      return await publishSongShareForUser(songId, userId, {
        shareCode: createSongShareCode(),
        visibility: input.visibility,
      });
    } catch (err) {
      if (!isUniqueShareCodeConflict(err)) throw err;
      lastConflict = err;
    }
  }
  throw lastConflict ?? new Error("share code allocation failed");
}

function errorResponse(
  error: "validation_error" | "not_found" | "conflict" | "audio_required" | "server_error",
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

async function revokeExistingShareIfNeeded(
  songId: string,
  userId: string,
  song: { shareCode?: unknown; visibility?: unknown },
) {
  if (!song.shareCode && song.visibility === "private") return;
  await revokeSongShareForUser(songId, userId);
}

function revokeLocalShareIfNeeded(
  songId: string,
  userId: string,
  song: { shareCode?: unknown; visibility?: unknown },
) {
  if (!song.shareCode && song.visibility === "private") return;
  revokeLocalSongShareForUserFallback(songId, userId);
}

async function readJsonObject(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return isObject(body) ? body : {};
  } catch {
    return {};
  }
}

function shouldUseLocalSongFallback(req: NextRequest, userId: string): boolean {
  if (userId !== "guest") return false;
  return shouldBypassBillingInDevelopment({
    host: req.nextUrl?.hostname ?? null,
  });
}

function isDatabaseUnavailable(error: unknown): boolean {
  if (!isObject(error)) return false;

  const code = "code" in error ? error.code : null;
  if (code === "ECONNREFUSED") return true;

  const message = "message" in error ? String(error.message) : "";
  if (message.includes("ECONNREFUSED") || message.includes("connection refused")) {
    return true;
  }

  const cause = "cause" in error ? error.cause : null;
  if (cause && isDatabaseUnavailable(cause)) return true;

  const nestedErrors = "errors" in error ? error.errors : null;
  if (Array.isArray(nestedErrors)) {
    return nestedErrors.some((nestedError) => isDatabaseUnavailable(nestedError));
  }

  return false;
}

function isUniqueShareCodeConflict(error: unknown): boolean {
  if (!isObject(error)) return false;
  const code = "code" in error ? error.code : null;
  if (code === "23505") return true;
  const constraint = "constraint" in error ? String(error.constraint) : "";
  if (constraint.includes("songs_share_code")) return true;
  const message = "message" in error ? String(error.message) : "";
  return message.includes("songs_share_code") || message.includes("duplicate key");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
