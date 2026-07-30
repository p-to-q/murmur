import { db } from "../client";
import { songs } from "../schema/songs";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import {
  ensureBillingAccount,
  spendNotesInTransaction,
  type SpendNotesResult,
} from "./notes-ledger";
import { users } from "../schema/users";
import {
  commitSongAudioObjectInTransaction,
  markSongAudioDeletePendingInTransaction,
} from "./song-audio-objects";

// Gallery / shelf / profile-count listings never touch the audio or the
// arrangement editor — they only render cover metadata. `mp3DataUrl` is a
// base64 data URL (often multiple MB) and `arrangementState` is a fat jsonb
// blob with per-track version histories; pulling either into a list response
// dwarfs everything else on the wire. Project them out here so switching to
// the gallery stays cheap. Detail playback still uses the full-row queries.
const songSummaryColumns = {
  id: songs.id,
  userId: songs.userId,
  title: songs.title,
  vibe: songs.vibe,
  vibeEn: songs.vibeEn,
  bpm: songs.bpm,
  keySignature: songs.keySignature,
  scaleType: songs.scaleType,
  duration: songs.duration,
  parentSongId: songs.parentSongId,
  rootSongId: songs.rootSongId,
  lineageDepth: songs.lineageDepth,
  sourceMelodyKind: songs.sourceMelodyKind,
  editCount: songs.editCount,
  editDepth: songs.editDepth,
  visibility: songs.visibility,
  shareCode: songs.shareCode,
  visualConfig: songs.visualConfig,
  tags: songs.tags,
  // Cheap boolean so the gallery can flag an incomplete/draft song (#291)
  // without pulling the audio payload into the list response.
  hasAudio: sql<boolean>`((${songs.mp3StorageKey} is not null and ${songs.mp3StorageKey} <> '') or (${songs.mp3DataUrl} is not null and ${songs.mp3DataUrl} <> '') or (${songs.mp3Url} is not null and ${songs.mp3Url} <> ''))`,
  legacyAudioUrl: sql<string | null>`case
    when (${songs.mp3StorageKey} is null or ${songs.mp3StorageKey} = '')
      and (${songs.mp3DataUrl} is null or ${songs.mp3DataUrl} = '')
      then ${songs.mp3Url}
    else null
  end`,
  createdAt: songs.createdAt,
  updatedAt: songs.updatedAt,
} as const;

export async function getSongSummariesByUser(userId: string) {
  return db
    .select(songSummaryColumns)
    .from(songs)
    .where(eq(songs.userId, userId))
    .orderBy(desc(songs.createdAt));
}

export async function getSongById(songId: string) {
  const rows = await db.select().from(songs).where(eq(songs.id, songId)).limit(1);
  return rows[0] ?? null;
}

export async function getSongByShareCode(shareCode: string) {
  const rows = await db
    .select()
    .from(songs)
    .where(and(
      eq(songs.shareCode, shareCode),
      inArray(songs.visibility, ["unlisted", "public"]),
    ))
    .limit(1);
  return rows[0] ?? null;
}

// Crawler/metadata path for /s/[shareCode]: it only decides indexability, so
// pull two scalars instead of the multi-MB row (mp3DataUrl + arrangementState)
// on an unauthenticated route every bot revisits.
export async function getSongShareMetaByShareCode(shareCode: string) {
  const rows = await db
    .select({
      visibility: songs.visibility,
      title: songs.title,
      hasAudio: sql<boolean>`((${songs.mp3StorageKey} is not null and ${songs.mp3StorageKey} <> '') or (${songs.mp3DataUrl} is not null and ${songs.mp3DataUrl} <> '') or (${songs.mp3Url} is not null and ${songs.mp3Url} <> ''))`,
    })
    .from(songs)
    .where(and(
      eq(songs.shareCode, shareCode),
      inArray(songs.visibility, ["unlisted", "public"]),
    ))
    .limit(1);
  return rows[0] ?? null;
}

// Public share playback needs the audio but never the arrangement editor
// state; leaving the fat jsonb in the database roughly halves what this
// unauthenticated endpoint reads and discards per hit.
export async function getPublicSongByShareCode(shareCode: string) {
  const rows = await db
    .select({
      id: songs.id,
      title: songs.title,
      vibe: songs.vibe,
      vibeEn: songs.vibeEn,
      bpm: songs.bpm,
      keySignature: songs.keySignature,
      scaleType: songs.scaleType,
      duration: songs.duration,
      sourceMelodyKind: songs.sourceMelodyKind,
      editCount: songs.editCount,
      editDepth: songs.editDepth,
      visibility: songs.visibility,
      shareCode: songs.shareCode,
      mp3DataUrl: songs.mp3DataUrl,
      mp3Url: songs.mp3Url,
      mp3StorageKey: songs.mp3StorageKey,
      visualConfig: songs.visualConfig,
      tags: songs.tags,
      createdAt: songs.createdAt,
      updatedAt: songs.updatedAt,
    })
    .from(songs)
    .where(and(
      eq(songs.shareCode, shareCode),
      inArray(songs.visibility, ["unlisted", "public"]),
    ))
    .limit(1);
  return rows[0] ?? null;
}

