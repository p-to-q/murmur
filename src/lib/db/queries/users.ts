import { and, eq, ilike } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "../client";
import { users, type User } from "../schema/users";
import { externalIdentities } from "../schema/external-identities";
import { notesLedger } from "../schema/notes-ledger";
import { GRANTS, LOCAL_CREATOR_FREE_NOTES } from "@murmur/core";

export async function getUserById(id: string): Promise<User | undefined> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0];
}

export async function upsertUser(data: {
  id: string;
  email?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
}): Promise<User> {
  const rows = await db
    .insert(users)
    .values(data)
    .onConflictDoUpdate({
      target: users.id,
      set: {
        email: data.email ?? null,
        name: data.name ?? null,
        avatarUrl: data.avatarUrl ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return rows[0];
}

export async function updateUser(
  id: string,
  data: { name?: string | null; avatarUrl?: string | null }
): Promise<User | undefined> {
  if (Object.keys(data).length === 0) return getUserById(id);

  const rows = await db
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  return rows[0];
}

export async function deleteUser(id: string): Promise<boolean> {
  const rows = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
  return rows.length > 0;
}

/** Trim + lowercase. OIDC emails are ASCII, so toLowerCase is safe here. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface GoogleProfileInput {
  /** Google OIDC `sub` (account.providerAccountId). */
  googleId: string;
  /** Caller guarantees this is non-empty. */
  email: string;
  name: string | null;
  image: string | null;
  /** Existing Local Creator user from the same browser session, if any. */
  localCreatorUserId?: string | null;
}

export async function createLocalCreatorUser(): Promise<User> {
  const userId = `lc_${ulid()}`;

  return db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        id: userId,
        email: null,
        name: "Local Creator",
        avatarUrl: null,
        regionId: "intl",
        accountKind: "local_creator",
        notesBalance: LOCAL_CREATOR_FREE_NOTES,
        planTier: "free",
      })
      .returning();

    await tx.insert(notesLedger).values({
      id: `nle_${ulid()}`,
      userId,
      delta: LOCAL_CREATOR_FREE_NOTES,
      reason: "grant:local_creator",
      externalRef: "local_creator_initial",
      metadata: {
        source: "local_creator_bootstrap",
      },
    });

    return user;
  });
}

/**
 * Idempotently ensure a murmur user + google `external_identities` row exist
 * for a Google sign-in, then return the resolved user id.
 *
 * Resolution order:
 *   1. identity already linked by (google, googleId)  → refresh profile.
 *   2. no identity, but a user already has this email  → link a new identity to
 *      that user. This is the fix for the silent lockout: previously a fresh
 *      `users` insert would hit the `users_email_unique` constraint and the
 *      whole callback was swallowed into `return false`.
 *   3. brand new                                       → create user + identity
 *      atomically inside one transaction.
 *
 * Concurrency: the identity insert is guarded by `onConflictDoNothing` on the
 * `(provider, external_id)` unique index; if a parallel first sign-in won the
 * race we re-select the winning row. Throws on genuine infra/DB failure so the
 * caller can surface it instead of silently denying access.
 */
