import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveRequestAuth } from "@/lib/auth";
import {
  deleteSongForUser,
  getSongByIdForUser,
  updateSongForUser,
} from "@/lib/db/queries/songs";
import { shouldBypassBillingInDevelopment } from "@/lib/billing/dev-balance";
import {
  deleteLocalSongForUserFallback,
  getLocalSongByIdForUserFallback,
  updateLocalSongForUserFallback,
} from "@/lib/db/queries/local-song-fallback";
import { log } from "@/lib/observability/log";
import { strictArrangementStateSchema, strictVisualConfigSchema } from "../schema";

const ROUTE = "/api/songs/[id]";

const updateSongSchema = z.object({
  title: z.string().min(1).optional(),
  vibe: z.string().min(1).optional(),
  vibeEn: z.string().min(1).optional(),
  bpm: z.number().int().optional(),
  keySignature: z.string().min(1).optional(),
  scaleType: z.string().min(1).optional(),
  duration: z.number().int().nonnegative().optional(),
  parentSongId: z.string().min(1).nullable().optional(),
  rootSongId: z.string().min(1).nullable().optional(),
  lineageDepth: z.number().int().nonnegative().optional(),
  sourceMelodyKind: z.enum(["intent", "corrected", "musical"]).optional(),
  editCount: z.number().int().nonnegative().optional(),
  editDepth: z.enum(["fresh", "shaped", "reworked"]).optional(),
  mp3DataUrl: z.string().nullable().optional(),
  visualConfig: strictVisualConfigSchema.optional(),
  arrangementState: strictArrangementStateSchema.optional(),
  tags: z.array(z.string()).optional(),
}).strict();

type SongUpdatePayload = z.infer<typeof updateSongSchema>;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveRequestAuth(req);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;
  const { id } = await params;
  try {
    const song = await getSongByIdForUser(id, userId);
    if (!song) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(song);
  } catch (err) {
    if (shouldUseLocalSongFallback(req, userId) && isDatabaseUnavailable(err)) {
      const fallbackSong = getLocalSongByIdForUserFallback(id, userId);
      if (!fallbackSong) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json(fallbackSong, {
        headers: { "X-Murmur-Fallback": "local-guest-song" },
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
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveRequestAuth(req);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;
  const { id } = await params;

  let body: SongUpdatePayload;
  try {
    body = updateSongSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: "validation_error",
          message: "Invalid song update payload",
          issues: err.issues.map((issue) => ({
            path: issue.path.join("."),
            code: issue.code,
            message: issue.message,
          })),
        },
        { status: 400 },
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
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  try {
    const updated = await updateSongForUser(id, userId, body);
    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (err) {
    if (shouldUseLocalSongFallback(req, userId) && isDatabaseUnavailable(err)) {
      const updated = updateLocalSongForUserFallback(id, userId, body);
      if (!updated) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json(updated, {
        headers: { "X-Murmur-Fallback": "local-guest-song" },
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
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await resolveRequestAuth(req);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;
  const { id } = await params;
  try {
    const deleted = await deleteSongForUser(id, userId);
    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    if (shouldUseLocalSongFallback(req, userId) && isDatabaseUnavailable(err)) {
      const deleted = deleteLocalSongForUserFallback(id, userId);
      if (!deleted) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json(
        { success: true },
        { headers: { "X-Murmur-Fallback": "local-guest-song" } },
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
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

function shouldUseLocalSongFallback(req: NextRequest, userId: string): boolean {
  if (userId !== "guest") return false;
  return shouldBypassBillingInDevelopment({
    host: getRequestHostname(req),
  });
}

function getRequestHostname(req: NextRequest): string | null {
  const nextUrl = (req as { nextUrl?: { hostname?: string } }).nextUrl;
  if (nextUrl?.hostname) return nextUrl.hostname;

  try {
    return new URL(req.url).hostname;
  } catch {
    return null;
  }
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
