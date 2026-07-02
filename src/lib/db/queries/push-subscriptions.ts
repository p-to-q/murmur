import { randomUUID } from "crypto";
import { and, desc, eq, isNull } from "drizzle-orm";

import { db } from "../client";
import { pushSubscriptions } from "../schema/push-subscriptions";
import type { PushSubscriptionRecord } from "../schema/push-subscriptions";

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
  sessionId?: string | null;
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

  const [row] = await db
    .insert(pushSubscriptions)
    .values({
      id: createPushSubscriptionId(),
      userId: input.userId,
      sessionId: input.sessionId ?? null,
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
        sessionId: input.sessionId ?? null,
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
  return db
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.disabledAt)))
    .orderBy(desc(pushSubscriptions.lastSeenAt));
}

export async function getActivePushSubscriptions(limit = 1000) {
  return db
    .select()
    .from(pushSubscriptions)
    .where(isNull(pushSubscriptions.disabledAt))
    .orderBy(desc(pushSubscriptions.lastSeenAt))
    .limit(limit);
}

function createPushSubscriptionId(): string {
  return `push_${Date.now().toString(36)}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}