export async function upsertGoogleUser(
  profile: GoogleProfileInput,
): Promise<{ userId: string; created: boolean }> {
  const email = normalizeEmail(profile.email);
  const name = profile.name?.trim() || email.split("@")[0];
  const avatarUrl = profile.image ?? null;
  const localCreatorUserId = normalizeLocalCreatorUserId(profile.localCreatorUserId);

  // 1) Fast path: identity already exists — just refresh the cached profile.
  const [identity] = await db
    .select({ userId: externalIdentities.userId })
    .from(externalIdentities)
    .where(
      and(
        eq(externalIdentities.provider, "google"),
        eq(externalIdentities.externalId, profile.googleId),
      ),
    )
    .limit(1);

  if (identity) {
    await db
      .update(users)
      .set({ name, avatarUrl, updatedAt: new Date() })
      .where(eq(users.id, identity.userId));
    return { userId: identity.userId, created: false };
  }

  // 2) + 3) + 4) No identity yet — create, link, or promote a Local Creator atomically.
  return db.transaction(async (tx) => {
    // Case-insensitive lookup so a pre-existing (possibly mixed-case) row is
    // reused, not duplicated — a duplicate insert would hit users_email_unique.
    const [existingByEmail] = await tx
      .select({ id: users.id })
      .from(users)
      .where(ilike(users.email, email))
      .limit(1);

    let userId: string;
    let created: boolean;
    if (existingByEmail) {
      userId = existingByEmail.id;
      created = false;
      // Refresh profile only; leave the stored email's case untouched to avoid
      // colliding with any rare case-variant row.
      await tx
        .update(users)
        .set({ name, avatarUrl, updatedAt: new Date() })
        .where(eq(users.id, userId));
    } else {
      const localCreator = localCreatorUserId
        ? await lockPromotableLocalCreator(tx, localCreatorUserId)
        : null;

      if (localCreator) {
        userId = localCreator.id;
        created = false;
        await promoteLocalCreatorToRegistered(tx, {
          userId,
          email,
          name,
          avatarUrl,
        });
      } else {
        userId = ulid();
        created = true;
        await tx.insert(users).values({
          id: userId,
          email,
          name,
          avatarUrl,
          regionId: "intl",
          accountKind: "registered",
          planTier: "free",
        });
      }
    }

    // Insert the identity; tolerate a concurrent first sign-in winning the race.
    const inserted = await tx
      .insert(externalIdentities)
      .values({
        id: `eid_${ulid()}`,
        userId,
        provider: "google",
        externalId: profile.googleId,
        metadata: { email, name },
      })
      .onConflictDoNothing({
        target: [externalIdentities.provider, externalIdentities.externalId],
      })
      .returning({ userId: externalIdentities.userId });

    if (inserted[0]) return { userId: inserted[0].userId, created };

    // Race lost: the identity now exists — re-select the winning row.
    const [winner] = await tx
      .select({ userId: externalIdentities.userId })
      .from(externalIdentities)
      .where(
        and(
          eq(externalIdentities.provider, "google"),
          eq(externalIdentities.externalId, profile.googleId),
        ),
      )
      .limit(1);

    if (!winner) {
      throw new Error("identity upsert: conflict fired with no resolvable row");
    }
    return { userId: winner.userId, created: false };
  });
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lockPromotableLocalCreator(
  tx: DbTransaction,
  userId: string,
): Promise<{ id: string } | null> {
  const [user] = await tx
    .select({
      id: users.id,
      accountKind: users.accountKind,
      email: users.email,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .for("update");

  if (!user || user.accountKind !== "local_creator" || user.email) return null;
  return { id: user.id };
}

async function promoteLocalCreatorToRegistered(
  tx: DbTransaction,
  input: {
    userId: string;
    email: string;
    name: string;
    avatarUrl: string | null;
  },
): Promise<void> {
  const targetBalance = GRANTS.signup_bonus;
  const [current] = await tx
    .select({ notesBalance: users.notesBalance })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  const notesBalance = current?.notesBalance ?? 0;
  const [existingLedger] = await tx
    .select({ id: notesLedger.id })
    .from(notesLedger)
    .where(eq(notesLedger.userId, input.userId))
    .limit(1);

  const nextBalance = Math.max(notesBalance, targetBalance);
  const grantAmount = existingLedger
    ? Math.max(0, nextBalance - notesBalance)
    : nextBalance;

  if (grantAmount > 0) {
    await tx
      .insert(notesLedger)
      .values({
        id: `nle_${ulid()}`,
        userId: input.userId,
        delta: grantAmount,
        reason: "grant:signup_bonus",
        externalRef: "local_creator_promotion",
        metadata: {
          source: "local_creator_promotion",
          targetBalance,
          previousBalance: notesBalance,
        },
      })
      .onConflictDoNothing();
  }

  await tx
    .update(users)
    .set({
      email: input.email,
      name: input.name,
      avatarUrl: input.avatarUrl,
      accountKind: "registered",
      notesBalance: nextBalance,
      promotedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, input.userId));
}

function normalizeLocalCreatorUserId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.startsWith("lc_") ? trimmed : null;
}
