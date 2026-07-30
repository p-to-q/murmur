import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const migration = readFileSync(
  path.join(import.meta.dir, "0029_account_deletion_cleanup.sql"),
  "utf8",
);

describe("0029 account deletion cleanup migration", () => {
  it("captures old-app deletions after the one-time backfill", () => {
    expect(migration).toContain('CREATE TRIGGER "users_account_deletion_job_trg"');
    expect(migration).toContain('AFTER UPDATE OF "deleted_at" ON "users"');
    expect(migration).toContain('ON CONFLICT ("user_id") DO NOTHING');
  });
});
