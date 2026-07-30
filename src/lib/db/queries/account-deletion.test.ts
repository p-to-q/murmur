import { describe, expect, it } from "bun:test";

import {
  accountDeletionRetryAt,
  isAccountDeletionMusicJobTerminal,
} from "./account-deletion";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("account deletion lifecycle decisions", () => {
  it("treats only settled music jobs as purgeable", () => {
    for (const status of ["succeeded", "failed", "canceled", "expired", "submission_unknown"]) {
      expect(isAccountDeletionMusicJobTerminal(status)).toBe(true);
    }
    for (const status of ["accepted", "submitting", "queued", "running", "result_ready", "cancel_requested"]) {
      expect(isAccountDeletionMusicJobTerminal(status)).toBe(false);
    }
  });

  it("purges songs before lifecycle receipts so rollout triggers cannot recreate rows", () => {
    const source = readFileSync(path.join(import.meta.dir, "account-deletion.ts"), "utf8");
    const deleteSongs = source.indexOf("await tx.delete(songs)");
    const deleteReceipts = source.indexOf("await tx.delete(songAudioObjects)");
    expect(deleteSongs).toBeGreaterThan(-1);
    expect(deleteReceipts).toBeGreaterThan(deleteSongs);
  });

  it("strips free-form billing metadata while retaining audit rows", () => {
    const source = readFileSync(path.join(import.meta.dir, "account-deletion.ts"), "utf8");

    expect(source).toContain(".update(notesLedger)");
    expect(source).toContain(".set({ metadata: {} })");
    expect(source).toContain(".update(purchases)");
    expect(source).toContain(".set({ rawPayload: null, updatedAt: now })");
    expect(source).not.toContain("delete(notesLedger)");
    expect(source).not.toContain("delete(purchases)");
  });

  it("backs retries off from five minutes and caps them at one day", () => {
    const now = new Date("2026-07-30T00:00:00.000Z");
    expect(accountDeletionRetryAt(1, now).toISOString()).toBe("2026-07-30T00:05:00.000Z");
    expect(accountDeletionRetryAt(3, now).toISOString()).toBe("2026-07-30T00:20:00.000Z");
    expect(accountDeletionRetryAt(100, now).toISOString()).toBe("2026-07-31T00:00:00.000Z");
  });
});
