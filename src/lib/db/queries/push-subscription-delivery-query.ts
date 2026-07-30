import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  isNull,
  or,
} from "drizzle-orm";

import { db } from "../client";
import { pushSubscriptions } from "../schema/push-subscriptions";
import { sessions } from "../schema/sessions";

function activeDeliveryPredicate(now: Date) {
  return and(
    isNull(pushSubscriptions.disabledAt),
    or(
      isNull(pushSubscriptions.expirationTime),
      gt(pushSubscriptions.expirationTime, now),
    ),
    isNull(sessions.revokedAt),
    gt(sessions.expiresAt, now),
  );
}

function activeSessionJoin() {
  return and(
    eq(sessions.id, pushSubscriptions.sessionId),
    eq(sessions.userId, pushSubscriptions.userId),
  );
}

export function activePushSubscriptionsForUserQuery(userId: string, now = new Date()) {
  return db
    .select(getTableColumns(pushSubscriptions))
    .from(pushSubscriptions)
    .innerJoin(sessions, activeSessionJoin())
    .where(and(eq(pushSubscriptions.userId, userId), activeDeliveryPredicate(now)))
    .orderBy(desc(pushSubscriptions.lastSeenAt));
}

export function activePushSubscriptionsPageQuery(options: {
  after: string | null;
  limit: number;
  now?: Date;
}) {
  const predicate = and(
    activeDeliveryPredicate(options.now ?? new Date()),
    options.after == null ? undefined : gt(pushSubscriptions.id, options.after),
  );
  return db
    .select(getTableColumns(pushSubscriptions))
    .from(pushSubscriptions)
    .innerJoin(sessions, activeSessionJoin())
    .where(predicate)
    .orderBy(asc(pushSubscriptions.id))
    .limit(options.limit);
}
