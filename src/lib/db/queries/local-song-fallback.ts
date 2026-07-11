import type { songs } from "@/lib/db/schema/songs";

type SongRow = typeof songs.$inferSelect;
type SongInsert = typeof songs.$inferInsert;

const STORE_KEY = "__murmurLocalSongFallback";

declare global {
  var __murmurLocalSongFallback: Map<string, SongRow> | undefined;
}

const localSongs =
  globalThis[STORE_KEY] ?? (globalThis[STORE_KEY] = new Map<string, SongRow>());

export function createLocalSongFallback(data: SongInsert): SongRow {
  const now = new Date();
  const existing = localSongs.get(data.id);
  const createdAt = existing?.createdAt ?? now;
  const row: SongRow = {
    id: data.id,
    userId: data.userId,
    title: data.title,
    vibe: data.vibe,
    vibeEn: data.vibeEn ?? "",
    bpm: data.bpm ?? 80,
    keySignature: data.keySignature ?? "C",
    scaleType: data.scaleType ?? "minor",
    duration: data.duration ?? 0,
    parentSongId: data.parentSongId ?? null,
    rootSongId: data.rootSongId ?? null,
    lineageDepth: data.lineageDepth ?? 0,
    sourceMelodyKind: data.sourceMelodyKind ?? "corrected",
    editCount: data.editCount ?? 0,
    editDepth: data.editDepth ?? "fresh",
    visibility: data.visibility ?? "private",
    shareCode: data.shareCode ?? null,
    mp3DataUrl: data.mp3DataUrl ?? null,
    mp3Url: data.mp3Url ?? null,
    mp3StorageKey: data.mp3StorageKey ?? null,
    artifactVersion: data.artifactVersion ?? 1,
    melody: data.melody ?? null,
    provenance: data.provenance ?? null,
    saveFingerprint: data.saveFingerprint ?? null,
    visualConfig: data.visualConfig,
    arrangementState: data.arrangementState,
    tags: data.tags ?? [],
    createdAt,
    updatedAt: now,
  };
  localSongs.set(row.id, row);
  return row;
}

export function getLocalSongsByUserFallback(userId: string): SongRow[] {
  return [...localSongs.values()]
    .filter((song) => song.userId === userId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

// List response shape — drops the heavy audio/arrangement fields, matching
// getSongSummariesByUser so the gallery payload stays lean even on the
// DB-unavailable fallback path. The store keeps the full rows for detail reads.
export type SongSummaryRow = Omit<
  SongRow,
  | "mp3DataUrl"
  | "mp3Url"
  | "mp3StorageKey"
  | "arrangementState"
  | "melody"
  | "provenance"
  | "saveFingerprint"
  | "artifactVersion"
> & { hasAudio: boolean };

export function getLocalSongSummariesByUserFallback(userId: string): SongSummaryRow[] {
  return getLocalSongsByUserFallback(userId).map((song) => ({
    id: song.id,
    userId: song.userId,
    title: song.title,
    vibe: song.vibe,
    vibeEn: song.vibeEn,
    bpm: song.bpm,
    keySignature: song.keySignature,
    scaleType: song.scaleType,
    duration: song.duration,
    parentSongId: song.parentSongId,
    rootSongId: song.rootSongId,
    lineageDepth: song.lineageDepth,
    sourceMelodyKind: song.sourceMelodyKind,
    editCount: song.editCount,
    editDepth: song.editDepth,
    visibility: song.visibility,
    shareCode: song.shareCode,
    visualConfig: song.visualConfig,
    tags: song.tags,
    hasAudio: Boolean(song.mp3Url || song.mp3DataUrl),
    createdAt: song.createdAt,
    updatedAt: song.updatedAt,
  }));
}

export function getLocalSongByIdForUserFallback(
  songId: string,
  userId: string,
): SongRow | null {
  const song = localSongs.get(songId);
  return song && song.userId === userId ? song : null;
}

export function getLocalSongByShareCodeFallback(shareCode: string): SongRow | null {
  for (const song of localSongs.values()) {
    if (
      song.shareCode === shareCode &&
      (song.visibility === "unlisted" || song.visibility === "public")
    ) {
      return song;
    }
  }
  return null;
}

export function updateLocalSongForUserFallback(
  songId: string,
  userId: string,
  data: Partial<SongInsert>,
): SongRow | null {
  const existing = getLocalSongByIdForUserFallback(songId, userId);
  if (!existing) return null;
  const updated: SongRow = {
    ...existing,
    ...data,
    id: existing.id,
    userId: existing.userId,
    updatedAt: new Date(),
  };
  localSongs.set(songId, updated);
  return updated;
}

export function publishLocalSongShareForUserFallback(
  songId: string,
  userId: string,
  input: {
    shareCode: string;
    visibility?: "unlisted" | "public";
  },
): SongRow | null {
  return updateLocalSongForUserFallback(songId, userId, {
    shareCode: input.shareCode,
    visibility: input.visibility ?? "unlisted",
  });
}

export function revokeLocalSongShareForUserFallback(
  songId: string,
  userId: string,
): SongRow | null {
  return updateLocalSongForUserFallback(songId, userId, {
    shareCode: null,
    visibility: "private",
  });
}

export function deleteLocalSongForUserFallback(
  songId: string,
  userId: string,
): boolean {
  if (!getLocalSongByIdForUserFallback(songId, userId)) return false;
  return localSongs.delete(songId);
}

export function resetLocalSongFallbackForTests() {
  localSongs.clear();
}
