import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { ulid } from "ulid";

import { db } from "../client";
import { compositionEvents } from "../schema/composition-events";
import { songs } from "../schema/songs";
import type {
  CompositionEventKind,
  CompositionEventPayload,
} from "../schema/composition-events";

export type CreateCompositionEventInput = {
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
      id: `cmp_${ulid()}`,
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
    .returning();
  return event;
}

export type CompositionTrainingExportFilter = {
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
  filter: CompositionTrainingExportFilter = {},
): Promise<CompositionTrainingExample[]> {
  const limit = Math.max(1, Math.min(filter.limit ?? 100, 500));
  const where = [
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
  ].filter(Boolean);

  const rows = await db
    .select()
    .from(songs)
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(desc(songs.createdAt))
    .limit(limit);

  if (rows.length === 0) return [];

  const eventRows = await db
    .select()
    .from(compositionEvents)
    .where(inArray(compositionEvents.songId, rows.map((row) => row.id)))
    .orderBy(compositionEvents.occurredAt);

  const eventsBySong = new Map<string, typeof eventRows>();
  for (const event of eventRows) {
    if (!event.songId) continue;
    const list = eventsBySong.get(event.songId) ?? [];
    list.push(event);
    eventsBySong.set(event.songId, list);
  }

  return rows.map((song) => {
    const provenance = song.provenance ?? {};
    const draftId = stringValue(provenance.draftId);
    const flowId = stringValue(provenance.flow);
    const generationBatchId = stringValue(provenance.generationBatchId);
    const generationClipId = stringValue(provenance.generationClipId);

    return {
      userId: song.userId,
      songId: song.id,
      draftId,
      flowId,
      generationBatchId,
      generationClipId,
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