export async function getPublicSongSummaries(input: {
  query?: string;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(input.limit ?? 24, 50));
  const query = input.query?.trim();

  const where = query
    ? and(
        eq(songs.visibility, "public"),
        or(
          ilike(songs.title, `%${query}%`),
          ilike(songs.vibe, `%${query}%`),
          ilike(songs.vibeEn, `%${query}%`),
        ),
      )
    : eq(songs.visibility, "public");

  return db
    .select({
      id: songs.id,
      title: songs.title,
      vibe: songs.vibe,
      vibeEn: songs.vibeEn,
      bpm: songs.bpm,
      keySignature: songs.keySignature,
      scaleType: songs.scaleType,
      duration: songs.duration,
      sourceMelodyKind: songs.sourceMelodyKind,
      editCount: songs.editCount,
      editDepth: songs.editDepth,
      visibility: songs.visibility,
      shareCode: songs.shareCode,
      visualConfig: songs.visualConfig,
      tags: songs.tags,
      createdAt: songs.createdAt,
      updatedAt: songs.updatedAt,
    })
    .from(songs)
    .where(where)
    .orderBy(desc(songs.createdAt))
    .limit(limit);
}

export async function getSongByIdForUser(songId: string, userId: string) {
  const rows = await db
    .select()
    .from(songs)
    .where(and(eq(songs.id, songId), eq(songs.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

// Single-song metadata reads (e.g. the song-detail lineage trail) that
// never touch audio or the editor. Same projection as getSongSummariesByUser.
export async function getSongSummaryByIdForUser(songId: string, userId: string) {
  const rows = await db
    .select(songSummaryColumns)
    .from(songs)
    .where(and(eq(songs.id, songId), eq(songs.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createSong(data: typeof songs.$inferInsert) {
  return db.transaction(async (tx) => {
    const [activeUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, data.userId), sql`${users.deletedAt} IS NULL`))
      .limit(1)
      .for("update");
    if (!activeUser) throw new Error("account_deleted_or_missing");
    const [song] = await tx.insert(songs).values(data).returning();
    if (data.mp3StorageKey) {
      await commitSongAudioObjectInTransaction(tx, {
        storageKey: data.mp3StorageKey,
        userId: data.userId,
        songId: data.id!,
      });
    }
    return song;
  });
}

export type CreateSongWithSpendResult =
  | {
      ok: true;
      song: typeof songs.$inferSelect;
      spend: Extract<SpendNotesResult, { ok: true }>;
    }
  | {
      ok: false;
      reason: "insufficient_notes" | "user_not_found";
      currentBalance: number;
    };

export async function createSongWithSpend(
  data: typeof songs.$inferInsert,
  input: {
    cost: number;
    externalRef?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<CreateSongWithSpendResult> {
  await ensureBillingAccount(data.userId);

  return db.transaction(async (tx) => {
    const spend = await spendNotesInTransaction(tx, {
      userId: data.userId,
      cost: input.cost,
      reason: "spend:save",
      externalRef: input.externalRef,
      metadata: input.metadata,
    });

    if (!spend.ok) {
      return spend;
    }

    const [song] = await tx.insert(songs).values(data).returning();
    if (data.mp3StorageKey) {
      await commitSongAudioObjectInTransaction(tx, {
        storageKey: data.mp3StorageKey,
        userId: data.userId,
        songId: data.id!,
      });
    }
    return {
      ok: true,
      song,
      spend,
    };
  });
}

export async function updateSong(
  songId: string,
  data: Partial<typeof songs.$inferInsert>
) {
  const rows = await db
    .update(songs)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(songs.id, songId))
    .returning();
  return rows[0];
}

export async function updateSongForUser(
  songId: string,
  userId: string,
  data: Partial<typeof songs.$inferInsert>,
) {
  const rows = await db
    .update(songs)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(songs.id, songId), eq(songs.userId, userId)))
    .returning();
  return rows[0] ?? null;
}

export async function publishSongShareForUser(
  songId: string,
  userId: string,
  input: {
    shareCode: string;
    visibility?: "unlisted" | "public";
  },
) {
  const rows = await db
    .update(songs)
    .set({
      shareCode: input.shareCode,
      visibility: input.visibility ?? "unlisted",
      updatedAt: new Date(),
    })
    .where(and(eq(songs.id, songId), eq(songs.userId, userId)))
    .returning();
  return rows[0] ?? null;
}

export async function revokeSongShareForUser(songId: string, userId: string) {
  const rows = await db
    .update(songs)
    .set({
      shareCode: null,
      visibility: "private",
      updatedAt: new Date(),
    })
    .where(and(eq(songs.id, songId), eq(songs.userId, userId)))
    .returning();
  return rows[0] ?? null;
}

export async function deleteSong(songId: string) {
  const rows = await db.delete(songs).where(eq(songs.id, songId)).returning({ id: songs.id });
  return rows.length > 0;
}

export async function deleteSongForUser(songId: string, userId: string) {
  return db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(songs)
      .where(and(eq(songs.id, songId), eq(songs.userId, userId)))
      .returning({
        id: songs.id,
        userId: songs.userId,
        mp3StorageKey: songs.mp3StorageKey,
      });
    if (!deleted) return null;
    if (deleted.mp3StorageKey) {
      await markSongAudioDeletePendingInTransaction(tx, {
        storageKey: deleted.mp3StorageKey,
        userId: deleted.userId,
        songId: deleted.id,
      });
    }
    return deleted;
  });
}
