import { createHash, randomBytes, randomUUID } from "crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "../client";
import { pushSubscriptions } from "../schema/push-subscriptions";
import { sessions } from "../schema/sessions";
import { users } from "../schema/users";
import type { AppUser } from "@/lib/platform/types";

export type SessionShell = "web" | "ios" | "android" | "wechat_mp";

export interface ResolvedSession {
  sessionId: string;
  user: AppUser;
}

export interface CreatedSession {
  sessionId: string;
  token: string;
  expiresAt: Date;
}

const SESSION_TTL_DAYS = 30;
// lastSeenAt is "recently active" telemetry with no sub-minute consumer.
// Refreshing it on every authenticated request would add a write round trip
// to the hottest paths (the 10s account poll, balance reads), so it only
// refreshes once it has aged past this threshold.
const LAST_SEEN_REFRESH_MS = 5 * 60 * 1000;

export async function createSession(input: {
  userId: string;
  shell: SessionShell;
  metadata?: { userAgent?: string; ip?: string };
}): Promise<CreatedSession> {
  const token = createSessionToken();
  const sessionId = createSessionId();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await db.insert(sessions).values({
    id: sessionId,
    userId: input.userId,
    shell: input.shell,
    tokenHash: hashSessionToken(token),
    expiresAt,
    metadata: input.metadata ?? {},
  });

  return { sessionId, token, expiresAt };
}

export async function getSessionByToken(
  token: string,
  now = new Date(),
): Promise<ResolvedSession | null> {
  const [row] = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      accountKind: users.accountKind,
      deletedAt: users.deletedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, hashSessionToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        isNull(users.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return null;

  // abs(): a DB-authored default on a non-UTC dev server can read back ahead
  // of the JS clock; treating that skew as stale rewrites it once with a
  // JS-authored value, after which the throttle behaves normally.
  if (Math.abs(now.getTime() - row.lastSeenAt.getTime()) >= LAST_SEEN_REFRESH_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: now })
      .where(eq(sessions.id, row.sessionId));
  }

  return {
    sessionId: row.sessionId,
    user: {
      id: row.userId,
      email: row.email,
      name: row.name,
      avatarUrl: row.avatarUrl,
      accountKind: normalizeAccountKind(row.accountKind),
    },
  };
}

export async function revokeSessionAndPushByToken(token: string): Promise<{
  revoked: boolean;
  disabledPushSubscriptions: number;
}> {
  const now = new Date();
  return db.transaction(async (tx) => {
    const [session] = await tx
      .update(sessions)
      .set({ revokedAt: now })
      .where(eq(sessions.tokenHash, hashSessionToken(token)))
      .returning({ id: sessions.id, userId: sessions.userId });

    if (!session) {
      return { revoked: false, disabledPushSubscriptions: 0 };
    }

    const disabledPushSubscriptions = await tx
      .update(pushSubscriptions)
      .set({ disabledAt: now, updatedAt: now })
      .where(
        and(
          isNull(pushSubscriptions.disabledAt),
          or(
            eq(pushSubscriptions.sessionId, session.id),
            and(
              eq(pushSubscriptions.userId, session.userId),
              isNull(pushSubscriptions.sessionId),
            ),
          ),
        ),
      )
      .returning({ id: pushSubscriptions.id });

    return {
      revoked: true,
      disabledPushSubscriptions: disabledPushSubscriptions.length,
    };
  });
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function createSessionId(): string {
  return `ses_${Date.now().toString(36)}_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}

function normalizeAccountKind(value: string): "local_creator" | "registered" {
  return value === "local_creator" ? "local_creator" : "registered";
}
