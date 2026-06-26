import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { resolveRequestAuth } from "@/lib/auth";
import { shouldBypassBillingInDevelopment } from "@/lib/billing/dev-balance";
import {
  getRequestHostname,
  shouldAllowLocalPreviewFallback,
} from "@/lib/auth/local-preview";
import { shouldSkipNotesBilling } from "@/lib/billing/session-billing";
import {
  getSongByIdForCreateConflict,
  getSongSummariesByUser,
  createSong,
  createSongWithSpend,
} from "@/lib/db/queries/songs";
import {
  createLocalSongFallback,
  getLocalSongSummariesByUserFallback,
} from "@/lib/db/queries/local-song-fallback";
import { log } from "@/lib/observability/log";
import { COST } from "@murmur/core";
import { deriveEditDepth, normalizeEditCount } from "@/modules/music/edit-depth";
import { normalizeLineageDepth, resolveParentSongId, resolveRootSongId } from "@/modules/music/lineage";
import { arrangementStateSchema, visualConfigSchema } from "./schema";
import type { MelodySelectionKind } from "@/modules/shared/types";
import type { songs } from "@/lib/db/schema/songs";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

const ROUTE = "/api/songs";
const SONG_CREATE_RATE_LIMIT = { capacity: 20, refillWindowMs: 60_000 };
const MELODY_SELECTION_KINDS = new Set<MelodySelectionKind>(["intent", "corrected", "musical"]);

const songPayloadSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  vibe: z.string().min(1),
  vibeEn: z.string().min(1),
  bpm: z.number().int(),
  keySignature: z.string().min(1),
  scaleType: z.string().min(1),
  duration: z.number().int().nonnegative(),
  parentSongId: z.string().min(1).nullable().optional(),
  rootSongId: z.string().min(1).nullable().optional(),
  lineageDepth: z.number().int().optional(),
  sourceMelodyKind: z.string().optional(),
  editCount: z.number().int().optional(),
  editDepth: z.enum(["fresh", "shaped", "reworked"]).optional(),
  mp3DataUrl: z.string().nullable().optional(),
  mp3Url: z.string().nullable().optional(),
  inputKind: z.enum(["hum", "voice", "demo", "library"]).optional(),
  lyrics: z.string().nullable().optional(),
  generationProvider: z.string().nullable().optional(),
  visualConfig: visualConfigSchema,
  arrangementState: arrangementStateSchema,
  tags: z.array(z.string()),
}).passthrough();

type SongPayload = z.infer<typeof songPayloadSchema>;
type SongInput = typeof songs.$inferInsert;
type OkAuth = Extract<ResolvedRequestAuth, { ok: true }>;

