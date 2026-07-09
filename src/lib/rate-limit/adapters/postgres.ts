import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { rateLimits } from "@/lib/db/schema/rate-limits";
import { decideHit, decideRefund } from "../token-bucket";
import {
  type RateLimitOptions,
  type RateLimitResult,
  type RateLimitState,
  type RateLimitStore,
} from "../types";

type RateLimitTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function createPostgresRateLimitStore(): RateLimitStore {
  return {
    driver: "postgres",

    async hit(key: string, opts: RateLimitOptions, now?: Date): Promise<RateLimitResult> {
      const at = now ?? new Date();
      const result = await db.transaction((tx) => mutateBucket(tx, key, opts, at, "hit"));
      maybeSweepExpired(at);
      return result;
    },

    async refund(key: string, opts: RateLimitOptions, now?: Date): Promise<void> {
      const at = now ?? new Date();
      await db.transaction((tx) => mutateBucket(tx, key, opts, at, "refund"));
      maybeSweepExpired(at);
    },

    async reset(key: string): Promise<void> {
      await db.transaction(async (tx) => {
        await lockBucket(tx, key);
        await tx.delete(rateLimits).where(eq(rateLimits.bucketKey, key));
      });
    },

    async resetAll(): Promise<void> {
      await db.transaction(async (tx) => {
        await tx.execute(sql`LOCK TABLE "rate_limits" IN EXCLUSIVE MODE`);
        await tx.delete(rateLimits);
      });
    },
  };
}

async function mutateBucket(
  tx: RateLimitTransaction,
  key: string,
  opts: RateLimitOptions,
  now: Date,
  mode: "hit" | "refund",
): Promise<RateLimitResult> {
  const nowMs = now.getTime();
  await lockBucket(tx, key);

  // The advisory xact lock above already serializes every mutation of this
  // bucket key (all writers go through lockBucket), so a FOR UPDATE row lock
  // here would only add a second lock acquisition per request.
  const [row] = await tx
    .select({
      tokens: rateLimits.tokens,
      updatedAt: rateLimits.updatedAt,
    })
    .from(rateLimits)
    .where(eq(rateLimits.bucketKey, key))
    .limit(1);

  const prevState: RateLimitState | null = row
    ? { tokens: row.tokens, updatedAtMs: row.updatedAt.getTime() }
    : null;

  const hitDecision = decideHit(prevState, opts, nowMs);
  const result =
    mode === "hit"
      ? hitDecision
      : { result: hitDecision.result, nextState: decideRefund(prevState, opts, nowMs) };
  const nextState = result.nextState;
  const expiresAt = new Date(nextState.updatedAtMs + opts.refillWindowMs * 2);

  await tx
    .insert(rateLimits)
    .values({
      bucketKey: key,
      tokens: nextState.tokens,
      updatedAt: new Date(nextState.updatedAtMs),
      expiresAt,
    })
    .onConflictDoUpdate({
      target: rateLimits.bucketKey,
      set: {
        tokens: nextState.tokens,
        updatedAt: new Date(nextState.updatedAtMs),
        expiresAt,
      },
    });

  return result.result;
}

/**
 * Lottery cleanup of expired buckets, run OUTSIDE the hit/refund transaction
 * so a table sweep never extends how long a request holds its bucket's
 * advisory lock. Best-effort by design: a missed sweep just re-rolls on a
 * later request, and `rate_limits_expires_at_idx` keeps the delete cheap.
 */
function maybeSweepExpired(now: Date): void {
  if (Math.random() >= 0.01) return;
  void db
    .delete(rateLimits)
    .where(sql`${rateLimits.expiresAt} < ${now}`)
    .catch(() => {
      // Sweep failures must never surface into the request path.
    });
}

async function lockBucket(tx: RateLimitTransaction, key: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
}
