import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { db } from "../client";
import {
  songAudioObjects,
  type SongAudioObject,
} from "../schema/song-audio-objects";

const MAX_ERROR_LENGTH = 2_000;
export const SONG_AUDIO_PENDING_GRACE_MS = 30 * 60 * 1_000;

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function reserveSongAudioObject(input: {
  storageKey: string;
  userId: string;
  songId: string;
  digest: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  await db.transaction(async (tx) => {
    await tx
      .insert(songAudioObjects)
      .values({
        storageKey: input.storageKey,
        userId: input.userId,
        songId: input.songId,
        digest: input.digest,
        state: "pending",
        nextAttemptAt: new Date(now.getTime() + SONG_AUDIO_PENDING_GRACE_MS),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: songAudioObjects.storageKey });

    const [existing] = await tx
      .select()
      .from(songAudioObjects)
      .where(eq(songAudioObjects.storageKey, input.storageKey))
      .limit(1)
      .for("update");
    if (!existing) throw new Error("song_audio_reservation_missing");
    if (
      existing.userId !== input.userId
      || existing.songId !== input.songId
      || existing.digest !== input.digest
    ) {
      throw new Error("song_audio_reservation_conflict");
    }
    if (existing.state === "delete_pending") {
      throw new Error("song_audio_deletion_in_progress");
    }
    if (existing.state === "pending") {
      await tx
        .update(songAudioObjects)
        .set({
          nextAttemptAt: new Date(now.getTime() + SONG_AUDIO_PENDING_GRACE_MS),
          leaseUntil: null,
          lastError: null,
          updatedAt: now,
        })
        .where(and(
          eq(songAudioObjects.storageKey, input.storageKey),
          eq(songAudioObjects.state, "pending"),
        ));
    } else if (existing.state === "deleted") {
      await tx
        .update(songAudioObjects)
        .set({
          state: "pending",
          attempts: 0,
          nextAttemptAt: new Date(now.getTime() + SONG_AUDIO_PENDING_GRACE_MS),
          leaseUntil: null,
          lastError: null,
          deletedAt: null,
          updatedAt: now,
        })
        .where(eq(songAudioObjects.storageKey, input.storageKey));
    }
  });
}

export async function commitSongAudioObjectInTransaction(
  tx: DbTransaction,
  input: { storageKey: string; userId: string; songId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const [committed] = await tx
    .update(songAudioObjects)
    .set({
      state: "committed",
      committedAt: now,
      nextAttemptAt: now,
      leaseUntil: null,
      lastError: null,
      updatedAt: now,
    })
    .where(and(
      eq(songAudioObjects.storageKey, input.storageKey),
      eq(songAudioObjects.userId, input.userId),
      eq(songAudioObjects.songId, input.songId),
      inArray(songAudioObjects.state, ["pending", "committed"]),
    ))
    .returning({ storageKey: songAudioObjects.storageKey });
  if (!committed) throw new Error("song_audio_commit_without_reservation");
}

export async function markSongAudioDeletePendingInTransaction(
  tx: DbTransaction,
  input: { storageKey: string; userId: string; songId: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const [marked] = await tx
    .insert(songAudioObjects)
    .values({
      storageKey: input.storageKey,
      userId: input.userId,
      songId: input.songId,
      digest: digestFromStorageKey(input.storageKey),
      state: "delete_pending",
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: songAudioObjects.storageKey,
      set: {
        state: "delete_pending",
        nextAttemptAt: now,
        leaseUntil: null,
        lastError: null,
        updatedAt: now,
      },
      setWhere: and(
        eq(songAudioObjects.userId, input.userId),
        eq(songAudioObjects.songId, input.songId),
      ),
    })
    .returning({ storageKey: songAudioObjects.storageKey });
  if (!marked) throw new Error("song_audio_delete_ownership_conflict");
}

export async function claimDueSongAudioObjects(input: {
  limit: number;
  leaseMs: number;
  now?: Date;
}): Promise<SongAudioObject[]> {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(100, Math.trunc(input.limit)));
  const leaseUntil = new Date(now.getTime() + input.leaseMs);
  const stalePendingBefore = new Date(now.getTime() - SONG_AUDIO_PENDING_GRACE_MS);

  return db.transaction(async (tx) => {
    const candidates = await tx
      .select({ storageKey: songAudioObjects.storageKey })
      .from(songAudioObjects)
      .where(and(
        or(
          eq(songAudioObjects.state, "delete_pending"),
          and(
            eq(songAudioObjects.state, "pending"),
            lte(songAudioObjects.createdAt, stalePendingBefore),
          ),
        ),
        lte(songAudioObjects.nextAttemptAt, now),
        or(isNull(songAudioObjects.leaseUntil), lt(songAudioObjects.leaseUntil, now)),
      ))
      .orderBy(asc(songAudioObjects.nextAttemptAt), asc(songAudioObjects.createdAt))
      .limit(limit)
      .for("update", { skipLocked: true });
    if (candidates.length === 0) return [];

    return tx
      .update(songAudioObjects)
      .set({
        state: sql`case
          when ${songAudioObjects.state} = 'pending' then 'delete_pending'
          else ${songAudioObjects.state}
        end`,
        leaseUntil,
        attempts: sql`${songAudioObjects.attempts} + 1`,
        updatedAt: now,
      })
      .where(and(
        inArray(songAudioObjects.storageKey, candidates.map((row) => row.storageKey)),
        inArray(songAudioObjects.state, ["pending", "delete_pending"]),
      ))
      .returning();
  });
}

export async function markSongAudioObjectDeleted(input: {
  storageKey: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  await db
    .update(songAudioObjects)
    .set({
      state: "deleted",
      deletedAt: now,
      leaseUntil: null,
      lastError: null,
      updatedAt: now,
    })
    .where(and(
      eq(songAudioObjects.storageKey, input.storageKey),
      inArray(songAudioObjects.state, ["pending", "delete_pending"]),
    ));
}

export async function markSongAudioObjectRetry(input: {
  storageKey: string;
  error: string;
  nextAttemptAt: Date;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  await db
    .update(songAudioObjects)
    .set({
      leaseUntil: null,
      nextAttemptAt: input.nextAttemptAt,
      lastError: input.error.slice(0, MAX_ERROR_LENGTH),
      updatedAt: now,
    })
    .where(and(
      eq(songAudioObjects.storageKey, input.storageKey),
      inArray(songAudioObjects.state, ["pending", "delete_pending"]),
    ));
}

export function songAudioObjectRetryAt(attempts: number, now = new Date()): Date {
  const exponent = Math.max(0, Math.min(8, Math.trunc(attempts) - 1));
  return new Date(now.getTime() + Math.min(6 * 60 * 60 * 1_000, 30_000 * 2 ** exponent));
}

function digestFromStorageKey(storageKey: string): string {
  return /\/([0-9a-f]{64})(?:-[A-Za-z0-9_-]+)?\.[A-Za-z0-9]+$/
    .exec(storageKey)?.[1] ?? "0".repeat(64);
}
