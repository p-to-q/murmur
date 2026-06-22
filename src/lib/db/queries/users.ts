import { and, eq, ilike } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "../client";
import { users, type User } from "../schema/users";
import { externalIdentities } from "../schema/external-identities";
import { notesLedger } from "../schema/notes-ledger";
import { GRANTS, LOCAL_CREATOR_FREE_NOTES } from "@murmur/core";
import type { UserRegistrationKind } from "@/lib/auth/registration-kind";

export async function getUserById(id: string): Promise<User | undefined> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

export async function getUserByEmail(email: string): Promise<User | undefined> {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0];
}

export async function getIdentityProvidersForUser(userId: string): Promise<string[]> {
  const rows = await db
    .select({ provider: externalIdentities.provider })
    .from(externalIdentities)
    .where(eq(externalIdentities.userId, userId));

  return rows.map((row) => row.provider);
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

export interface OAuthProfileInput {
  provider: string;
  externalId: string;
  email: string;
  name: string | null;
  image: string | null;
  localCreatorUserId?: string | null;
}

/** @deprecated Use {@link OAuthProfileInput} with {@link upsertOAuthUser}. */
export interface GoogleProfileInput {
  googleId: string;
  email: string;
  name: string | null;
  image: string | null;
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
 * Idempotently ensure a murmur user + external_identities row exist for an
 * OAuth / email sign-in, then return the resolved user id.
 *
 * Resolution order:
 *   1. identity already linked by (provider, externalId)  → refresh profile.
 *   2. no identity, but a user already has this email     → link identity.
 *   3. local creator in session                           → promote + link.
 *   4. brand new                                          → create user + identity.
 *
 * Concurrency: the identity insert uses onConflictDoNothing on the
 * (provider, external_id) unique index; a parallel first sign-in that won
 * the race is re-selected. Throws on genuine infra/DB failure.
 */
export async function upsertOAuthUser(
  profile: OAuthProfileInput,
): Promise<{ userId: string; created: boolean; registrationKind: UserRegistrationKind }> {
  const { provider, externalId } = profile;
  const email = normalizeEmail(profile.email);
  const name = profile.name?.trim() || email.split("@")[0];
  const avatarUrl = profile.image ?? null;
  const localCreatorUserId = normalizeLocalCreatorUserId(profile.localCreatorUserId);

  const [identity] = await db
    .select({ userId: externalIdentities.userId })
    .from(externalIdentities)
    .where(
      and(
        eq(externalIdentities.provider, provider),
        eq(externalIdentities.externalId, externalId),
      ),
    )
    .limit(1);

  if (identity) {
    await db
      .update(users)
      .set({ name, avatarUrl, updatedAt: new Date() })
      .where(eq(users.id, identity.userId));
    return { userId: identity.userId, created: false, registrationKind: "existing_identity" };
  }

  return db.transaction(async (tx) => {
    const [existingByEmail] = await tx
      .select({ id: users.id })
      .from(users)
      .where(ilike(users.email, email))
      .limit(1);

    let userId: string;
    let created: boolean;
    let registrationKind: UserRegistrationKind;
    if (existingByEmail) {
      userId = existingByEmail.id;
      created = false;
      registrationKind = "existing_user";
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
        registrationKind = "local_creator_promotion";
        await promoteLocalCreatorToRegistered(tx, {
          userId,
          email,
          name,
          avatarUrl,
        });
      } else {
        userId = ulid();
        created = true;
        registrationKind = "new_user";
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

    const inserted = await tx
      .insert(externalIdentities)
      .values({
        id: `eid_${ulid()}`,
        userId,
        provider,
        externalId,
        metadata: { email, name },
      })
      .onConflictDoNothing({
        target: [externalIdentities.provider, externalIdentities.externalId],
      })
      .returning({ userId: externalIdentities.userId });

    if (inserted[0]) return { userId: inserted[0].userId, created, registrationKind };

    const [winner] = await tx
      .select({ userId: externalIdentities.userId })
      .from(externalIdentities)
      .where(
        and(
          eq(externalIdentities.provider, provider),
          eq(externalIdentities.externalId, externalId),
        ),
      )
      .limit(1);

    if (!winner) {
      throw new Error("identity upsert: conflict fired with no resolvable row");
    }
    return { userId: winner.userId, created: false, registrationKind: "existing_identity" };
  });
}

/** @deprecated Use {@link upsertOAuthUser}. */
export async function upsertGoogleUser(
  profile: GoogleProfileInput,
): Promise<{ userId: string; created: boolean; registrationKind: UserRegistrationKind }> {
  return upsertOAuthUser({
    provider: "google",
    externalId: profile.googleId,
    email: profile.email,
    name: profile.name,
    image: profile.image,
    localCreatorUserId: profile.localCreatorUserId,
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
