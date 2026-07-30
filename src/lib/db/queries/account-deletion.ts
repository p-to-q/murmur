import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  not,
  or,
  sql,
} from "drizzle-orm";

import { db } from "../client";
import {
  accountDeletionJobs,
  accountDeletionObjects,
  type AccountDeletionJob,
} from "../schema/account-deletion-jobs";
import { compositionEvents } from "../schema/composition-events";
import { emailVerificationCodes } from "../schema/email-verification-codes";
import { externalIdentities } from "../schema/external-identities";
import { musicJobs } from "../schema/music-jobs";
import { pushSubscriptions } from "../schema/push-subscriptions";
import { rateLimits } from "../schema/rate-limits";
import { sessions } from "../schema/sessions";
import { shareReferrals } from "../schema/share-referrals";
import { songs } from "../schema/songs";
import { users } from "../schema/users";
import { recordPendingRefundInTransaction } from "./notes-ledger";
import { COST } from "@murmur/core";

export const ACCOUNT_DELETION_GRACE_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_ERROR_LENGTH = 2_000;
const MUSIC_JOB_TERMINAL_STATUSES = [
  "succeeded", "failed", "canceled", "expired", "submission_unknown",
] as const;

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface AccountDeletionRequestResult {
  ok: true;
  deletedAt: Date;
  purgeAfter: Date;
  revokedSongs: number;
  revokedSessions: number;
  disabledPushSubscriptions: number;
  alreadyDeleted: boolean;
}

