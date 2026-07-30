import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const migration = readFileSync(
  path.join(import.meta.dir, "0030_song_audio_lifecycle.sql"),
  "utf8",
);

describe("0030 song audio lifecycle migration", () => {
  it("tracks old-app inserts, replacements, and deletes across rollout", () => {
    expect(migration).toContain('CREATE TRIGGER "songs_audio_lifecycle_trg"');
    expect(migration).toContain('AFTER INSERT OR UPDATE OF "mp3_storage_key" OR DELETE');
    expect(migration).toContain("'delete_pending'");
    expect(migration).toContain("'committed'");
  });
});
