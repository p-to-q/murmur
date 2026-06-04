import { db } from "../client";
import { songs } from "../schema/songs";
import { desc, eq } from "drizzle-orm";
import {
  ensureBillingAccount,
  spendNotesInTransaction,
  type SpendNotesResult,
} from "./notes-ledger";

export async function getSongsByUser(userId: string) {
  return db.select().from(songs).where(eq(songs.userId, userId)).orderBy(desc(songs.createdAt));
}

export async function getSongById(songId: string) {
  const rows = await db.select().from(songs).where(eq(songs.id, songId)).limit(1);
  return rows[0] ?? null;
}

export async function createSong(data: typeof songs.$inferInsert) {
  const rows = await db.insert(songs).values(data).returning();
  return rows[0];
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

export async function deleteSong(songId: string) {
  const rows = await db.delete(songs).where(eq(songs.id, songId)).returning({ id: songs.id });
  return rows.length > 0;
}