export async function requestAccountDeletionCleanup(
  tx: DbTransaction,
  input: { userId: string; now: Date },
): Promise<AccountDeletionRequestResult | { ok: false; reason: "user_not_found" }> {
  const [user] = await tx
    .select({
      id: users.id,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1)
    .for("update");

  if (!user) return { ok: false, reason: "user_not_found" };

  const deletedAt = user.deletedAt ?? input.now;
  const purgeAfter = new Date(deletedAt.getTime() + ACCOUNT_DELETION_GRACE_MS);

  if (!user.deletedAt) {
    await tx
      .update(users)
      .set({ deletedAt, updatedAt: input.now })
      .where(eq(users.id, input.userId));
  }

  const revokedSongs = await tx
    .update(songs)
    .set({ shareCode: null, visibility: "private", updatedAt: input.now })
    .where(eq(songs.userId, input.userId))
    .returning({ id: songs.id });

  const revokedSessions = await tx
    .update(sessions)
    .set({ revokedAt: input.now })
    .where(and(eq(sessions.userId, input.userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });

  const disabledPushSubscriptions = await tx
    .update(pushSubscriptions)
    .set({ disabledAt: input.now, updatedAt: input.now })
    .where(and(
      eq(pushSubscriptions.userId, input.userId),
      isNull(pushSubscriptions.disabledAt),
    ))
    .returning({ id: pushSubscriptions.id });

  await tx
    .insert(accountDeletionJobs)
    .values({
      userId: input.userId,
      requestedAt: deletedAt,
      purgeAfter,
      nextAttemptAt: purgeAfter,
    })
    .onConflictDoNothing({ target: accountDeletionJobs.userId });

  const cancellationRows = await tx
    .update(musicJobs)
    .set({
      status: sql`case
        when ${musicJobs.status} = 'accepted' then 'canceled'
        else 'cancel_requested'
      end`,
      cancelRequestedAt: input.now,
      leaseUntil: sql`case when ${musicJobs.status} = 'accepted' then null else ${musicJobs.leaseUntil} end`,
      nextRunAt: sql`case when ${musicJobs.status} = 'accepted' then null else ${input.now} end`,
      finishedAt: sql`case when ${musicJobs.status} = 'accepted' then ${input.now} else ${musicJobs.finishedAt} end`,
      updatedAt: input.now,
    })
    .where(and(
      eq(musicJobs.userId, input.userId),
      inArray(musicJobs.status, ["accepted", "submitting", "queued", "running"]),
    ))
    .returning({
      id: musicJobs.id,
      status: musicJobs.status,
      spendLedgerId: musicJobs.spendLedgerId,
    });
  for (const row of cancellationRows) {
    if (row.status !== "canceled" || !row.spendLedgerId) continue;
    await recordPendingRefundInTransaction(tx, {
      userId: input.userId,
      originalLedgerId: row.spendLedgerId,
      amount: COST.music_generate,
      spendReason: "spend:music_generate",
      source: "account_deletion",
      metadata: { jobId: row.id, trigger: "account_deletion" },
    });
  }

  return {
    ok: true,
    deletedAt,
    purgeAfter,
    revokedSongs: revokedSongs.length,
    revokedSessions: revokedSessions.length,
    disabledPushSubscriptions: disabledPushSubscriptions.length,
    alreadyDeleted: Boolean(user.deletedAt),
  };
}

export async function claimDueAccountDeletionJobs(input: {
  limit: number;
  leaseMs: number;
  now?: Date;
}): Promise<AccountDeletionJob[]> {
  const now = input.now ?? new Date();
  const limit = Math.max(1, Math.min(50, Math.trunc(input.limit)));
  const leaseUntil = new Date(now.getTime() + input.leaseMs);

  const candidates = await db
    .select({ userId: accountDeletionJobs.userId })
    .from(accountDeletionJobs)
    .where(and(
      not(eq(accountDeletionJobs.status, "completed")),
      lte(accountDeletionJobs.purgeAfter, now),
      lte(accountDeletionJobs.nextAttemptAt, now),
      or(lt(accountDeletionJobs.leaseUntil, now), isNull(accountDeletionJobs.leaseUntil)),
    ))
    .orderBy(asc(accountDeletionJobs.nextAttemptAt), asc(accountDeletionJobs.requestedAt))
    .limit(limit);

  if (candidates.length === 0) return [];

  return db
    .update(accountDeletionJobs)
    .set({
      status: "processing",
      leaseUntil,
      attempts: sql`${accountDeletionJobs.attempts} + 1`,
      updatedAt: now,
    })
    .where(and(
      inArray(accountDeletionJobs.userId, candidates.map((row) => row.userId)),
      not(eq(accountDeletionJobs.status, "completed")),
      lte(accountDeletionJobs.purgeAfter, now),
      lte(accountDeletionJobs.nextAttemptAt, now),
      or(lt(accountDeletionJobs.leaseUntil, now), isNull(accountDeletionJobs.leaseUntil)),
    ))
    .returning();
}

export async function snapshotAccountDeletionObjects(
  userId: string,
  now = new Date(),
): Promise<number> {
  return db.transaction(async (tx) => {
    const songKeys = await tx
      .select({ storageKey: songs.mp3StorageKey })
      .from(songs)
      .where(and(eq(songs.userId, userId), sql`${songs.mp3StorageKey} IS NOT NULL`));
    const jobArtifacts = await tx
      .select({ input: musicJobs.input, output: musicJobs.output })
      .from(musicJobs)
      .where(eq(musicJobs.userId, userId));

    const keys = new Set<string>();
    for (const row of songKeys) addStorageKey(keys, row.storageKey);
    for (const row of jobArtifacts) {
      addStorageKey(keys, row.input.humStorageKey);
      addStorageKey(keys, row.output?.storageKey);
    }
    if (keys.size === 0) return 0;

    const inserted = await tx
      .insert(accountDeletionObjects)
      .values([...keys].map((storageKey) => ({ userId, storageKey, nextAttemptAt: now })))
      .onConflictDoNothing()
      .returning({ storageKey: accountDeletionObjects.storageKey });
    return inserted.length;
  });
}

export async function listUnsettledAccountDeletionMusicJobs(
  userId: string,
): Promise<Array<{ id: string; userId: string }>> {
  return db
    .select({ id: musicJobs.id, userId: musicJobs.userId })
    .from(musicJobs)
    .where(and(
      eq(musicJobs.userId, userId),
      not(inArray(musicJobs.status, [...MUSIC_JOB_TERMINAL_STATUSES])),
    ))
    .orderBy(asc(musicJobs.createdAt));
}

export async function listPendingAccountDeletionObjects(
  userId: string,
  now = new Date(),
): Promise<string[]> {
  const rows = await db
    .select({ storageKey: accountDeletionObjects.storageKey })
    .from(accountDeletionObjects)
    .where(and(
      eq(accountDeletionObjects.userId, userId),
      isNull(accountDeletionObjects.deletedAt),
      lte(accountDeletionObjects.nextAttemptAt, now),
    ))
    .orderBy(asc(accountDeletionObjects.createdAt));
  return rows.map((row) => row.storageKey);
}

export async function markAccountDeletionObjectDeleted(input: {
  userId: string;
  storageKey: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  const [updated] = await db
    .update(accountDeletionObjects)
    .set({
      attempts: sql`${accountDeletionObjects.attempts} + 1`,
      deletedAt: now,
      lastError: null,
      updatedAt: now,
    })
    .where(and(
      eq(accountDeletionObjects.userId, input.userId),
      eq(accountDeletionObjects.storageKey, input.storageKey),
      isNull(accountDeletionObjects.deletedAt),
    ))
    .returning({ userId: accountDeletionObjects.userId });

  if (updated) {
    await db
      .update(accountDeletionJobs)
      .set({
        objectsDeleted: sql`${accountDeletionJobs.objectsDeleted} + 1`,
        updatedAt: now,
      })
      .where(eq(accountDeletionJobs.userId, input.userId));
  }
}

export async function countPendingAccountDeletionObjects(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(accountDeletionObjects)
    .where(and(
      eq(accountDeletionObjects.userId, userId),
      isNull(accountDeletionObjects.deletedAt),
    ));
  return row?.count ?? 0;
}

export async function markAccountDeletionJobRetry(input: {
  userId: string;
  error: string;
  nextAttemptAt: Date;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  await db
    .update(accountDeletionJobs)
    .set({
      status: "pending",
      leaseUntil: null,
      nextAttemptAt: input.nextAttemptAt,
      lastError: input.error.slice(0, MAX_ERROR_LENGTH),
      updatedAt: now,
    })
    .where(eq(accountDeletionJobs.userId, input.userId));
}

export async function markAccountDeletionObjectRetry(input: {
  userId: string;
  storageKey: string;
  error: string;
  nextAttemptAt: Date;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  await db
    .update(accountDeletionObjects)
    .set({
      attempts: sql`${accountDeletionObjects.attempts} + 1`,
      nextAttemptAt: input.nextAttemptAt,
      lastError: input.error.slice(0, MAX_ERROR_LENGTH),
      updatedAt: now,
    })
    .where(and(
      eq(accountDeletionObjects.userId, input.userId),
      eq(accountDeletionObjects.storageKey, input.storageKey),
      isNull(accountDeletionObjects.deletedAt),
    ));
}

/**
 * Remove creative and identity data while retaining the user id, purchases,
 * and Notes ledger required for billing/refund audit. The retained rows are
 * stripped of profile, provider payload, and free-form metadata.
 */
export async function finalizeAccountDeletionPurge(input: {
  userId: string;
  now?: Date;
}): Promise<boolean> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [job] = await tx
      .select({ status: accountDeletionJobs.status })
      .from(accountDeletionJobs)
      .where(eq(accountDeletionJobs.userId, input.userId))
      .limit(1)
      .for("update");
    if (!job || job.status === "completed") return false;

    const [pendingObjects] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(accountDeletionObjects)
      .where(and(
        eq(accountDeletionObjects.userId, input.userId),
        isNull(accountDeletionObjects.deletedAt),
      ));
    if ((pendingObjects?.count ?? 0) > 0) return false;

    // Re-read references under the finalization transaction. A request that
    // passed auth before deletion may have persisted a row after the prior
    // snapshot; defer so the next attempt can delete that newly referenced
    // object before removing its DB row.
    const currentSongKeys = await tx
      .select({ storageKey: songs.mp3StorageKey })
      .from(songs)
      .where(and(eq(songs.userId, input.userId), sql`${songs.mp3StorageKey} IS NOT NULL`));
    const currentJobArtifacts = await tx
      .select({ status: musicJobs.status, input: musicJobs.input, output: musicJobs.output })
      .from(musicJobs)
      .where(eq(musicJobs.userId, input.userId));
    if (currentJobArtifacts.some((row) => !isAccountDeletionMusicJobTerminal(row.status))) {
      return false;
    }
    const deletedObjectRows = await tx
      .select({ storageKey: accountDeletionObjects.storageKey })
      .from(accountDeletionObjects)
      .where(and(
        eq(accountDeletionObjects.userId, input.userId),
        sql`${accountDeletionObjects.deletedAt} IS NOT NULL`,
      ));
    const deletedKeys = new Set(deletedObjectRows.map((row) => row.storageKey));
    const currentKeys = new Set<string>();
    for (const row of currentSongKeys) addStorageKey(currentKeys, row.storageKey);
    for (const row of currentJobArtifacts) {
      addStorageKey(currentKeys, row.input.humStorageKey);
      addStorageKey(currentKeys, row.output?.storageKey);
    }
    if ([...currentKeys].some((storageKey) => !deletedKeys.has(storageKey))) return false;

    await tx.delete(compositionEvents).where(eq(compositionEvents.userId, input.userId));
    await tx.delete(songs).where(eq(songs.userId, input.userId));
    await tx.delete(musicJobs).where(eq(musicJobs.userId, input.userId));
    await tx.delete(sessions).where(eq(sessions.userId, input.userId));
    await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.userId, input.userId));
    await tx.delete(externalIdentities).where(eq(externalIdentities.userId, input.userId));
    await tx.delete(shareReferrals).where(or(
      eq(shareReferrals.referrerUserId, input.userId),
      eq(shareReferrals.inviteeUserId, input.userId),
    ));
    await tx.delete(rateLimits).where(
      sql`right(${rateLimits.bucketKey}, char_length(${input.userId}) + 1) = ':' || ${input.userId}`,
    );

    const [user] = await tx
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (user?.email) {
      await tx
        .delete(emailVerificationCodes)
        .where(eq(emailVerificationCodes.email, user.email));
    }

    await tx
      .update(users)
      .set({
        email: null,
        name: null,
        avatarUrl: null,
        accountKind: "deleted",
        dailyFreeNotesBalance: 0,
        planTier: "free",
        updatedAt: now,
      })
      .where(eq(users.id, input.userId));

    await tx
      .delete(accountDeletionObjects)
      .where(eq(accountDeletionObjects.userId, input.userId));

    await tx
      .update(accountDeletionJobs)
      .set({
        status: "completed",
        completedAt: now,
        leaseUntil: null,
        lastError: null,
        updatedAt: now,
      })
      .where(eq(accountDeletionJobs.userId, input.userId));
    return true;
  });
}

export function accountDeletionRetryAt(attempts: number, now = new Date()): Date {
  const exponent = Math.max(0, Math.min(9, Math.trunc(attempts) - 1));
  const delayMs = Math.min(24 * 60 * 60 * 1_000, 5 * 60 * 1_000 * (2 ** exponent));
  return new Date(now.getTime() + delayMs);
}

export function isAccountDeletionMusicJobTerminal(status: string): boolean {
  return MUSIC_JOB_TERMINAL_STATUSES.includes(
    status as (typeof MUSIC_JOB_TERMINAL_STATUSES)[number],
  );
}

function addStorageKey(keys: Set<string>, value: string | null | undefined): void {
  const key = value?.trim();
  if (key) keys.add(key);
}
