import { and, eq, ilike } from "drizzle-orm";
import { ulid } from "ulid";
import { db } from "../client";
import { users, type User } from "../schema/users";
import { externalIdentities } from "../schema/external-identities";

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

  // 2) + 3) No identity yet — create or link atomically.
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
      userId = ulid();
      created = true;
      await tx.insert(users).values({
        id: userId,
        email,
        name,
        avatarUrl,
        regionId: "intl",
        planTier: "free",
      });
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
