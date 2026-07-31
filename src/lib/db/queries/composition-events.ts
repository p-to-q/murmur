import { and, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { ulid } from "ulid";

import { db } from "../client";
import { compositionEvents } from "../schema/composition-events";
import { songs } from "../schema/songs";
import { users } from "../schema/users";
import { normalizeConsentedUserIds } from "./composition-training-scope";
import type {
  CompositionEventKind,
  CompositionEventPayload,
} from "../schema/composition-events";

export type CreateCompositionEventInput = {
  id?: string;
  userId: string;
  songId?: string | null;
  draftId?: string | null;
  flowId?: string | null;
  generationBatchId?: string | null;
  generationClipId?: string | null;
  eventKind: CompositionEventKind;
  source?: string;
  payload?: CompositionEventPayload;
  occurredAt?: Date;
};

export async function createCompositionEvent(input: CreateCompositionEventInput) {
  const [event] = await db
    .insert(compositionEvents)
    .values({
      id: input.id ?? `cmp_${ulid()}`,
      userId: input.userId,
      songId: input.songId ?? null,
      draftId: input.draftId ?? null,
      flowId: input.flowId ?? null,
      generationBatchId: input.generationBatchId ?? null,
      generationClipId: input.generationClipId ?? null,
      eventKind: input.eventKind,
      source: input.source ?? "server",
      payload: input.payload ?? {},
      occurredAt: input.occurredAt ?? new Date(),
    })
    .onConflictDoNothing({ target: compositionEvents.id })
    .returning();
  return event ?? null;
}

export async function hasVerifiedGenerationEvidence(input: {
  userId: string;
  generationBatchId: string;
  generationClipId: string;
  outputSha256: string;
}): Promise<boolean> {
  const [event] = await db
    .select({ id: compositionEvents.id })
    .from(compositionEvents)
    .where(and(
      eq(compositionEvents.userId, input.userId),
      eq(compositionEvents.eventKind, "generation.completed"),
      eq(compositionEvents.generationBatchId, input.generationBatchId),
      eq(compositionEvents.generationClipId, input.generationClipId),
      sql`${compositionEvents.payload}->>'outputSha256' = ${input.outputSha256.toLowerCase()}`,
    ))
    .limit(1);
  return Boolean(event);
}

export type CompositionTrainingExportFilter = {
  /** Explicit, separately consented users. Saving or sharing is not consent. */
  consentedUserIds: string[];
  userId?: string;
  songId?: string;
  draftId?: string;
  generationBatchId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
};

export type CompositionTrainingExample = {
  userId: string;
  songId: string;
  draftId: string | null;
  flowId: string | null;
  generationBatchId: string | null;
  generationClipId: string | null;
  generationAudioSha256: string | null;
  /** The event is server-verified; selecting it for this song is user asserted. */
  generationLinkTrust: "user_asserted_server_verified" | null;
  sourceType: string | null;
  sourceMelodyKind: string;
  lineage: {
    parentSongId: string | null;
    rootSongId: string | null;
    depth: number;
    editCount: number;
    editDepth: string;
  };
  artifact: {
    version: number;
    title: string;
    vibe: string;
    vibeEn: string;
    bpm: number;
    keySignature: string;
    scaleType: string;
    duration: number;
    tags: string[];
    melody: unknown;
    arrangementState: unknown;
    visualConfig: unknown;
    hasAudio: boolean;
    mp3StorageKey: string | null;
    saveFingerprint: string | null;
  };
  events: Array<{
    id: string;
    kind: CompositionEventKind;
    source: string;
    payload: CompositionEventPayload;
    occurredAt: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
};

export async function listCompositionTrainingExamples(
  filter: CompositionTrainingExportFilter,
): Promise<CompositionTrainingExample[]> {
  const consentedUserIds = normalizeConsentedUserIds(filter.consentedUserIds);
  if (consentedUserIds.length === 0) return [];
  if (filter.userId && !consentedUserIds.includes(filter.userId)) return [];
  const limit = Math.max(1, Math.min(filter.limit ?? 100, 500));
  const where = [
    inArray(songs.userId, consentedUserIds),
    filter.userId ? eq(songs.userId, filter.userId) : undefined,
    filter.songId ? eq(songs.id, filter.songId) : undefined,
    filter.draftId
      ? sql`${songs.provenance}->>'draftId' = ${filter.draftId}`
      : undefined,
    filter.generationBatchId
      ? sql`${songs.provenance}->>'generationBatchId' = ${filter.generationBatchId}`
      : undefined,
    filter.from ? gte(songs.createdAt, filter.from) : undefined,
    filter.to ? lte(songs.createdAt, filter.to) : undefined,
    isNull(users.deletedAt),
  ].filter(Boolean);

  const joinedRows = await db
    .select({ song: songs })
    .from(songs)
    .innerJoin(users, eq(songs.userId, users.id))
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(desc(songs.createdAt))
    .limit(limit);
  const rows = joinedRows.map((row) => row.song);

  if (rows.length === 0) return [];

  const generationClipIds = [...new Set(rows.flatMap((song) => {
    const value = stringValue(song.provenance?.generationClipId);
    return value ? [value] : [];
  }))];
  const eventIdentity = generationClipIds.length > 0
    ? or(
        inArray(compositionEvents.songId, rows.map((row) => row.id)),
        inArray(compositionEvents.generationClipId, generationClipIds),
      )
    : inArray(compositionEvents.songId, rows.map((row) => row.id));

  const eventRows = await db
    .select({ event: compositionEvents })
    .from(compositionEvents)
    .innerJoin(users, eq(compositionEvents.userId, users.id))
    .where(and(
      eventIdentity,
      inArray(compositionEvents.userId, consentedUserIds),
      isNull(users.deletedAt),
    ))
    .orderBy(compositionEvents.occurredAt);

  const eventsBySong = new Map<string, typeof compositionEvents.$inferSelect[]>();
  const songIdsByGeneration = new Map<string, string[]>();
  for (const song of rows) {
    const identity = buildGenerationEvidenceIdentity({
      userId: song.userId,
      batchId: song.provenance?.generationBatchId,
      clipId: song.provenance?.generationClipId,
      audioSha256: song.provenance?.generationAudioSha256,
    });
    if (!identity) continue;
    const songIds = songIdsByGeneration.get(identity) ?? [];
    songIds.push(song.id);
    songIdsByGeneration.set(identity, songIds);
  }
  const seenGenerationEvidence = new Map<string, Set<string>>();
  for (const { event } of eventRows) {
    if (event.songId) {
      const list = eventsBySong.get(event.songId) ?? [];
      list.push(event);
      eventsBySong.set(event.songId, list);
      continue;
    }
    if (event.eventKind !== "generation.completed") continue;
    const identity = buildGenerationEvidenceIdentity({
      userId: event.userId,
      batchId: event.generationBatchId,
      clipId: event.generationClipId,
      audioSha256: event.payload.outputSha256,
    });
    if (!identity) continue;
    for (const songId of songIdsByGeneration.get(identity) ?? []) {
      const seen = seenGenerationEvidence.get(songId) ?? new Set<string>();
      if (seen.has(identity)) continue;
      seen.add(identity);
      seenGenerationEvidence.set(songId, seen);
      const list = eventsBySong.get(songId) ?? [];
      list.push(event);
      eventsBySong.set(songId, list);
    }
  }

  const stillActiveUserIds = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, consentedUserIds), isNull(users.deletedAt)));
  const active = new Set(stillActiveUserIds.map((user) => user.id));

  return rows.filter((song) => active.has(song.userId)).map((song) => {
    const provenance = song.provenance ?? {};
    const draftId = stringValue(provenance.draftId);
    const flowId = stringValue(provenance.flow);
    const generationBatchId = stringValue(provenance.generationBatchId);
    const generationClipId = stringValue(provenance.generationClipId);
    const generationAudioSha256 = sha256Value(provenance.generationAudioSha256);

    return {
      userId: song.userId,
      songId: song.id,
      draftId,
      flowId,
      generationBatchId,
      generationClipId,
      generationAudioSha256,
      generationLinkTrust: generationAudioSha256
        && generationBatchId
        && generationClipId
        && seenGenerationEvidence.has(song.id)
        ? "user_asserted_server_verified"
        : null,
      sourceType: stringValue(provenance.sourceType),
      sourceMelodyKind: song.sourceMelodyKind,
      lineage: {
        parentSongId: song.parentSongId,
        rootSongId: song.rootSongId,
        depth: song.lineageDepth,
        editCount: song.editCount,
        editDepth: song.editDepth,
      },
      artifact: {
        version: song.artifactVersion,
        title: song.title,
        vibe: song.vibe,
        vibeEn: song.vibeEn,
        bpm: song.bpm,
        keySignature: song.keySignature,
        scaleType: song.scaleType,
        duration: song.duration,
        tags: song.tags,
        melody: song.melody,
        arrangementState: song.arrangementState,
        visualConfig: song.visualConfig,
        hasAudio: Boolean(song.mp3Url || song.mp3DataUrl),
        mp3StorageKey: song.mp3StorageKey,
        saveFingerprint: song.saveFingerprint,
      },
      events: (eventsBySong.get(song.id) ?? []).map((event) => ({
        id: event.id,
        kind: event.eventKind,
        source: event.source,
        payload: event.payload,
        occurredAt: event.occurredAt,
      })),
      createdAt: song.createdAt,
      updatedAt: song.updatedAt,
    };
  });
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function buildGenerationEvidenceIdentity(input: {
  userId: unknown;
  batchId: unknown;
  clipId: unknown;
  audioSha256: unknown;
}): string | null {
  const userId = stringValue(input.userId);
  const batchId = stringValue(input.batchId);
  const clipId = stringValue(input.clipId);
  const audioSha256 = sha256Value(input.audioSha256);
  return userId && batchId && clipId && audioSha256
    ? JSON.stringify([userId, batchId, clipId, audioSha256])
    : null;
}

function sha256Value(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value)
    ? value.toLowerCase()
    : null;
}
