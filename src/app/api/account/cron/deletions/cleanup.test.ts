import { describe, expect, it } from "bun:test";

import {
  runAccountDeletionCleanup,
  type AccountDeletionCleanupDependencies,
} from "./cleanup";

const NOW = new Date("2026-07-30T00:00:00.000Z");

function dependencies(
  overrides: Partial<AccountDeletionCleanupDependencies> = {},
): AccountDeletionCleanupDependencies {
  return {
    reconcileMissing: async () => 0,
    claimDue: async () => [{ userId: "usr_delete", attempts: 1 }] as never,
    listUnsettledMusicJobs: async () => [],
    advanceMusicJob: async () => undefined,
    snapshotObjects: async () => 0,
    listPendingObjects: async () => ["songs/master/usr_delete/song_1/audio.mp3"],
    deleteObject: async () => undefined,
    markObjectDeleted: async () => undefined,
    markObjectRetry: async () => undefined,
    countPendingObjects: async () => 0,
    finalize: async () => true,
    markJobRetry: async () => undefined,
    now: () => NOW,
    ...overrides,
  };
}

describe("account deletion cleanup orchestration", () => {
  it("deletes all referenced objects before finalizing the database purge", async () => {
    const calls: string[] = [];
    const summary = await runAccountDeletionCleanup({}, dependencies({
      snapshotObjects: async () => { calls.push("snapshot"); return 1; },
      deleteObject: async () => { calls.push("delete-object"); },
      markObjectDeleted: async () => { calls.push("receipt"); },
      finalize: async () => { calls.push("finalize"); return true; },
    }));

    expect(calls).toEqual(["snapshot", "delete-object", "receipt", "finalize"]);
    expect(summary).toEqual({
      reconciled: 0,
      candidates: 1,
      completed: 1,
      deferred: 0,
      failed: 0,
      objectsDeleted: 1,
    });
  });

  it("repairs missing deletion jobs before claiming due work", async () => {
    const calls: string[] = [];
    const summary = await runAccountDeletionCleanup({}, dependencies({
      reconcileMissing: async () => { calls.push("reconcile"); return 2; },
      claimDue: async () => { calls.push("claim"); return []; },
    }));

    expect(calls).toEqual(["reconcile", "claim"]);
    expect(summary.reconciled).toBe(2);
  });

  it("defers finalization and persists retry state when object deletion fails", async () => {
    const retries: string[] = [];
    let finalized = false;
    const summary = await runAccountDeletionCleanup({}, dependencies({
      deleteObject: async () => { throw new Error("bucket unavailable"); },
      markObjectRetry: async ({ storageKey }) => { retries.push(storageKey); },
      countPendingObjects: async () => 1,
      markJobRetry: async ({ error }) => { retries.push(error); },
      finalize: async () => { finalized = true; return true; },
    }));

    expect(finalized).toBe(false);
    expect(retries).toEqual([
      "songs/master/usr_delete/song_1/audio.mp3",
      "account deletion has 1 pending object(s)",
    ]);
    expect(summary.deferred).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it("advances unsettled music jobs before taking the object snapshot", async () => {
    const calls: string[] = [];
    await runAccountDeletionCleanup({}, dependencies({
      listUnsettledMusicJobs: async () => [{ id: "mjob_1", userId: "usr_delete" }],
      advanceMusicJob: async () => { calls.push("advance"); },
      snapshotObjects: async () => { calls.push("snapshot"); return 0; },
    }));
    expect(calls).toEqual(["advance", "snapshot"]);
  });

  it("requeues when references changed during the final transaction", async () => {
    const errors: string[] = [];
    const summary = await runAccountDeletionCleanup({}, dependencies({
      finalize: async () => false,
      markJobRetry: async ({ error }) => { errors.push(error); },
    }));
    expect(errors).toEqual(["account deletion references changed during finalization"]);
    expect(summary.deferred).toBe(1);
  });
});
