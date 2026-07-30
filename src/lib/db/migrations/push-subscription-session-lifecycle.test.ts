import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const up = readFileSync(
  path.join(import.meta.dir, "0032_push_subscription_session_lifecycle.sql"),
  "utf8",
);
const down = readFileSync(
  path.join(import.meta.dir, "0032_push_subscription_session_lifecycle.down.sql"),
  "utf8",
);
const journal = readFileSync(
  path.join(import.meta.dir, "meta/_journal.json"),
  "utf8",
);

describe("push subscription session lifecycle migration", () => {
  test("preserves legacy null-session rows while disabling invalid bound rows", () => {
    expect(up).toContain('"push"."session_id" IS NOT NULL');
    expect(up).not.toContain('OR ("push"."session_id" IS NULL');
    expect(up).toContain('"push"."expiration_time" <= NOW()');
    expect(up).toContain('"session"."revoked_at" IS NULL');
    expect(up).toContain('"session"."expires_at" > NOW()');
    expect(up).toContain('"disabled_at" = COALESCE("push"."disabled_at", NOW())');
  });

  test("enforces ownership for rows that already reference a session", () => {
    expect(up).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "sessions_id_user_idx"');
    expect(up).toContain('CONSTRAINT "push_subscriptions_session_owner_fk"');
    expect(up).toContain('FOREIGN KEY ("session_id", "user_id")');
    expect(up).not.toContain('CONSTRAINT "push_subscriptions_active_session_required_check"');
  });

  test("rolls back constraints and the supporting index without deleting data", () => {
    expect(down).toContain('DROP CONSTRAINT IF EXISTS "push_subscriptions_session_owner_fk"');
    expect(down).toContain('DROP INDEX IF EXISTS "sessions_id_user_idx"');
    expect(down.toLowerCase()).not.toContain("delete from");
  });

  test("is registered as migration 0032", () => {
    const parsed = JSON.parse(journal) as {
      entries: Array<{ idx: number; tag: string }>;
    };

    expect(parsed.entries.at(-1)).toEqual({
      ...parsed.entries.at(-1),
      idx: 32,
      tag: "0032_push_subscription_session_lifecycle",
    });
  });
});
