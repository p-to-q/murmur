import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  activePushSubscriptionsForUserQuery,
  activePushSubscriptionsPageQuery,
} from "./push-subscription-delivery-query";

const NOW = new Date("2026-07-30T12:00:00.000Z");

describe("active push delivery queries", () => {
  test("user delivery requires an owned, unrevoked, unexpired session and live endpoint", () => {
    const query = activePushSubscriptionsForUserQuery("usr_push", NOW).toSQL();

    expect(query.sql).toContain('inner join "sessions"');
    expect(query.sql).toContain('"sessions"."id" = "push_subscriptions"."session_id"');
    expect(query.sql).toContain('"sessions"."user_id" = "push_subscriptions"."user_id"');
    expect(query.sql).toContain('"push_subscriptions"."disabled_at" is null');
    expect(query.sql).toContain('"push_subscriptions"."expiration_time" is null');
    expect(query.sql).toContain('"push_subscriptions"."expiration_time" >');
    expect(query.sql).toContain('"sessions"."revoked_at" is null');
    expect(query.sql).toContain('"sessions"."expires_at" >');
  });

  test("broadcast pages use the same lifecycle filters and retain keyset pagination", () => {
    const query = activePushSubscriptionsPageQuery({
      after: "push_cursor",
      limit: 50,
      now: NOW,
    }).toSQL();

    expect(query.sql).toContain('inner join "sessions"');
    expect(query.sql).toContain('"sessions"."revoked_at" is null');
    expect(query.sql).toContain('"sessions"."expires_at" >');
    expect(query.sql).toContain('"push_subscriptions"."expiration_time" >');
    expect(query.sql).toContain('"push_subscriptions"."id" >');
    expect(query.sql).toContain('order by "push_subscriptions"."id" asc');
    expect(query.sql).toContain("limit");
  });

  test("subscription writes lock the same valid session row used by logout", () => {
    const source = readFileSync(
      new URL("./push-subscriptions.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain('eq(sessions.id, input.sessionId)');
    expect(source).toContain('eq(sessions.userId, input.userId)');
    expect(source).toContain('isNull(sessions.revokedAt)');
    expect(source).toContain('gt(sessions.expiresAt, now)');
    expect(source).toContain('.for("update")');
    expect(source).toContain('sessionId: input.sessionId');
    expect(source).not.toContain('sessionId: input.sessionId ?? null');
  });
});
