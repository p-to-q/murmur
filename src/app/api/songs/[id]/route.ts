import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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
  const { id } = await params;

  if (isDemoSongId(id)) {
    const demo = getDemoSong(id);
    if (!demo) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { mp3Url, ...rest } = demo;
    return NextResponse.json({ ...rest, mp3DataUrl: null, mp3Url });
  }

  const auth = await resolveRequestAuth(req, {
    allowGuestPreview: shouldAllowLocalPreviewFallback(req),
  });
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  try {
    // ?view=summary serves metadata-only consumers (e.g. the lineage trail)
    // without the multi-MB mp3DataUrl / arrangementState payload. The default
    // full view is unchanged.
    const song =
      requestedView(req) === "summary"
        ? await getSongSummaryByIdForUser(id, userId)
        : await getSongByIdForUser(id, userId);
    if (!song) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(song);
  } catch (err) {
    if (shouldUseGuestSongFallback(req, userId) && isDatabaseUnavailable(err)) {
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
  const auth = await resolveRequestAuth(req, {
    allowGuestPreview: shouldAllowLocalPreviewFallback(req),
  });
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
    if (shouldUseGuestSongFallback(req, userId) && isDatabaseUnavailable(err)) {
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
  const auth = await resolveRequestAuth(req, {
    allowGuestPreview: shouldAllowLocalPreviewFallback(req),
  });
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
    if (shouldUseGuestSongFallback(req, userId) && isDatabaseUnavailable(err)) {
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

function requestedView(req: NextRequest): string | null {
  const nextUrl = (req as { nextUrl?: { searchParams?: URLSearchParams } }).nextUrl;
  if (nextUrl?.searchParams) return nextUrl.searchParams.get("view");

  try {
    return new URL(req.url).searchParams.get("view");
  } catch {
    return null;
  }
}


