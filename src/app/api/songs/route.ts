import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { resolveRequestAuth } from "@/lib/auth";
import { shouldBypassBillingInDevelopment } from "@/lib/billing/dev-balance";
import { shouldSkipNotesBilling } from "@/lib/billing/session-billing";
import { getSongsByUser, createSong, createSongWithSpend } from "@/lib/db/queries/songs";
import {
  createLocalSongFallback,
  getLocalSongsByUserFallback,
} from "@/lib/db/queries/local-song-fallback";
import { log } from "@/lib/observability/log";
import { COST } from "@murmur/core";
import { deriveEditDepth, normalizeEditCount } from "@/modules/music/edit-depth";
import { normalizeLineageDepth, resolveParentSongId, resolveRootSongId } from "@/modules/music/lineage";
import { arrangementStateSchema, visualConfigSchema } from "./schema";
import type { MelodySelectionKind } from "@/modules/shared/types";
import type { songs } from "@/lib/db/schema/songs";

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
  visualConfig: visualConfigSchema,
  arrangementState: arrangementStateSchema,
  tags: z.array(z.string()),
}).passthrough();

type SongPayload = z.infer<typeof songPayloadSchema>;
type SongInput = typeof songs.$inferInsert;

export async function GET(req: NextRequest) {
  const auth = await resolveRequestAuth(req, {
    allowGuestPreview: shouldAllowGuestSongsPreview(),
  });
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;
  try {
    const rows = await getSongsByUser(userId);
    return NextResponse.json(rows);
  } catch (err) {
    if (shouldUseLocalSongFallback() && isDatabaseUnavailable(err)) {
      const rows = getLocalSongsByUserFallback(userId);
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
    return NextResponse.json({ error: "Failed to fetch songs" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const auth = await resolveRequestAuth(req, {
    allowGuestPreview: shouldAllowGuestSongsPreview(),
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
      shouldBypassBillingInDevelopment({ host: req.nextUrl?.hostname })
      || COST.save === 0
      || shouldSkipNotesBilling(auth);
    if (skipBilling) {
      try {
        const song = await createSong(songInput);

        return NextResponse.json(song, {
          headers: { "X-Request-Id": requestId },
        });
      } catch (dbError) {
        if (isDatabaseUnavailable(dbError)) {
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
    if (shouldUseLocalSongFallback() && isDatabaseUnavailable(err)) {
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

    log("song.create_failed", {
      error: err instanceof Error ? err.message : String(err),
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
        { error: "billing_unavailable", message: "Database unavailable", requestId },
        { status: 503, headers: { "X-Request-Id": requestId } },
      );
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

function shouldUseLocalSongFallback(): boolean {
  // Free era: every action costs 0, so local fallback is safe for all users
  // when the database is unreachable. Once real billing returns, gate this
  // back to dev-only or guest-only.
  return true;
}

function shouldAllowGuestSongsPreview(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  return process.env.MURMUR_AUTH_MODE?.trim().toLowerCase() === "local";
}

function isMelodySelectionKind(value: unknown): value is MelodySelectionKind {
  return typeof value === "string" && MELODY_SELECTION_KINDS.has(value as MelodySelectionKind);
}
