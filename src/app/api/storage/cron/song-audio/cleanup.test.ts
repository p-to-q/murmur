import { describe, expect, it, mock } from "bun:test";

import type { SongAudioObject } from "@/lib/db/schema/song-audio-objects";
import { runSongAudioCleanup } from "./cleanup";

const NOW = new Date("2026-07-30T00:00:00.000Z");

describe("song audio cleanup", () => {
  it("deletes every claimed object with bounded concurrency", async () => {
    const objects = [trackedObject("a"), trackedObject("b")];
    const claimDue = mock(async () => objects);
    const deleted: string[] = [];

    const summary = await runSongAudioCleanup({
      limit: 2,
      concurrency: 1,
      claimDue,
      deleteObject: async (object) => {
        deleted.push(object.storageKey);
      },
    });

    expect(summary).toEqual({ candidates: 2, deleted: 2, failed: 0 });
    expect(deleted).toEqual(["songs/a.mp3", "songs/b.mp3"]);
  });

  it("reports partial failure and continues with the remaining objects", async () => {
    const objects = [trackedObject("fail"), trackedObject("ok")];
    const deleted: string[] = [];

    const summary = await runSongAudioCleanup({
      claimDue: async () => objects,
      deleteObject: async (object) => {
        if (object.storageKey.includes("fail")) throw new Error("storage down");
        deleted.push(object.storageKey);
      },
    });

    expect(summary).toEqual({ candidates: 2, deleted: 1, failed: 1 });
    expect(deleted).toEqual(["songs/ok.mp3"]);
  });
});

function trackedObject(id: string): SongAudioObject {
  return {
    storageKey: `songs/${id}.mp3`,
    userId: "usr_1",
    songId: `song_${id}`,
    digest: "a".repeat(64),
    state: "delete_pending",
    attempts: 1,
    nextAttemptAt: NOW,
    leaseUntil: null,
    lastError: null,
    committedAt: NOW,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}
