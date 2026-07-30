import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkApiRateLimit, rateLimitedResponse } from "@/lib/api/rate-limit";
import { getRequestId } from "@/lib/api/request-id";
import { resolveRequestAuth } from "@/lib/auth";
import { shouldBypassBillingInDevelopment } from "@/lib/billing/dev-balance";
import {
  getRequestHostname,
  shouldAllowLocalPreviewFallback,
} from "@/lib/auth/local-preview";
import { shouldSkipNotesBilling } from "@/lib/billing/session-billing";
import {
  getSongById,
  getSongSummariesByUser,
  createSong,
  createSongWithSpend,
} from "@/lib/db/queries/songs";
import { createCompositionEvent } from "@/lib/db/queries/composition-events";
import {
  createLocalSongFallback,
  getLocalSongSummariesByUserFallback,
} from "@/lib/db/queries/local-song-fallback";
import { isDatabaseUnavailable, objectFieldAsString } from "@/app/api/songs/db-fallback";
import {
  getObjectStore,
} from "@/lib/storage";
import {
  parseAudioDataUrl,
  ownerSongAudioUrl,
  storedSongAudioDigest,
  uploadSongMasterFromDataUrl,
} from "@/lib/storage/song-audio";
import { isObject } from "@/lib/utils/is-object";
import { log } from "@/lib/observability/log";
import { serializeOwnerSong } from "@/lib/storage/song-audio-delivery";
import {
  langFromAcceptLanguage,
  songSavedNotificationCopy,
} from "@/lib/notifications/notification-copy";
import { notifications } from "@/lib/platform/notifications-server";
import { scheduleAfterResponse } from "@/lib/platform/request-lifecycle";
import { ulid } from "ulid";
import { COST } from "@murmur/core";
import { deriveEditDepth, normalizeEditCount } from "@/modules/music/edit-depth";
import { deriveServerLineage } from "@/modules/music/lineage";
import {
  SONG_ARTIFACT_VERSION,
  computeSaveFingerprint,
} from "@/modules/music/song-artifact";
import {
  arrangementStateSchema,
  cleanMelodySchema,
  songProvenanceSchema,
  songTagsSchema,
  sourceMelodyKindSchema,
  visualConfigSchema,
} from "./schema";
import type { songs } from "@/lib/db/schema/songs";
import type { ResolvedRequestAuth } from "@/lib/platform/server-auth";

const ROUTE = "/api/songs";
const SONG_LIST_RATE_LIMIT = { capacity: 60, refillWindowMs: 60_000 };
const SONG_CREATE_RATE_LIMIT = { capacity: 20, refillWindowMs: 60_000 };

// Client-minted draft ids double as the idempotency key for save retries
// (see handleSongIdConflict), so they must be accepted — but only in a
// bounded, URL-safe shape. Covers every id the app mints today: raw UUIDs,
// `demo-<uuid>` drafts, and server-generated `song_<ulid>` fallbacks.
const SONG_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const songPayloadSchema = z.object({
  id: z.string().regex(SONG_ID_PATTERN, "Invalid song id").optional(),
  title: z.string().min(1).max(200),
  vibe: z.string().min(1).max(500),
  vibeEn: z.string().min(1).max(500),
  bpm: z.number().int(),
  keySignature: z.string().min(1).max(100),
  scaleType: z.string().min(1).max(100),
  duration: z.number().int().nonnegative(),
  parentSongId: z.string().min(1).max(100).nullable().optional(),
  rootSongId: z.string().min(1).max(100).nullable().optional(),
  lineageDepth: z.number().int().optional(),
  // Shared enum with the update route (#311): an unknown kind is now an
  // explicit validation error, not a silent fallback to "corrected".
  sourceMelodyKind: sourceMelodyKindSchema.optional(),
  editCount: z.number().int().optional(),
  editDepth: z.enum(["fresh", "shaped", "reworked"]).optional(),
  mp3DataUrl: z.string().nullable().optional(),
  melody: cleanMelodySchema.nullable().optional(),
  provenance: songProvenanceSchema.nullable().optional(),
  visualConfig: visualConfigSchema,
  arrangementState: arrangementStateSchema,
  tags: songTagsSchema,
}).passthrough();

