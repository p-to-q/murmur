import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const migration = readFileSync(
  path.join(import.meta.dir, "0028_durable_music_dispatcher.sql"),
  "utf8",
);

describe("0028 durable music dispatcher migration", () => {
  it("keeps pre-dispatcher inserts compatible across migrate-before-deploy", () => {
    const defaultAt = migration.indexOf('ALTER COLUMN "deadline_at"\n  SET DEFAULT');
    const notNullAt = migration.indexOf('ALTER COLUMN "deadline_at" SET NOT NULL');

    expect(defaultAt).toBeGreaterThan(-1);
    expect(notNullAt).toBeGreaterThan(defaultAt);
  });
});
