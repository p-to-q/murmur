import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const up = readFileSync(
  path.join(import.meta.dir, "0031_push_subscriptions_active_session_index.sql"),
  "utf8",
);
const down = readFileSync(
  path.join(import.meta.dir, "0031_push_subscriptions_active_session_index.down.sql"),
  "utf8",
);

describe("push subscription session index migration", () => {
  test("indexes only active subscriptions by session", () => {
    expect(up).toContain('ON "push_subscriptions" USING btree ("session_id")');
    expect(up).toContain('WHERE "disabled_at" IS NULL');
  });

  test("can remove the rollout index without touching subscription data", () => {
    expect(down).toContain(
      'DROP INDEX IF EXISTS "push_subscriptions_active_session_idx"',
    );
    expect(down.toLowerCase()).not.toContain("delete from");
  });
});