export async function GET(req: NextRequest) {
  const requestHost = getRequestHostname(req);
  const auth = await resolveRequestAuth(req, {
    allowGuestPreview: shouldAllowLocalPreviewFallback(req),
  });
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;
  try {
    const rows = await getSongSummariesByUser(userId);
    return NextResponse.json(rows);
  } catch (err) {
    if (shouldUseLocalSongFallback(auth, requestHost) && isDatabaseUnavailable(err)) {
      const rows = getLocalSongSummariesByUserFallback(userId);
      log("song.list_failed", {
        reason: "database_unavailable",
        fallback: "local_guest_song_snapshot",
        count: rows.length,
      }, {
        route: "/api/songs",
        userId,
        sessionId: auth.sessionId,
        level: "warn",
      });
      return NextResponse.json(rows);
    }

    log("song.list_failed", {
      error: err instanceof Error ? err.message : String(err),
    }, {
      route: ROUTE,
      userId,
      sessionId: auth.sessionId,
      level: "error",
    });
    if (isDatabaseUnavailable(err)) {
      return NextResponse.json(
        { error: "songs_unavailable", message: "Database unavailable" },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Failed to fetch songs" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const requestHost = getRequestHostname(req);
  const auth = await resolveRequestAuth(req, {
    allowGuestPreview: shouldAllowLocalPreviewFallback(req),
  });
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;
  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "create:user",
    userId,
    requestId,
    sessionId: auth.sessionId,
    options: SONG_CREATE_RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  let body: SongPayload;
  try {
    body = songPayloadSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "validation_error",
          message: "Invalid song payload",
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
    }, {
      route: ROUTE,
      userId,
      sessionId: auth.sessionId,
      requestId,
      level: "warn",
    });
    return NextResponse.json(
      { error: "Failed to read song payload", requestId },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const songInput = buildSongInput(body, userId);

  try {
    const skipBilling =
      shouldBypassBillingInDevelopment({ host: requestHost })
      || COST.save === 0
      || shouldSkipNotesBilling(auth);
    if (skipBilling) {
      try {
        const song = await createSong(songInput);

        return NextResponse.json(song, {
          headers: { "X-Request-Id": requestId },
        });
      } catch (dbError) {
        if (isSongIdUniqueConstraintViolation(dbError)) {
          return handleSongIdConflict(songInput.id, userId, requestId);
        }
        if (
          shouldUseLocalSongFallback(auth, requestHost)
          && isDatabaseUnavailable(dbError)
        ) {
          const fallbackSong = createLocalSongFallback(songInput);
          log("song.create_failed", {
            reason: "database_unavailable",
            fallback: "local_song_snapshot",
            songId: fallbackSong.id,
          }, {
            route: ROUTE,
            requestId,
            userId,
            sessionId: auth.sessionId,
            level: "warn",
          });
          return NextResponse.json(fallbackSong, {
            headers: {
              "X-Request-Id": requestId,
              "X-Murmur-Fallback": "local-song",
            },
          });
        }
        throw dbError;
      }
    }

    const result = await createSongWithSpend(
      songInput,
      {
        cost: COST.save,
        externalRef: requestId,
        metadata: {
          title: typeof body.title === "string" ? body.title.slice(0, 80) : null,
        },
      },
    );

    if (!result.ok) {
      if (result.reason === "insufficient_notes") {
        return NextResponse.json(
          {
            error: "insufficient_notes",
            message: "Not enough Murmur Notes",
            currentBalance: result.currentBalance,
            cost: COST.save,
            requestId,
          },
          { status: 402, headers: { "X-Request-Id": requestId } },
        );
      }

      return NextResponse.json(
        {
          error: "billing_unavailable",
          message: "User balance is unavailable",
          requestId,
        },
        { status: 503, headers: { "X-Request-Id": requestId } },
      );
    }

    log("notes.spent", {
      reason: "spend:save",
      cost: COST.save,
      balanceAfter: result.spend.balanceAfter,
      ledgerId: result.spend.ledgerId,
    }, {
      route: ROUTE,
      requestId,
      userId,
      sessionId: auth.sessionId,
    });
    log("song.created", {
      songId: result.song.id,
      cost: COST.save,
      balanceAfter: result.spend.balanceAfter,
    }, {
      route: ROUTE,
      requestId,
      userId,
      sessionId: auth.sessionId,
    });

    return NextResponse.json(result.song, {
      headers: { "X-Request-Id": requestId },
    });
  } catch (err) {
    if (shouldUseLocalSongFallback(auth, requestHost) && isDatabaseUnavailable(err)) {
      const fallbackSong = createLocalSongFallback(songInput);
      log("song.create_failed", {
        reason: "database_unavailable",
        fallback: "local_guest_song_snapshot",
        songId: fallbackSong.id,
      }, {
        route: ROUTE,
        requestId,
        userId,
        sessionId: auth.sessionId,
        level: "warn",
      });
      return NextResponse.json(fallbackSong, {
        headers: {
          "X-Request-Id": requestId,
          "X-Murmur-Fallback": "local-guest-song",
        },
      });
    }

    const cause = err instanceof Error && "cause" in err ? err.cause : undefined;
    log("song.create_failed", {
      error: err instanceof Error ? err.message : String(err),
      code: objectFieldAsString(err, "code"),
      detail: objectFieldAsString(cause, "message"),
      databaseUnavailable: isDatabaseUnavailable(err),
    }, {
      route: ROUTE,
      requestId,
      userId,
      sessionId: auth.sessionId,
      level: "error",
    });
    if (isDatabaseUnavailable(err)) {
      return NextResponse.json(
        { error: "save_unavailable", message: "Database unavailable", requestId },
        { status: 503, headers: { "X-Request-Id": requestId } },
      );
    }

    if (isSongIdUniqueConstraintViolation(err)) {
      return handleSongIdConflict(songInput.id, userId, requestId);
    }

    return NextResponse.json(
      { error: "Failed to save song", requestId },
      { status: 500, headers: { "X-Request-Id": requestId } },
    );
  }
}

function buildSongInput(body: SongPayload, userId: string): SongInput {
  const editCount = normalizeEditCount(body.editCount);
  const lineageDepth = normalizeLineageDepth(body.lineageDepth);
  const sourceMelodyKind = isMelodySelectionKind(body.sourceMelodyKind)
    ? body.sourceMelodyKind
    : "corrected";
  const editDepth = deriveEditDepth(editCount);
  const parentSongId = resolveParentSongId({ id: body.id, parentSongId: body.parentSongId });
  const rootSongId = resolveRootSongId({ id: body.id, rootSongId: body.rootSongId });

  return {
    id: body.id,
    userId,
    title: body.title,
    vibe: body.vibe,
    vibeEn: body.vibeEn,
    bpm: body.bpm,
    keySignature: body.keySignature,
    scaleType: body.scaleType,
    duration: body.duration,
    parentSongId,
    rootSongId,
    lineageDepth,
    sourceMelodyKind,
    editCount,
    editDepth,
    mp3DataUrl: body.mp3DataUrl ?? null,
    mp3Url: body.mp3Url ?? null,
    inputKind: body.inputKind ?? "hum",
    lyrics: body.lyrics ?? null,
    generationProvider: body.generationProvider ?? null,
    visualConfig: body.visualConfig,
    arrangementState: body.arrangementState,
    tags: body.tags,
  };
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSongIdUniqueConstraintViolation(error: unknown): boolean {
  if (!isObject(error)) return false;

  const code = "code" in error ? String(error.code) : "";
  if (code && code !== "23505") return false;

  const constraint = objectFieldAsString(error, "constraint")?.toLowerCase() ?? "";
  if (constraint === "songs_pkey") return true;

  const message = "message" in error ? String(error.message).toLowerCase() : "";
  const detail = objectFieldAsString(error, "detail")?.toLowerCase() ?? "";
  const table = objectFieldAsString(error, "table")?.toLowerCase() ?? "";
  if (
    message.includes("duplicate key") &&
    (message.includes("songs_pkey") || (table === "songs" && detail.includes("key (id)=")))
  ) {
    return true;
  }

  const cause = "cause" in error ? error.cause : null;
  if (cause && isSongIdUniqueConstraintViolation(cause)) return true;

  const nestedErrors = "errors" in error ? error.errors : null;
  if (Array.isArray(nestedErrors)) {
    return nestedErrors.some((nestedError) => isSongIdUniqueConstraintViolation(nestedError));
  }

  return false;
}

async function handleSongIdConflict(songId: string, userId: string, requestId: string) {
  const existing = await getSongByIdForCreateConflict(songId);
  if (existing?.userId === userId) {
    return NextResponse.json(existing, {
      headers: {
        "X-Request-Id": requestId,
        "X-Murmur-Idempotent-Replay": "song",
      },
    });
  }

  return songIdConflictResponse(requestId);
}

function songIdConflictResponse(requestId: string) {
  return NextResponse.json(
    {
      error: "song_id_conflict",
      message: "Could not save this draft because its song id already exists.",
      requestId,
    },
    { status: 409, headers: { "X-Request-Id": requestId } },
  );
}

function objectFieldAsString(value: unknown, key: string): string | undefined {
  if (!isObject(value) || !(key in value)) return undefined;
  const field = value[key];
  return typeof field === "string" ? field : String(field);
}

function shouldUseLocalSongFallback(auth: OkAuth, host?: string | null): boolean {
  if (auth.source === "guest" || auth.source === "local_header") {
    return true;
  }

  return (
    auth.user.accountKind === "local_creator"
    && shouldBypassBillingInDevelopment({ host })
  );
}

function isMelodySelectionKind(value: unknown): value is MelodySelectionKind {
  return typeof value === "string" && MELODY_SELECTION_KINDS.has(value as MelodySelectionKind);
}
