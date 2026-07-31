import {
  markSongAudioObjectDeleted,
  markSongAudioObjectRetry,
  songAudioObjectRetryAt,
} from "@/lib/db/queries/song-audio-objects";
import type { SongAudioObject } from "@/lib/db/schema/song-audio-objects";
import { getObjectStore } from "@/lib/storage";

export async function deleteTrackedSongAudioObject(
  object: Pick<SongAudioObject, "storageKey" | "attempts">,
  now = new Date(),
): Promise<void> {
  try {
    await getObjectStore().delete(object.storageKey);
    await markSongAudioObjectDeleted({ storageKey: object.storageKey, now });
  } catch (error) {
    await markSongAudioObjectRetry({
      storageKey: object.storageKey,
      error: error instanceof Error ? error.message : String(error),
      nextAttemptAt: songAudioObjectRetryAt(object.attempts, now),
      now,
    });
    throw error;
  }
}

export async function deleteTrackedSongAudioObjectByKey(
  storageKey: string,
  now = new Date(),
): Promise<void> {
  return deleteTrackedSongAudioObject({ storageKey, attempts: 1 }, now);
}
