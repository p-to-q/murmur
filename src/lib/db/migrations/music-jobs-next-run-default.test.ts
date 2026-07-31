import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const migration = readFileSync(
  path.join(import.meta.dir, "0033_music_jobs_next_run_default.sql"),
  "utf8",
);
const rollback = readFileSync(
  path.join(import.meta.dir, "0033_music_jobs_next_run_default.down.sql"),
  "utf8",
);
const journal = JSON.parse(readFileSync(
  path.join(import.meta.dir, "meta/_journal.json"),
  "utf8",
)) as { entries: Array<{ idx: number; tag: string }> };

describe("0033 music job next-run compatibility migration", () => {
  it("keeps old-app accepted jobs runnable during migrate-before-deploy", () => {
    expect(migration).toContain(
      'ALTER TABLE "music_jobs" ALTER COLUMN "next_run_at" SET DEFAULT now()',
    );
    expect(migration).toContain('UPDATE "music_jobs"');
    expect(migration).toContain('WHERE "next_run_at" IS NULL');
    for (const status of [
      "accepted",
      "submitting",
      "queued",
      "running",
      "result_ready",
      "cancel_requested",
    ]) {
      expect(migration).toContain(`'${status}'`);
    }
    expect(rollback).toContain(
      'ALTER TABLE "music_jobs" ALTER COLUMN "next_run_at" DROP DEFAULT',
    );
    expect(journal.entries.find((entry) => entry.idx === 33)).toEqual({
      ...journal.entries.find((entry) => entry.idx === 33),
      idx: 33,
      tag: "0033_music_jobs_next_run_default",
    });
  });
});
