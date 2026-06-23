import { createHash, randomBytes, randomUUID } from "crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "../client";
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

  await db
    .update(sessions)
    .set({ lastSeenAt: now })
    .where(eq(sessions.id, row.sessionId));

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

export async function revokeSessionByToken(token: string): Promise<boolean> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.tokenHash, hashSessionToken(token)))
    .returning({ id: sessions.id });
  return rows.length > 0;
}

export async function revokeSessionsForUser(userId: string): Promise<number> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return rows.length;
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
