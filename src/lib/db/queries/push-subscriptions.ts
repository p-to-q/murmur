import { randomUUID } from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";

import { db } from "../client";
import { pushSubscriptions } from "../schema/push-subscriptions";
import { sessions } from "../schema/sessions";
import type { PushSubscriptionRecord } from "../schema/push-subscriptions";
import {
  activePushSubscriptionsForUserQuery,
  activePushSubscriptionsPageQuery,
} from "./push-subscription-delivery-query";

export type WebPushSubscriptionJSON = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

export async function upsertPushSubscription(input: {
  userId: string;
  sessionId: string;
  subscription: WebPushSubscriptionJSON;
  userAgent?: string | null;
  locale?: string | null;
  timezone?: string | null;
}): Promise<PushSubscriptionRecord> {
  const now = new Date();
  const expirationTime =
    typeof input.subscription.expirationTime === "number"
      ? new Date(input.subscription.expirationTime)
      : null;

  if (!input.sessionId) {
    throw new Error("Cannot attach push without a persistent session");
  }
  if (expirationTime && expirationTime <= now) {
    throw new Error("Cannot attach an expired push subscription");
  }

  return db.transaction(async (tx) => {
    const [activeSession] = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.id, input.sessionId),
          eq(sessions.userId, input.userId),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
        ),
      )
      .for("update")
      .limit(1);
    if (!activeSession) {
      throw new Error("Cannot attach push to an inactive session");
    }

    const [row] = await tx
      .insert(pushSubscriptions)
      .values({
        id: createPushSubscriptionId(),
        userId: input.userId,
        sessionId: input.sessionId,
        endpoint: input.subscription.endpoint,
        p256dh: input.subscription.keys.p256dh,
        auth: input.subscription.keys.auth,
        expirationTime,
        shell: "web",
        userAgent: input.userAgent ?? null,
        metadata: {
          locale: input.locale ?? undefined,
          timezone: input.timezone ?? undefined,
        },
        lastSeenAt: now,
        updatedAt: now,
        disabledAt: null,
      })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: {
          userId: input.userId,
          sessionId: input.sessionId,
          p256dh: input.subscription.keys.p256dh,
          auth: input.subscription.keys.auth,
          expirationTime,
          shell: "web",
          userAgent: input.userAgent ?? null,
          metadata: {
            locale: input.locale ?? undefined,
            timezone: input.timezone ?? undefined,
          },
          lastSeenAt: now,
          updatedAt: now,
          disabledAt: null,
        },
      })
      .returning();

    return row;
  });
}

export async function disablePushSubscriptionByEndpoint(endpoint: string) {
  const now = new Date();
  const rows = await db
    .update(pushSubscriptions)
    .set({ disabledAt: now, updatedAt: now })
    .where(eq(pushSubscriptions.endpoint, endpoint))
    .returning({ id: pushSubscriptions.id });
  return rows.length > 0;
}

export async function disablePushSubscriptionForUser(
  endpoint: string,
  userId: string,
) {
  const now = new Date();
  const rows = await db
    .update(pushSubscriptions)
    .set({ disabledAt: now, updatedAt: now })
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)))
    .returning({ id: pushSubscriptions.id });
  return rows.length > 0;
}

export async function getActivePushSubscriptionsForUser(userId: string) {
  return activePushSubscriptionsForUserQuery(userId);
}

/**
 * Default page size for walking every active subscription. Kept modest so a
 * single broadcast never buffers the entire population in memory.
 */
export const ACTIVE_PUSH_SUBSCRIPTIONS_PAGE_SIZE = 500;

/**
 * Fetch one keyset page whose Push endpoint and owning session are both active,
 * ordered by the immutable primary key. Pass the last returned row's `id` as
 * `after` to fetch the next page; an empty result means the walk is complete.
 *
 * Keying on `id` (rather than `last_seen_at`, which is rewritten on every
 * heartbeat/upsert) makes the walk stable: each active subscription is visited
 * exactly once even while rows are concurrently inserted, re-subscribed, or
 * disabled mid-broadcast. Backed by the `push_subscriptions_active_id_idx`
 * partial index (`WHERE disabled_at IS NULL`).
 */
export async function getActivePushSubscriptionsPage(options?: {
  after?: string | null;
  limit?: number;
}): Promise<PushSubscriptionRecord[]> {
  const after = options?.after ?? null;
  const limit = options?.limit ?? ACTIVE_PUSH_SUBSCRIPTIONS_PAGE_SIZE;
  return activePushSubscriptionsPageQuery({ after, limit });
}

function createPushSubscriptionId(): string {
  return `push_${Date.now().toString(36)}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}
