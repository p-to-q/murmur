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
      return db.transaction((tx) => mutateBucket(tx, key, opts, now ?? new Date(), "hit"));
    },

    async refund(key: string, opts: RateLimitOptions, now?: Date): Promise<void> {
      await db.transaction((tx) => mutateBucket(tx, key, opts, now ?? new Date(), "refund"));
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

  const [row] = await tx
    .select({
      tokens: rateLimits.tokens,
      updatedAt: rateLimits.updatedAt,
    })
    .from(rateLimits)
    .where(eq(rateLimits.bucketKey, key))
    .for("update")
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

  if (Math.random() < 0.01) {
    await tx
      .delete(rateLimits)
      .where(sql`${rateLimits.expiresAt} < ${now}`);
  }

  return result.result;
}

async function lockBucket(tx: RateLimitTransaction, key: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
}
