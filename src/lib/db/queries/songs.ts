import { db } from "../client";
import { songs } from "../schema/songs";
import { desc, eq } from "drizzle-orm";

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