type SongPayload = z.infer<typeof songPayloadSchema>;
type SongInput = typeof songs.$inferInsert;
type SavedSong = typeof songs.$inferSelect;
type OkAuth = Extract<ResolvedRequestAuth, { ok: true }>;

export async function GET(req: NextRequest) {
  const requestId = getRequestId(req);
  const requestHost = getRequestHostname(req);
  const auth = await resolveRequestAuth(req, {
    allowGuestPreview: shouldAllowLocalPreviewFallback(req),
  });
  if (!auth.ok) return auth.response;
  const userId = auth.user.id;

  const rateLimit = await checkApiRateLimit({
    route: ROUTE,
    bucket: "read:user",
    userId,
    requestId,
    sessionId: auth.sessionId,
    options: SONG_LIST_RATE_LIMIT,
  });
  if (!rateLimit.allowed) {
    return rateLimitedResponse(rateLimit, requestId);
  }

  try {
    const rows = await getSongSummariesByUser(userId);
    return NextResponse.json(rows.map((song) => ({
      ...song,
      audioUrl: song.hasAudio ? ownerSongAudioUrl(song.id) : null,
    })));
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
        { error: "songs_unavailable", message: "Database unavailable", requestId },
        { status: 503, headers: { "X-Request-Id": requestId } },
      );
    }
    return NextResponse.json(
      { error: "server_error", message: "Failed to fetch songs", requestId },
      { status: 500, headers: { "X-Request-Id": requestId } },
    );
  }
}

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req);
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
      { error: "validation_error", message: "Failed to read song payload", requestId },
      { status: 400, headers: { "X-Request-Id": requestId } },
    );
  }

  const dataUrl =
    typeof body.mp3DataUrl === "string" && body.mp3DataUrl.length > 0
      ? body.mp3DataUrl
      : null;
  const parsedCandidateAudio = dataUrl ? parseAudioDataUrl(dataUrl) : null;
  if (dataUrl && !parsedCandidateAudio) {
    log("song.audio_payload_rejected", {
      songId: body.id ?? null,
      reason: "invalid_audio_signature",
    }, {
      route: ROUTE,
      requestId,
      userId,
      sessionId: auth.sessionId,
      level: "warn",
    });
    return NextResponse.json(
      {
        error: "invalid_audio",
        message: "Rendered audio is not a valid MP3 or WAV file",
        requestId,
      },
      { status: 422, headers: { "X-Request-Id": requestId } },
    );
  }

  const baseInput = await buildSongInput(body, userId);
  const candidateAudioDigest = parsedCandidateAudio?.digest ?? null;
  const candidateFingerprint = computeSaveFingerprint({
    ...baseInput,
    mp3Url: null,
    mp3StorageKey: null,
    mp3DataUrl: candidateAudioDigest ? null : dataUrl,
    audioDigest: candidateAudioDigest,
  });

  // Resolve an explicit id before touching object storage. Content-addressed
  // audio keys below also protect the race where two first saves arrive at once.
  if (body.id && candidateAudioDigest) {
    const existing = await getSongById(baseInput.id);
    if (existing) {
      const compatibleFingerprints = [candidateFingerprint];
      const existingAudioDigest = existing.userId === userId
        ? parseAudioDataUrl(existing.mp3DataUrl ?? "")?.digest ??
          await storedSongAudioDigest(existing.mp3StorageKey)
        : null;
      if (existingAudioDigest === candidateAudioDigest) {
        compatibleFingerprints.push(computeSaveFingerprint({
          ...baseInput,
          mp3Url: existing.mp3Url,
          mp3StorageKey: existing.mp3StorageKey,
          mp3DataUrl: existing.mp3DataUrl,
        }));
      }
      return handleSongIdConflict(
        baseInput.id,
        userId,
        requestId,
        compatibleFingerprints,
        existing,
      );
    }
  }

  const resolvedAudio = await resolveSongAudioForSave(baseInput, body, {
    requestId,
    userId,
    sessionId: auth.sessionId,
  });
  // Fingerprint the fully resolved payload so save replay (idempotent) is
  // distinguishable from a same-id/different-payload conflict (#297).
  const songInput: SongInput = {
    ...resolvedAudio.input,
    saveFingerprint: computeSaveFingerprint({
      ...resolvedAudio.input,
      audioDigest: resolvedAudio.audioDigest,
    }),
  };
  const audioStorageHeaders =
    resolvedAudio.audioStorage === "data_url_fallback"
      ? { "X-Murmur-Audio-Storage": "fallback-data-url" }
      : undefined;

  try {
    const skipBilling =
      shouldBypassBillingInDevelopment({ host: requestHost })
      || COST.save === 0
      || shouldSkipNotesBilling(auth);
    if (skipBilling) {
      try {
        const song = await createSong(songInput);
        scheduleAfterResponse(() => publishSongSavedNotification({
          userId,
          sessionId: auth.sessionId,
          songId: song.id,
          title: song.title,
          acceptLanguage: req.headers.get("accept-language"),
        }));
        scheduleAfterResponse(() => recordSongSavedCompositionEvent(song, {
          requestId,
          userId,
          sessionId: auth.sessionId,
          audioStorage: resolvedAudio.audioStorage,
        }));

        return NextResponse.json(serializeOwnerSong(song), {
          headers: { "X-Request-Id": requestId, ...audioStorageHeaders },
        });
      } catch (dbError) {
        if (isSongIdUniqueConstraintViolation(dbError)) {
          return handleSongIdConflict(songInput.id, userId, requestId, songInput.saveFingerprint);
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
          return NextResponse.json(serializeOwnerSong(fallbackSong), {
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
    scheduleAfterResponse(() => publishSongSavedNotification({
      userId,
      sessionId: auth.sessionId,
      songId: result.song.id,
      title: result.song.title,
      acceptLanguage: req.headers.get("accept-language"),
    }));
    scheduleAfterResponse(() => recordSongSavedCompositionEvent(result.song, {
      requestId,
      userId,
      sessionId: auth.sessionId,
      audioStorage: resolvedAudio.audioStorage,
    }));

    return NextResponse.json(serializeOwnerSong(result.song), {
      headers: { "X-Request-Id": requestId, ...audioStorageHeaders },
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
      return NextResponse.json(serializeOwnerSong(fallbackSong), {
        headers: {
          "X-Request-Id": requestId,
          "X-Murmur-Fallback": "local-guest-song",
        },
      });
    }
    if (
      resolvedAudio.input.mp3StorageKey
      && err instanceof Error
      && err.message === "account_deleted_or_missing"
    ) {
      await getObjectStore()
        .delete(resolvedAudio.input.mp3StorageKey)
        .catch((cleanupError) => {
          log("song.audio_cleanup_failed", {
            songId: songInput.id,
            reason: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          }, {
            route: ROUTE,
            requestId,
            userId,
            sessionId: auth.sessionId,
            level: "error",
          });
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
      return handleSongIdConflict(songInput.id, userId, requestId, songInput.saveFingerprint);
    }

    return NextResponse.json(
      { error: "server_error", message: "Failed to save song", requestId },
      { status: 500, headers: { "X-Request-Id": requestId } },
    );
  }
}

async function buildSongInput(body: SongPayload, userId: string): Promise<SongInput> {
  // Prefer the client-minted draft id (idempotent retry key); mint a
  // server-side id only when the payload omits one.
  const id = body.id ?? `song_${ulid()}`;
  const editCount = normalizeEditCount(body.editCount);
  // Validated by sourceMelodyKindSchema (#311); default only when omitted.
  const sourceMelodyKind = body.sourceMelodyKind ?? "corrected";
  const editDepth = deriveEditDepth(editCount);
  // Derive + validate lineage server-side from the owned parent (#297) rather
  // than trusting client-supplied root/depth.
  const lineage = await deriveServerLineage({
    id,
    userId,
    parentSongId: body.parentSongId,
    rootSongId: body.rootSongId,
    lineageDepth: body.lineageDepth,
    loadParent: async (parentSongId) => {
      const parent = await getSongById(parentSongId);
      return parent
        ? {
            id: parent.id,
            userId: parent.userId,
            rootSongId: parent.rootSongId,
            lineageDepth: parent.lineageDepth,
          }
        : null;
    },
  });

  return {
    id,
    userId,
    title: body.title,
    vibe: body.vibe,
    vibeEn: body.vibeEn,
    bpm: body.bpm,
    keySignature: body.keySignature,
    scaleType: body.scaleType,
    duration: body.duration,
    parentSongId: lineage.parentSongId,
    rootSongId: lineage.rootSongId,
    lineageDepth: lineage.lineageDepth,
    sourceMelodyKind,
    editCount,
    editDepth,
    artifactVersion: SONG_ARTIFACT_VERSION,
    melody: body.melody ?? null,
    provenance: body.provenance ?? null,
    visualConfig: body.visualConfig,
    arrangementState: body.arrangementState,
    tags: body.tags,
  };
}

/**
 * Resolve the persisted audio artifact for a save (#292). Newly rendered
 * audio is uploaded through the object-storage adapter and stored as an
 * `mp3Url` + `mp3StorageKey`; the base64 `mp3DataUrl` is no longer written to
 * Postgres on the happy path.
 *
 * Storage-unavailable behavior is explicit and demo-safe: if the upload
 * throws (unconfigured driver, network) we fall back to embedding the legacy
 * data URL so the demo/offline flow never loses the user's audio, and flag it
 * on the response via the caller. A payload with no audio persists no audio at
 * all (an incomplete draft — see #291).
 */
type ResolvedSongAudio = {
  input: SongInput;
  audioStorage: "object" | "data_url_fallback" | "none";
  audioDigest: string | null;
};

async function resolveSongAudioForSave(
  base: SongInput,
  body: SongPayload,
  ctx: { requestId: string; userId: string; sessionId: string | null },
): Promise<ResolvedSongAudio> {
  const dataUrl =
    typeof body.mp3DataUrl === "string" && body.mp3DataUrl.length > 0
      ? body.mp3DataUrl
      : null;

  if (!dataUrl) {
    return {
      input: { ...base, mp3Url: null, mp3StorageKey: null, mp3DataUrl: null },
      audioStorage: "none",
      audioDigest: null,
    };
  }

  const parsed = parseAudioDataUrl(dataUrl);
  if (!parsed) {
    log("song.audio_payload_rejected", {
      songId: base.id,
      reason: "invalid_audio_signature",
    }, {
      route: ROUTE,
      requestId: ctx.requestId,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      level: "warn",
    });
    return {
      input: { ...base, mp3Url: null, mp3StorageKey: null, mp3DataUrl: null },
      audioStorage: "none",
      audioDigest: null,
    };
  }
  const audioDigest = parsed.digest;

  try {
    const uploaded = await uploadSongMasterFromDataUrl({
      userId: base.userId,
      songId: base.id!,
      dataUrl,
    });
    if (uploaded) {
      return {
        input: {
          ...base,
          mp3Url: uploaded.mp3Url,
          mp3StorageKey: uploaded.mp3StorageKey,
          mp3DataUrl: null,
        },
        audioStorage: "object",
        audioDigest: uploaded.digest,
      };
    }
  } catch (err) {
    log("song.audio_upload_failed", {
      error: err instanceof Error ? err.message : String(err),
      songId: base.id,
    }, {
      route: ROUTE,
      requestId: ctx.requestId,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      level: "warn",
    });
  }

  // Demo-safe fallback: keep the rendered audio as an embedded data URL rather
  // than dropping it. Legacy read paths already accept mp3DataUrl.
  return {
    input: { ...base, mp3Url: null, mp3StorageKey: null, mp3DataUrl: dataUrl },
    audioStorage: "data_url_fallback",
    audioDigest,
  };
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

async function handleSongIdConflict(
  songId: string,
  userId: string,
  requestId: string,
  incomingFingerprint: string | null | undefined | string[],
  knownExisting?: SavedSong | null,
) {
  const existing = knownExisting ?? await getSongById(songId);
  if (!existing || existing.userId !== userId) {
    // A different user already owns this id — never disclose or overwrite it.
    return songIdConflictResponse(requestId);
  }

  // Same user, same id: distinguish an exact save replay (idempotent retry of
  // the same content) from a same-id/different-payload conflict (#297). Legacy
  // rows have no stored fingerprint — treat those as replays to preserve the
  // pre-#297 idempotent-save behavior.
  const existingFingerprint = existing.saveFingerprint;
  const incomingFingerprints = Array.isArray(incomingFingerprint)
    ? incomingFingerprint
    : [incomingFingerprint];
  const isExactReplay =
    !existingFingerprint ||
    incomingFingerprints.some(
      (fingerprint) => !fingerprint || existingFingerprint === fingerprint,
    );
  if (isExactReplay) {
    return NextResponse.json(serializeOwnerSong(existing), {
      headers: {
        "X-Request-Id": requestId,
        "X-Murmur-Idempotent-Replay": "song",
      },
    });
  }

  return songPayloadConflictResponse(requestId);
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

function songPayloadConflictResponse(requestId: string) {
  return NextResponse.json(
    {
      error: "song_payload_conflict",
      message:
        "This song id was already saved with different content. Reload the song before editing.",
      requestId,
    },
    { status: 409, headers: { "X-Request-Id": requestId } },
  );
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

async function publishSongSavedNotification(input: {
  userId: string;
  sessionId: string | null;
  songId: string;
  title: string;
  acceptLanguage: string | null;
}) {
  const lang = langFromAcceptLanguage(input.acceptLanguage);
  const title = truncateNotificationText(input.title, 80);
  const copy = songSavedNotificationCopy(lang, title);
  await notifications
    .publish({
      title: copy.title,
      body: copy.body,
      userId: input.userId,
      data: {
        kind: "song_saved",
        tag: `murmur-song-saved-${input.songId}`,
        href: `/song/${input.songId}`,
        source: "song-save",
        songId: input.songId,
      },
    })
    .catch((error) => {
      log("notifications.publish_failed", {
        source: "song_saved",
        songId: input.songId,
        error: error instanceof Error ? error.message : String(error),
      }, {
        route: ROUTE,
        userId: input.userId,
        sessionId: input.sessionId,
        level: "warn",
      });
    });
}

async function recordSongSavedCompositionEvent(
  song: SavedSong,
  ctx: {
    requestId: string;
    userId: string;
    sessionId: string | null;
    audioStorage: ResolvedSongAudio["audioStorage"];
  },
) {
  try {
    const provenance = song.provenance ?? {};
    await createCompositionEvent({
      userId: song.userId,
      songId: song.id,
      draftId: typeof provenance.draftId === "string" ? provenance.draftId : null,
      flowId: typeof provenance.flow === "string" ? provenance.flow : null,
      generationBatchId:
        typeof provenance.generationBatchId === "string" ? provenance.generationBatchId : null,
      generationClipId:
        typeof provenance.generationClipId === "string" ? provenance.generationClipId : null,
      eventKind: "song.saved",
      source: "server",
      payload: {
        requestId: ctx.requestId,
        sessionId: ctx.sessionId,
        artifactVersion: song.artifactVersion,
        sourceMelodyKind: song.sourceMelodyKind,
        editCount: song.editCount,
        editDepth: song.editDepth,
        lineageDepth: song.lineageDepth,
        hasAudio: Boolean(song.mp3Url || song.mp3DataUrl),
        audioStorage: ctx.audioStorage,
      },
    });
  } catch (error) {
    log("composition_event.write_failed", {
      eventKind: "song.saved",
      songId: song.id,
      error: error instanceof Error ? error.message : String(error),
    }, {
      route: ROUTE,
      requestId: ctx.requestId,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      level: "warn",
    });
  }
}

function truncateNotificationText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
