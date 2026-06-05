import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveRequestAuth } from "@/lib/auth";
import { shouldBypassBillingInDevelopment } from "@/lib/billing/dev-balance";
import { getSongsByUser, createSong, createSongWithSpend } from "@/lib/db/queries/songs";
import { log } from "@/lib/observability/log";
import { COST } from "@murmur/core";
import { deriveEditDepth, normalizeEditCount } from "@/modules/music/edit-depth";
import { normalizeLineageDepth, resolveParentSongId, resolveRootSongId } from "@/modules/music/lineage";
import type { MelodySelectionKind } from "@/modules/shared/types";

const ROUTE = "/api/songs";
const MELODY_SELECTION_KINDS = new Set<MelodySelectionKind>(["intent", "corrected", "musical"]);
const trackStateSchema = z.object({
  enabled: z.boolean(),
  intensity: z.number(),
  originalPattern: z.string(),
  currentPattern: z.string(),
  instrument: z.string(),
  versionHistory: z.array(z.string()),
  melodyPitchSequence: z.array(z.number()).optional(),
  chordsTag: z.string().optional(),
  bassPattern: z.string().optional(),
  drumsPattern: z.string().optional(),
  texturePreset: z.string().optional(),
});
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
  visualConfig: z.object({
    preset: z.string().min(1),
    gradient: z.string().min(1),
    particleDensity: z.number(),
    pulseSource: z.enum(["drums", "melody", "energy"]),
    posterBg: z.string().optional(),
  }),
  arrangementState: z.object({
    melody: trackStateSchema,
    chords: trackStateSchema,
    strings: trackStateSchema,
    drums: trackStateSchema,
    bass: trackStateSchema,
    texture: trackStateSchema,
  }),
  tags: z.array(z.string()),
}).passthrough();

export async function GET(req: NextRequest) {
  const auth = await resolveRequestAuth(req);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;
  try {
    const rows = await getSongsByUser(userId);
    return NextResponse.json(rows);
  } catch (err) {
    if (userId === "guest" && isDatabaseUnavailable(err)) {
      log("song.list_failed", {
        reason: "database_unavailable",
        fallback: "guest_empty_gallery",
      }, {
        route: "/api/songs",
        userId,
        sessionId: auth.sessionId,
        level: "warn",
      });
      return NextResponse.json([]);
    }

    console.error("[songs GET]", err);
    return NextResponse.json({ error: "Failed to fetch songs" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const requestId = req.headers.get("x-request-id") || crypto.randomUUID();
  const auth = await resolveRequestAuth(req);
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;
  try {
    const body = songPayloadSchema.parse(await req.json());
    const editCount = normalizeEditCount(body.editCount);
    const lineageDepth = normalizeLineageDepth(body.lineageDepth);
    const sourceMelodyKind = isMelodySelectionKind(body.sourceMelodyKind)
      ? body.sourceMelodyKind
      : "corrected";
    const editDepth = deriveEditDepth(editCount);
    const parentSongId = resolveParentSongId({ id: String(body.id ?? ""), parentSongId: body.parentSongId });
    const rootSongId = resolveRootSongId({ id: String(body.id ?? ""), rootSongId: body.rootSongId });
    const songInput = {
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
    if (shouldBypassBillingInDevelopment()) {
      const song = await createSong(songInput);

      return NextResponse.json(song, {
        headers: { "X-Request-Id": requestId },
      });
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
    console.error("[songs POST]", err);
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

function isMelodySelectionKind(value: unknown): value is MelodySelectionKind {
  return typeof value === "string" && MELODY_SELECTION_KINDS.has(value as MelodySelectionKind);
}
