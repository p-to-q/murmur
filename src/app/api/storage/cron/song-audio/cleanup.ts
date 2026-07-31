import {
  claimDueSongAudioObjects,
} from "@/lib/db/queries/song-audio-objects";
import { deleteTrackedSongAudioObject } from "@/lib/storage/song-audio-cleanup";

const LEASE_MS = 5 * 60 * 1_000;

export interface SongAudioCleanupSummary {
  candidates: number;
  deleted: number;
  failed: number;
}

export async function runSongAudioCleanup(input: {
  limit?: number;
  concurrency?: number;
  claimDue?: typeof claimDueSongAudioObjects;
  deleteObject?: typeof deleteTrackedSongAudioObject;
} = {}): Promise<SongAudioCleanupSummary> {
  const limit = clamp(input.limit ?? 50, 1, 100);
  const concurrency = clamp(input.concurrency ?? 5, 1, 10);
  const claimDue = input.claimDue ?? claimDueSongAudioObjects;
  const deleteObject = input.deleteObject ?? deleteTrackedSongAudioObject;
  const objects = await claimDue({ limit, leaseMs: LEASE_MS });
  const summary = { candidates: objects.length, deleted: 0, failed: 0 };

  await runBounded(objects, concurrency, async (object) => {
    try {
      await deleteObject(object);
      summary.deleted += 1;
    } catch {
      summary.failed += 1;
    }
  });
  return summary;
}

async function runBounded<T>(
  items: T[],
  concurrency: number,
  action: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  await Promise.all(Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const item = items[cursor];
        cursor += 1;
        await action(item!);
      }
    },
  ));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}
